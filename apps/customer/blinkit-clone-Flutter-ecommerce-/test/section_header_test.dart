import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/section_header.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

void main() {
  testWidgets('title only: no action, and no divider rule under it', (tester) async {
    await tester.pumpWidget(componentHost(
      tester,
      const BlynkSectionHeader(title: 'Recommended for You'),
      center: false,
    ));

    expect(find.text('Recommended for You'), findsOneWidget);
    expect(tester.widget<Text>(find.text('Recommended for You')).style,
        BlynkText.sectionHeader);
    expect(find.byType(BlynkButton), findsNothing);
    expect(find.byType(Divider), findsNothing,
        reason: 'sections are separated by space, not rules');
  });

  testWidgets('the action fires', (tester) async {
    var taps = 0;
    await tester.pumpWidget(componentHost(
      tester,
      BlynkSectionHeader(title: 'Dairy', actionLabel: 'See all', onAction: () => taps++),
      center: false,
    ));

    await tester.tap(find.text('See all'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('the action is a text button, never the yellow CTA', (tester) async {
    await tester.pumpWidget(componentHost(
      tester,
      BlynkSectionHeader(title: 'Dairy', actionLabel: 'See all', onAction: () {}),
      center: false,
    ));

    // It must not consume the screen's one yellow action.
    final fills = tester
        .widgetList<Container>(find.byType(Container))
        .map((c) => c.decoration)
        .whereType<BoxDecoration>()
        .map((d) => d.color)
        .toList();
    expect(fills, isNot(contains(BlynkColors.signal)));
    expect(fills, isNot(contains(BlynkCta.fill)));
    expect(find.byType(BlynkButton), findsOneWidget);

    // ...and it still clears the shared 48 dp target.
    expect(tester.getSize(find.byType(BlynkButton)).height, greaterThanOrEqualTo(48));
  });

  testWidgets('a label with nothing behind it is not rendered as dead chrome', (tester) async {
    await tester.pumpWidget(componentHost(
      tester,
      const BlynkSectionHeader(title: 'Dairy', actionLabel: 'See all'),
      center: false,
    ));
    expect(find.text('See all'), findsNothing);
  });

  testWidgets('the title is a semantics header', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(componentHost(
      tester,
      const BlynkSectionHeader(title: 'Dairy'),
      center: false,
    ));
    expect(
      tester.getSemantics(find.text('Dairy')),
      matchesSemantics(label: 'Dairy', isHeader: true, hasSelectedState: false),
    );
    handle.dispose();
  });

  testWidgets('AppSectionHeader is the same widget, so every existing call site moved with it',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(componentHost(
      tester,
      AppSectionHeader(title: 'Dairy', actionLabel: 'See all', onAction: () => taps++),
      center: false,
    ));
    expect(find.byType(BlynkSectionHeader), findsOneWidget);
    expect(tester.widget<Text>(find.text('Dairy')).style, BlynkText.sectionHeader);
    await tester.tap(find.text('See all'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  for (final scale in kTextScales) {
    testWidgets('${scale}x: no overflow with a long title and an action', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        BlynkSectionHeader(
          title: 'Fruits, Vegetables and Fresh Produce of the Week',
          actionLabel: 'See all',
          onAction: () {},
        ),
        textScale: scale,
        width: 320,
        center: false,
      ));
      expect(tester.takeException(), isNull);
    });
  }
}
