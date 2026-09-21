import 'package:ecom/Infrastructure/HttpMethods/token_storage.dart';

/// A secure store whose calls can be held on a gate: an operation waits for the
/// future the gate returns (never completing = a hung platform call) and only
/// then takes effect, exactly like a late-completing native call.
class GatedStore implements SecureKeyValueStore {
  final Map<String, String> data = {};
  Future<void>? Function(String op, String key)? gate;

  /// Every delete throws (a keystore that errors instead of hanging).
  bool failDeletes = false;

  @override
  Future<String?> read(String key) async {
    // The value is what the native read saw when it started; the answer may
    // arrive later, after the store has changed.
    final value = data[key];
    await gate?.call('read', key);
    return value;
  }

  @override
  Future<void> write(String key, String value) async {
    await gate?.call('write', key);
    data[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    await gate?.call('delete', key);
    if (failDeletes) throw StateError('keystore error');
    data.remove(key);
  }
}
