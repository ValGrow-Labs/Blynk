import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Content that belongs to the upstream Blinkit clone, invented features, or
/// developer text, and must never reach a Blynk customer.
final _forbidden = <String, RegExp>{
  'Blinkit': RegExp('blinkit', caseSensitive: false),
  'icons8 (remote images)': RegExp('icons8', caseSensitive: false),
  'kDummy* placeholder data': RegExp('kDummy'),
  '"Gotcha"': RegExp('Gotcha'),
  '"10-Minute" delivery claim': RegExp('10-Minute'),
  'FRESHER. FASTER.': RegExp(r'FRESHER\. FASTER'),
  '"number below" (there is no number)': RegExp('number below'),
};

void main() {
  final files = Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();

  test('lib/ is not empty', () => expect(files, isNotEmpty));

  _forbidden.forEach((name, pattern) {
    test('lib/ contains no $name', () {
      final offenders = files.where((f) => pattern.hasMatch(f.readAsStringSync())).map((f) => f.path).toList();
      expect(offenders, isEmpty);
    });
  });

  test('the web shell has no speed claim in its description', () {
    final html = File('web/index.html').readAsStringSync();
    expect(html, isNot(contains('10-Minute')));
    expect(html, contains('<meta name="description" content="Blynk - order groceries for delivery.">'));
  });

  test('the customer-facing copy makes no speed promise', () {
    final copy = files
        .where((f) => !f.path.contains('${Platform.pathSeparator}design${Platform.pathSeparator}'))
        .map((f) => f.readAsStringSync())
        .join('\n');
    for (final claim in ['Delivered Fast', 'Fast Delivery', 'minute delivery', 'Minute Delivery']) {
      expect(copy.contains(claim), isFalse, reason: claim);
    }
  });
}
