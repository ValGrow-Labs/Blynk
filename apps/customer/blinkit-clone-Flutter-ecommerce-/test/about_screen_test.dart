import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'package:ecom/Screens/app_about_screen.dart';
import 'package:ecom/Services/store_info.dart';

import 'fixtures/component_host.dart';

void _mockPackage({String version = '1.4.2', String build = '17'}) {
  PackageInfo.setMockInitialValues(
    appName: 'Blynk',
    packageName: 'lk.blynk.customer',
    version: version,
    buildNumber: build,
    buildSignature: '',
  );
}

Widget _host(WidgetTester tester, {double textScale = 1}) =>
    componentHost(tester, const AppAboutScreen(), textScale: textScale, center: false);

void main() {
  testWidgets('shows the version and build number from the platform', (tester) async {
    _mockPackage();
    await tester.pumpWidget(_host(tester));
    await tester.pumpAndSettle();

    expect(find.text('Version 1.4.2 (17)'), findsOneWidget);
  });

  testWidgets('omits the build number when the platform reports none', (tester) async {
    _mockPackage(build: '');
    await tester.pumpWidget(_host(tester));
    await tester.pumpAndSettle();

    expect(find.text('Version 1.4.2'), findsOneWidget);
  });

  testWidgets('shows no version while it is loading and never the old invented one', (tester) async {
    _mockPackage();
    await tester.pumpWidget(_host(tester));

    expect(find.textContaining('Version'), findsNothing);
    expect(find.text('v15.30.2'), findsNothing);
    await tester.pumpAndSettle();
  });

  testWidgets('does not throw when the platform cannot report a version', (tester) async {
    // Without mock values the plugin has no platform implementation in tests.
    PackageInfo.setMockInitialValues(
      appName: '',
      packageName: '',
      version: '',
      buildNumber: '',
      buildSignature: '',
    );
    await tester.pumpWidget(_host(tester));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Blynk'), findsOneWidget);
  });

  testWidgets('carries no Blinkit copy and states only true facts', (tester) async {
    _mockPackage();
    await tester.pumpWidget(_host(tester));
    await tester.pumpAndSettle();

    expect(find.textContaining('Blinkit'), findsNothing);
    expect(find.textContaining('loyalty'), findsNothing);
    expect(find.textContaining('time slot'), findsNothing);
    expect(find.textContaining('recommendations'), findsNothing);
    expect(find.textContaining(StoreInfo.hubName), findsOneWidget);
    expect(find.textContaining('cash'), findsOneWidget);
    expect(find.textContaining(StoreInfo.deliveryHoursLabel), findsOneWidget);
  });

  for (final scale in kTextScales) {
    testWidgets('does not overflow at text scale $scale', (tester) async {
      _mockPackage();
      await tester.pumpWidget(_host(tester, textScale: scale));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  }
}
