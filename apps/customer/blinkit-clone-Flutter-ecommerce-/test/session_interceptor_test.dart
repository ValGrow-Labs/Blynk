import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

/// A real HTTP server on loopback, so the real Dio interceptor runs: it
/// answers /orders with 401 unless the bearer token is `access-2`, and
/// /auth/refresh with whatever the test scripted.
class _Backend {
  late final HttpServer server;
  int refreshCalls = 0;
  int ordersCalls = 0;
  int refreshStatus = 200;
  Duration refreshDelay = Duration.zero;

  /// Delay for the first refresh call only (a slow refresh that a logout races).
  Duration? firstRefreshDelay;

  /// The refresh tokens the server was asked to revoke on /auth/logout.
  final List<String> revoked = [];

  /// Every orders request answers 401, even with a fresh token.
  bool ordersAlways401 = false;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final response = request.response..headers.contentType = ContentType.json;
      if (request.uri.path.endsWith('/auth/logout')) {
        final body = jsonDecode(await utf8.decoder.bind(request).join()) as Map;
        revoked.add(body['refresh_token'] as String);
        response.statusCode = 200;
        response.write(jsonEncode({'success': true}));
      } else if (request.uri.path.endsWith('/auth/refresh')) {
        final call = ++refreshCalls;
        await utf8.decoder.bind(request).join();
        await Future<void>.delayed(call == 1 ? (firstRefreshDelay ?? refreshDelay) : refreshDelay);
        response.statusCode = refreshStatus;
        // Call n mints access-(n+1) / refresh-(n+1): the first is access-2.
        response.write(jsonEncode(refreshStatus == 200
            ? {
                'success': true,
                'data': {'access_token': 'access-${call + 1}', 'refresh_token': 'refresh-${call + 1}'},
              }
            : {'success': false, 'error': {'message': 'refresh refused'}}));
      } else {
        ordersCalls++;
        final auth = request.headers.value('authorization') ?? '';
        final ok = !ordersAlways401 && auth.startsWith('Bearer access-') && auth != 'Bearer access-1';
        response.statusCode = ok ? 200 : 401;
        response.write(jsonEncode(ok ? {'success': true, 'data': {'orders': []}} : {'success': false}));
      }
      await response.close();
    });
    dotenv.testLoad(fileInput: 'API_BASE_URL=http://127.0.0.1:${server.port}/api/v1');
    ApiService.resetDio();
  }

  Future<void> stop() => server.close(force: true);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // flutter_test answers every HTTP request with a 400; this suite talks to a
  // real loopback server on purpose.
  HttpOverrides.global = null;

  late _Backend backend;
  late List<void> rejections;
  late StreamSubscription<void> sub;

  setUp(() async {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({
      'blynk_access_token': 'access-1',
      'blynk_refresh_token': 'refresh-1',
    });
    backend = _Backend();
    await backend.start();
    rejections = [];
    sub = ApiService.sessionRejected.listen(rejections.add);
  });

  tearDown(() async {
    await sub.cancel();
    await backend.stop();
    ApiService.resetDio();
  });

  Future<dynamic> getOrders() => ApiService.requestMethods(methodType: 'GET', url: '/orders');

  test('a 401 is refreshed once and the request is retried with the new token', () async {
    final result = await getOrders();

    expect(result['success'], isTrue);
    expect(backend.refreshCalls, 1);
    expect(await TokenStorage.getAccessToken(), 'access-2');
    expect(await TokenStorage.getRefreshToken(), 'refresh-2');
    expect(rejections, isEmpty);
  });

  test('parallel 401s share one refresh (rotating tokens must not be spent twice)', () async {
    backend.refreshDelay = const Duration(milliseconds: 80);

    final results = await Future.wait([getOrders(), getOrders(), getOrders()]);

    expect(results.every((r) => r['success'] == true), isTrue);
    expect(backend.refreshCalls, 1);
    expect(rejections, isEmpty);
  });

  test('a refresh token the server rejects (401) ends the session: storage cleared, one event', () async {
    backend.refreshStatus = 401;

    await expectLater(getOrders(), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));
    await Future<void>.delayed(Duration.zero);

    expect(rejections, hasLength(1));
    expect(await TokenStorage.getRefreshToken(), isNull);
    expect(await TokenStorage.getAccessToken(), isNull);
  });

  test('a rejected refresh (403) also ends the session', () async {
    backend.refreshStatus = 403;

    await expectLater(getOrders(), throwsA(isA<ApiException>()));
    await Future<void>.delayed(Duration.zero);

    expect(rejections, hasLength(1));
    expect(await TokenStorage.getRefreshToken(), isNull);
  });

  test('a failing refresh (503) keeps the session: nothing cleared, no event', () async {
    backend.refreshStatus = 503;

    await expectLater(getOrders(), throwsA(isA<ApiException>()));
    await Future<void>.delayed(Duration.zero);

    expect(rejections, isEmpty);
    expect(await TokenStorage.getRefreshToken(), 'refresh-1');
    expect(await TokenStorage.getAccessToken(), 'access-1');
  });

  test('an unreachable refresh endpoint keeps the session too', () async {
    await backend.stop(); // the server is gone: connection refused for everything
    ApiService.resetDio();

    await expectLater(getOrders(), throwsA(isA<ApiException>()));
    await Future<void>.delayed(Duration.zero);

    expect(rejections, isEmpty);
    expect(await TokenStorage.getRefreshToken(), 'refresh-1');
    // Restart so tearDown's stop() has a live server to close.
    backend = _Backend();
    await backend.start();
  });

  test('a guest\'s 401 (no refresh token stored) is not a session end and does not refresh', () async {
    FlutterSecureStorage.setMockInitialValues({});

    await expectLater(getOrders(), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));
    await Future<void>.delayed(Duration.zero);

    expect(backend.refreshCalls, 0);
    expect(rejections, isEmpty);
  });

  test('after a rejected refresh a later request starts clean (no stuck in-flight refresh)', () async {
    backend.refreshStatus = 401;
    await expectLater(getOrders(), throwsA(isA<ApiException>()));

    // A new login stores new tokens; the next 401 refreshes again.
    await TokenStorage.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');
    backend.refreshStatus = 200;
    final result = await getOrders();

    expect(result['success'], isTrue);
    expect(backend.refreshCalls, 2);
  });

  test('a request whose retry is also 401 is replayed once only (no loop)', () async {
    backend.ordersAlways401 = true;

    await expectLater(getOrders(), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));

    expect(backend.refreshCalls, 1);
    expect(backend.ordersCalls, 2, reason: 'the original and exactly one replay');
  });

  group('a session that ends while a token refresh is in flight', () {
    AuthProvider newAuth([List<String>? log]) => AuthProvider(
          request: ({methodType, url, body}) async {
            log?.add('$methodType $url ${body is Map ? body['refresh_token'] : ''}');
            return {'success': true};
          },
        );

    /// Starts a request that 401s, then waits until the server is holding the
    /// (delayed) refresh call, so the next line races it deterministically.
    Future<Future<dynamic>> startSlowRefresh() async {
      backend.firstRefreshDelay = const Duration(milliseconds: 250);
      final request = getOrders();
      // Each test awaits the failure explicitly; keep it from being unhandled meanwhile.
      request.ignore();
      while (backend.refreshCalls == 0) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return request;
    }

    Future<void> untilRevoked() async {
      for (var i = 0; i < 100 && backend.revoked.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    }

    test('logout mid-refresh: storage stays empty, the queued request fails, restore says signed out', () async {
      final auth = newAuth();
      await auth.restoreSession();
      final request = await startSlowRefresh();

      await auth.logout(); // while the refresh is on the wire
      await expectLater(request, throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));

      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(await TokenStorage.getAccessToken(), isNull);
      expect(backend.ordersCalls, 1, reason: 'the queued request was not replayed with the new token');
      expect(rejections, isEmpty, reason: 'a chosen logout is not a forced end');

      final next = AuthProvider(request: ({methodType, url, body}) async => {});
      expect(await next.restoreSession(), isFalse);
      expect(next.isAuthenticated, isFalse);
      auth.dispose();
      next.dispose();
    });

    test('logout mid-refresh: the token the server minted after the logout is revoked too', () async {
      final auth = newAuth();
      await auth.restoreSession();
      final request = await startSlowRefresh();

      await auth.logout();
      await expectLater(request, throwsA(isA<ApiException>()));
      await untilRevoked();

      expect(backend.revoked, contains('refresh-2'));
      expect(await TokenStorage.getRefreshToken(), isNull, reason: 'revoking keeps nothing locally');
      auth.dispose();
    });

    test('logout revokes the token the interceptor rotated, not the stale one memory still holds', () async {
      final log = <String>[];
      final auth = newAuth(log);
      await auth.restoreSession(); // memory: refresh-1
      await getOrders(); // 401 -> refresh: storage now holds refresh-2, memory does not
      expect(await TokenStorage.getRefreshToken(), 'refresh-2');
      expect(auth.rawRefreshToken, 'refresh-1', reason: 'the case under test: memory is stale');

      await auth.logout();

      expect(log, contains('POST /auth/logout refresh-2'));
      expect(log.where((l) => l.contains('refresh-1')), isEmpty, reason: 'the spent token is never the one revoked');
      auth.dispose();
    });

    test('logout bumps the session epoch and signs out before its first await', () async {
      final auth = newAuth();
      await auth.restoreSession();
      final before = ApiService.sessionEpoch;

      final done = auth.logout(); // nothing awaited yet
      expect(ApiService.sessionEpoch, before + 1);
      expect(auth.isAuthenticated, isFalse);
      await done;
      auth.dispose();
    });

    test('endSession bumps the session epoch and signs out before its first await', () async {
      final auth = newAuth();
      await auth.restoreSession();
      final before = ApiService.sessionEpoch;

      final done = auth.endSession();
      expect(ApiService.sessionEpoch, before + 1);
      expect(auth.isAuthenticated, isFalse);
      await done;
      auth.dispose();
    });

    test('a forced session end mid-refresh discards the result the same way', () async {
      final auth = newAuth();
      await auth.restoreSession();
      final request = await startSlowRefresh();

      await auth.endSession();
      await expectLater(request, throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)));

      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(await TokenStorage.getAccessToken(), isNull);
      expect(backend.ordersCalls, 1);
      final next = AuthProvider(request: ({methodType, url, body}) async => {});
      expect(await next.restoreSession(), isFalse);
      auth.dispose();
      next.dispose();
    });

    test('a refresh that finishes after a new login does not overwrite the new session', () async {
      final auth = newAuth();
      await auth.restoreSession();
      final stale = await startSlowRefresh();

      await auth.logout();
      // The next customer logs in while the old refresh is still on the wire.
      await TokenStorage.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-9');
      backend.firstRefreshDelay = null;
      final fresh = await getOrders(); // 401 -> its own refresh, never the stale one
      await expectLater(stale, throwsA(isA<ApiException>()));

      expect(fresh['success'], isTrue);
      expect(await TokenStorage.getRefreshToken(), 'refresh-3', reason: 'the second refresh, not the stale first');
      auth.dispose();
    });

    test('an explicit AuthProvider.refreshToken() racing a logout is discarded too', () async {
      final release = Completer<void>();
      final auth = AuthProvider(
        request: ({methodType, url, body}) async {
          if (url == '/auth/refresh') {
            await release.future;
            return {
              'success': true,
              'data': {'access_token': 'late-access', 'refresh_token': 'late-refresh'},
            };
          }
          return {'success': true};
        },
      );
      await auth.restoreSession();
      final refresh = auth.refreshToken();
      await Future<void>.delayed(const Duration(milliseconds: 20));

      await auth.logout();
      release.complete();

      expect(await refresh, isFalse);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(auth.isAuthenticated, isFalse);
      auth.dispose();
    });

    test('logout with no refresh in flight is unchanged: cleared, revoked, nothing else', () async {
      final log = <String>[];
      final auth = newAuth(log);
      await auth.restoreSession();

      await auth.logout();

      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(await TokenStorage.getAccessToken(), isNull);
      expect(log, contains('POST /auth/logout refresh-1'));
      expect(backend.refreshCalls, 0);
      expect(backend.revoked, isEmpty);
      auth.dispose();
    });

    test('a refresh that completes normally (no logout) still works and keeps the session', () async {
      final auth = newAuth();
      await auth.restoreSession();
      backend.firstRefreshDelay = const Duration(milliseconds: 60);

      final result = await getOrders();

      expect(result['success'], isTrue);
      expect(await TokenStorage.getRefreshToken(), 'refresh-2');
      expect(await TokenStorage.getAccessToken(), 'access-2');
      expect(backend.revoked, isEmpty);
      auth.dispose();
    });
  });
}
