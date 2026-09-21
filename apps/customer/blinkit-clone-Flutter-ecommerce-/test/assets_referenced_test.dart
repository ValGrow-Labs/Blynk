import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _norm(String path) => path.replaceAll(r'\', '/');

/// The `flutter: assets:` entries, verbatim (comments and blank lines dropped).
List<String> _pubspecAssets() {
  final lines = File('pubspec.yaml').readAsLinesSync();
  final start = lines.indexWhere((l) => l.trim() == 'assets:');
  if (start < 0) throw StateError('pubspec.yaml has no assets: block');
  final entries = <String>[];
  for (final line in lines.skip(start + 1)) {
    final t = line.trim();
    if (t.isEmpty || t.startsWith('#')) continue;
    if (!t.startsWith('- ')) break;
    entries.add(t.substring(2).trim());
  }
  return entries;
}

void main() {
  final assets = _pubspecAssets();

  final sources = <Directory>[Directory('lib'), Directory('test'), Directory('integration_test')]
      .where((d) => d.existsSync())
      .expand((d) => d.listSync(recursive: true))
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .map((f) => f.readAsStringSync())
      .join('\n');

  final files = Directory('Assets')
      .listSync(recursive: true)
      .whereType<File>()
      .map((f) => _norm(f.path))
      .where((p) => !p.startsWith('Assets/Fonts/'))
      .where((p) => !RegExp(r'^Assets/splash[^/]*\.png$').hasMatch(p))
      .where((p) => !p.startsWith('Assets/map/'))
      .toList();

  test('every asset file is referenced by a literal path in code or listed as a file in pubspec', () {
    final unused = files.where((p) => !sources.contains(p) && !assets.contains(p)).toList();
    expect(unused, isEmpty, reason: 'unreferenced assets: $unused');
  });

  test('pubspec does not bundle the Assets/ root, so the splash source PNGs stay out of the build', () {
    expect(assets, isNot(contains('Assets/')));
    expect(assets.any((a) => RegExp(r'splash').hasMatch(a)), isFalse);
  });

  test('every pubspec asset entry exists on disk', () {
    for (final entry in assets.where((a) => a != '.env')) {
      final exists = entry.endsWith('/') ? Directory(entry).existsSync() : File(entry).existsSync();
      expect(exists, isTrue, reason: entry);
    }
  });

  test('the deleted Blinkit-clone art is not bundled', () {
    for (final gone in ['Categories', 'SubCategories', 'Products', 'cimgs', 'SvgIcons']) {
      expect(assets.any((a) => a.startsWith('Assets/$gone')), isFalse, reason: gone);
      expect(Directory('Assets/$gone').existsSync(), isFalse, reason: 'Assets/$gone still on disk');
    }
  });

  test('no unused Catamaran weights are declared or left on disk', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    for (final weight in ['Thin', 'Light', 'ExtraLight', 'Black']) {
      expect(pubspec.contains('Catamaran-$weight.ttf'), isFalse, reason: weight);
      expect(File('Assets/Fonts/Catamaran-$weight.ttf').existsSync(), isFalse, reason: weight);
    }
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      expect(pubspec.contains('Catamaran-$weight.ttf'), isTrue, reason: weight);
    }
  });

  test('no source uses a font weight the bundled Catamaran files do not cover', () {
    final lib = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .map((f) => f.readAsStringSync())
        .join('\n');
    expect(RegExp(r'FontWeight\.w(100|200|300|900)\b').hasMatch(lib), isFalse);
  });
}
