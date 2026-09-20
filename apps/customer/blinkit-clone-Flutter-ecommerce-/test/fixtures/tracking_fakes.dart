import 'dart:async';

import 'package:flutter/widgets.dart';

import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';

/// A stand-in for the real map: records what it was asked to draw and needs no
/// native platform view. Extends the provider-neutral [TrackingMapView], so no
/// test importing this file ever touches a map SDK.
class FakeTrackingMap extends TrackingMapView {
  const FakeTrackingMap({
    super.key,
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
  }) : super.constructor();

  @override
  final GeoPoint initialCenter;
  @override
  final double initialZoom;
  @override
  final Set<MapMarkerSpec> markers;

  @override
  Widget build(BuildContext context) => const SizedBox.expand(key: Key('fake-map'));
}

TrackingMapView fakeMapBuilder({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
}) =>
    FakeTrackingMap(initialCenter: initialCenter, initialZoom: initialZoom, markers: markers);

/// A REAL [LocationProvider] (so freshness / closed / state clearing come from
/// its own logic) fed by controllable streams, with every watch/stopWatching
/// recorded. Nothing opens a network connection: the opener hands out an
/// in-memory stream per watch.
class SpyLocationProvider extends LocationProvider {
  SpyLocationProvider._(this._clock, this._streams, this._opened)
      : super(
          opener: (orderId) {
            _opened.add(orderId);
            final c = StreamController<String>();
            _streams.add(c);
            return c.stream;
          },
          now: () => _clock.value,
        );

  factory SpyLocationProvider() =>
      SpyLocationProvider._(_Clock(DateTime.utc(2026, 9, 19, 10, 0, 0)), [], []);

  final _Clock _clock;
  final List<StreamController<String>> _streams;
  final List<String> _opened;

  /// `watch:<id>` / `stop`, in call order.
  final List<String> calls = [];

  /// Order ids a stream was actually opened for (one per watch).
  List<String> get opened => List.unmodifiable(_opened);

  int get watchCount => calls.where((c) => c.startsWith('watch:')).length;
  int get stopCount => calls.where((c) => c == 'stop').length;

  @override
  void watch(String orderId) {
    calls.add('watch:$orderId');
    super.watch(orderId);
  }

  @override
  void stopWatching() {
    calls.add('stop');
    super.stopWatching();
  }

  /// Emits a rider point (2 s old on the provider's fixed clock => LIVE) on the
  /// most recently opened stream.
  void sendPoint({double lat = 6.5, double lng = 80.1}) {
    final captured = _clock.value.subtract(const Duration(seconds: 2));
    _streams.last.add('event: location\n'
        'data: {"latitude":$lat,"longitude":$lng,"accuracy":8,'
        '"captured_at":"${captured.toIso8601String()}",'
        '"received_at":"${captured.add(const Duration(seconds: 1)).toIso8601String()}"}\n\n');
  }

  /// Fires a bare listener notification (what any later provider notify looks
  /// like to the screen), without changing any state.
  void poke() => notifyListeners();

  /// The server's authoritative end of the stream.
  void sendClosed([String reason = 'delivery_closed']) {
    _streams.last.add('event: closed\ndata: {"reason":"$reason"}\n\n');
  }
}

class _Clock {
  _Clock(this.value);
  DateTime value;
}
