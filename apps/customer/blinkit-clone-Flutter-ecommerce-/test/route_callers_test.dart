import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Routes that have no `pushNamed`-style caller on purpose. An entry must give
/// the reason, and the test fails if the entry becomes stale (a caller appears).
const _allowedWithoutCaller = <String, String>{};

List<File> _libFiles() => Directory('lib')
    .listSync(recursive: true)
    .whereType<File>()
    .where((f) => f.path.endsWith('.dart'))
    .toList();

String _norm(String path) => path.replaceAll(r'\', '/');

void main() {
  final routerSource = File('lib/route_generator.dart').readAsStringSync();
  final routes = RegExp(r'''case\s+['"]([^'"]+)['"]\s*:''')
      .allMatches(routerSource)
      .map((m) => m.group(1)!)
      .where((name) => name != '/')
      .toList();

  final callerSources = _libFiles()
      .where((f) => _norm(f.path) != 'lib/route_generator.dart')
      .map((f) => f.readAsStringSync())
      .join('\n');

  bool hasCaller(String route) => RegExp(
        r'(pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil|popAndPushNamed)'
        r'\s*(<[^>(]*>)?\(\s*(?:[A-Za-z_.]+\s*,\s*)?'
        '''['"]${RegExp.escape(route)}['"]''',
      ).hasMatch(callerSources);

  test('the router source is parsed', () {
    expect(routes, isNotEmpty);
    expect(routes, contains('/home'));
  });

  test('the routes for deleted screens are gone', () {
    for (final gone in ['/coupons', '/cart/gift', '/order/invoice']) {
      expect(routes, isNot(contains(gone)), reason: gone);
    }
  });

  test('every route has at least one named-navigation caller or an allow-list reason', () {
    final orphans = routes
        .where((r) => !_allowedWithoutCaller.containsKey(r))
        .where((r) => !hasCaller(r))
        .toList();
    expect(orphans, isEmpty, reason: 'routes nothing navigates to: $orphans');
  });

  test('allow-listed routes really have no caller (remove the entry once one exists)', () {
    final stale = _allowedWithoutCaller.keys.where(hasCaller).toList();
    expect(stale, isEmpty);
    for (final entry in _allowedWithoutCaller.entries) {
      expect(routes, contains(entry.key), reason: '${entry.key} is not a route any more');
      expect(entry.value, isNotEmpty);
    }
  });
}
