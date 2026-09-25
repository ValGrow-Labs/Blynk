import 'dart:ui' show SemanticsAction, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

/// The redesign's flat-yellow CTA and its ink promo pill (plan §5/§8). These
/// are [BlynkButton] kinds (`.cta`, `.promo`); the existing `.primary` etc.
/// constructors and their tests are untouched. T1 reverted both off the
/// previous pass's lime->green gradient and second green.
void main() {
  group('BlynkButton.cta', () {
    testWidgets('enabled: flat signal fill, ink bold label, radius 20, >= 56 dp tall', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, BlynkButton.cta(label: 'Add to cart', onPressed: () {})),
      );
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      final decoration = container.decoration! as BoxDecoration;
      expect(decoration.color, BlynkCta.fill);
      expect(decoration.color, BlynkColors.signal, reason: 'Blynk Yellow, not a gradient and not green');
      expect(decoration.gradient, isNull, reason: 'the CTA is a flat fill; the design layer has no gradient');
      expect(decoration.borderRadius, BlynkRadius.lgAll);

      final label = tester.widget<Text>(find.text('Add to cart'));
      expect(label.style!.color, BlynkCta.label);
      expect(label.style!.fontWeight, FontWeight.w800);
      expect(label.style!.fontSize, 17);

      expect(tester.getSize(find.byType(BlynkButton)).height, greaterThanOrEqualTo(56));
    });

    testWidgets('fills the available width by default', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          BlynkButton.cta(label: 'Add to cart', onPressed: () {}),
          width: 360,
          center: false,
        ),
      );
      expect(tester.getSize(find.byType(BlynkButton)).width, 360);
    });

    testWidgets('disabled: flat line fill (never a dimmed yellow), ink3 label, disabled semantics, no tap', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(
        componentHost(tester, const BlynkButton.cta(label: 'Add to cart', onPressed: null)),
      );
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      final decoration = container.decoration! as BoxDecoration;
      expect(decoration.gradient, isNull);
      expect(decoration.color, BlynkColors.line);

      final label = tester.widget<Text>(find.text('Add to cart'));
      // ink3, not ink2: ink2 on `line` measures 3.97:1, under the 4.5:1 floor.
      expect(label.style!.color, BlynkCta.labelDisabled);
      expect(label.style!.color, BlynkColors.ink3);

      final data = tester.getSemantics(find.byType(BlynkButton)).getSemanticsData();
      expect(data.flagsCollection.isEnabled, Tristate.isFalse);
      expect(data.hasAction(SemanticsAction.tap), isFalse);
      handle.dispose();
    });

    testWidgets('pressed: the fill swaps to signalPressed', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, BlynkButton.cta(label: 'Add to cart', onPressed: () {})),
      );
      final gesture = await tester.startGesture(tester.getCenter(find.byType(BlynkButton)));
      await tester.pump(const Duration(milliseconds: 100));

      final container = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      expect((container.decoration! as BoxDecoration).color, BlynkCta.fillPressed);
      expect((container.decoration! as BoxDecoration).color, BlynkColors.signalPressed);

      // The pressed state is the fill swap itself. The previous pass painted
      // a translucent ink wash over its gradient because a gradient cannot be
      // swapped for a darker one; with a flat fill there is a real pressed
      // token, and a translucent yellow/ink wash is banned (plan §5).
      final washFinder = find.descendant(
        of: find.byType(BlynkButton),
        matching: find.byWidgetPredicate(
          (w) =>
              w is DecoratedBox &&
              w.decoration is BoxDecoration &&
              (w.decoration as BoxDecoration).color == BlynkColors.ink.withValues(alpha: 0.12),
        ),
      );
      expect(washFinder, findsNothing, reason: 'no translucent wash: the fill token itself darkens');

      await gesture.up();
      await tester.pumpAndSettle();
      final released = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      expect((released.decoration! as BoxDecoration).color, BlynkCta.fill,
          reason: 'releasing returns to the resting fill');
    });

    testWidgets('leading and trailing icons render alongside the label', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          BlynkButton.cta(
            label: 'Checkout',
            onPressed: () {},
            trailingIcon: Icons.arrow_forward,
          ),
        ),
      );
      expect(find.byIcon(Icons.arrow_forward), findsOneWidget);
    });

    testWidgets('never renders a "→" character', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          BlynkButton.cta(label: 'Checkout', onPressed: () {}, trailingIcon: Icons.arrow_forward),
        ),
      );
      expect(find.textContaining('→'), findsNothing);
    });

    testWidgets('loading: spinner replaces the label, taps are ignored', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        componentHost(
          tester,
          BlynkButton.cta(label: 'Add to cart', onPressed: () => taps++, loading: true),
        ),
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.tap(find.byType(BlynkButton));
      expect(taps, 0);
    });

    testWidgets('keyboard focus draws a 2 dp ink ring without changing the size', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, BlynkButton.cta(label: 'Add to cart', onPressed: () {})),
      );
      final before = tester.getSize(find.byType(BlynkButton));
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(tester.getSize(find.byType(BlynkButton)), before);
    });
  });

  group('BlynkButton.promo', () {
    testWidgets('enabled: solid ink fill, paper label, full radius, >= 44 dp tall', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, BlynkButton.promo(label: 'Shop Now', onPressed: () {})),
      );
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      final decoration = container.decoration! as BoxDecoration;
      expect(decoration.color, BlynkCta.promoFill);
      expect(decoration.color, BlynkColors.ink, reason: 'the promo pill sits on the yellow surface, so it is ink');
      expect(decoration.borderRadius, BlynkRadius.full);

      final label = tester.widget<Text>(find.text('Shop Now'));
      expect(label.style!.color, BlynkCta.promoLabel);

      expect(tester.getSize(find.byType(BlynkButton)).height, greaterThanOrEqualTo(44));
    });

    testWidgets('pressed fill is promoFillPressed', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, BlynkButton.promo(label: 'Shop Now', onPressed: () {})),
      );
      final gesture = await tester.startGesture(tester.getCenter(find.byType(BlynkButton)));
      await tester.pump(const Duration(milliseconds: 100));
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      expect((container.decoration! as BoxDecoration).color, BlynkCta.promoFillPressed);
      await gesture.up();
      await tester.pumpAndSettle();
    });

    testWidgets('trailing arrow icon renders, never a "→" character', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          BlynkButton.promo(label: 'Shop Now', onPressed: () {}, trailingIcon: Icons.arrow_forward),
        ),
      );
      expect(find.byIcon(Icons.arrow_forward), findsOneWidget);
      expect(find.textContaining('→'), findsNothing);
    });

    testWidgets('disabled: flat line fill, ink3 label, no tap', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(
        componentHost(tester, const BlynkButton.promo(label: 'Shop Now', onPressed: null)),
      );
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(BlynkButton), matching: find.byType(Container)).first,
      );
      expect((container.decoration! as BoxDecoration).color, BlynkColors.line);
      final data = tester.getSemantics(find.byType(BlynkButton)).getSemanticsData();
      expect(data.flagsCollection.isEnabled, Tristate.isFalse);
      expect(data.hasAction(SemanticsAction.tap), isFalse);
      handle.dispose();
    });
  });
}
