import 'map_provider.dart';

/// Pure marker logic for the map adapter. No SDK, no widgets, no platform
/// calls: everything here is unit-tested without a map.

/// What changed between the markers currently on the map and the wanted set.
class MarkerDiff {
  const MarkerDiff({required this.added, required this.updated, required this.removedIds});
  final List<MapMarkerSpec> added;
  final List<MapMarkerSpec> updated;
  final List<String> removedIds;

  bool get isEmpty => added.isEmpty && updated.isEmpty && removedIds.isEmpty;
}

/// Diffs [applied] (marker id -> what is on the map now) against [wanted].
/// A marker keeps its identity by id: a moved or retoned marker is an
/// *update* of the existing annotation (no remove + add, so no flicker), an
/// unchanged marker is left alone, and only vanished ids are removed.
MarkerDiff diffMarkers(Map<String, MapMarkerSpec> applied, Set<MapMarkerSpec> wanted) {
  final added = <MapMarkerSpec>[];
  final updated = <MapMarkerSpec>[];
  final wantedIds = <String>{};
  for (final marker in wanted) {
    wantedIds.add(marker.id);
    final current = applied[marker.id];
    if (current == null) {
      added.add(marker);
    } else if (current != marker) {
      updated.add(marker);
    }
  }
  final removedIds = [for (final id in applied.keys) if (!wantedIds.contains(id)) id];
  return MarkerDiff(added: added, updated: updated, removedIds: removedIds);
}

/// Hues from the plan (the prior Google-Maps violet/azure pins) rather than
/// AppColors tokens: a destination and a rider must not read as Blynk
/// yellow/green UI chrome, and must stay distinct from each other and from the
/// pale land/water of the map style.
const String destinationMarkerHex = '#8E24AA'; // violet
const String riderMarkerHex = '#1E88E5'; // azure
const String markerStrokeHex = '#FFFFFF';

/// A stale rider is the same azure dot, half faded.
const double staleMarkerOpacity = 0.5;

/// How one marker tone is painted. Plain values so the SDK adapter is a
/// mechanical translation and the mapping is testable without the SDK.
class MarkerPaint {
  const MarkerPaint({
    required this.colorHex,
    required this.opacity,
    required this.radius,
    required this.strokeColorHex,
    required this.strokeWidth,
    required this.strokeOpacity,
  });
  final String colorHex;
  final double opacity;
  final double radius;
  final String strokeColorHex;
  final double strokeWidth;
  final double strokeOpacity;
}

MarkerPaint markerPaintFor(MapMarkerTone tone) {
  final stale = tone == MapMarkerTone.riderStale;
  final opacity = stale ? staleMarkerOpacity : 1.0;
  return MarkerPaint(
    colorHex: tone == MapMarkerTone.destination ? destinationMarkerHex : riderMarkerHex,
    opacity: opacity,
    radius: 9,
    strokeColorHex: markerStrokeHex,
    strokeWidth: 2.5,
    strokeOpacity: opacity,
  );
}

/// The camera fits both markers exactly once: the first time the rider marker
/// is on the map. After that the customer may have panned or zoomed, and
/// re-centering on every location update would fight them.
bool shouldFitCamera({required bool hasFitted, required bool riderPresent}) => riderPresent && !hasFitted;

/// The smallest box (degrees) the fit will use, about 220 m. A rider standing
/// on the destination would otherwise ask the camera to fit a zero-size box.
const double minFitSpanDegrees = 0.002;

/// South/west/north/east edges of a box, in degrees.
class GeoBounds {
  const GeoBounds({required this.south, required this.west, required this.north, required this.east});
  final double south, west, north, east;
}

bool _validCoordinate(GeoPoint p) =>
    p.latitude.isFinite &&
    p.longitude.isFinite &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180;

/// The box containing [a] and [b], grown to at least [minFitSpanDegrees] in
/// each axis (centred on the pair). Null for a non-finite / out-of-range point,
/// so a bad coordinate can never reach the camera.
GeoBounds? boundsFor(GeoPoint a, GeoPoint b) {
  if (!_validCoordinate(a) || !_validCoordinate(b)) return null;
  var south = a.latitude < b.latitude ? a.latitude : b.latitude;
  var north = a.latitude < b.latitude ? b.latitude : a.latitude;
  var west = a.longitude < b.longitude ? a.longitude : b.longitude;
  var east = a.longitude < b.longitude ? b.longitude : a.longitude;
  if (north - south < minFitSpanDegrees) {
    final mid = (north + south) / 2;
    south = mid - minFitSpanDegrees / 2;
    north = mid + minFitSpanDegrees / 2;
  }
  if (east - west < minFitSpanDegrees) {
    final mid = (east + west) / 2;
    west = mid - minFitSpanDegrees / 2;
    east = mid + minFitSpanDegrees / 2;
  }
  return GeoBounds(south: south, west: west, north: north, east: east);
}
