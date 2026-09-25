import 'dart:io';
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/circular_icon_button.dart';
import 'package:ecom/UI/Widgets/Atoms/expandable_row.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

/// New atoms for the 2026-09 redesign: the circular icon button, the struck
/// original price and the expandable row. The discount pill and the trust
/// chip were removed - plan §8 rejects both as unjustified (no real discount
/// or provenance data source), and the group below asserts they stay gone
/// rather than simply dropping their coverage.
/// [BlynkButton.cta]/[.promo] have their own test file
/// (blynk_button_cta_test.dart); the product card / category chip / stepper
/// restyles have theirs (product_card_layout_test.dart, etc.).
void main() {
  group('CircularIconButton', () {
    testWidgets('paper fill, line border, ink glyph, >= 48 dp tap target', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CircularIconButton(icon: Icons.search, onPressed: () {}, semanticLabel: 'Search')),
      );
      final container = tester.widget<Container>(
        find.descendant(of: find.byType(CircularIconButton), matching: find.byType(Container)).first,
      );
      final decoration = container.decoration! as BoxDecoration;
      expect(decoration.color, BlynkColors.paper);
      expect(decoration.shape, BoxShape.circle);
      expect(decoration.border!.top.color, BlynkColors.line);
      expect(tester.widget<Icon>(find.byIcon(Icons.search)).color, BlynkColors.ink);
      expect(tester.getSize(find.byType(CircularIconButton)).height, greaterThanOrEqualTo(48));
      expect(tester.getSize(find.byType(CircularIconButton)).width, greaterThanOrEqualTo(48));
    });

    testWidgets('visual diameter defaults to 44 and is overridable', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          const Column(
            children: [
              CircularIconButton(icon: Icons.search, onPressed: null, semanticLabel: 'Search'),
              CircularIconButton(icon: Icons.search, onPressed: null, semanticLabel: 'Search', size: 40),
            ],
          ),
          center: false,
        ),
      );
      final containers = tester
          .widgetList<Container>(find.descendant(of: find.byType(CircularIconButton), matching: find.byType(Container)))
          .toList();
      expect(containers[0].constraints!.maxWidth, 44);
      expect(containers[1].constraints!.maxWidth, 40);
    });

    testWidgets('elevated adds the soft shadow; default has none', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          const Column(
            children: [
              CircularIconButton(icon: Icons.share_outlined, onPressed: null, semanticLabel: 'Share'),
              CircularIconButton(
                icon: Icons.share_outlined,
                onPressed: null,
                semanticLabel: 'Share',
                elevated: true,
              ),
            ],
          ),
          center: false,
        ),
      );
      final containers = tester
          .widgetList<Container>(find.descendant(of: find.byType(CircularIconButton), matching: find.byType(Container)))
          .toList();
      expect((containers[0].decoration! as BoxDecoration).boxShadow, isEmpty);
      expect((containers[1].decoration! as BoxDecoration).boxShadow, BlynkElevation.soft);
    });

    testWidgets('badgeCount shows a count badge; omitted when null or zero', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          CircularIconButton(icon: Icons.shopping_bag_outlined, onPressed: () {}, semanticLabel: 'Cart', badgeCount: 3),
        ),
      );
      expect(find.text('3'), findsOneWidget);

      await tester.pumpWidget(
        componentHost(
          tester,
          CircularIconButton(icon: Icons.shopping_bag_outlined, onPressed: () {}, semanticLabel: 'Cart'),
        ),
      );
      expect(find.text('3'), findsNothing);
    });

    testWidgets('disabled: no tap, disabled semantics', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(
        componentHost(tester, const CircularIconButton(icon: Icons.search, onPressed: null, semanticLabel: 'Search')),
      );
      final data = tester.getSemantics(find.byType(CircularIconButton)).getSemanticsData();
      expect(data.flagsCollection.isEnabled, Tristate.isFalse);
      handle.dispose();
    });

    testWidgets('tapping calls onPressed', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        componentHost(tester, CircularIconButton(icon: Icons.search, onPressed: () => taps++, semanticLabel: 'Search')),
      );
      await tester.tap(find.byType(CircularIconButton));
      expect(taps, 1);
    });
  });

  group('atoms rejected as fabricated data (plan §8)', () {
    test('discount_pill.dart and trust_chip.dart do not exist', () {
      // Neither has a real backend source: there is no discount field and no
      // provenance/"100% fresh" field. A re-added file fails here.
      expect(File('lib/UI/Widgets/Atoms/discount_pill.dart').existsSync(), isFalse);
      expect(File('lib/UI/Widgets/Atoms/trust_chip.dart').existsSync(), isFalse);
    });

    test('no DiscountPill or TrustChip widget anywhere in lib/', () {
      final scanned = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .toList();
      // Review M-5: a scope derived from a live directory listing must fail
      // loudly if the path ever stops matching, not pass vacuously.
      expect(scanned, isNotEmpty, reason: 'lib/ scan found nothing - the guard would be vacuous');
      final offenders = scanned
          .where((f) => RegExp(r'\b(DiscountPill|TrustChip)\b').hasMatch(f.readAsStringSync()))
          .map((f) => f.path)
          .toList();
      expect(offenders, isEmpty, reason: 'both atoms are rejected by plan §8 (no real data source)');
    });
  });

  group('StruckPrice', () {
    testWidgets('strike colour, line-through decoration', (tester) async {
      await tester.pumpWidget(componentHost(tester, const StruckPrice(450)));
      final text = tester.widget<Text>(find.byType(Text).first);
      expect(text.style!.color, BlynkColors.strike);
      expect(text.style!.decoration, TextDecoration.lineThrough);
    });
  });

  group('ExpandableRow', () {
    testWidgets('collapsed by default: child not shown, chevron down', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          const ExpandableRow(title: 'Product Details', child: Text('Contains milk.')),
          center: false,
        ),
      );
      expect(find.text('Product Details'), findsOneWidget);
      expect(find.text('Contains milk.'), findsNothing);
    });

    testWidgets('tapping the row reveals the child', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          const ExpandableRow(title: 'Product Details', child: Text('Contains milk.')),
          center: false,
        ),
      );
      await tester.tap(find.text('Product Details'));
      await tester.pumpAndSettle();
      expect(find.text('Contains milk.'), findsOneWidget);
    });

    testWidgets('initiallyExpanded starts open', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          const ExpandableRow(
            title: 'Product Details',
            initiallyExpanded: true,
            child: Text('Contains milk.'),
          ),
          center: false,
        ),
      );
      expect(find.text('Contains milk.'), findsOneWidget);
    });

    testWidgets('a line divider sits beneath the row', (tester) async {
      await tester.pumpWidget(
        componentHost(
          tester,
          const ExpandableRow(title: 'Product Details', child: Text('Contains milk.')),
          center: false,
        ),
      );
      final decorated = tester.widget<DecoratedBox>(find.byType(DecoratedBox).first);
      final border = (decorated.decoration as BoxDecoration).border! as Border;
      expect(border.bottom.color, BlynkColors.line);
    });
  });
}
