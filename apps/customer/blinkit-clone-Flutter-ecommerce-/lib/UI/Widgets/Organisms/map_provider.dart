import 'package:flutter/widgets.dart';

import 'maplibre_map_view.dart';

/// Provider-neutral map contracts (plan section 8.4). This file names no map
/// SDK: only the adapter file (maplibre_map_view.dart) may import one, so
/// swapping the map provider later means changing that file and the two
/// factory redirects below, nothing else. Every other file, including
/// OrderTrackingMap, depends on this file alone.

/// A latitude/longitude pair in degrees. Value-equal so a marker set can be
/// compared and diffed.
@immutable
class GeoPoint {
  const GeoPoint(this.latitude, this.longitude);
  final double latitude;
  final double longitude;

  @override
  bool operator ==(Object other) =>
      other is GeoPoint && other.latitude == latitude && other.longitude == longitude;

  @override
  int get hashCode => Object.hash(latitude, longitude);

  @override
  String toString() => 'GeoPoint($latitude, $longitude)';
}

enum MapMarkerTone { destination, riderLive, riderStale }

/// One marker to draw. [id] is the marker's identity across updates: the same
/// id at a new position is the same marker moving, not a new marker.
@immutable
class MapMarkerSpec {
  const MapMarkerSpec({required this.id, required this.position, required this.tone});
  final String id;
  final GeoPoint position;
  final MapMarkerTone tone;

  @override
  bool operator ==(Object other) =>
      other is MapMarkerSpec && other.id == id && other.position == position && other.tone == tone;

  @override
  int get hashCode => Object.hash(id, position, tone);

  @override
  String toString() => 'MapMarkerSpec($id, $position, $tone)';
}

/// Builds a [TrackingMapView]. The default is the real map; OrderTrackingMap
/// accepts an override so widget tests can supply a fake without a native
/// platform view.
typedef TrackingMapBuilder = TrackingMapView Function({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
});

/// A read-only map showing a fixed set of markers - the live delivery-tracking
/// map. The concrete widget returned is MapLibreTrackingMapView; callers never
/// reference that class directly.
///
/// [markers] may change between builds: implementations move / retone /
/// remove the markers whose [MapMarkerSpec.id] persists, appears or vanishes.
abstract class TrackingMapView extends StatelessWidget {
  const factory TrackingMapView({
    Key? key,
    required GeoPoint initialCenter,
    required double initialZoom,
    required Set<MapMarkerSpec> markers,
  }) = MapLibreTrackingMapView;

  const TrackingMapView.constructor({super.key});

  GeoPoint get initialCenter;
  double get initialZoom;
  Set<MapMarkerSpec> get markers;
}

/// Builds a [LocationPickerMapView]. The default is the real map; the picker
/// screen accepts an override so widget tests can supply a fake without a
/// native platform view.
typedef LocationPickerMapBuilder = LocationPickerMapView Function({
  required GeoPoint initialPosition,
  required ValueChanged<GeoPoint> onPositionChanged,
});

/// An interactive map with ONE fixed pin - the address location picker
/// (Task M6). The pin stays at the centre of the view and the map pans
/// underneath it, so the picked coordinate is whatever is under the pin.
/// [onPositionChanged] reports that coordinate as the map moves and once more
/// when it settles. When the map itself cannot be shown the implementation
/// shows an honest "Map unavailable" state (no pin) and never reports a
/// position: the caller keeps the last one it knew. The concrete widget
/// returned is MapLibreLocationPickerView.
///
/// When it falls back to "Map unavailable" the implementation also dispatches a
/// [PickerMapUnavailableNotification] up the tree, so the screen can stop
/// telling the customer to "move the map" (the position it holds is then the
/// device fix, not something the customer chose).
abstract class LocationPickerMapView extends StatelessWidget {
  const factory LocationPickerMapView({
    Key? key,
    required GeoPoint initialPosition,
    required ValueChanged<GeoPoint> onPositionChanged,
  }) = MapLibreLocationPickerView;

  const LocationPickerMapView.constructor({super.key});
}

/// Sent up the widget tree by a [LocationPickerMapView] that could not prepare
/// a map and is showing the "Map unavailable" placeholder instead. Carries no
/// data: it only lets the picker screen swap its instruction copy.
class PickerMapUnavailableNotification extends Notification {
  const PickerMapUnavailableNotification();
}
