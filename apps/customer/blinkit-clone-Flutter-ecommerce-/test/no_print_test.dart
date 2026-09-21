import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('lib/ has no print( calls (debugPrint is the only console output)', () {
    // A bare print( - not debugPrint( / blueprint( / footprint( - outside comments.
    final bare = RegExp(r'(^|[^A-Za-z0-9_$.])print\s*\(');
    final offenders = <String>[];

    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final lines = f.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final code = lines[i].split('//').first;
        if (bare.hasMatch(code)) offenders.add('${f.path}:${i + 1}: ${lines[i].trim()}');
      }
    }

    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });

  test('the matcher itself catches a bare print and ignores debugPrint', () {
    final bare = RegExp(r'(^|[^A-Za-z0-9_$.])print\s*\(');
    expect(bare.hasMatch("  print('x');"), isTrue);
    expect(bare.hasMatch("print ('x')"), isTrue);
    expect(bare.hasMatch("debugPrint('x')"), isFalse);
    expect(bare.hasMatch('final blueprint(x)'), isFalse);
    expect(bare.hasMatch('log.print(x)'), isFalse);
  });
}
