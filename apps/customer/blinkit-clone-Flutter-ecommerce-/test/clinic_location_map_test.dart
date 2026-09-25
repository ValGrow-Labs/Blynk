import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Organisms/clinic_location_map.dart';
import 'package:ecom/UI/Widgets/Organisms/map_provider.dart';

/// A stand-in for the real map: records what it was asked to draw. Extends
/// the provider-neutral `TrackingMapView`, so this test never imports a map
/// SDK or needs a native platform view - `order_tracking_map_test.dart`'s
/// `_FakeTrackingMap` pattern.
class _FakeTrackingMap extends TrackingMapView {
  const _FakeTrackingMap({
    required this.initialCenter,
    required this.initialZoom,
    required this.markers,
    this.semanticsLabel,
  }) : super.constructor();

  @override
  final GeoPoint initialCenter;
  @override
  final double initialZoom;
  @override
  final Set<MapMarkerSpec> markers;

  /// Recorded (not applied to any real Semantics node - the fake draws
  /// none) purely so a test can assert `ClinicLocationMap` actually forwards
  /// `label` to the builder's `semanticsLabel` argument (task-F1 review-fix
  /// round 1). The REAL adapter's own semantics behaviour is covered
  /// separately by `google_map_view_test.dart`, against the genuine
  /// `GoogleTrackingMapView`, not this fake.
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) => const SizedBox.expand(key: Key('fake-map'));
}

TrackingMapView _fakeBuilder({
  required GeoPoint initialCenter,
  required double initialZoom,
  required Set<MapMarkerSpec> markers,
  String? semanticsLabel,
}) =>
    _FakeTrackingMap(
      initialCenter: initialCenter,
      initialZoom: initialZoom,
      markers: markers,
      semanticsLabel: semanticsLabel,
    );

const _clinicLat = 6.9271;
const _clinicLng = 79.8612;
const _location = GeoPoint(_clinicLat, _clinicLng);

TrackingMapView _map(WidgetTester tester) =>
    tester.widget<TrackingMapView>(find.byWidgetPredicate((w) => w is TrackingMapView));

Future<void> _pump(WidgetTester tester, Widget child) =>
    tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));

void main() {
  group('ClinicLocationMap', () {
    testWidgets('renders exactly one destination-toned marker at the given location', (tester) async {
      await _pump(tester, const ClinicLocationMap(location: _location, mapBuilder: _fakeBuilder));

      final map = _map(tester);
      expect(map.markers, hasLength(1));
      final marker = map.markers.single;
      expect(marker.id, 'clinic');
      expect(marker.position, _location);
      expect(marker.tone, MapMarkerTone.destination);
    });

    testWidgets('centers the camera on the clinic location', (tester) async {
      await _pump(tester, const ClinicLocationMap(location: _location, mapBuilder: _fakeBuilder));
      final map = _map(tester);
      expect(map.initialCenter, _location);
    });

    testWidgets('no routing/ETA/rider UI - only the map widget is present, nothing else', (tester) async {
      await _pump(tester, const ClinicLocationMap(location: _location, mapBuilder: _fakeBuilder));
      expect(find.byWidgetPredicate((w) => w is TrackingMapView), findsOneWidget);
      expect(find.textContaining('ETA'), findsNothing);
      expect(find.textContaining('min'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a different location moves the marker, never adds a second one', (tester) async {
      const otherLocation = GeoPoint(7.2906, 80.6337);
      await _pump(tester, const ClinicLocationMap(location: otherLocation, mapBuilder: _fakeBuilder));
      final map = _map(tester);
      expect(map.markers, hasLength(1));
      expect(map.markers.single.position, otherLocation);
    });

    testWidgets('an accessibility label, when given, is attached via Semantics', (tester) async {
      await _pump(
        tester,
        const ClinicLocationMap(location: _location, label: 'Smile Dental Clinic', mapBuilder: _fakeBuilder),
      );
      expect(find.bySemanticsLabel('Smile Dental Clinic'), findsOneWidget);
    });

    testWidgets('the label is also threaded to the builder as semanticsLabel (review-fix round 1)', (tester) async {
      await _pump(
        tester,
        const ClinicLocationMap(location: _location, label: 'Smile Dental Clinic', mapBuilder: _fakeBuilder),
      );
      final map = _map(tester) as _FakeTrackingMap;
      expect(map.semanticsLabel, 'Smile Dental Clinic',
          reason: 'so a real Google-backed map can override its own hardcoded rider/delivery label with this one');
    });

    testWidgets('no label given: the builder receives a null semanticsLabel, never a fabricated one', (tester) async {
      await _pump(tester, const ClinicLocationMap(location: _location, mapBuilder: _fakeBuilder));
      final map = _map(tester) as _FakeTrackingMap;
      expect(map.semanticsLabel, isNull);
    });

    testWidgets('no label means no extra Semantics wrapper is introduced', (tester) async {
      await _pump(tester, const ClinicLocationMap(location: _location, mapBuilder: _fakeBuilder));
      expect(find.byWidgetPredicate((w) => w is TrackingMapView), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
