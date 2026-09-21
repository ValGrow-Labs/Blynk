import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

/// Answers are held on Completers so a test decides exactly when each response
/// lands relative to a logout / login (no timing, no sleeps).
class _Server {
  final List<Completer<dynamic>> me = [];
  final List<Completer<dynamic>> verify = [];
  final List<String> log = [];

  Future<dynamic> call({String? methodType, String? url, dynamic body}) {
    log.add('$methodType $url');
    if (url == '/auth/me') {
      final c = Completer<dynamic>();
      me.add(c);
      return c.future;
    }
    if (url == '/auth/otp/verify') {
      final c = Completer<dynamic>();
      verify.add(c);
      return c.future;
    }
    return Future.value({'success': true});
  }
}

Map<String, dynamic> _user(String id, String name) => {
      'id': id,
      'phone': '+9477000000$id',
      'role': 'CUSTOMER',
      'full_name': name,
    };

Map<String, dynamic> _meResponse(String id, String name) => {
      'success': true,
      'data': {'user': _user(id, name)},
    };

Map<String, dynamic> _verifyResponse(String id, String name, {bool withUser = true}) => {
      'success': true,
      'data': {
        'access_token': 'access-$id',
        'refresh_token': 'refresh-$id',
        if (withUser) 'user': _user(id, name),
      },
    };

Future<void> _until(bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(condition(), isTrue, reason: 'the awaited call never happened');
}

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _Server server;
  late AuthProvider auth;

  /// A is signed in on the device with a cached profile.
  setUp(() {
    TokenStorage.resetSerialQueueForTest();
    FlutterSecureStorage.setMockInitialValues({
      'blynk_access_token': 'access-A',
      'blynk_refresh_token': 'refresh-A',
      'blynk_user_profile': UserModel.fromJson(_user('A', 'Customer A')).toJsonString(),
    });
    server = _Server();
    auth = AuthProvider(request: server.call);
  });

  tearDown(() {
    auth.dispose();
    TokenStorage.resetSerialQueueForTest();
  });

  Future<String?> cachedProfile() => TokenStorage.getUserCache();

  group('a profile fetched for one session', () {
    test('logout while /auth/me is in flight: the late answer leaves no cache and no user', () async {
      await auth.restoreSession();
      await _until(() => server.me.length == 1);

      await auth.logout();
      server.me.single.complete(_meResponse('A', 'Customer A (fresh)'));
      await _settle();

      expect(await cachedProfile(), isNull);
      expect(auth.currentUser, isNull);
      expect(auth.isAuthenticated, isFalse);
    });

    test('A in flight, logout, B logs in, A answers: B keeps their own profile and cache', () async {
      await auth.restoreSession();
      await _until(() => server.me.length == 1);

      await auth.logout();
      final login = auth.verifyOtp('0770000000', '123456');
      await _until(() => server.verify.length == 1);
      server.verify.single.complete(_verifyResponse('B', 'Customer B'));
      expect(await login, isTrue);
      expect(auth.currentUser?.id, 'B');

      server.me.single.complete(_meResponse('A', 'Customer A (fresh)')); // lands in B's session
      await _settle();

      expect(auth.currentUser?.id, 'B', reason: 'A\'s profile must not replace B\'s');
      expect(auth.currentUser?.fullName, 'Customer B');
      final cached = await cachedProfile();
      expect(cached, contains('Customer B'));
      expect(cached, isNot(contains('Customer A')));
      expect(await TokenStorage.getRefreshToken(), 'refresh-B');
    });

    test('a plain logout leaves no blynk_user_profile behind', () async {
      await auth.restoreSession();
      expect(await cachedProfile(), isNotNull, reason: 'the cached profile exists before the logout');

      await auth.logout();

      expect(await cachedProfile(), isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(await TokenStorage.getAccessToken(), isNull);
    });

    test('a forced session end while /auth/me is in flight discards it the same way', () async {
      await auth.restoreSession();
      await _until(() => server.me.length == 1);

      await auth.endSession();
      server.me.single.complete(_meResponse('A', 'Customer A (fresh)'));
      await _settle();

      expect(await cachedProfile(), isNull);
      expect(auth.currentUser, isNull);
    });

    test('an explicit loadCurrentUser() racing a logout is discarded too', () async {
      await auth.restoreSession();
      await _until(() => server.me.length == 1);
      server.me.first.complete(_meResponse('A', 'Customer A'));
      await _settle();

      final load = auth.loadCurrentUser();
      await _until(() => server.me.length == 2);
      await auth.logout();
      server.me[1].complete(_meResponse('A', 'Customer A (again)'));
      await load;
      await _settle();

      expect(await cachedProfile(), isNull);
      expect(auth.currentUser, isNull);
    });

    test('normal case: the background check refreshes the cached profile', () async {
      await auth.restoreSession();
      expect(auth.currentUser?.fullName, 'Customer A', reason: 'the cached profile shows at once');
      await _until(() => server.me.length == 1);

      server.me.single.complete(_meResponse('A', 'Customer A (fresh)'));
      await _settle();

      expect(auth.currentUser?.fullName, 'Customer A (fresh)');
      expect(await cachedProfile(), contains('Customer A (fresh)'));
      expect(auth.isAuthenticated, isTrue);
    });

    test('normal case: an explicit loadCurrentUser() returns and caches the profile', () async {
      await auth.restoreSession();
      await _until(() => server.me.length == 1);
      server.me.first.complete(_meResponse('A', 'Customer A'));
      await _settle();

      final load = auth.loadCurrentUser();
      await _until(() => server.me.length == 2);
      server.me[1].complete(_meResponse('A', 'Customer A (renamed)'));
      final user = await load;

      expect(user?.fullName, 'Customer A (renamed)');
      expect(await cachedProfile(), contains('Customer A (renamed)'));
    });
  });

  group('other async results applied to the session', () {
    test('verifyOtp: a session end while the code is being verified signs nobody in', () async {
      FlutterSecureStorage.setMockInitialValues({});
      final login = auth.verifyOtp('0770000000', '123456');
      await _until(() => server.verify.length == 1);

      await auth.endSession();
      server.verify.single.complete(_verifyResponse('B', 'Customer B'));

      await expectLater(login, throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('interrupted'))));
      expect(auth.isAuthenticated, isFalse);
      expect(auth.currentUser, isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(await cachedProfile(), isNull);
      expect(auth.errorMessage, contains('interrupted'));
      expect(auth.isVerifyingOtp, isFalse);
    });

    test('verifyOtp without a user in the answer loads it, and a logout racing that load leaves nothing', () async {
      FlutterSecureStorage.setMockInitialValues({});
      final login = auth.verifyOtp('0770000000', '123456');
      await _until(() => server.verify.length == 1);
      server.verify.single.complete(_verifyResponse('B', 'Customer B', withUser: false));
      await _until(() => server.me.length == 1);

      await auth.logout();
      server.me.single.complete(_meResponse('B', 'Customer B'));

      await expectLater(login, throwsA(isA<ApiException>()));
      await _settle();
      expect(await cachedProfile(), isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
      expect(auth.isAuthenticated, isFalse);
    });

    test('verifyOtp normal case: tokens, profile and cache are stored and the customer is signed in', () async {
      FlutterSecureStorage.setMockInitialValues({});
      final login = auth.verifyOtp('0770000000', '123456');
      await _until(() => server.verify.length == 1);
      server.verify.single.complete(_verifyResponse('B', 'Customer B'));

      expect(await login, isTrue);
      expect(auth.isAuthenticated, isTrue);
      expect(auth.currentUser?.fullName, 'Customer B');
      expect(await TokenStorage.getRefreshToken(), 'refresh-B');
      expect(await cachedProfile(), contains('Customer B'));
    });

    test('restoreSession racing a logout applies none of what it read', () async {
      final restore = auth.restoreSession(); // storage read is in flight...
      final logout = auth.logout(); // ...when the customer logs out
      await logout;

      expect(await restore, isFalse);
      expect(auth.isAuthenticated, isFalse);
      expect(auth.currentUser, isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
    });
  });
}
