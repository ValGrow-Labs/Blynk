import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The three calls the token store needs from secure storage. A test seam only
/// (so a test can stand in a store whose calls never complete); the app uses
/// [FlutterSecureStorage] and nothing else ever supplies another store.
abstract class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class _PlatformStore implements SecureKeyValueStore {
  const _PlatformStore();

  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
  );

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class TokenStorage {
  static SecureKeyValueStore _store = const _PlatformStore();

  static const String _accessTokenKey = 'blynk_access_token';
  static const String _refreshTokenKey = 'blynk_refresh_token';
  static const String _userCacheKey = 'blynk_user_profile';

  static Future<String?> getAccessToken() async {
    try {
      return await _store.read(_accessTokenKey);
    } catch (_) {
      return null;
    }
  }

  static Future<String?> getRefreshToken() async {
    try {
      return await _store.read(_refreshTokenKey);
    } catch (_) {
      return null;
    }
  }

  // Every write, clear and take runs one after another, so a late token writer
  // can never interleave with a logout's clear and undo it.
  static Future<void>? _tail;

  static Future<T> _serial<T>(Future<T> Function() op) {
    // Created lazily, in the caller's zone: a future made in another zone (a
    // test's setUp) would run its listeners on that zone's microtask queue.
    final result = (_tail ?? Future<void>.value()).then((_) => op());
    _tail = result.then<void>((_) {}, onError: (_) {});
    return result;
  }

  /// Test-only. A widget test that ends with a storage call still unfinished
  /// (its fake-async zone is gone) would leave the chain waiting forever for
  /// every later test in the file; suites that can do that call this in setUp
  /// and tearDown. Also restores the real store, or installs [store]. Production
  /// code never calls it.
  @visibleForTesting
  static void resetSerialQueueForTest({SecureKeyValueStore? store}) {
    _tail = null;
    _store = store ?? const _PlatformStore();
  }

  static Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) =>
      _serial(() => _write(accessToken, refreshToken));

  /// Writes the pair only if [stillValid] is still true at the moment of the
  /// write (checked inside the same serialised step). Returns whether it wrote.
  static Future<bool> saveTokensIf({
    required bool Function() stillValid,
    required String accessToken,
    required String refreshToken,
  }) =>
      _serial(() async {
        if (!stillValid()) return false;
        await _write(accessToken, refreshToken);
        return true;
      });

  static Future<void> _write(String accessToken, String refreshToken) async {
    await _store.write(_accessTokenKey, accessToken);
    await _store.write(_refreshTokenKey, refreshToken);
  }

  static Future<String?> getUserCache() async {
    try {
      return await _store.read(_userCacheKey);
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveUserCache(String userJson) =>
      _serial(() => _store.write(_userCacheKey, userJson));

  /// Writes the profile only if [stillValid] holds at the moment of the write
  /// (inside the same serialised step as every other write and clear), so a
  /// profile fetched for a session that has since ended cannot land after the
  /// logout's clear. Returns whether it wrote.
  static Future<bool> saveUserCacheIf({
    required bool Function() stillValid,
    required String userJson,
  }) =>
      _serial(() async {
        if (!stillValid()) return false;
        await _store.write(_userCacheKey, userJson);
        return true;
      });

  static Future<void> clearAll() => _serial(_clear);

  /// Reads the stored refresh token and clears everything in one serialised
  /// step, so a write that finished just before is the token returned (and can
  /// be revoked) and a write that starts just after is refused by its epoch.
  static Future<String?> takeRefreshTokenAndClearAll() => _serial(() async {
        final token = await getRefreshToken();
        await _clear();
        return token;
      });

  static Future<void> _clear() async {
    // The refresh token goes first: it is the credential a restore trusts.
    try {
      await _store.delete(_refreshTokenKey);
    } catch (_) {}
    try {
      await _store.delete(_accessTokenKey);
    } catch (_) {}
    try {
      await _store.delete(_userCacheKey);
    } catch (_) {}
  }
}
