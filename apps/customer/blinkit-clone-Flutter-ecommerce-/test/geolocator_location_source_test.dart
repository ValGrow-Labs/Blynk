import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart' as geo;

import 'package:ecom/Services/Location/device_location_source.dart';
import 'package:ecom/Services/Location/geolocator_location_source.dart';

/// The adapter's pure mapping logic (geolocator types -> the app's own). The
/// platform calls themselves need a device and are not exercised here.
void main() {
  group('mapGeolocatorPermission', () {
    test('while-in-use and always both count as granted', () {
      expect(mapGeolocatorPermission(geo.LocationPermission.whileInUse), LocationPermissionStatus.granted);
      expect(mapGeolocatorPermission(geo.LocationPermission.always), LocationPermissionStatus.granted);
    });

    test('denied stays askable, deniedForever is not', () {
      expect(mapGeolocatorPermission(geo.LocationPermission.denied), LocationPermissionStatus.denied);
      expect(mapGeolocatorPermission(geo.LocationPermission.deniedForever), LocationPermissionStatus.deniedForever);
    });

    test('unableToDetermine is treated as denied, never as granted', () {
      expect(mapGeolocatorPermission(geo.LocationPermission.unableToDetermine), LocationPermissionStatus.denied);
    });
  });

  group('mapGeolocatorFailure', () {
    test('a timeout maps to timeout', () {
      expect(mapGeolocatorFailure(TimeoutException('slow')), DeviceLocationFailure.timeout);
    });

    test('location services off maps to serviceDisabled', () {
      expect(mapGeolocatorFailure(const geo.LocationServiceDisabledException()), DeviceLocationFailure.serviceDisabled);
    });

    test('a permission problem maps to permissionDenied', () {
      expect(mapGeolocatorFailure(const geo.PermissionDeniedException('no')), DeviceLocationFailure.permissionDenied);
    });

    test('anything else is a generic unavailable', () {
      expect(mapGeolocatorFailure(const geo.PositionUpdateException('boom')), DeviceLocationFailure.unavailable);
      expect(mapGeolocatorFailure(StateError('x')), DeviceLocationFailure.unavailable);
    });
  });
}
