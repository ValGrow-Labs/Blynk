import 'package:ecom/UI/Widgets/Organisms/map_provider.dart' show GeoPoint;

/// The customer's own device-location permission, as the address picker sees
/// it. Deliberately small: the picker only needs to know whether it may read a
/// position, whether asking again can help, or whether only the system
/// settings can.
///
/// This is the customer's address-entry permission - unrelated to viewing the
/// rider on the tracking map, which needs none (plan section 12).
enum LocationPermissionStatus {
  /// A position may be read (while-in-use or always).
  granted,

  /// Not granted, but the OS will still show its prompt if asked.
  denied,

  /// Refused with "don't ask again" (or restricted): only the system settings
  /// can change it, requesting again shows nothing.
  deniedForever,
}

/// Why no position could be produced.
enum DeviceLocationFailure {
  /// No fix within the time limit.
  timeout,

  /// The device's location services are switched off.
  serviceDisabled,

  /// The permission was refused or revoked.
  permissionDenied,

  /// Anything else the platform reported.
  unavailable,
}

/// [DeviceLocationSource.currentPosition] could not produce a position. There
/// is never a fabricated fallback: the caller shows the failure.
class DeviceLocationException implements Exception {
  const DeviceLocationException(this.reason);
  final DeviceLocationFailure reason;

  @override
  String toString() => 'DeviceLocationException($reason)';
}

/// One position reading.
class DeviceFix {
  const DeviceFix(this.position, {this.accuracyMeters});
  final GeoPoint position;

  /// Estimated horizontal accuracy, when the platform reports one.
  final double? accuracyMeters;
}

/// The device's location and permission state. The address picker and its
/// tests depend on this interface alone; the only implementation that touches a
/// plugin is GeolocatorLocationSource (geolocator_location_source.dart), and
/// test/map_isolation_test.dart enforces that no other file imports the
/// plugin. Same idea as the Rider app's injectable TrackingPlugin.
abstract class DeviceLocationSource {
  /// Reads the current permission WITHOUT prompting.
  Future<LocationPermissionStatus> checkPermission();

  /// Shows the OS permission prompt (if the OS still allows it) and returns
  /// the outcome. Callers must explain first (plan section 3): this is the
  /// call that puts the OS dialog on screen.
  Future<LocationPermissionStatus> requestPermission();

  Future<bool> isLocationServiceEnabled();

  /// One high-accuracy reading with a bounded wait. Throws
  /// [DeviceLocationException] on failure, never returns a guess.
  Future<DeviceFix> currentPosition();

  /// Opens this app's page in the system settings. False when it could not.
  Future<bool> openAppSettings();

  /// Opens the system's location-services settings. False when it could not.
  Future<bool> openLocationSettings();
}
