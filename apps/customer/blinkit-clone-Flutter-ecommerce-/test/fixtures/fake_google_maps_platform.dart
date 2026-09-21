import 'dart:async';

import 'package:flutter/services.dart' show PlatformException, PlatformViewCreatedCallback;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart' show addTearDown;
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';

/// A harmless stand-in for the Google Maps platform so `GoogleMap` widgets run
/// under `flutter test` without a native view. Modelled on the package's own
/// test fake (not importable: it lives in the package's test/ directory).
///
/// Install with [FakeGoogleMapsPlatform.install]; it records what the widget
/// asked the platform for (initial camera, gesture recognizers, the full map
/// configuration, marker updates, camera calls) and lets a test inject camera
/// events and make camera calls fail.
class FakeGoogleMapsPlatform extends GoogleMapsFlutterPlatform {
  /// Replaces [GoogleMapsFlutterPlatform.instance] and restores it at teardown.
  static FakeGoogleMapsPlatform install() {
    final previous = GoogleMapsFlutterPlatform.instance;
    final fake = FakeGoogleMapsPlatform();
    GoogleMapsFlutterPlatform.instance = fake;
    addTearDown(() => GoogleMapsFlutterPlatform.instance = previous);
    return fake;
  }

  final List<int> createdIds = <int>[];
  final Map<int, RecordedMap> maps = <int, RecordedMap>{};

  /// How many native maps were built. The tests use this to prove that exactly
  /// one Google map exists (and none when the platform is unsupported).
  int get buildCount => createdIds.length;

  RecordedMap get lastMap => maps[createdIds.last]!;

  /// The next [failCameraCalls] animateCamera / moveCamera calls throw, like a
  /// native map that has not been laid out yet.
  int failCameraCalls = 0;

  /// Camera calls in order: `animate:<type>` or `move:<type>`, plus the update.
  final List<RecordedCameraCall> cameraCalls = <RecordedCameraCall>[];

  final StreamController<MapEvent<dynamic>> _events = StreamController<MapEvent<dynamic>>.broadcast();

  /// Injects a platform event (e.g. `CameraMoveEvent`, `CameraIdleEvent`).
  void emit(MapEvent<dynamic> event) => _events.add(event);

  Stream<T> _of<T extends MapEvent<dynamic>>() => _events.stream.where((e) => e is T).cast<T>();

  @override
  Future<void> init(int mapId) async {}

  @override
  Future<void> updateMapConfiguration(MapConfiguration update, {required int mapId}) async {
    final map = maps[mapId];
    if (map != null) map.configurationUpdates.add(update);
  }

  @override
  Future<void> updateMarkers(MarkerUpdates markerUpdates, {required int mapId}) async {
    maps[mapId]?.recordMarkerUpdate(markerUpdates);
  }

  @override
  Future<void> updatePolygons(PolygonUpdates polygonUpdates, {required int mapId}) async {}
  @override
  Future<void> updatePolylines(PolylineUpdates polylineUpdates, {required int mapId}) async {}
  @override
  Future<void> updateCircles(CircleUpdates circleUpdates, {required int mapId}) async {}
  @override
  Future<void> updateHeatmaps(HeatmapUpdates heatmapUpdates, {required int mapId}) async {}
  @override
  Future<void> updateTileOverlays({required Set<TileOverlay> newTileOverlays, required int mapId}) async {}
  @override
  Future<void> updateClusterManagers(ClusterManagerUpdates clusterManagerUpdates, {required int mapId}) async {}
  @override
  Future<void> updateGroundOverlays(GroundOverlayUpdates groundOverlayUpdates, {required int mapId}) async {}
  @override
  Future<void> clearTileCache(TileOverlayId tileOverlayId, {required int mapId}) async {}

  void _recordCamera(String kind, CameraUpdate update, int mapId) {
    if (failCameraCalls > 0) {
      failCameraCalls--;
      throw PlatformException(code: 'not_laid_out', message: 'the map has no size yet');
    }
    cameraCalls.add(RecordedCameraCall(kind, update));
  }

  @override
  Future<void> animateCamera(CameraUpdate cameraUpdate, {required int mapId}) async =>
      _recordCamera('animate', cameraUpdate, mapId);

  @override
  Future<void> animateCameraWithConfiguration(
    CameraUpdate cameraUpdate,
    CameraUpdateAnimationConfiguration configuration, {
    required int mapId,
  }) async =>
      _recordCamera('animate', cameraUpdate, mapId);

  @override
  Future<void> moveCamera(CameraUpdate cameraUpdate, {required int mapId}) async =>
      _recordCamera('move', cameraUpdate, mapId);

  @override
  Future<void> setMapStyle(String? mapStyle, {required int mapId}) async {}

  @override
  Future<LatLngBounds> getVisibleRegion({required int mapId}) async =>
      LatLngBounds(southwest: const LatLng(0, 0), northeast: const LatLng(0, 0));

  @override
  Future<ScreenCoordinate> getScreenCoordinate(LatLng latLng, {required int mapId}) async =>
      const ScreenCoordinate(x: 0, y: 0);

  @override
  Future<LatLng> getLatLng(ScreenCoordinate screenCoordinate, {required int mapId}) async => const LatLng(0, 0);

  @override
  Future<void> showMarkerInfoWindow(MarkerId markerId, {required int mapId}) async {}
  @override
  Future<void> hideMarkerInfoWindow(MarkerId markerId, {required int mapId}) async {}
  @override
  Future<bool> isMarkerInfoWindowShown(MarkerId markerId, {required int mapId}) async => false;
  @override
  Future<double> getZoomLevel({required int mapId}) async => 0.0;

  @override
  Stream<CameraMoveStartedEvent> onCameraMoveStarted({required int mapId}) => _of<CameraMoveStartedEvent>();
  @override
  Stream<CameraMoveEvent> onCameraMove({required int mapId}) => _of<CameraMoveEvent>();
  @override
  Stream<CameraIdleEvent> onCameraIdle({required int mapId}) => _of<CameraIdleEvent>();
  @override
  Stream<MarkerTapEvent> onMarkerTap({required int mapId}) => _of<MarkerTapEvent>();
  @override
  Stream<InfoWindowTapEvent> onInfoWindowTap({required int mapId}) => _of<InfoWindowTapEvent>();
  @override
  Stream<MarkerDragStartEvent> onMarkerDragStart({required int mapId}) => _of<MarkerDragStartEvent>();
  @override
  Stream<MarkerDragEvent> onMarkerDrag({required int mapId}) => _of<MarkerDragEvent>();
  @override
  Stream<MarkerDragEndEvent> onMarkerDragEnd({required int mapId}) => _of<MarkerDragEndEvent>();
  @override
  Stream<PolylineTapEvent> onPolylineTap({required int mapId}) => _of<PolylineTapEvent>();
  @override
  Stream<PolygonTapEvent> onPolygonTap({required int mapId}) => _of<PolygonTapEvent>();
  @override
  Stream<CircleTapEvent> onCircleTap({required int mapId}) => _of<CircleTapEvent>();
  @override
  Stream<MapTapEvent> onTap({required int mapId}) => _of<MapTapEvent>();
  @override
  Stream<MapLongPressEvent> onLongPress({required int mapId}) => _of<MapLongPressEvent>();
  @override
  Stream<ClusterTapEvent> onClusterTap({required int mapId}) => _of<ClusterTapEvent>();
  @override
  Stream<GroundOverlayTapEvent> onGroundOverlayTap({required int mapId}) => _of<GroundOverlayTapEvent>();

  @override
  void dispose({required int mapId}) {
    maps[mapId]?.disposed = true;
  }

  @override
  Widget buildViewWithConfiguration(
    int creationId,
    PlatformViewCreatedCallback onPlatformViewCreated, {
    required MapWidgetConfiguration widgetConfiguration,
    MapObjects mapObjects = const MapObjects(),
    MapConfiguration mapConfiguration = const MapConfiguration(),
  }) {
    if (!maps.containsKey(creationId)) {
      createdIds.add(creationId);
      maps[creationId] = RecordedMap(
        widgetConfiguration: widgetConfiguration,
        initialConfiguration: mapConfiguration,
        initialMarkers: mapObjects.markers,
      );
      onPlatformViewCreated(creationId);
    }
    return const SizedBox.expand(key: Key('fake-google-map'));
  }
}

/// What one fake native map was asked to do.
class RecordedMap {
  RecordedMap({
    required this.widgetConfiguration,
    required this.initialConfiguration,
    required this.initialMarkers,
  });

  final MapWidgetConfiguration widgetConfiguration;
  final MapConfiguration initialConfiguration;
  final Set<Marker> initialMarkers;
  final List<MapConfiguration> configurationUpdates = <MapConfiguration>[];
  final List<MarkerUpdates> markerUpdates = <MarkerUpdates>[];
  bool disposed = false;

  CameraPosition get initialCameraPosition => widgetConfiguration.initialCameraPosition;

  /// Every configuration the map ever received (initial + diffs).
  List<MapConfiguration> get allConfigurations => [initialConfiguration, ...configurationUpdates];

  late final Map<MarkerId, Marker> _now = <MarkerId, Marker>{for (final m in initialMarkers) m.markerId: m};

  /// The markers on the map now: the initial set with every update applied
  /// (what the native map would be showing), unaffected by clearing
  /// [markerUpdates].
  Map<MarkerId, Marker> get currentMarkers => Map.unmodifiable(_now);

  void recordMarkerUpdate(MarkerUpdates update) {
    markerUpdates.add(update);
    for (final m in update.markersToAdd) {
      _now[m.markerId] = m;
    }
    for (final m in update.markersToChange) {
      _now[m.markerId] = m;
    }
    update.markerIdsToRemove.forEach(_now.remove);
  }

  /// Marker ids added / changed / removed by the recorded updates, flattened
  /// in order, so a test can prove there was no add/remove churn (call
  /// `markerUpdates.clear()` first to look only at what happens next).
  List<MarkerId> get added => [for (final u in markerUpdates) ...u.markersToAdd.map((m) => m.markerId)];
  List<MarkerId> get changed => [for (final u in markerUpdates) ...u.markersToChange.map((m) => m.markerId)];
  List<MarkerId> get removed => [for (final u in markerUpdates) ...u.markerIdsToRemove];
}

class RecordedCameraCall {
  const RecordedCameraCall(this.kind, this.update);

  /// `animate` or `move`.
  final String kind;
  final CameraUpdate update;

  bool get isFitBounds => update is CameraUpdateNewLatLngBounds;
}
