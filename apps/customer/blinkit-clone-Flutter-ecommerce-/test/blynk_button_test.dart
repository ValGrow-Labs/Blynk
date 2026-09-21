import 'dart:ui' show SemanticsAction, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

Material _materialOf(WidgetTester tester, Type button) => tester.widget<Material>(
      find.descendant(of: find.byType(button), matching: find.byType(Material)).first,
    );

TextStyle _labelStyle(WidgetTester tester, Type button, String label) {
  final text = tester.widget<Text>(find.descendant(of: find.byType(button), matching: find.text(label)));
  final base = DefaultTextStyle.of(tester.element(find.descendant(of: find.byType(button), matching: find.text(label)))).style;
  return base.merge(text.style);
}

void main() {
  group('BlynkButton.primary', () {
    testWidgets('default: signal fill, ink label, flat, 48 dp min, md radius', (tester) async {
      await tester.pumpWidget(componentHost(tester, BlynkButton.primary(label: 'Add to cart', onPressed: () {})));
      final material = _materialOf(tester, ElevatedButton);
      expect(material.color, BlynkColors.signal);
      expect(material.elevation, 0);
      expect((material.shape! as RoundedRectangleBorder).borderRadius, BlynkRadius.mdAll);
      expect(_labelStyle(tester, ElevatedButton, 'Add to cart').color, BlynkColors.ink);
      expect(tester.getSize(find.byType(ElevatedButton)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('pressed is signalPressed and the size does not change', (tester) async {
      await tester.pumpWidget(componentHost(tester, BlynkButton.primary(label: 'Add to cart', onPressed: () {})));
      final before = tester.getSize(find.byType(ElevatedButton));
      final gesture = await tester.startGesture(tester.getCenter(find.byType(ElevatedButton)));
      await tester.pump(const Duration(milliseconds: 300));
      expect(_materialOf(tester, ElevatedButton).color, BlynkColors.signalPressed);
      expect(tester.getSize(find.byType(ElevatedButton)), before);
      await gesture.up();
      await tester.pumpAndSettle();
    });

    testWidgets('disabled: well fill, ink2 label, disabled semantics, no tap', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, const BlynkButton.primary(label: 'Place order', onPressed: null)));
      expect(_materialOf(tester, ElevatedButton).color, BlynkColors.well);
      expect(_labelStyle(tester, ElevatedButton, 'Place order').color, BlynkColors.ink2);
      final data = tester.getSemantics(find.byType(BlynkButton)).getSemanticsData();
      expect(data.label, 'Place order');
      expect(data.flagsCollection.isButton, isTrue);
      expect(data.flagsCollection.isEnabled, Tristate.isFalse);
      expect(data.hasAction(SemanticsAction.tap), isFalse);
      handle.dispose();
    });

    testWidgets('enabled semantics: button, labelled, tappable', (tester) async {
      final handle = tester.ensureSemantics();
      var taps = 0;
      await tester.pumpWidget(componentHost(tester, BlynkButton.primary(label: 'Continue', onPressed: () => taps++)));
      final data = tester.getSemantics(find.byType(BlynkButton)).getSemanticsData();
      expect(data.label, 'Continue');
      expect(data.flagsCollection.isButton, isTrue);
      expect(data.flagsCollection.isEnabled, Tristate.isTrue);
      expect(data.hasAction(SemanticsAction.tap), isTrue);
      await tester.tap(find.text('Continue'));
      expect(taps, 1);
      handle.dispose();
    });

    testWidgets('loading: spinner replaces the label, width is kept, taps are ignored, semantics say loading', (tester) async {
      final handle = tester.ensureSemantics();
      var taps = 0;
      Widget build({required bool loading}) => componentHost(
            tester,
            BlynkButton.primary(label: 'Place order', loading: loading, onPressed: () => taps++),
          );
      await tester.pumpWidget(build(loading: false));
      final idleSize = tester.getSize(find.byType(ElevatedButton));

      await tester.pumpWidget(build(loading: true));
      final spinner = find.byType(CircularProgressIndicator);
      expect(spinner, findsOneWidget);
      expect(tester.getSize(find.ancestor(of: spinner, matching: find.byType(SizedBox)).first), const Size(18, 18));
      expect(tester.widget<CircularProgressIndicator>(spinner).color, BlynkColors.ink);
      expect(tester.getSize(find.byType(ElevatedButton)), idleSize);

      await tester.tap(find.byType(ElevatedButton), warnIfMissed: false);
      await tester.pump();
      expect(taps, 0);
      final data = tester.getSemantics(find.byType(BlynkButton)).getSemanticsData();
      expect(data.label, 'Place order, loading');
      expect(data.hasAction(SemanticsAction.tap), isFalse);
      handle.dispose();
    });

    testWidgets('loading spinner is a fixed arc (no ticker) under reduced motion and rotates otherwise', (tester) async {
      final loading = BlynkButton.primary(label: 'Place order', loading: true, onPressed: () {});
      await tester.pumpWidget(componentHost(tester, loading, disableAnimations: true));
      expect(tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator)).value, isNotNull);
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.hasRunningAnimations, isFalse);

      await tester.pumpWidget(componentHost(tester, loading));
      expect(tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator)).value, isNull);
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.hasRunningAnimations, isTrue);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('leading icon renders before the label', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        BlynkButton.primary(label: 'Use my location', leadingIcon: Icons.my_location, onPressed: () {}),
      ));
      final icon = find.descendant(of: find.byType(ElevatedButton), matching: find.byIcon(Icons.my_location));
      expect(icon, findsOneWidget);
      expect(tester.getTopLeft(icon).dx, lessThan(tester.getTopLeft(find.text('Use my location')).dx));
    });

    testWidgets('expand fills the available width', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        BlynkButton.primary(label: 'Continue', expand: true, onPressed: () {}),
        width: 360,
      ));
      expect(tester.getSize(find.byType(ElevatedButton)).width, 360);
    });

    testWidgets('keyboard focus draws a 2 dp ink ring without changing the size', (tester) async {
      await tester.pumpWidget(componentHost(tester, BlynkButton.primary(label: 'Continue', onPressed: () {})));
      final before = tester.getSize(find.byType(ElevatedButton));
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      final shape = _materialOf(tester, ElevatedButton).shape! as RoundedRectangleBorder;
      expect(shape.side.color, BlynkColors.ink);
      expect(shape.side.width, 2);
      expect(tester.getSize(find.byType(ElevatedButton)), before);
    });
  });

  group('other kinds', () {
    testWidgets('secondary: 1.5 dp lineStrong outline, ink label, white fill', (tester) async {
      await tester.pumpWidget(componentHost(tester, BlynkButton.secondary(label: 'Cancel', onPressed: () {})));
      final shape = _materialOf(tester, OutlinedButton).shape! as RoundedRectangleBorder;
      expect(shape.side.color, BlynkColors.lineStrong);
      expect(shape.side.width, 1.5);
      expect(_labelStyle(tester, OutlinedButton, 'Cancel').color, BlynkColors.ink);
      expect(tester.getSize(find.byType(OutlinedButton)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('secondary disabled: ink2 label', (tester) async {
      await tester.pumpWidget(componentHost(tester, const BlynkButton.secondary(label: 'Cancel', onPressed: null)));
      expect(_labelStyle(tester, OutlinedButton, 'Cancel').color, BlynkColors.ink2);
    });

    testWidgets('tertiary: ink text with no fill, underlined on focus', (tester) async {
      await tester.pumpWidget(componentHost(tester, BlynkButton.tertiary(label: 'Skip', onPressed: () {})));
      expect(_materialOf(tester, TextButton).color, isNot(BlynkColors.signal));
      expect(_labelStyle(tester, TextButton, 'Skip').color, BlynkColors.ink);
      expect(_labelStyle(tester, TextButton, 'Skip').decoration, isNot(TextDecoration.underline));
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
      expect(_labelStyle(tester, TextButton, 'Skip').decoration, TextDecoration.underline);
      expect(tester.getSize(find.byType(TextButton)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('destructive: problem label on a problem outline', (tester) async {
      await tester.pumpWidget(componentHost(tester, BlynkButton.destructive(label: 'Cancel order', onPressed: () {})));
      expect(_labelStyle(tester, OutlinedButton, 'Cancel order').color, BlynkColors.problem);
      final shape = _materialOf(tester, OutlinedButton).shape! as RoundedRectangleBorder;
      expect(shape.side.color, BlynkColors.problem);
    });
  });

  group('text scale', () {
    for (final scale in kTextScales) {
      // The test font is Ahem (every glyph is a full-size square), so a short
      // label already needs two lines at 2.0x in 220 dp.
      testWidgets('long label at ${scale}x wraps to at most two lines, no overflow, grows past 48', (tester) async {
        await tester.pumpWidget(componentHost(
          tester,
          SizedBox(
            width: 220,
            child: BlynkButton.primary(label: 'Place order', expand: true, onPressed: () {}),
          ),
          textScale: scale,
        ));
        expect(tester.takeException(), isNull);
        final size = tester.getSize(find.byType(ElevatedButton));
        expect(size.height, greaterThanOrEqualTo(48));
        final text = tester.renderObject<RenderParagraph>(find.text('Place order'));
        expect(text.didExceedMaxLines, isFalse, reason: 'the label must not be truncated at ${scale}x');
        if (scale == 2.0) expect(size.height, greaterThan(48));
      });
    }
  });

  group('accessibility guidelines', () {
    for (final scale in kTextScales) {
      testWidgets('tap target, labelled target and contrast at ${scale}x', (tester) async {
        final handle = tester.ensureSemantics();
        await tester.pumpWidget(componentHost(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              BlynkButton.primary(label: 'Add to cart', onPressed: () {}),
              const SizedBox(height: 8),
              BlynkButton.secondary(label: 'Cancel', onPressed: () {}),
              const SizedBox(height: 8),
              BlynkButton.tertiary(label: 'Skip', onPressed: () {}),
              const SizedBox(height: 8),
              BlynkButton.destructive(label: 'Cancel order', onPressed: () {}),
            ],
          ),
          textScale: scale,
        ));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });
    }
  });

  group('BlynkButtonPair', () {
    Widget pair() => BlynkButtonPair(
          secondary: BlynkButton.secondary(label: 'Cancel', onPressed: () {}),
          primary: BlynkButton.primary(label: 'Confirm location', onPressed: () {}),
        );

    testWidgets('1.0x: side by side, one shared height, primary wider on the right', (tester) async {
      await tester.pumpWidget(componentHost(tester, pair(), width: 400));
      final secondary = tester.getRect(find.byType(OutlinedButton));
      final primary = tester.getRect(find.byType(ElevatedButton));
      expect(secondary.top, primary.top);
      expect(secondary.height, primary.height);
      expect(primary.left, greaterThan(secondary.right));
      expect(primary.width, greaterThan(secondary.width));
    });

    testWidgets('2.0x: stacks with the primary on top and no overflow', (tester) async {
      await tester.pumpWidget(componentHost(tester, pair(), width: 400, textScale: 2.0));
      expect(tester.takeException(), isNull);
      expect(tester.getRect(find.byType(ElevatedButton)).bottom, lessThanOrEqualTo(tester.getRect(find.byType(OutlinedButton)).top));
    });

    testWidgets('a narrow container stacks even at 1.0x', (tester) async {
      await tester.pumpWidget(componentHost(tester, SizedBox(width: 260, child: pair())));
      expect(tester.takeException(), isNull);
      expect(tester.getRect(find.byType(ElevatedButton)).bottom, lessThanOrEqualTo(tester.getRect(find.byType(OutlinedButton)).top));
    });
  });
}
