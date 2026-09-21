import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

void main() {
  group('contrast (plan 2.2 / 13)', () {
    void atLeast(String name, Color fg, Color bg, double min) {
      test('$name >= $min:1', () {
        expect(contrastRatio(fg, bg), greaterThanOrEqualTo(min));
      });
    }

    test('contrastRatio is the WCAG formula', () {
      expect(contrastRatio(Colors.black, Colors.white), closeTo(21, 0.001));
      expect(contrastRatio(Colors.white, Colors.white), closeTo(1, 0.001));
    });

    atLeast('ink on paper', BlynkColors.ink, BlynkColors.paper, 16);
    atLeast('ink2 on paper', BlynkColors.ink2, BlynkColors.paper, 4.5);
    atLeast('ink2 on well', BlynkColors.ink2, BlynkColors.well, 4.5);
    atLeast('ink3 on well', BlynkColors.ink3, BlynkColors.well, 7);
    atLeast('ink on signal', BlynkColors.ink, BlynkColors.signal, 12);
    atLeast('ink on signalPressed', BlynkColors.ink, BlynkColors.signalPressed, 9);
    atLeast('positiveInk on well', BlynkColors.positiveInk, BlynkColors.well, 5.5);
    atLeast('positiveInk on positiveTint', BlynkColors.positiveInk, BlynkColors.positiveTint, 5);
    atLeast('paper on positive', BlynkColors.paper, BlynkColors.positive, 4.5);
    atLeast('problem on paper', BlynkColors.problem, BlynkColors.paper, 6);
    atLeast('problem on problemTint', BlynkColors.problem, BlynkColors.problemTint, 5.5);
    atLeast('notice on noticeTint', BlynkColors.notice, BlynkColors.noticeTint, 5);
    atLeast('lineStrong on paper', BlynkColors.lineStrong, BlynkColors.paper, 3.5);
    atLeast('lineStrong on well', BlynkColors.lineStrong, BlynkColors.well, 3.5);
    atLeast('paper on ink (snackbar, cart bar)', BlynkColors.paper, BlynkColors.ink, 16);

    test('signalPressed is visibly darker than signal', () {
      expect(contrastRatio(BlynkColors.signalPressed, BlynkColors.signal), greaterThan(1.2));
    });

    test('yellow is never a text or border colour: signal on paper < 1.5:1', () {
      expect(contrastRatio(BlynkColors.signal, BlynkColors.paper), lessThan(1.5));
    });

    test('onSignal is ink and onPositive is paper', () {
      expect(BlynkColors.onSignal, BlynkColors.ink);
      expect(BlynkColors.onPositive, BlynkColors.paper);
    });
  });

  group('scales', () {
    test('spacing is the 4-pt scale', () {
      expect(
        [
          BlynkSpace.s4,
          BlynkSpace.s8,
          BlynkSpace.s12,
          BlynkSpace.s16,
          BlynkSpace.s24,
          BlynkSpace.s32,
          BlynkSpace.s48,
        ],
        [4, 8, 12, 16, 24, 32, 48],
      );
    });

    test('radii are 8 / 12 / 20 and full is a pill', () {
      expect([BlynkRadius.sm, BlynkRadius.md, BlynkRadius.lg], [8, 12, 20]);
      expect(BlynkRadius.smAll, BorderRadius.circular(8));
      expect(BlynkRadius.mdAll, BorderRadius.circular(12));
      expect(BlynkRadius.lgAll, BorderRadius.circular(20));
      expect(BlynkRadius.lgTop.topLeft, const Radius.circular(20));
      expect(BlynkRadius.lgTop.bottomLeft, Radius.zero);
      expect(BlynkRadius.full.topLeft.x, greaterThanOrEqualTo(999));
    });

    test('gutterFor breakpoints: 16 < 600, 24 < 1024, 32 above', () {
      expect(BlynkSpace.gutterFor(320), 16);
      expect(BlynkSpace.gutterFor(599.9), 16);
      expect(BlynkSpace.gutterFor(600), 24);
      expect(BlynkSpace.gutterFor(1023.9), 24);
      expect(BlynkSpace.gutterFor(1024), 32);
      expect(BlynkSpace.gutterFor(1920), 32);
    });

    test('durations are 120 / 200 / 280 ms', () {
      expect(BlynkMotion.fast, const Duration(milliseconds: 120));
      expect(BlynkMotion.base, const Duration(milliseconds: 200));
      expect(BlynkMotion.slow, const Duration(milliseconds: 280));
      expect(BlynkMotion.easeIn, Curves.easeInCubic);
      expect(BlynkMotion.easeOut, Curves.easeOutCubic);
    });

    test('icon sizes are 20 / 24 / 32', () {
      expect([BlynkIcons.sm, BlynkIcons.md, BlynkIcons.lg], [20, 24, 32]);
    });

    test('only the cart bar and overlays cast a shadow', () {
      expect(BlynkElevation.none, isEmpty);
      expect(BlynkElevation.raised, hasLength(1));
      expect(BlynkElevation.overlayDp, greaterThan(0));
      expect(BlynkElevation.overlayShadow.a, lessThan(0.3));
    });
  });

  group('BlynkMotion.resolve', () {
    Future<Duration> resolved(WidgetTester tester, {required bool disableAnimations}) async {
      late Duration result;
      await tester.pumpWidget(
        MediaQuery(
          data: MediaQueryData(disableAnimations: disableAnimations),
          child: Builder(
            builder: (context) {
              result = BlynkMotion.resolve(context, BlynkMotion.base);
              return const SizedBox();
            },
          ),
        ),
      );
      return result;
    }

    testWidgets('is zero when the platform disables animations', (tester) async {
      expect(await resolved(tester, disableAnimations: true), Duration.zero);
    });

    testWidgets('passes the duration through otherwise', (tester) async {
      expect(await resolved(tester, disableAnimations: false), BlynkMotion.base);
    });
  });

  group('BlynkIcons', () {
    test('semantically distinct icons never share a glyph', () {
      final seen = <IconData>{};
      for (final icon in BlynkIcons.distinct) {
        expect(seen.add(icon), isTrue, reason: 'duplicate icon 0x${icon.codePoint.toRadixString(16)}');
      }
    });

    test('address book differs from packed, orders and the address labels', () {
      expect(BlynkIcons.addressBook, isNot(BlynkIcons.packed));
      expect(BlynkIcons.addressBook, isNot(BlynkIcons.orders));
      expect(BlynkIcons.addressHome, isNot(BlynkIcons.shop));
    });
  });

  group('BlynkText', () {
    test('scale matches the plan (size / line height / weight)', () {
      void expectStyle(TextStyle s, double size, double line, FontWeight w) {
        expect(s.fontSize, size);
        expect(s.height! * s.fontSize!, closeTo(line, 0.001));
        expect(s.fontWeight, w);
        expect(s.fontFamily, 'Catamaran');
        expect(s.color, BlynkColors.ink);
      }

      expectStyle(BlynkText.display, 28, 34, FontWeight.w800);
      expectStyle(BlynkText.title, 20, 26, FontWeight.w800);
      expectStyle(BlynkText.heading, 16, 22, FontWeight.w700);
      expectStyle(BlynkText.body, 14, 20, FontWeight.w500);
      expectStyle(BlynkText.label, 14, 20, FontWeight.w700);
      expectStyle(BlynkText.caption, 12, 16, FontWeight.w600);
    });

    test('price is heading-size w800 with tabular figures', () {
      expect(BlynkText.price.fontSize, BlynkText.heading.fontSize);
      expect(BlynkText.price.fontWeight, FontWeight.w800);
      expect(BlynkText.price.fontFeatures, contains(const FontFeature.tabularFigures()));
    });

    test('textTheme maps the scale onto Material roles', () {
      final t = BlynkText.textTheme;
      expect(t.displayMedium, BlynkText.display);
      expect(t.titleLarge, BlynkText.title);
      expect(t.titleMedium, BlynkText.heading);
      expect(t.bodyMedium, BlynkText.body);
      expect(t.bodyLarge, BlynkText.body);
      expect(t.labelLarge, BlynkText.label);
      expect(t.bodySmall, BlynkText.caption);
      expect(t.labelMedium, BlynkText.caption);
      expect(t.labelSmall, BlynkText.caption);
    });
  });
}
