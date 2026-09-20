import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/order_model.dart';
import 'package:ecom/Services/Providers/location.provider.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';
import 'package:ecom/UI/Widgets/Organisms/order_tracking_map.dart';
import 'package:ecom/app_design.dart';

import 'fixtures/order_fixtures.dart';

/// A stand-in for the real map: records what it was asked to draw. It extends
/// the provider-neutral TrackingMapView, so this test never imports a map SDK
/// or needs a native platform view.
class _FakeTrackingMap extends TrackingMapView {
  const _FakeTrackingMap({
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

TrackingMapView _fakeBuilder({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
}) =>
    _FakeTrackingMap(initialCenter: initialCenter, initialZoom: initialZoom, markers: markers);

const _attribution = '© OpenStreetMap contributors';
const _destLat = 6.4382;
const _destLng = 80.0274;

OrderModel _order({bool withCoordinates = true}) => OrderModel.fromJson({
      ...orderJson(status: 'OUT_FOR_DELIVERY'),
      if (withCoordinates) 'delivery_latitude': '$_destLat',
      if (withCoordinates) 'delivery_longitude': '$_destLng',
    });

/// Drives a REAL LocationProvider from a controllable SSE stream and a
/// controllable clock, so LIVE/STALE/OFFLINE/closed come from the provider's
/// own logic rather than from a test double that could drift from it.
class _Harness {
  _Harness({Stream<String>? stream}) : controller = StreamController<String>() {
    provider = LocationProvider(
      opener: (_) => stream ?? controller.stream,
      now: () => clock,
      freshnessInterval: tick,
    );
  }

  final StreamController<String> controller;
  late final LocationProvider provider;
  DateTime clock = DateTime.utc(2026, 9, 19, 10, 0, 0);

  void sendPoint({required double lat, required double lng, required Duration age}) {
    final captured = clock.subtract(age);
    controller.add('event: location\n'
        'data: {"latitude":$lat,"longitude":$lng,"accuracy":8,'
        '"captured_at":"${captured.toIso8601String()}",'
        '"received_at":"${captured.add(const Duration(seconds: 1)).toIso8601String()}"}\n\n');
  }

  static const tick = Duration(seconds: 1);

  /// Moves the provider clock forward and lets its periodic age tick fire.
  Future<void> advance(WidgetTester tester, Duration by) async {
    clock = clock.add(by);
    await tester.pump(tick);
    await tester.pump();
  }

  void sendClosed() => controller.add('event: closed\ndata: {"reason":"delivery_closed"}\n\n');

  void dispose() {
    provider.dispose();
    controller.close();
  }
}

Future<void> _pump(WidgetTester tester, LocationProvider provider, OrderModel order) async {
  await tester.pumpWidget(
    ChangeNotifierProvider<LocationProvider>.value(
      value: provider,
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OrderTrackingMap(order: order, mapBuilder: _fakeBuilder),
          ),
        ),
      ),
    ),
  );
}

TrackingMapView _map(WidgetTester tester) => tester.widget<TrackingMapView>(find.byWidgetPredicate((w) => w is TrackingMapView));

MapMarkerSpec _markerById(WidgetTester tester, String id) => _map(tester).markers.singleWhere((m) => m.id == id);

Set<MapMarkerTone> _tones(WidgetTester tester) => _map(tester).markers.map((m) => m.tone).toSet();

/// A stream event reaches the provider in a microtask that runs after the frame
/// pump, so one more pump is needed for the Consumer to rebuild.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

/// Harnesses of the running test. Disposed INSIDE the test body: Flutter checks
/// for pending timers before tearDown callbacks run, and the provider owns a
/// periodic age timer.
final _open = <_Harness>[];

/// A testWidgets that always unmounts the tree and disposes its providers.
void _testMap(String name, Future<void> Function(WidgetTester tester) body) {
  testWidgets(name, (tester) async {
    try {
      await body(tester);
    } finally {
      await tester.pumpWidget(const SizedBox());
      for (final h in _open) {
        h.dispose();
      }
      _open.clear();
    }
  });
}

Future<_Harness> _watching(WidgetTester tester, OrderModel order) async {
  final h = _Harness();
  _open.add(h);
  h.provider.watch(order.id);
  await _pump(tester, h.provider, order);
  await _settle(tester);
  return h;
}

void main() {
  group('OrderTrackingMap - markers', () {
    _testMap('no point yet: destination only, from the order coordinate; camera on it at zoom 14', (tester) async {
      final order = _order();
      await _watching(tester, order);

      expect(_map(tester).markers, hasLength(1));
      expect(_tones(tester), {MapMarkerTone.destination});
      expect(_markerById(tester, 'destination').position, const GeoPoint(_destLat, _destLng));
      expect(_map(tester).initialCenter, const GeoPoint(_destLat, _destLng));
      expect(_map(tester).initialZoom, 14);
      expect(find.text('Live location unavailable right now.'), findsOneWidget);
    });

    _testMap('a fresh point adds a live rider marker at exactly the provider point', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);

      h.sendPoint(lat: 6.4411, lng: 80.0299, age: const Duration(seconds: 4));
      await _settle(tester);

      expect(_map(tester).markers, hasLength(2));
      final rider = _markerById(tester, 'rider');
      expect(rider.tone, MapMarkerTone.riderLive);
      expect(rider.position, const GeoPoint(6.4411, 80.0299));
      expect(rider.position, GeoPoint(h.provider.current!.latitude, h.provider.current!.longitude));
      expect(_markerById(tester, 'destination').tone, MapMarkerTone.destination);
      expect(find.text('Live'), findsOneWidget);
    });

    _testMap('an aging point is a stale rider marker (same position, stale tone)', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);

      h.sendPoint(lat: 6.4411, lng: 80.0299, age: const Duration(seconds: 45));
      await _settle(tester);

      expect(_tones(tester), {MapMarkerTone.destination, MapMarkerTone.riderStale});
      expect(_markerById(tester, 'rider').position, const GeoPoint(6.4411, 80.0299));
    });

    _testMap('an offline-aged point shows the destination only', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);

      h.sendPoint(lat: 6.4411, lng: 80.0299, age: const Duration(minutes: 5));
      await _settle(tester);

      expect(_tones(tester), {MapMarkerTone.destination});
      expect(find.text('Live location unavailable right now.'), findsOneWidget);
    });

    _testMap('a point that ages LIVE -> STALE -> OFFLINE on the provider clock moves through the tones', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 2));
      await _settle(tester);
      expect(_markerById(tester, 'rider').tone, MapMarkerTone.riderLive);

      await h.advance(tester, const Duration(seconds: 40));
      expect(_markerById(tester, 'rider').tone, MapMarkerTone.riderStale);

      await h.advance(tester, const Duration(minutes: 5));
      expect(_tones(tester), {MapMarkerTone.destination});
    });

    _testMap('closed drops the rider marker and shows the unavailable caption', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 3));
      await _settle(tester);
      expect(_map(tester).markers, hasLength(2));

      h.sendClosed();
      await _settle(tester);

      expect(h.provider.closed, isTrue);
      expect(_tones(tester), {MapMarkerTone.destination});
      expect(find.text('Live location unavailable right now.'), findsOneWidget);
      expect(find.text('Live'), findsNothing);
    });

    _testMap('a refused stream (unavailable) shows the destination only', (tester) async {
      final order = _order();
      final h = _Harness(stream: Stream<String>.error(const LocationStreamRefused(403)));
      _open.add(h);
      h.provider.watch(order.id);
      await _pump(tester, h.provider, order);
      await _settle(tester);

      expect(h.provider.unavailable, isTrue);
      expect(_tones(tester), {MapMarkerTone.destination});
      expect(find.text('Live location unavailable right now.'), findsOneWidget);
    });

    _testMap('movement: a new point re-renders the map with a NEW marker set at the new position', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);

      h.sendPoint(lat: 6.4400, lng: 80.0300, age: const Duration(seconds: 3));
      await _settle(tester);
      final first = _map(tester).markers;
      expect(_markerById(tester, 'rider').position, const GeoPoint(6.4400, 80.0300));

      h.clock = h.clock.add(const Duration(seconds: 10));
      h.sendPoint(lat: 6.4415, lng: 80.0312, age: const Duration(seconds: 2));
      await _settle(tester);
      final second = _map(tester).markers;

      expect(second, isNot(equals(first)));
      expect(_markerById(tester, 'rider').position, const GeoPoint(6.4415, 80.0312));
      expect(_markerById(tester, 'rider').tone, MapMarkerTone.riderLive);
      expect(_markerById(tester, 'destination').position, const GeoPoint(_destLat, _destLng)); // destination never moves
      expect(second, hasLength(2));
    });

    _testMap('no destination coordinate: nothing rendered, no map, no fabricated coordinate', (tester) async {
      final order = _order(withCoordinates: false);
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 3));
      await _settle(tester);

      expect(find.byWidgetPredicate((w) => w is TrackingMapView), findsNothing);
      expect(find.text(_attribution), findsNothing);
      expect(find.byType(SizedBox), findsWidgets); // the shrink placeholder
      expect(tester.takeException(), isNull);
    });
  });

  group('OrderTrackingMap - attribution overlay', () {
    _testMap('present in every state: no point, live, stale, offline, closed', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      expect(find.text(_attribution), findsOneWidget, reason: 'no point');

      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 3));
      await _settle(tester);
      expect(find.text(_attribution), findsOneWidget, reason: 'live');

      await h.advance(tester, const Duration(seconds: 40));
      expect(_markerById(tester, 'rider').tone, MapMarkerTone.riderStale);
      expect(find.text(_attribution), findsOneWidget, reason: 'stale');

      await h.advance(tester, const Duration(minutes: 5));
      expect(_tones(tester), {MapMarkerTone.destination});
      expect(find.text(_attribution), findsOneWidget, reason: 'offline');

      h.sendPoint(lat: 6.45, lng: 80.04, age: const Duration(seconds: 1));
      await _settle(tester);
      h.sendClosed();
      await _settle(tester);
      expect(h.provider.closed, isTrue);
      expect(find.text(_attribution), findsOneWidget, reason: 'closed');
    });

    _testMap('is drawn over the map, non-interactive (never steals map gestures) and has readable contrast', (tester) async {
      final order = _order();
      await _watching(tester, order);

      final attribution = find.byKey(const Key('map-attribution'));
      expect(attribution, findsOneWidget);
      // Overlay, not a dismissible control.
      expect(find.descendant(of: attribution, matching: find.byType(IconButton)), findsNothing);
      expect(find.descendant(of: attribution, matching: find.byType(TextButton)), findsNothing);
      expect(find.ancestor(of: attribution, matching: find.byType(IgnorePointer)), findsWidgets);
      // Sits inside the map frame, bottom-left, over the map.
      final mapRect = tester.getRect(find.byKey(const Key('fake-map')));
      final attrRect = tester.getRect(attribution);
      expect(mapRect.contains(attrRect.topLeft) && mapRect.contains(attrRect.bottomRight), isTrue);
      expect(attrRect.left - mapRect.left, lessThan(24));
      expect(mapRect.bottom - attrRect.bottom, lessThan(24));
      // Dark text on a light backing: AppTextColors.primary on white-ish.
      final text = tester.widget<Text>(find.text(_attribution));
      expect(text.style?.color, AppTextColors.primary);
      expect(text.style!.fontSize!, greaterThanOrEqualTo(10));
    });
  });

  group('OrderTrackingMap - caption', () {
    _testMap('LIVE reads "Live" in Blynk green', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 3));
      await _settle(tester);

      final live = tester.widget<Text>(find.text('Live'));
      expect(live.style?.color, AppTextColors.positiveOnBackground);
    });

    _testMap('STALE reads the real elapsed time from capturedAt, in seconds', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 45));
      await _settle(tester);

      expect(find.text('Last seen 45 seconds ago'), findsOneWidget);
    });

    _testMap('STALE elapsed time switches to minutes and follows the clock', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.44, lng: 80.03, age: const Duration(seconds: 30));
      await _settle(tester);
      expect(find.text('Last seen 30 seconds ago'), findsOneWidget);

      await h.advance(tester, const Duration(seconds: 45));
      expect(find.text('Last seen 1 minute ago'), findsOneWidget);

      await h.advance(tester, const Duration(seconds: 50));
      expect(find.textContaining('Last seen'), findsNothing);
      expect(find.text('Live location unavailable right now.'), findsOneWidget);
    });

    _testMap('no caption ever contains a coordinate', (tester) async {
      final order = _order();
      final h = await _watching(tester, order);
      h.sendPoint(lat: 6.4411, lng: 80.0299, age: const Duration(seconds: 45));
      await _settle(tester);

      for (final t in tester.widgetList<Text>(find.byType(Text))) {
        final s = t.data ?? '';
        expect(s.contains('6.44'), isFalse, reason: s);
        expect(s.contains('80.02'), isFalse, reason: s);
      }
    });
  });

  group('lastSeenText', () {
    test('seconds under a minute, singular/plural minutes after', () {
      expect(lastSeenText(const Duration(seconds: 19)), 'Last seen 19 seconds ago');
      expect(lastSeenText(const Duration(seconds: 59)), 'Last seen 59 seconds ago');
      expect(lastSeenText(const Duration(seconds: 60)), 'Last seen 1 minute ago');
      expect(lastSeenText(const Duration(seconds: 119)), 'Last seen 1 minute ago');
      expect(lastSeenText(const Duration(minutes: 2)), 'Last seen 2 minutes ago');
    });

    test('a negative or zero age (clock skew) never shows a negative number', () {
      expect(lastSeenText(const Duration(seconds: -5)), 'Last seen just now');
      expect(lastSeenText(Duration.zero), 'Last seen just now');
    });
  });

  group('OrderTrackingMap - layout', () {
    _testMap('map frame is 220 logical px high and uses the card radius', (tester) async {
      final order = _order();
      await _watching(tester, order);

      expect(tester.getSize(find.byKey(const Key('order-tracking-map-frame'))).height, 220);
      final clip = tester.widget<ClipRRect>(find.descendant(
        of: find.byKey(const Key('order-tracking-map-frame')),
        matching: find.byType(ClipRRect),
      ));
      expect(clip.borderRadius, BorderRadius.circular(AppRadius.card));
    });
  });
}
