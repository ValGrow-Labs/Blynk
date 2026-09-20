// geolocator_location_source.dart - the ONLY file that imports the geolocator
// plugin (enforced by test/map_isolation_test.dart). Everything else depends on
// device_location_source.dart.
//
// The two mapping functions are pure and unit-tested. The platform calls
// themselves need a device (a real permission prompt, a real GPS fix) and have
// NOT been exercised by the task that wrote this file.
import 'dart:async';

import 'package:geolocator/geolocator.dart' as geo;

import 'package:ecom/UI/Widgets/Organisms/map_provider.dart' show GeoPoint;

import 'device_location_source.dart';

/// How long the plugin may wait for a fix, and a slightly longer outer bound in
/// case the plugin's own time limit is not honoured on some platform.
const Duration kLocationTimeLimit = Duration(seconds: 15);
const Duration _outerTimeLimit = Duration(seconds: 20);

/// While-in-use and always both allow a read. `unableToDetermine` (seen mainly
/// on web) is treated as an askable denial, never as a grant.
LocationPermissionStatus mapGeolocatorPermission(geo.LocationPermission permission) {
  switch (permission) {
    case geo.LocationPermission.whileInUse:
    case geo.LocationPermission.always:
      return LocationPermissionStatus.granted;
    case geo.LocationPermission.deniedForever:
      return LocationPermissionStatus.deniedForever;
    case geo.LocationPermission.denied:
    case geo.LocationPermission.unableToDetermine:
      return LocationPermissionStatus.denied;
  }
}

/// Buckets whatever the plugin threw while reading a position.
DeviceLocationFailure mapGeolocatorFailure(Object error) {
  if (error is TimeoutException) return DeviceLocationFailure.timeout;
  if (error is geo.LocationServiceDisabledException) return DeviceLocationFailure.serviceDisabled;
  if (error is geo.PermissionDeniedException) return DeviceLocationFailure.permissionDenied;
  return DeviceLocationFailure.unavailable;
}

class GeolocatorLocationSource implements DeviceLocationSource {
  const GeolocatorLocationSource();

  @override
  Future<LocationPermissionStatus> checkPermission() async =>
      mapGeolocatorPermission(await geo.Geolocator.checkPermission());

  @override
  Future<LocationPermissionStatus> requestPermission() async =>
      mapGeolocatorPermission(await geo.Geolocator.requestPermission());

  @override
  Future<bool> isLocationServiceEnabled() => geo.Geolocator.isLocationServiceEnabled();

  @override
  Future<DeviceFix> currentPosition() async {
    try {
      final position = await geo.Geolocator.getCurrentPosition(
        locationSettings: const geo.LocationSettings(
          accuracy: geo.LocationAccuracy.high,
          timeLimit: kLocationTimeLimit,
        ),
      ).timeout(_outerTimeLimit);
      return DeviceFix(
        GeoPoint(position.latitude, position.longitude),
        accuracyMeters: position.accuracy,
      );
    } catch (error) {
      throw DeviceLocationException(mapGeolocatorFailure(error));
    }
  }

  @override
  Future<bool> openAppSettings() => geo.Geolocator.openAppSettings();

  @override
  Future<bool> openLocationSettings() => geo.Geolocator.openLocationSettings();
}
