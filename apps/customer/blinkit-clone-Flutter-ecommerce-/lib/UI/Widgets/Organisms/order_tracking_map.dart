import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_model.dart';
import '../../../Models/rider_location_model.dart';
import '../../../Services/Providers/location.provider.dart';
import '../../../app_colors.dart';
import '../../../app_design.dart';
import 'map_provider.dart';

/// The OSM/ODbL credit every map must show (docs/06-deployment/
/// map-tile-hosting-setup.md section 4). Drawn by Blynk's own widget tree so it
/// exists whatever the map style says and survives a style or provider swap.
const String mapAttributionText = '© OpenStreetMap contributors';

const double _mapHeight = 220;
const double _initialZoom = 14;

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

  static TrackingMapView _defaultMapBuilder({
    required GeoPoint initialCenter,
    required double initialZoom,
    required Set<MapMarkerSpec> markers,
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

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              key: const Key('order-tracking-map-frame'),
              height: _mapHeight,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.card),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    map,
                    const Positioned(left: AppSpacing.sm, bottom: AppSpacing.sm, child: _AttributionOverlay()),
                    // Hairline frame above the map; ignores touches.
                    Positioned.fill(
                      child: IgnorePointer(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(AppRadius.card),
                            border: Border.all(color: AppSurfaces.border),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            _FreshnessCaption(
              text: riderVisible && freshness == LocationFreshness.stale
                  ? lastSeenText(location.now.difference(point.capturedAt))
                  : null,
              live: riderVisible && freshness == LocationFreshness.live,
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

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        key: const Key('map-attribution'),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm - 2, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.85),
          borderRadius: BorderRadius.circular(4),
        ),
        child: const Text(
          mapAttributionText,
          style: TextStyle(color: AppTextColors.primary, fontSize: 10.5, fontWeight: FontWeight.w500),
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
      dot = AppColors.primaryGreenColor;
      label = 'Live';
      style = const TextStyle(color: AppColors.primaryGreenColor, fontSize: 13, fontWeight: FontWeight.w700);
    } else if (text != null) {
      dot = AppTextColors.muted;
      label = text!;
      style = const TextStyle(color: AppTextColors.onBackground, fontSize: 13, fontWeight: FontWeight.w600);
    } else {
      dot = AppTextColors.muted;
      label = 'Live location unavailable right now.';
      style = const TextStyle(color: AppTextColors.onBackground, fontSize: 13);
    }

    return Row(
      key: const Key('order-tracking-caption'),
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(child: Text(label, style: style)),
      ],
    );
  }
}
