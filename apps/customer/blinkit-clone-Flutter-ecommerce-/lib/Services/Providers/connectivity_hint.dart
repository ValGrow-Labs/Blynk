import 'package:flutter/foundation.dart';

import 'package:ecom/Infrastructure/HttpMethods/requesting_methods.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/app_errors.dart';

/// Whether the last network call failed because there is no connection.
///
/// It is a hint, not a connectivity monitor: it only learns from requests the
/// app actually made (no plugin, no polling). A failed connection sets it; any
/// answer from the backend - including a 4xx or a 5xx, which prove the network
/// is fine - clears it. A timeout says nothing either way, so it leaves the
/// hint as it was.
class ConnectivityHint extends ChangeNotifier {
  bool _offline = false;
  void Function(ApiException?)? _observer;

  /// True when the most recent conclusive request failed with an offline-kind
  /// error. Screens that are showing saved content show a banner while it is.
  bool get isOffline => _offline;

  /// Feed one finished request: null for a response, or the failure.
  void record(Object? error) {
    final next = error == null ? false : _next(AppErrors.from(error));
    _set(next);
  }

  bool _next(CustomerError error) {
    if (error.isOffline) return true;
    if (error.isTimeout) return _offline; // inconclusive
    return false;
  }

  void _set(bool value) {
    if (value == _offline) return;
    _offline = value;
    notifyListeners();
  }

  /// Wires this hint to the app's HTTP client, replacing any earlier one.
  void attach() {
    void observer(ApiException? error) => record(error);
    _observer = observer;
    ApiService.networkObserver = observer;
  }

  /// Unhooks only this hint's own observer, never a newer hint's.
  void detach() {
    if (identical(ApiService.networkObserver, _observer)) {
      ApiService.networkObserver = null;
    }
    _observer = null;
  }

  @override
  void dispose() {
    detach();
    super.dispose();
  }
}
