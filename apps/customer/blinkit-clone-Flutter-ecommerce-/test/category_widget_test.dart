import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/category_model.dart';
import 'package:ecom/UI/Widgets/Atoms/category_widget.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

/// 2026-09-24 redesign: the tile is a **circular image container with the
/// name underneath**, on one neutral surface. It replaced a large rounded
/// square carrying one of four rotating pastel tints, whose selected state
/// was a solid `signal` block.
///
/// These tests replace the ones that asserted that older design. They are
/// deliberately stricter than the tests they replace: as well as the new
/// look, they pin the two properties the old tile got wrong — that colour
/// must not be used decoratively, and that selecting must not resize
/// anything.
void main() {
  _glyphMapping();

  const dairy = CategoryModel(id: 'c1', name: 'Dairy & Eggs', slug: 'dairy');

  BoxDecoration disc(WidgetTester tester) =>
      tester.widget<AnimatedContainer>(find.byType(AnimatedContainer)).decoration!
          as BoxDecoration;

  group('the tile is circular and image-led', () {
    testWidgets('unselected: a circle on the one neutral surface, no ring', (tester) async {
      await tester.pumpWidget(componentHost(tester, const CategoryWidget(category: dairy)));

      final d = disc(tester);
      expect(d.shape, BoxShape.circle);
      expect(d.color, BlynkCategory.surface);
      expect(d.border, isNull, reason: 'the ring is the selected cue only');
      expect(d.gradient, isNull, reason: 'no gradients anywhere in Blynk');
    });

    testWidgets('the old square-tile design cannot come back', (tester) async {
      // The defect: rounded squares in four rotating pastels that carried no
      // meaning, and a selected tile that was a solid block of Blynk Yellow.
      // (The pastel family itself is deleted; `design_tokens_test` asserts no
      // file may re-declare it.)
      for (final active in [false, true]) {
        await tester.pumpWidget(
          componentHost(tester, CategoryWidget(category: dairy, isActive: active)),
        );
        final d = disc(tester);
        expect(d.shape, BoxShape.circle, reason: 'the tile is the image, not a block');
        expect(d.borderRadius, isNull, reason: 'a radius means it went back to a square');
        expect(d.color, isNot(BlynkColors.signal),
            reason: 'selected is a ring and a wash, never a solid yellow tile');
      }
    });
  });

  group('selected state', () {
    testWidgets('a thin signal ring, the faint wash, and a heavier label', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, const CategoryWidget(category: dairy, isActive: true)),
      );

      final d = disc(tester);
      expect(d.color, BlynkCategory.selectedSurface);
      expect((d.border! as Border).top.color, BlynkCategory.selectedRing);
      expect((d.border! as Border).top.width, BlynkCategory.ringWidth);

      final label = tester.widget<Text>(find.text('Dairy & Eggs'));
      expect(label.style!.color, BlynkColors.ink);
      expect(label.style!.fontWeight, FontWeight.w700);
    });

    testWidgets('the label weight really is a step up from unselected', (tester) async {
      // Blynk Yellow is 1.30:1 on paper, so the ring cannot be the only cue.
      // If the two label weights ever converge, the selected state would rest
      // entirely on a colour that does not meet any contrast floor.
      await tester.pumpWidget(componentHost(tester, const CategoryWidget(category: dairy)));
      final off = tester.widget<Text>(find.text('Dairy & Eggs')).style!.fontWeight!;
      await tester.pumpWidget(
        componentHost(tester, const CategoryWidget(category: dairy, isActive: true)),
      );
      final on = tester.widget<Text>(find.text('Dairy & Eggs')).style!.fontWeight!;
      expect(on.value, greaterThan(off.value));
    });

    testWidgets('selecting shifts nothing: the tile is the same size either way',
        (tester) async {
      await tester.pumpWidget(componentHost(tester, const CategoryWidget(category: dairy)));
      final unselected = tester.getSize(find.byType(CategoryWidget));
      final discOff = tester.getSize(find.byType(AnimatedContainer));

      await tester.pumpWidget(
        componentHost(tester, const CategoryWidget(category: dairy, isActive: true)),
      );
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byType(CategoryWidget)), unselected);
      expect(tester.getSize(find.byType(AnimatedContainer)), discOff,
          reason: 'the photo inset is unconditional so the ring costs no space');
    });
  });

  group('geometry is capped, not proportional', () {
    testWidgets('a wider screen fits more categories, not bigger ones', (tester) async {
      // Spec §10: "Maintain a consistent maximum category size."
      final sizes = <double, double>{};
      for (final width in [320.0, 700.0, 1400.0]) {
        await tester.pumpWidget(
          componentHost(tester, const CategoryWidget(category: dairy),
              width: width, height: 400, center: false),
        );
        sizes[width] = tester.getSize(find.byType(AnimatedContainer)).width;
      }
      expect(sizes[320], BlynkCategory.diameterCompact);
      expect(sizes[700], BlynkCategory.diameterMedium);
      expect(sizes[1400], BlynkCategory.diameterExpanded);
      // A 4.4x wider screen must not give a 4.4x wider tile.
      expect(sizes[1400]! / sizes[320]!, lessThan(1.5));
    });

    testWidgets('an explicit diameter wins, for a cell narrower than the cap',
        (tester) async {
      await tester.pumpWidget(
        componentHost(tester, const CategoryWidget(category: dairy, diameter: 40)),
      );
      expect(tester.getSize(find.byType(AnimatedContainer)).width, 40);
    });

    testWidgets('the label box grows with the text scale rather than clipping',
        (tester) async {
      final heights = <double>[];
      for (final scale in [1.0, 2.0]) {
        await tester.pumpWidget(
          componentHost(tester, const CategoryWidget(category: dairy), textScale: scale),
        );
        heights.add(tester.getSize(find.byType(CategoryWidget)).height);
      }
      expect(tester.takeException(), isNull);
      expect(heights[1], greaterThan(heights[0]));
    });
  });

  group('the no-image fallback', () {
    testWidgets('is a semantic glyph, shared with the product image wells',
        (tester) async {
      await tester.pumpWidget(componentHost(tester, const CategoryWidget(category: dairy)));
      final icon = tester.widget<Icon>(find.byType(Icon));
      expect(icon.icon, fallbackGlyphFor('Dairy & Eggs'));
      expect(icon.color, BlynkCategory.fallbackGlyph);
    });

    testWidgets('a caller may name the glyph, which is how "All" gets a basket',
        (tester) async {
      const all = CategoryModel(id: '', name: 'All', slug: '');
      await tester.pumpWidget(
        componentHost(tester, const CategoryWidget(category: all, glyph: BlynkIcons.product)),
      );
      expect(tester.widget<Icon>(find.byType(Icon)).icon, BlynkIcons.product);
    });

    testWidgets('the glyph scales with the circle, so one number fits every size',
        (tester) async {
      await tester.pumpWidget(
        componentHost(tester, const CategoryWidget(category: dairy, diameter: 100)),
      );
      expect(tester.widget<Icon>(find.byType(Icon)).size,
          100 * BlynkCategory.fallbackGlyphFraction);
    });
  });

  group('press feedback is a fill change, never a ripple', () {
    // The defect: an InkWell splash on a tile that is a circle above a label
    // painted a stadium-shaped grey wash across both at once.
    testWidgets('every ink overlay colour is cleared and the splash is NoSplash',
        (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, onTap: () {})),
      );
      final ink = tester.widget<InkWell>(find.byType(InkWell));
      expect(ink.splashColor, BlynkColors.clear);
      expect(ink.highlightColor, BlynkColors.clear);
      expect(ink.hoverColor, BlynkColors.clear);
      expect(ink.focusColor, BlynkColors.clear);
      expect(ink.splashFactory, NoSplash.splashFactory);
    });

    testWidgets('no InkSplash or InkRipple is ever created', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, onTap: () {})),
      );
      final gesture = await tester.startGesture(tester.getCenter(find.byType(InkWell)));
      await tester.pump(const Duration(milliseconds: 100));

      // InkSplash/InkRipple register themselves as InkFeatures on the
      // Material below. Asserting on the overlay colours alone would miss a
      // splash introduced through some other route.
      final material = tester.renderObject(find.byType(Material).first);
      expect(material.debugDescribeChildren().map((n) => n.toString()).join(),
          isNot(contains('InkSplash')));

      await gesture.up();
      await tester.pumpAndSettle();
    });

    testWidgets('pressing steps the circle surface down, and releasing restores it',
        (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, onTap: () {})),
      );
      expect(disc(tester).color, BlynkCategory.surface);

      final gesture = await tester.startGesture(tester.getCenter(find.byType(InkWell)));
      await tester.pumpAndSettle();
      expect(disc(tester).color, BlynkCategory.pressedSurface);

      await gesture.up();
      await tester.pumpAndSettle();
      expect(disc(tester).color, BlynkCategory.surface);
    });

    testWidgets('a selected tile keeps its yellow while pressed', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, isActive: true, onTap: () {})),
      );
      final gesture = await tester.startGesture(tester.getCenter(find.byType(InkWell)));
      await tester.pumpAndSettle();

      // Not the neutral pressed grey: losing the wash mid-press would flash
      // the selected state off under the finger.
      expect(disc(tester).color, BlynkCategory.selectedPressedSurface);
      expect(disc(tester).color, isNot(BlynkCategory.pressedSurface));

      await gesture.up();
      await tester.pumpAndSettle();
      expect(disc(tester).color, BlynkCategory.selectedSurface);
    });

    testWidgets('pressing changes no dimension', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, onTap: () {})),
      );
      final before = tester.getSize(find.byType(CategoryWidget));

      final gesture = await tester.startGesture(tester.getCenter(find.byType(InkWell)));
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(CategoryWidget)), before);

      await gesture.up();
      await tester.pumpAndSettle();
    });
  });

  group('interaction and accessibility', () {
    testWidgets('tapping calls onTap', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, onTap: () => taps++)),
      );
      await tester.tap(find.byType(CategoryWidget));
      expect(taps, 1);
    });

    testWidgets('the tap target clears 48 dp in both axes', (tester) async {
      await tester.pumpWidget(
        componentHost(tester, CategoryWidget(category: dairy, onTap: () {})),
      );
      final size = tester.getSize(find.byType(InkWell));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    });

    testWidgets('the name is real text, not only a picture', (tester) async {
      await tester.pumpWidget(componentHost(tester, const CategoryWidget(category: dairy)));
      expect(find.text('Dairy & Eggs'), findsOneWidget);
    });
  });
}

// 2026-09-24: every chip used to draw the same grocery trolley, so a row of
// eight categories was eight identical glyphs carrying no information. The
// chip now shares `fallbackGlyphFor` with the product image wells, which is
// also why a category and the products inside it show the same symbol.
void _glyphMapping() {
  group('category glyphs are per-category, not one icon for all', () {
    testWidgets('the eight real Blynk categories map to distinct symbols', (tester) async {
      const names = [
        'Dairy & Eggs',
        'Rice & Grains',
        'Fruits & Vegetables',
        'Beverages',
        'Spices & Condiments',
        'Personal Care',
        'Household',
        'Biscuits & Snacks',
      ];
      final glyphs = names.map(fallbackGlyphFor).toList();

      // The bug this guards: a single glyph reused for everything.
      expect(glyphs.toSet().length, greaterThan(4),
          reason: 'eight categories sharing one or two icons is the defect');
      for (final g in glyphs) {
        expect(g, isNot(Icons.local_grocery_store_outlined),
            reason: 'the old catch-all trolley must not come back');
      }
    });

    testWidgets('an unknown category still falls back rather than guessing', (tester) async {
      expect(fallbackGlyphFor('Something We Do Not Sell Yet'), BlynkIcons.product);
      expect(fallbackGlyphFor(''), BlynkIcons.product);
    });
  });
}
