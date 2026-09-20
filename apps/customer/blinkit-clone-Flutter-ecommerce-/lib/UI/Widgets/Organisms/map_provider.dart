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

/// An interactive map with a single draggable pin - the address location
/// picker (Task M6; nothing builds it yet). The concrete widget returned is
/// MapLibreLocationPickerView.
abstract class LocationPickerMapView extends StatelessWidget {
  const factory LocationPickerMapView({
    Key? key,
    required GeoPoint initialPosition,
    required ValueChanged<GeoPoint> onPositionChanged,
  }) = MapLibreLocationPickerView;

  const LocationPickerMapView.constructor({super.key});
}
