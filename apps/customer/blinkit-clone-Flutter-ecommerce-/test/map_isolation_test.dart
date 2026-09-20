import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Architecture guard (plan section 8.4): the map SDK is confined to ONE file,
/// so swapping providers later touches that file and map_provider.dart only.
/// Runs from the package root (where `flutter test` runs).
List<File> _dartFilesUnder(String dir) => Directory(dir)
    .listSync(recursive: true)
    .whereType<File>()
    .where((f) => f.path.endsWith('.dart'))
    .toList();

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

  test('no other map SDK is imported anywhere in lib/ (only maplibre_gl or maplibre_gl_* platform packages via the adapter)', () {
    final offenders = _dartFilesUnder('lib')
        .where((f) => f.readAsStringSync().contains('package:maplibre_gl_'))
        .map((f) => _norm(f.path))
        .toList();
    expect(offenders, isEmpty, reason: 'platform-interface packages must not be imported directly: $offenders');
  });

  test('the abstraction and the tracking widget stay SDK-free', () {
    for (final name in ['map_provider.dart', 'map_marker_logic.dart', 'map_tile_config.dart', 'order_tracking_map.dart']) {
      final text = File('lib/UI/Widgets/Organisms/$name').readAsStringSync();
      expect(text.contains('maplibre_gl'), isFalse, reason: '$name must not mention maplibre_gl imports');
    }
  });

  test('no Google Maps anywhere in lib/ or pubspec.yaml', () {
    final files = <File>[..._dartFilesUnder('lib'), File('pubspec.yaml')];
    final offenders = <String>[];
    for (final f in files) {
      final text = f.readAsStringSync();
      for (final needle in ['google_maps_flutter', 'com.google.android.geo']) {
        if (text.contains(needle)) offenders.add('${_norm(f.path)} mentions $needle');
      }
    }
    expect(offenders, isEmpty);
  });
}
