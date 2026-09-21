import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

import 'fixtures/gated_store.dart';

/// No timers and no sleeping here: hung calls are futures that never complete,
/// and every ordering is decided by awaiting or by microtask turns.
Future<void> _turns([int n = 20]) async {
  for (var i = 0; i < n; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late GatedStore store;

  setUp(() {
    store = GatedStore();
    TokenStorage.resetSerialQueueForTest(store: store);
  });

  tearDown(TokenStorage.resetSerialQueueForTest);

  Map<String, String> signedIn() => {
        'blynk_access_token': 'access-1',
        'blynk_refresh_token': 'refresh-1',
        'blynk_user_profile': '{"id":"u1"}',
      };

  group('storage paths', () {
    test('write, read and clear round-trip', () async {
      await TokenStorage.saveTokens(accessToken: 'a', refreshToken: 'r');
      await TokenStorage.saveUserCache('{"id":"u"}');

      expect(await TokenStorage.getAccessToken(), 'a');
      expect(await TokenStorage.getRefreshToken(), 'r');
      expect(await TokenStorage.getUserCache(), '{"id":"u"}');
      expect(await TokenStorage.takeRefreshTokenAndClearAll(), 'r');

      expect(store.data, isEmpty);
    });

    test('guarded writes write when valid and refuse when not', () async {
      expect(
        await TokenStorage.saveTokensIf(stillValid: () => true, accessToken: 'a', refreshToken: 'r'),
        isTrue,
      );
      expect(
        await TokenStorage.saveUserCacheIf(stillValid: () => false, userJson: 'x'),
        isFalse,
      );
      expect(store.data.keys, containsAll(['blynk_access_token', 'blynk_refresh_token']));
      expect(store.data.containsKey('blynk_user_profile'), isFalse);
    });

    test('a failing delete does not poison the queue: the next operation still runs', () async {
      store.data.addAll(signedIn());
      store.failDeletes = true;
      await TokenStorage.clearAll(); // completes, swallowing the failures

      store.failDeletes = false;
      await TokenStorage.clearAll();

      expect(store.data, isEmpty);
    });
  });

  group('when secure storage never answers a clear', () {
    test('logout still signs the customer out in memory and in the UI at once', () async {
      store.data.addAll(signedIn());
      final calls = <String>[];
      final auth = AuthProvider(
        request: ({methodType, url, body}) async {
          calls.add('$methodType $url');
          return {'success': true};
        },
      );
      await auth.restoreSession();
      store.gate = (op, key) => op == 'delete' ? Completer<void>().future : null; // every delete hangs
      var notified = 0;
      auth.addListener(() => notified++);

      final done = auth.logout(); // never completes: the clear is stuck
      await _turns();

      expect(auth.isAuthenticated, isFalse, reason: 'signed out in memory before any storage call');
      expect(auth.currentUser, isNull);
      expect(notified, greaterThan(0), reason: 'listeners (the UI) were told');
      var finished = false;
      unawaited(done.then((_) => finished = true));
      await _turns();
      expect(finished, isFalse, reason: 'documents the accepted residual: the disk clear is still pending');
      auth.dispose();
    });

    test('endSession announces the forced end before storage has answered', () async {
      store.data.addAll(signedIn());
      final auth = AuthProvider(request: ({methodType, url, body}) async => {'success': true});
      await auth.restoreSession();
      store.gate = (op, key) => op == 'delete' ? Completer<void>().future : null;
      var announced = false;
      auth.onSessionEnded.listen((_) => announced = true);

      unawaited(auth.endSession());
      await _turns();

      expect(announced, isTrue, reason: 'the UI does not wait for the storage clear');
      expect(auth.isAuthenticated, isFalse);
      auth.dispose();
    });
  });

  group('epoch checks around storage reads', () {
    test('refreshToken() whose storage read straddles a logout does not refresh', () async {
      store.data.addAll(signedIn());
      final calls = <String>[];
      final auth = AuthProvider(
        request: ({methodType, url, body}) async {
          calls.add('$methodType $url');
          return {'success': true};
        },
      );
      await auth.restoreSession();
      calls.clear();
      final release = Completer<void>();
      var armed = true;
      store.gate = (op, key) {
        if (armed && op == 'read' && key == 'blynk_refresh_token') {
          armed = false;
          return release.future;
        }
        return null;
      };

      final refresh = auth.refreshToken(); // its read is held...
      await _turns(2);
      await auth.logout(); // ...while the customer logs out
      release.complete();

      expect(await refresh, isFalse);
      expect(calls.where((c) => c.contains('/auth/refresh')), isEmpty);
      auth.dispose();
    });

    test('a restore that finds no session bumps the epoch (nothing older can apply afterwards)', () async {
      store.data['blynk_access_token'] = 'access-only';
      final auth = AuthProvider(request: ({methodType, url, body}) async => {});
      final before = ApiService.sessionEpoch;

      expect(await auth.restoreSession(), isFalse);

      expect(ApiService.sessionEpoch, greaterThan(before));
      expect(store.data, isEmpty);
      auth.dispose();
    });
  });
}
