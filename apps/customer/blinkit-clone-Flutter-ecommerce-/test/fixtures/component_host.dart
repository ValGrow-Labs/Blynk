import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/app_theme.dart';

const List<double> kTextScales = <double>[1.0, 1.3, 2.0];

/// Hosts a component in the real Blynk theme with an explicit text scale and
/// reduced-motion flag, on a viewport of [width] x [height] logical pixels.
Widget componentHost(
  WidgetTester tester,
  Widget child, {
  double textScale = 1,
  bool disableAnimations = false,
  double width = 400,
  double height = 800,
  bool center = true,
}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return MaterialApp(
    theme: AppTheme.theme,
    builder: (context, app) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
        disableAnimations: disableAnimations,
      ),
      child: app!,
    ),
    home: Scaffold(body: center ? Center(child: child) : child),
  );
}
