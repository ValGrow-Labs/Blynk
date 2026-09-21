import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Architecture guard (plan section 8.4): each map SDK is confined to ONE
/// adapter file (google_map_view.dart, maplibre_map_view.dart), so swapping
/// providers touches those files and map_provider.dart only.
/// Runs from the package root (where `flutter test` runs).
List<File> _dartFilesUnder(String dir) => Directory(dir)
    .listSync(recursive: true)
    .whereType<File>()
    .where((f) => f.path.endsWith('.dart'))
    .toList();

/// Files under [dir] (if it exists) whose normalised path satisfies [test],
/// skipping any directory named in [skipDirs] (build output, Gradle caches).
List<File> _filesUnder(String dir, bool Function(String path) test, {Set<String> skipDirs = const {}}) {
  final root = Directory(dir);
  if (!root.existsSync()) return [];
  return root
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) {
        final path = _norm(f.path);
        final segments = path.substring(dir.length).split('/');
        return !segments.any(skipDirs.contains) && test(path);
      })
      .toList();
}

String _norm(String p) => p.replaceAll('\\', '/');

void main() {
  test('exactly one file under lib/ imports package:maplibre_gl, and it is maplibre_map_view.dart', () {
    final importing = _dartFilesUnder('lib')
        .where((f) => RegExp(r'''(import|export)\s+['"]package:maplibre_gl[/'"]''').hasMatch(f.readAsStringSync()))
        .map((f) => _norm(f.path))
        .toList();

    expect(importing, hasLength(1), reason: 'maplibre_gl importers: $importing');
    expect(importing.single, endsWith('lib/UI/Widgets/Organisms/maplibre_map_view.dart'));
  });

  test('exactly one file under lib/ imports package:google_maps_flutter, and it is google_map_view.dart', () {
    final importing = _dartFilesUnder('lib')
        .where((f) => RegExp(r'''(import|export)\s+['"]package:google_maps_flutter[/'"]''').hasMatch(f.readAsStringSync()))
        .map((f) => _norm(f.path))
        .toList();

    expect(importing, hasLength(1), reason: 'google_maps_flutter importers: $importing');
    expect(importing.single, endsWith('lib/UI/Widgets/Organisms/google_map_view.dart'));
  });

  test('the two adapter files never import each other (Google and MapLibre are never built together)', () {
    final google = File('lib/UI/Widgets/Organisms/google_map_view.dart').readAsStringSync();
    final maplibre = File('lib/UI/Widgets/Organisms/maplibre_map_view.dart').readAsStringSync();
    expect(google.contains('maplibre'), isFalse);
    expect(maplibre.contains('google_map_view'), isFalse);
    expect(maplibre.contains('google_maps_flutter'), isFalse);
  });

  test('exactly one file under lib/ imports package:geolocator, and it is the location adapter', () {
    // Device-location types stay behind DeviceLocationSource, the same way the
    // map SDK stays behind map_provider.dart: the screen and every test depend
    // on the interface, and swapping the plugin touches the adapter only.
    final importing = _dartFilesUnder('lib')
        .where((f) => RegExp(r'''(import|export)\s+['"]package:geolocator[/'"]''').hasMatch(f.readAsStringSync()))
        .map((f) => _norm(f.path))
        .toList();

    expect(importing, hasLength(1), reason: 'geolocator importers: $importing');
    expect(importing.single, endsWith('lib/Services/Location/geolocator_location_source.dart'));
  });

  test('no geolocator platform package is imported directly (the adapter imports the umbrella package only)', () {
    final offenders = _dartFilesUnder('lib')
        .where((f) => f.readAsStringSync().contains('package:geolocator_'))
        .map((f) => _norm(f.path))
        .toList();
    expect(offenders, isEmpty, reason: 'geolocator_* platform packages must not be imported: $offenders');
  });

  test('no map platform-interface package is imported directly anywhere in lib/', () {
    final offenders = _dartFilesUnder('lib')
        .where((f) {
          final text = f.readAsStringSync();
          return text.contains('package:maplibre_gl_') || text.contains('package:google_maps_flutter_');
        })
        .map((f) => _norm(f.path))
        .toList();
    expect(offenders, isEmpty, reason: 'platform-interface packages must not be imported directly: $offenders');
  });

  test('the abstraction and the tracking widget stay SDK-free', () {
    for (final name in [
      'map_provider.dart',
      'map_provider_config.dart',
      'map_marker_logic.dart',
      'map_tile_config.dart',
      'map_unavailable_card.dart',
      'order_tracking_map.dart',
    ]) {
      final text = File('lib/UI/Widgets/Organisms/$name').readAsStringSync();
      expect(text.contains('package:maplibre_gl'), isFalse, reason: '$name must not import maplibre_gl');
      expect(text.contains('package:google_maps_flutter'), isFalse, reason: '$name must not import google_maps_flutter');
    }
  });

  test('no screen, provider or service in lib/ names a map SDK type outside the adapters', () {
    final adapters = {
      'lib/UI/Widgets/Organisms/google_map_view.dart',
      'lib/UI/Widgets/Organisms/maplibre_map_view.dart',
    };
    final offenders = _dartFilesUnder('lib')
        .where((f) => !adapters.contains(_norm(f.path)))
        .where((f) => RegExp(r'(GoogleMapController|MapLibreMapController|BitmapDescriptor)').hasMatch(f.readAsStringSync()))
        .map((f) => _norm(f.path))
        .toList();
    expect(offenders, isEmpty);
  });

  test('both map SDKs are declared in pubspec.yaml (Google active, MapLibre dormant rollback)', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    expect(RegExp(r'^  google_maps_flutter:', multiLine: true).hasMatch(pubspec), isTrue);
    expect(RegExp(r'^  maplibre_gl:', multiLine: true).hasMatch(pubspec), isTrue);
  });

  test('no Google Maps API key literal in the native projects, the manifest or the iOS runner', () {
    // The Android SDK reads its key from the manifest at build time (G1b wires a
    // placeholder); nothing may embed one. Scans the files a key would land in.
    final files = <File>[
      File('android/app/src/main/AndroidManifest.xml'),
      ..._filesUnder('android', (p) => p.endsWith('.gradle') || p.endsWith('.gradle.kts'), skipDirs: {'build', '.gradle'}),
      ..._filesUnder('ios/Runner', (p) {
        final name = p.split('/').last;
        return name.endsWith('.plist') || name.startsWith('AppDelegate') || name.startsWith('GeneratedPluginRegistrant');
      }),
    ];

    // Guard against the guard silently scanning nothing.
    expect(files.where((f) => f.existsSync()).map((f) => _norm(f.path)), containsAll([
      'android/app/src/main/AndroidManifest.xml',
      'android/app/build.gradle',
      'android/build.gradle',
      'android/settings.gradle',
      'ios/Runner/Info.plist',
      'ios/Runner/AppDelegate.swift',
    ]));

    final keyShape = RegExp(r'AIza[0-9A-Za-z_\-]{35}');
    final offenders = [
      for (final f in files)
        if (f.existsSync() && keyShape.hasMatch(f.readAsStringSync())) _norm(f.path),
    ];
    expect(offenders, isEmpty, reason: 'a Google API key must never be committed: $offenders');
  });

  test('the backend has no Google Maps dependency or reference (it stays provider-independent)', () {
    const needles = ['googleapis', '@googlemaps', 'maps.googleapis'];
    final root = Directory('../../../backend/api');
    // Guard against the guard silently scanning nothing.
    expect(root.existsSync(), isTrue, reason: 'expected backend/api relative to the Customer app');
    expect(File('../../../backend/api/package.json').existsSync(), isTrue);

    final files = <File>[
      File('../../../backend/api/package.json'),
      ..._filesUnder('../../../backend/api/src', (p) => RegExp(r'\.(ts|js|json|sql)$').hasMatch(p)),
    ];
    expect(files.length, greaterThan(20));
    final offenders = <String>[];
    for (final f in files) {
      final text = f.readAsStringSync();
      for (final needle in needles) {
        if (text.contains(needle)) offenders.add('${_norm(f.path)} mentions $needle');
      }
    }
    expect(offenders, isEmpty);
  });

  test('location permission is declared for the address picker (iOS usage string, Android permissions once)', () {
    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    expect(RegExp(r'<key>NSLocationWhenInUseUsageDescription</key>\s*<string>[^<]{20,}</string>').hasMatch(plist), isTrue);
    expect('NSLocationWhenInUseUsageDescription'.allMatches(plist), hasLength(1));

    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    for (final permission in ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']) {
      expect('android.permission.$permission'.allMatches(manifest), hasLength(1), reason: permission);
    }
  });
}
