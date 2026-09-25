import 'dart:ui' show SemanticsAction, Tristate;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/quantity_stepper.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

const _name = 'Amul Milk 500 ml';

Widget _stepper(
  WidgetTester tester, {
  int quantity = 2,
  VoidCallback? onIncrement,
  VoidCallback? onDecrement,
  int min = 0,
  int? max,
  double textScale = 1,
  bool disableAnimations = false,
}) {
  return componentHost(
    tester,
    QuantityStepper(
      quantity: quantity,
      onIncrement: onIncrement,
      onDecrement: onDecrement,
      productName: _name,
      min: min,
      max: max,
    ),
    textScale: textScale,
    disableAnimations: disableAnimations,
  );
}

Finder _button(String label) => find.bySemanticsLabel(label);

void main() {
  group('QuantityStepper', () {
    testWidgets('shows the quantity and calls back on plus and minus', (tester) async {
      var up = 0, down = 0;
      await tester.pumpWidget(_stepper(tester, onIncrement: () => up++, onDecrement: () => down++));
      expect(find.text('2'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.add));
      await tester.tap(find.byIcon(Icons.remove));
      expect(up, 1);
      expect(down, 1);
    });

    // 2026-09 redesign (spec §3 "Quantity stepper"): paper fill, not signal.
    // T2: the boundary moved from `line` to BlynkStepper.borderStrong
    // (`lineStrong`), which is what plan §8 specifies for this control —
    // `line` on `paper` measures 1.19:1, the invisible hairline the existing
    // control-outline guard exists to keep off real controls. Every value
    // here now comes from BlynkStepper, so the widget cannot drift from it.
    testWidgets('visual pill is 40 dp tall, on the stepper tokens end to end', (tester) async {
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
      final pill = find.byWidgetPredicate(
        (w) => w is DecoratedBox && w.decoration is BoxDecoration && (w.decoration as BoxDecoration).color == BlynkStepper.surface,
      );
      expect(pill, findsOneWidget);
      expect(tester.getSize(pill).height, BlynkStepper.visualHeight);
      expect(BlynkStepper.visualHeight, 40);
      expect(BlynkStepper.visualHeight, lessThan(BlynkStepper.minTapSize),
          reason: 'the extra hit area is what makes an edge tap register');
      final decoration = (tester.widget<DecoratedBox>(pill)).decoration as BoxDecoration;
      expect(decoration.border!.top.color, BlynkStepper.borderStrong);
      expect(decoration.borderRadius, BlynkStepper.radius);
      expect(BlynkStepper.borderStrong, BlynkColors.lineStrong);
      // A control boundary is a non-text graphic: the 3:1 floor, which the
      // 1.19:1 hairline it replaced could never meet.
      expect(contrastRatio(BlynkStepper.borderStrong, BlynkStepper.surface), greaterThanOrEqualTo(3));
      final add = tester.widget<Icon>(find.byIcon(Icons.add));
      expect(add.color, BlynkStepper.icon);
      expect(add.size, BlynkStepper.iconSize);
      expect(tester.widget<Text>(find.text('2')).style!.color, BlynkStepper.countColor);
      expect(tester.getSize(find.byType(QuantityStepper)).height, BlynkStepper.minTapSize);
    });

    testWidgets('each button has a 48 x 48 hit target', (tester) async {
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
      for (final icon in [Icons.add, Icons.remove]) {
        final hit = find.ancestor(of: find.byIcon(icon), matching: find.byType(InkResponse));
        expect(tester.getSize(hit), const Size(48, 48));
      }
      expect(tester.getSize(find.byType(QuantityStepper)).height, 48);
    });

    testWidgets('a tap at the edge of the 48 dp area (outside the 40 dp visual) still registers', (tester) async {
      var up = 0;
      await tester.pumpWidget(_stepper(tester, onIncrement: () => up++, onDecrement: () {}));
      final hit = find.ancestor(of: find.byIcon(Icons.add), matching: find.byType(InkResponse));
      final rect = tester.getRect(hit);
      await tester.tapAt(Offset(rect.right - 2, rect.top + 2));
      expect(up, 1);
    });

    testWidgets('pressing changes no layout', (tester) async {
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
      final before = tester.getRect(find.byType(QuantityStepper));
      final gesture = await tester.startGesture(tester.getCenter(find.byIcon(Icons.add)));
      await tester.pump(const Duration(milliseconds: 150));
      expect(tester.getRect(find.byType(QuantityStepper)), before);
      await gesture.up();
      await tester.pumpAndSettle();
      expect(tester.getRect(find.byType(QuantityStepper)), before);
    });

    testWidgets('keyboard focus draws a 2 dp ink ring on the focused button only', (tester) async {
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      final rings = find.byWidgetPredicate(
        (w) => w is Container && w.decoration is BoxDecoration && (w.decoration as BoxDecoration).border != null,
      );
      expect(rings, findsOneWidget);
      final border = ((tester.widget<Container>(rings)).decoration! as BoxDecoration).border! as Border;
      expect(border.top.color, BlynkColors.ink);
      expect(border.top.width, 2);
    });
  });

  group('limits', () {
    testWidgets('at min the decrement is disabled and does nothing', (tester) async {
      var down = 0;
      await tester.pumpWidget(_stepper(tester, quantity: 0, onIncrement: () {}, onDecrement: () => down++));
      await tester.tap(find.byIcon(Icons.remove));
      expect(down, 0);
    });

    testWidgets('a custom min of 1 stops the decrement at one', (tester) async {
      var down = 0;
      await tester.pumpWidget(_stepper(tester, quantity: 1, min: 1, onIncrement: () {}, onDecrement: () => down++));
      await tester.tap(find.byIcon(Icons.remove));
      expect(down, 0);
    });

    testWidgets('at max the increment is disabled and does nothing', (tester) async {
      var up = 0;
      await tester.pumpWidget(_stepper(tester, quantity: 5, max: 5, onIncrement: () => up++, onDecrement: () {}));
      await tester.tap(find.byIcon(Icons.add));
      expect(up, 0);
    });

    testWidgets('null callbacks disable both buttons and grey the glyphs', (tester) async {
      await tester.pumpWidget(_stepper(tester));
      expect(tester.widget<Icon>(find.byIcon(Icons.add)).color, BlynkStepper.iconDisabled);
      expect(tester.widget<Icon>(find.byIcon(Icons.remove)).color, BlynkStepper.iconDisabled);
    });
  });

  // T2: the in-flight state for a cart write that has not come back yet. It
  // is a correctness feature, not a look: a second tap while a change is in
  // flight must not queue a duplicate change.
  group('busy (a cart write is in flight)', () {
    testWidgets('neither control fires while busy, however many times it is tapped', (tester) async {
      var up = 0, down = 0;
      await tester.pumpWidget(componentHost(
        tester,
        QuantityStepper(
          quantity: 2,
          onIncrement: () => up++,
          onDecrement: () => down++,
          productName: _name,
          busy: true,
        ),
      ));
      for (var i = 0; i < 3; i++) {
        await tester.tap(find.byIcon(Icons.add));
        await tester.tap(find.byIcon(Icons.remove));
      }
      expect(up, 0);
      expect(down, 0);
    });

    testWidgets('busy greys both glyphs and keeps the count visible', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        QuantityStepper(
          quantity: 3,
          onIncrement: () {},
          onDecrement: () {},
          productName: _name,
          busy: true,
        ),
      ));
      expect(tester.widget<Icon>(find.byIcon(Icons.add)).color, BlynkStepper.iconDisabled);
      expect(tester.widget<Icon>(find.byIcon(Icons.remove)).color, BlynkStepper.iconDisabled);
      expect(find.text('3'), findsOneWidget);
    });

    testWidgets('busy is announced, not just drawn: disabled with an "updating" label', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(
        tester,
        QuantityStepper(
          quantity: 2,
          onIncrement: () {},
          onDecrement: () {},
          productName: _name,
          busy: true,
        ),
      ));
      final add = tester.getSemantics(_button('Add one more $_name, updating')).getSemanticsData();
      expect(add.flagsCollection.isEnabled, Tristate.isFalse);
      expect(add.hasAction(SemanticsAction.tap), isFalse);
      expect(_button('Remove one $_name, updating'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('busy false is the default and changes nothing', (tester) async {
      var up = 0;
      await tester.pumpWidget(_stepper(tester, onIncrement: () => up++, onDecrement: () {}));
      await tester.tap(find.byIcon(Icons.add));
      expect(up, 1);
    });
  });

  group('semantics', () {
    testWidgets('labels: "Add one more", "Remove one", "{n} in cart" as a live region', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));

      final add = tester.getSemantics(_button('Add one more $_name')).getSemanticsData();
      expect(add.flagsCollection.isButton, isTrue);
      expect(add.hasAction(SemanticsAction.tap), isTrue);

      final remove = tester.getSemantics(_button('Remove one $_name')).getSemanticsData();
      expect(remove.flagsCollection.isButton, isTrue);
      expect(remove.hasAction(SemanticsAction.tap), isTrue);

      final count = tester.getSemantics(_button('2 $_name in cart')).getSemanticsData();
      expect(count.flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('a disabled button reports disabled and has no tap action', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_stepper(tester, quantity: 0, onIncrement: () {}, onDecrement: () {}));
      final remove = tester.getSemantics(_button('Remove one $_name')).getSemanticsData();
      expect(remove.flagsCollection.isEnabled, Tristate.isFalse);
      expect(remove.hasAction(SemanticsAction.tap), isFalse);
      handle.dispose();
    });

    testWidgets('the label follows the quantity', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_stepper(tester, quantity: 7, onIncrement: () {}, onDecrement: () {}));
      expect(_button('7 $_name in cart'), findsOneWidget);
      handle.dispose();
    });
  });

  group('haptics', () {
    late List<String> calls;

    setUp(() {
      calls = [];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') calls.add(call.arguments as String);
        return null;
      });
    });

    tearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null);
    });

    // The platform override must be cleared inside the test body.
    Future<void> onPlatform(TargetPlatform platform, Future<void> Function() body) async {
      debugDefaultTargetPlatformOverride = platform;
      try {
        await body();
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    }

    testWidgets('Android: a selection click on plus and on minus', (tester) async {
      await onPlatform(TargetPlatform.android, () async {
        await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
        await tester.tap(find.byIcon(Icons.add));
        await tester.tap(find.byIcon(Icons.remove));
        expect(calls, ['HapticFeedbackType.selectionClick', 'HapticFeedbackType.selectionClick']);
      });
    });

    testWidgets('iOS: no haptic from this component', (tester) async {
      await onPlatform(TargetPlatform.iOS, () async {
        await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
        await tester.tap(find.byIcon(Icons.add));
        expect(calls, isEmpty);
      });
    });

    testWidgets('a disabled button gives no haptic', (tester) async {
      await onPlatform(TargetPlatform.android, () async {
        await tester.pumpWidget(_stepper(tester, quantity: 0, onIncrement: () {}, onDecrement: () {}));
        await tester.tap(find.byIcon(Icons.remove));
        expect(calls, isEmpty);
      });
    });
  });

  group('text scale, motion and guidelines', () {
    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x with a three-digit quantity', (tester) async {
        await tester.pumpWidget(_stepper(tester, quantity: 120, onIncrement: () {}, onDecrement: () {}, textScale: scale));
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('reduced motion: nothing animates', (tester) async {
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}, disableAnimations: true));
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('tap target, labelled target and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_stepper(tester, onIncrement: () {}, onDecrement: () {}));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
