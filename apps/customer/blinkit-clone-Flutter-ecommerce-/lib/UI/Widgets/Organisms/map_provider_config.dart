import 'package:flutter/foundation.dart';

/// Which map adapter the app builds. Google is the default; MapLibre stays in
/// the tree as the dormant rollback path (plan section 11, D13).
enum MapProviderKind { google, maplibre }

/// Compile-time provider choice: `--dart-define=MAP_PROVIDER=maplibre` rolls
/// back, anything else (including an unknown value or nothing) is Google.
/// Exactly one adapter is ever built, never both.
class MapProviderConfig {
  const MapProviderConfig._();

  static const String _define = String.fromEnvironment('MAP_PROVIDER', defaultValue: 'google');

  /// The kind selected by the build define. Kept separate from [kind] so tests
  /// can see the pure parsing.
  static MapProviderKind parse(String value) =>
      value.trim().toLowerCase() == 'maplibre' ? MapProviderKind.maplibre : MapProviderKind.google;

  /// Test-only: forces a provider. Reset it to null in tearDown.
  @visibleForTesting
  static MapProviderKind? debugOverride;

  static MapProviderKind get kind => debugOverride ?? parse(_define);
}
