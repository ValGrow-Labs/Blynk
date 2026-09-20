// maplibre_map_view.dart - the ONLY file that imports the MapLibre SDK
// (plan section 8.4; enforced by test/map_isolation_test.dart). Everything else
// in this app depends only on map_provider.dart.
//
// Pure logic (marker diffing, paint, fit-bounds decision, tile URL and style
// substitution) lives in map_marker_logic.dart / map_tile_config.dart so it is
// unit-tested without a native platform view. This file is the thin, stateful
// glue that applies that logic to a MapLibreMapController. It has NOT been
// exercised on a device or emulator in the task that wrote it.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:maplibre_gl/maplibre_gl.dart'
    show
        AnnotationType,
        AttributionButtonPosition,
        CameraPosition,
        CameraUpdate,
        Circle,
        CircleOptions,
        LatLng,
        LatLngBounds,
        MapLibreMap,
        MapLibreMapController,
        MinMaxZoomPreference;

import 'package:ecom/app_design.dart';

import 'map_marker_logic.dart';
import 'map_provider.dart';
import 'map_tile_config.dart';

/// Padding (logical px) around the two markers when the camera fits them.
const double _fitPadding = 48;
const Duration _fitDuration = Duration(milliseconds: 500);

class MapLibreTrackingMapView extends TrackingMapView {
  const MapLibreTrackingMapView({
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
  Widget build(BuildContext context) =>
      _TrackingMapBody(initialCenter: initialCenter, initialZoom: initialZoom, markers: markers);
}

class _TrackingMapBody extends StatefulWidget {
  const _TrackingMapBody({required this.initialCenter, required this.initialZoom, required this.markers});
  final GeoPoint initialCenter;
  final double initialZoom;
  final Set<MapMarkerSpec> markers;

  @override
  State<_TrackingMapBody> createState() => _TrackingMapBodyState();
}

/// Draws the markers as MapLibre circle annotations (no image assets: a plain
/// coloured dot per tone, which also makes the stale fade a simple opacity).
///
/// Lifecycle rules, because the native map becomes usable asynchronously and
/// can go away at any time:
///  - nothing touches the controller before onStyleLoaded (annotation managers
///    are not initialised earlier) - the wanted markers are read fresh when the
///    map becomes ready, so the latest set is always the one applied;
///  - one apply loop at a time; a marker update that arrives mid-apply sets a
///    dirty flag and the loop runs again, so updates coalesce and never
///    interleave;
///  - after dispose nothing is called;
///  - a failed platform call is logged and swallowed: the order screen must
///    not crash because a map call failed. The next marker change retries.
class _TrackingMapBodyState extends State<_TrackingMapBody> {
  /// The style with the tile URL substituted, or null while loading / failed.
  String? _style;
  bool _styleFailed = false;

  MapLibreMapController? _controller;
  bool _styleLoaded = false;
  bool _disposed = false;
  bool _applying = false;
  bool _dirty = false;
  bool _fitted = false;

  final Map<String, Circle> _circles = {};
  final Map<String, MapMarkerSpec> _applied = {};

  @override
  void initState() {
    super.initState();
    unawaited(_loadStyle());
  }

  Future<void> _loadStyle() async {
    String? style;
    try {
      final raw = await rootBundle.loadString(kMapStyleAsset);
      final tilesUrl = resolveMapTilesUrlFromEnvironment();
      if (tilesUrl != null) style = substituteTilesUrl(raw, tilesUrl);
    } catch (e) {
      debugPrint('Map style could not be prepared: $e');
    }
    if (!mounted) return;
    setState(() {
      _style = style;
      _styleFailed = style == null;
    });
  }

  @override
  void didUpdateWidget(covariant _TrackingMapBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!setEquals(oldWidget.markers, widget.markers)) _scheduleApply();
  }

  @override
  void dispose() {
    _disposed = true;
    _controller = null;
    _circles.clear();
    _applied.clear();
    super.dispose();
  }

  bool get _canApply => !_disposed && _styleLoaded && _controller != null;

  void _onMapCreated(MapLibreMapController controller) {
    // A (re)created native map starts empty: forget annotations of any
    // earlier one so the diff re-adds everything.
    _controller = controller;
    _styleLoaded = false;
    _circles.clear();
    _applied.clear();
  }

  void _onStyleLoaded() {
    // A style (re)load rebuilds the native circle manager, so every circle
    // added before it is gone: forget them so the diff re-adds the markers.
    _circles.clear();
    _applied.clear();
    _styleLoaded = true;
    _scheduleApply();
  }

  void _scheduleApply() {
    if (_canApply) unawaited(_drain());
  }

  Future<void> _drain() async {
    if (_applying) {
      _dirty = true;
      return;
    }
    _applying = true;
    try {
      do {
        _dirty = false;
        await _applyOnce();
      } while (_dirty && _canApply);
    } finally {
      _applying = false;
    }
  }

  CircleOptions _optionsFor(MapMarkerSpec marker) {
    final paint = markerPaintFor(marker.tone);
    return CircleOptions(
      geometry: LatLng(marker.position.latitude, marker.position.longitude),
      circleColor: paint.colorHex,
      circleOpacity: paint.opacity,
      circleRadius: paint.radius,
      circleStrokeColor: paint.strokeColorHex,
      circleStrokeWidth: paint.strokeWidth,
      circleStrokeOpacity: paint.strokeOpacity,
    );
  }

  Future<void> _applyOnce() async {
    final controller = _controller;
    if (!_canApply || controller == null) return;
    final diff = diffMarkers(_applied, widget.markers);
    try {
      for (final id in diff.removedIds) {
        final circle = _circles.remove(id);
        _applied.remove(id);
        if (circle != null) await controller.removeCircle(circle);
        if (!_canApply) return;
      }
      for (final marker in diff.added) {
        final circle = await controller.addCircle(_optionsFor(marker));
        if (!_canApply) return;
        _circles[marker.id] = circle;
        _applied[marker.id] = marker;
      }
      for (final marker in diff.updated) {
        final circle = _circles[marker.id];
        if (circle == null) continue;
        await controller.updateCircle(circle, _optionsFor(marker));
        if (!_canApply) return;
        _applied[marker.id] = marker;
      }
      await _fitOnce(controller);
    } catch (e) {
      debugPrint('Map marker update failed: $e');
    }
  }

  Future<void> _fitOnce(MapLibreMapController controller) async {
    final destination = _applied.values.where((m) => m.tone == MapMarkerTone.destination);
    final rider = _applied.values.where((m) => m.tone != MapMarkerTone.destination);
    if (!shouldFitCamera(hasFitted: _fitted, riderPresent: rider.isNotEmpty) || destination.isEmpty) return;
    final bounds = boundsFor(destination.first.position, rider.first.position);
    if (bounds == null) return;
    _fitted = true;
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(bounds.south, bounds.west),
          northeast: LatLng(bounds.north, bounds.east),
        ),
        left: _fitPadding,
        top: _fitPadding,
        right: _fitPadding,
        bottom: _fitPadding,
      ),
      duration: _fitDuration,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_styleFailed) return const _MapUnavailable();
    final style = _style;
    if (style == null) return const ColoredBox(color: AppSurfaces.tile);

    return MapLibreMap(
      styleString: style,
      initialCameraPosition: CameraPosition(
        target: LatLng(widget.initialCenter.latitude, widget.initialCenter.longitude),
        zoom: widget.initialZoom,
      ),
      onMapCreated: _onMapCreated,
      onStyleLoadedCallback: _onStyleLoaded,
      // A small inline map: keep it light on low/mid-range Android.
      compassEnabled: false,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      dragEnabled: false, // annotation dragging; panning the map stays on
      myLocationEnabled: false, // no location layer, no location permission
      logoEnabled: false,
      // Only circles are used, so skip the other annotation managers.
      annotationOrder: const [AnnotationType.circle],
      annotationConsumeTapEvents: const [AnnotationType.circle],
      minMaxZoomPreference: const MinMaxZoomPreference(10, 18),
      // The package offers no switch to hide its native attribution button, so
      // it stays bottom-right; Blynk's own overlay (bottom-left) is the
      // authoritative credit.
      attributionButtonPosition: AttributionButtonPosition.bottomRight,
      // Inside the order screen's scroll view the map would otherwise lose
      // every drag to the page scroll.
      gestureRecognizers: {
        Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
      },
    );
  }
}

/// Shown when the style or tile URL cannot be prepared: an honest label, not a
/// fake map. Sits under the attribution overlay drawn by the caller.
class _MapUnavailable extends StatelessWidget {
  const _MapUnavailable();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('map-unavailable'),
      color: AppSurfaces.tile,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.map_outlined, color: AppTextColors.onBackground, size: 28),
          SizedBox(height: AppSpacing.xs),
          Text(
            'Map unavailable',
            style: TextStyle(color: AppTextColors.onBackground, fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class MapLibreLocationPickerView extends LocationPickerMapView {
  const MapLibreLocationPickerView({
    super.key,
    required this.initialPosition,
    required this.onPositionChanged,
  }) : super.constructor();

  final GeoPoint initialPosition;
  final ValueChanged<GeoPoint> onPositionChanged;

  @override
  Widget build(BuildContext context) {
    // Completed in Task M6 together with the picker screen that uses it (a
    // draggable single circle whose drag end calls onPositionChanged). Nothing
    // in the app builds it yet, so this cannot be reached from a screen.
    throw UnimplementedError('implemented in Task M6');
  }
}
