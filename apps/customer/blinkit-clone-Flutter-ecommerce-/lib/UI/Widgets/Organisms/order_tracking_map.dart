import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_model.dart';
import '../../../Models/rider_location_model.dart';
import '../../../Services/Providers/location.provider.dart';
import 'map_provider.dart';
import '../../../design/tokens.dart';

/// The OSM/ODbL credit a MapLibre map must show (docs/06-deployment/
/// map-tile-hosting-setup.md section 4). Drawn by Blynk's own widget tree so it
/// exists whatever the map style says; shown only when [mapNeedsOsmAttribution].
const String mapAttributionText = '© OpenStreetMap contributors';

/// W8: the one map-frame height, named in the token layer so this frame and
/// the dental ones cannot drift apart again. Same rendered 220 as before.
const double _mapHeight = BlynkMap.frameHeight;
const double _initialZoom = 14;

/// The section title above the map. It names what the section is — a live
/// position — and promises nothing the backend does not send: no estimate, no
/// route, no distance and no rider identity.
const String mapSectionTitle = 'Live tracking';

/// The freshness dot. Small enough to read as an indicator rather than a
/// control, and always paired with words.
const double _freshnessDot = BlynkSpace.s8;

/// "Last seen 45 seconds ago" / "Last seen 2 minutes ago". Never a coordinate.
/// A zero or negative age (clock skew) reads "just now" rather than a
/// negative number.
String lastSeenText(Duration age) {
  final seconds = age.inSeconds;
  if (seconds <= 0) return 'Last seen just now';
  if (seconds < 60) return 'Last seen $seconds ${seconds == 1 ? 'second' : 'seconds'} ago';
  final minutes = age.inMinutes;
  return 'Last seen $minutes ${minutes == 1 ? 'minute' : 'minutes'} ago';
}

/// The customer's live delivery map (plan section 8): the destination pin
/// whenever the order has coordinates; the rider pin only while a LIVE or STALE
/// point exists and the stream has not ended. No route, no ETA, no distance
/// (plan D.13) - the map shows where things ARE, not a prediction.
///
/// Depends only on map_provider.dart, never on a concrete map SDK (plan 8.4).
/// Needs a [LocationProvider] above it (Task M5 registers it).
class OrderTrackingMap extends StatelessWidget {
  const OrderTrackingMap({super.key, required this.order, this.mapBuilder});

  final OrderModel order;

  /// Test seam: substitutes the map widget so widget tests need no native
  /// platform view. Production callers leave it null and get the real map;
  /// behaviour is otherwise identical.
  final TrackingMapBuilder? mapBuilder;

  // `semanticsLabel` is accepted (required by the `TrackingMapBuilder`
  // typedef, task-F1 review-fix round 1) but never passed on below: the
  // rider/delivery map keeps the Google adapter's own default label
  // unconditionally, exactly as before this fix round.
  static TrackingMapView _defaultMapBuilder({
    required GeoPoint initialCenter,
    required double initialZoom,
    required Set<MapMarkerSpec> markers,
    String? semanticsLabel,
  }) =>
      TrackingMapView(initialCenter: initialCenter, initialZoom: initialZoom, markers: markers);

  @override
  Widget build(BuildContext context) {
    final destLat = order.deliveryLatitude;
    final destLng = order.deliveryLongitude;
    if (destLat == null || destLng == null) return const SizedBox.shrink();
    final destination = GeoPoint(destLat, destLng);

    return Consumer<LocationProvider>(
      builder: (context, location, _) {
        final point = location.current;
        final freshness = location.freshness;
        final riderVisible = point != null &&
            freshness != null &&
            freshness != LocationFreshness.offline &&
            !location.closed &&
            !location.unavailable;

        final markers = <MapMarkerSpec>{
          MapMarkerSpec(id: 'destination', position: destination, tone: MapMarkerTone.destination),
          if (riderVisible)
            MapMarkerSpec(
              id: 'rider',
              position: GeoPoint(point.latitude, point.longitude),
              tone: freshness == LocationFreshness.stale ? MapMarkerTone.riderStale : MapMarkerTone.riderLive,
            ),
        };

        final map = (mapBuilder ?? _defaultMapBuilder)(
          initialCenter: destination,
          initialZoom: _initialZoom,
          markers: markers,
        );

        // Deliberately NOT wrapped in a card: `google_logo_clearance_test`
        // requires that nothing Blynk paints reaches the map's bottom strip,
        // and a card surface behind the whole section would span it. The
        // section is separated by space, like every other section here.
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: const Text(mapSectionTitle, style: BlynkText.sectionHeader),
            ),
            const SizedBox(height: BlynkSpace.s12),
            SizedBox(
              key: const Key('order-tracking-map-frame'),
              height: _mapHeight,
              child: ClipRRect(
                borderRadius: BlynkRadius.chipAll,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    map,
                    // Only over MapLibre's OSM tiles. Google draws its own logo
                    // and copyright in that corner: never cover it.
                    if (mapNeedsOsmAttribution)
                      const Positioned(
                        left: BlynkSpace.s8,
                        bottom: BlynkSpace.s8,
                        child: _AttributionOverlay(),
                      ),
                    // Hairline frame above the map; ignores touches. It keeps a
                    // light map from bleeding into a light page.
                    const Positioned.fill(
                      child: IgnorePointer(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BlynkRadius.chipAll,
                            border: Border.fromBorderSide(BorderSide(color: BlynkColors.line)),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: BlynkSpace.s12),
            Align(
              alignment: Alignment.centerLeft,
              child: _FreshnessCaption(
                text: riderVisible && freshness == LocationFreshness.stale
                    ? lastSeenText(location.now.difference(point.capturedAt))
                    : null,
                live: riderVisible && freshness == LocationFreshness.live,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Permanent, non-dismissible, non-interactive credit in the map's bottom-left
/// corner: dark text on a translucent white chip so it reads on any tile.
class _AttributionOverlay extends StatelessWidget {
  const _AttributionOverlay();

  /// The chip is a third-party credit sitting on live tiles, so it keeps its
  /// own tight metrics rather than a page spacing step, and stays slightly
  /// translucent so it reads as part of the map.
  static const double _chipPadX = 6;
  static const double _chipPadY = 2;
  static const double _chipOpacity = 0.85;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        key: const Key('map-attribution'),
        padding: const EdgeInsets.symmetric(horizontal: _chipPadX, vertical: _chipPadY),
        decoration: BoxDecoration(
          color: BlynkColors.paper.withValues(alpha: _chipOpacity),
          borderRadius: BlynkRadius.smAll,
        ),
        child: Text(
          mapAttributionText,
          style: BlynkText.caption.copyWith(color: BlynkColors.ink, fontWeight: FontWeight.w500),
        ),
      ),
    );
  }
}

/// Under-map status line. [live] -> "Live" (green); [text] (a "last seen"
/// string) -> stale; neither -> the unavailable copy (offline, closed,
/// refused, or no point yet).
class _FreshnessCaption extends StatelessWidget {
  const _FreshnessCaption({required this.text, required this.live});
  final String? text;
  final bool live;

  @override
  Widget build(BuildContext context) {
    final Color dot;
    final String label;
    final TextStyle style;
    if (live) {
      dot = BlynkColors.positive;
      label = 'Live';
      // Darker green than the dot: the brand green is below AA for text this
      // size on a light surface; `positiveInk` clears it.
      style = BlynkText.microLabel.copyWith(color: BlynkColors.positiveInk);
    } else if (text != null) {
      dot = BlynkColors.lineStrong;
      label = text!;
      style = BlynkText.caption.copyWith(color: BlynkColors.ink3);
    } else {
      dot = BlynkColors.lineStrong;
      label = 'Live location unavailable right now.';
      style = BlynkText.caption.copyWith(color: BlynkColors.ink3);
    }

    // A soft `well` pill, so the indicator reads as one status object rather
    // than loose text under the map. Never colour alone: the dot always sits
    // beside words that say the same thing.
    return DecoratedBox(
      decoration: const BoxDecoration(color: BlynkColors.well, borderRadius: BlynkRadius.full),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s8),
        child: Row(
          key: const Key('order-tracking-caption'),
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: _freshnessDot,
              height: _freshnessDot,
              child: DecoratedBox(
                decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
              ),
            ),
            const SizedBox(width: BlynkSpace.s8),
            Flexible(child: Text(label, style: style)),
          ],
        ),
      ),
    );
  }
}
