import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Screens/config_problem_screen.dart';
import 'package:ecom/Services/app_config.dart';
import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';

void main() {
  Future<void> pump(WidgetTester tester, ConfigProblem problem, {double scale = 1}) {
    return tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(scale)),
        child: ConfigErrorApp(problem: problem),
      ),
    );
  }

  testWidgets('shows a plain message and only the short code', (tester) async {
    await pump(tester, ConfigProblem.apiUrlLocal);

    expect(find.byType(AppStateView), findsOneWidget);
    expect(find.text("This build isn't configured"), findsOneWidget);
    expect(find.textContaining(ConfigProblem.apiUrlLocal.code), findsOneWidget);
    // No technical detail: no URL, no host names, no key names.
    expect(find.textContaining('localhost'), findsNothing);
    expect(find.textContaining('API_BASE_URL'), findsNothing);
    expect(find.textContaining('http'), findsNothing);
    // Nothing to tap: retrying cannot fix a build.
    expect(find.byType(BlynkButton), findsNothing);
    expect(find.byType(ElevatedButton), findsNothing);
    expect(find.byType(OutlinedButton), findsNothing);
    expect(find.byType(TextButton), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(find.byType(IconButton), findsNothing);
  });

  testWidgets('does not overflow at text scale 2.0 on a small screen', (tester) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await pump(tester, ConfigProblem.apiUrlMissing, scale: 2);
    expect(tester.takeException(), isNull);
    expect(find.text("This build isn't configured"), findsOneWidget);
  });
}
