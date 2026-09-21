import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/status_badge.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

void main() {
  final tones = <BadgeTone, ({Color background, Color foreground})>{
    BadgeTone.positive: (background: BlynkColors.positiveTint, foreground: BlynkColors.positiveInk),
    BadgeTone.problem: (background: BlynkColors.problemTint, foreground: BlynkColors.problem),
    BadgeTone.notice: (background: BlynkColors.noticeTint, foreground: BlynkColors.notice),
    BadgeTone.neutral: (background: BlynkColors.well, foreground: BlynkColors.ink3),
  };

  group('StatusBadge', () {
    tones.forEach((tone, colors) {
      testWidgets('${tone.name}: tint, foreground, icon and word, pill radius', (tester) async {
        await tester.pumpWidget(componentHost(tester, StatusBadge(tone: tone, label: 'Status')));
        final box = tester.widget<DecoratedBox>(
          find.descendant(of: find.byType(StatusBadge), matching: find.byType(DecoratedBox)).first,
        );
        final decoration = box.decoration as BoxDecoration;
        expect(decoration.color, colors.background);
        expect(decoration.borderRadius, BlynkRadius.full);
        final text = tester.widget<Text>(find.text('Status'));
        expect(text.style!.color, colors.foreground);
        expect(text.style!.fontSize, greaterThanOrEqualTo(12));
        final icon = tester.widget<Icon>(find.descendant(of: find.byType(StatusBadge), matching: find.byType(Icon)));
        expect(icon.color, colors.foreground);
        expect(contrastRatio(colors.foreground, colors.background), greaterThanOrEqualTo(4.5));
      });
    });

    testWidgets('every tone shows its own glyph AND its word, never colour alone', (tester) async {
      final expectedGlyph = <BadgeTone, IconData>{
        BadgeTone.positive: BlynkIcons.check,
        BadgeTone.problem: BlynkIcons.warning,
        BadgeTone.notice: BlynkIcons.pending,
        BadgeTone.neutral: BlynkIcons.info,
      };
      expect(expectedGlyph.values.toSet(), hasLength(BadgeTone.values.length));
      for (final tone in BadgeTone.values) {
        await tester.pumpWidget(componentHost(tester, StatusBadge(tone: tone, label: 'Word ${tone.name}')));
        expect(find.descendant(of: find.byType(StatusBadge), matching: find.byIcon(expectedGlyph[tone]!)), findsOneWidget, reason: '${tone.name} glyph');
        expect(find.descendant(of: find.byType(StatusBadge), matching: find.text('Word ${tone.name}')), findsOneWidget, reason: '${tone.name} word');
        expect(find.descendant(of: find.byType(StatusBadge), matching: find.byType(Icon)), findsOneWidget);
      }
    });

    testWidgets('a custom icon replaces the default', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const StatusBadge(tone: BadgeTone.notice, label: 'Packed', icon: BlynkIcons.packed),
      ));
      expect(find.byIcon(BlynkIcons.packed), findsOneWidget);
    });

    testWidgets('semantics: a single label', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, const StatusBadge(tone: BadgeTone.positive, label: 'Delivered')));
      expect(tester.getSemantics(find.byType(StatusBadge)).getSemanticsData().label, 'Delivered');
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x in a narrow slot', (tester) async {
        await tester.pumpWidget(componentHost(
          tester,
          const SizedBox(width: 120, child: StatusBadge(tone: BadgeTone.problem, label: 'Out for delivery')),
          textScale: scale,
        ));
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('text contrast guideline for every tone', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(
        tester,
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final tone in BadgeTone.values) StatusBadge(tone: tone, label: 'Status ${tone.name}'),
          ],
        ),
      ));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
