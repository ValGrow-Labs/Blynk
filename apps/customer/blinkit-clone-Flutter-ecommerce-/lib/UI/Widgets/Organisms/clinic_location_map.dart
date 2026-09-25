import 'package:flutter/widgets.dart';

import 'map_provider.dart';

/// A read-only single-pin map for a clinic's fixed location (task F1).
/// Structurally simpler than `OrderTrackingMap`: no `LocationProvider`, no
/// live stream, no polling, no freshness caption, no second marker - a
/// clinic address doesn't move. No routing, no ETA, no ratings/reviews UI.
///
/// Depends only on `map_provider.dart`, never a concrete map SDK (plan
/// 8.4), matching `OrderTrackingMap`'s convention.
///
/// No fixed frame/height is baked in here (unlike `OrderTrackingMap`'s
/// `220`px card): the brief gives no size for this wrapper and common.md
/// rule 13 forbids inventing new spacing/radius values, so sizing/framing is
/// left to whichever screen (F2/F3) embeds this widget in its own layout.
class ClinicLocationMap extends StatelessWidget {
  const ClinicLocationMap({super.key, required this.location, this.label, this.mapBuilder});

  final GeoPoint location;

  /// An optional accessibility label (e.g. the clinic's name) announced by
  /// screen readers. `MapMarkerSpec` itself has no label field (only
  /// `id`/`position`/`tone`), so this cannot be drawn ON the pin.
  ///
  /// It is applied twice, deliberately (task-F1 review-fix round 1):
  /// 1. Passed down as `semanticsLabel` to the real map adapter, so the
  ///    Google adapter's own internal `Semantics(container: true, ...)` node
  ///    (`google_map_view.dart`) announces THIS text instead of its
  ///    hardcoded rider/delivery phrase - a static clinic-address map is
  ///    neither. Without this, a screen reader on the default (Google)
  ///    adapter announced "Map showing the rider and your delivery address"
  ///    on a clinic map, which is simply false (there is no rider, no
  ///    delivery here) - the defect the fix round exists to close.
  /// 2. Still wrapped in an outer `Semantics` node below, because the
  ///    MapLibre adapter draws no Semantics node of its own at all (nothing
  ///    to override there) and the fake map substituted by
  ///    `clinic_location_map_test.dart`'s `mapBuilder` seam likewise has
  ///    none - both would announce nothing without this outer wrapper. On
  ///    the real Google adapter this makes the label audible twice
  ///    (redundant, both instances correct) rather than once; accepted as
  ///    the safest fix that cannot regress either the MapLibre rollback path
  ///    or the existing widget tests, which only common.md rule 12 forbids
  ///    "gold-plating" past.
  final String? label;

  /// Test seam: substitutes the map widget so widget tests need no native
  /// platform view - identical purpose to `OrderTrackingMap.mapBuilder`.
  /// Production callers leave it null and get the real map.
  final TrackingMapBuilder? mapBuilder;

  static const double _initialZoom = 15;

  static TrackingMapView _defaultMapBuilder({
    required GeoPoint initialCenter,
    required double initialZoom,
    required Set<MapMarkerSpec> markers,
    String? semanticsLabel,
  }) =>
      TrackingMapView(
        initialCenter: initialCenter,
        initialZoom: initialZoom,
        markers: markers,
        semanticsLabel: semanticsLabel,
      );

  @override
  Widget build(BuildContext context) {
    // `destination` is the closest semantic fit `MapMarkerTone` offers for a
    // static place pin: this is not a rider (there is no `riderLive`/
    // `riderStale` concept for a clinic), and `destination` is exactly the
    // tone `OrderTrackingMap` already uses for its own fixed address pin -
    // same concept (a place the customer is going to), one clinic address
    // instead of one delivery address.
    final markers = <MapMarkerSpec>{
      MapMarkerSpec(id: 'clinic', position: location, tone: MapMarkerTone.destination),
    };

    final map = (mapBuilder ?? _defaultMapBuilder)(
      initialCenter: location,
      initialZoom: _initialZoom,
      markers: markers,
      semanticsLabel: label,
    );

    return label == null ? map : Semantics(label: label, child: map);
  }
}
