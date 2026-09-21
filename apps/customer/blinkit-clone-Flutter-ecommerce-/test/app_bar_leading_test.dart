import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// `leadingWidth: 25` squeezed the 48 dp back button into 25 dp and clipped
/// it. The default 56 dp leading slot is right everywhere.
void main() {
  test('no app bar in lib/ narrows its leading slot', () {
    final offenders = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final lines = f.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        if (RegExp(r'leadingWidth\s*:').hasMatch(lines[i])) {
          offenders.add('${f.path}:${i + 1}');
        }
      }
    }
    expect(offenders, isEmpty);
  });
}
