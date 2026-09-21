import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/app_responsive.dart';

void main() {
  group('Responsive.classOf', () {
    test('sits on the AppBreakpoints boundaries', () {
      expect(Responsive.classOf(0), ResponsiveClass.compact);
      expect(Responsive.classOf(599), ResponsiveClass.compact);
      expect(Responsive.classOf(599.9), ResponsiveClass.compact);
      expect(Responsive.classOf(600), ResponsiveClass.medium);
      expect(Responsive.classOf(1023), ResponsiveClass.medium);
      expect(Responsive.classOf(1023.9), ResponsiveClass.medium);
      expect(Responsive.classOf(1024), ResponsiveClass.expanded);
      expect(Responsive.classOf(2560), ResponsiveClass.expanded);
    });

    test('the breakpoints are 600 and 1024', () {
      expect(AppBreakpoints.tablet, 600);
      expect(AppBreakpoints.desktop, 1024);
    });

    test('agrees with the existing Responsive flags at every boundary', () {
      for (final w in <double>[320, 599, 600, 800, 1023, 1024, 1600]) {
        final r = Responsive(w);
        expect(r.responsiveClass == ResponsiveClass.compact, r.isMobile, reason: '$w');
        expect(r.responsiveClass == ResponsiveClass.medium, r.isTablet, reason: '$w');
        expect(r.responsiveClass == ResponsiveClass.expanded, r.isDesktop, reason: '$w');
      }
    });
  });

  test('the login screen has no private 600 / 1024 thresholds any more', () {
    final src = File('lib/Screens/Auth/login_screen.dart').readAsStringSync();
    expect(RegExp(r'(>=|<)\s*(600|1024)\b').hasMatch(src), isFalse);
    expect(src, contains('AppBreakpoints.desktop'));
    expect(src, contains('AppBreakpoints.tablet'));
  });
}
