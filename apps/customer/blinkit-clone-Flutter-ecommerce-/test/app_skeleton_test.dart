import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

double _opacityOf(WidgetTester tester, Finder skeleton) {
  final fade = find.descendant(of: skeleton, matching: find.byType(FadeTransition)).first;
  return tester.widget<FadeTransition>(fade).opacity.value;
}

Widget _twenty(WidgetTester tester, {bool scoped = true, bool disableAnimations = false, double textScale = 1}) {
  final blocks = Wrap(children: [for (var i = 0; i < 20; i++) const AppSkeleton(width: 40, height: 12)]);
  return componentHost(
    tester,
    scoped ? SkeletonScope(child: blocks) : blocks,
    disableAnimations: disableAnimations,
    textScale: textScale,
    center: false,
  );
}

void main() {
  group('SkeletonScope', () {
    testWidgets('20 skeletons under one scope run exactly one ticker', (tester) async {
      await tester.pumpWidget(_twenty(tester));
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.binding.transientCallbackCount, 1);
    });

    testWidgets('the same 20 skeletons with no scope run one ticker each (the fallback, as before)', (tester) async {
      await tester.pumpWidget(_twenty(tester, scoped: false));
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.binding.transientCallbackCount, 20);
    });

    testWidgets('the shared pulse stays within 0.6 to 1.0 and actually moves', (tester) async {
      await tester.pumpWidget(componentHost(tester, const SkeletonScope(child: AppSkeleton(width: 40, height: 12)), center: false));
      final seen = <double>{};
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 70));
        final value = _opacityOf(tester, find.byType(AppSkeleton));
        expect(value, inInclusiveRange(0.6, 1.0));
        seen.add(double.parse(value.toStringAsFixed(2)));
      }
      expect(seen.length, greaterThan(2));
    });

    testWidgets('all skeletons under one scope pulse in lockstep', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SkeletonScope(child: Column(children: [AppSkeleton(width: 40, height: 12), AppSkeleton(width: 40, height: 12)])),
        center: false,
      ));
      await tester.pump(const Duration(milliseconds: 90));
      final blocks = find.byType(AppSkeleton);
      expect(_opacityOf(tester, blocks.at(0)), _opacityOf(tester, blocks.at(1)));
    });

    testWidgets('disposing the scope stops the ticker (no leaked controller)', (tester) async {
      await tester.pumpWidget(_twenty(tester));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
      await tester.pumpWidget(const SizedBox());
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('a skeleton reads an existing scope instead of creating its own', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SkeletonScope(child: ProductCardSkeleton()),
        center: false,
      ));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
    });
  });

  group('reduced motion', () {
    testWidgets('scope: no ticker runs and the blocks are static and fully opaque', (tester) async {
      await tester.pumpWidget(_twenty(tester, disableAnimations: true));
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.hasRunningAnimations, isFalse);
      expect(tester.binding.transientCallbackCount, 0);
      expect(_opacityOf(tester, find.byType(AppSkeleton).first), 1.0);
    });

    testWidgets('fallback (no scope): also static', (tester) async {
      await tester.pumpWidget(_twenty(tester, scoped: false, disableAnimations: true));
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('composites are static too', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const Column(children: [SizedBox(height: 200, child: ProductCardSkeleton()), CategoryTileSkeleton(), ListRowSkeleton()]),
        disableAnimations: true,
        center: false,
      ));
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('turning reduced motion on stops a running pulse, and off starts it again', (tester) async {
      const blocks = AppSkeleton(width: 40, height: 12);
      await tester.pumpWidget(componentHost(tester, const SkeletonScope(child: blocks), center: false));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);

      await tester.pumpWidget(componentHost(tester, const SkeletonScope(child: blocks), disableAnimations: true, center: false));
      await tester.pump();
      expect(tester.binding.transientCallbackCount, 0);

      await tester.pumpWidget(componentHost(tester, const SkeletonScope(child: blocks), center: false));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
    });
  });

  group('appearance', () {
    testWidgets('a block is a well-filled rounded rectangle with the sm radius by default', (tester) async {
      await tester.pumpWidget(componentHost(tester, const SkeletonScope(child: AppSkeleton(width: 40, height: 12)), center: false));
      final box = tester.widget<Container>(find.descendant(of: find.byType(AppSkeleton), matching: find.byType(Container)));
      final decoration = box.decoration! as BoxDecoration;
      expect(decoration.color, BlynkColors.well);
      expect(decoration.borderRadius, BorderRadius.circular(BlynkRadius.sm));
    });

    testWidgets('composite skeletons hold their shape (product card fills its slot)', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SizedBox(width: 160, height: 240, child: ProductCardSkeleton()),
      ));
      expect(tester.getSize(find.byType(ProductCardSkeleton)), const Size(160, 240));
      expect(tester.takeException(), isNull);
    });
  });

  group('one controller per composite when there is no scope', () {
    testWidgets('ProductCardSkeleton alone runs one ticker (was five)', (tester) async {
      await tester.pumpWidget(componentHost(tester, const SizedBox(width: 160, height: 240, child: ProductCardSkeleton())));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
    });

    testWidgets('CategoryTileSkeleton and ListRowSkeleton run one ticker each', (tester) async {
      await tester.pumpWidget(componentHost(tester, const SizedBox(width: 120, child: CategoryTileSkeleton())));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
      await tester.pumpWidget(componentHost(tester, const ListRowSkeleton()));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
    });

    testWidgets('a whole loading grid under one scope runs one ticker', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        SkeletonScope(
          child: GridView.builder(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, childAspectRatio: 0.7),
            itemCount: 6,
            itemBuilder: (_, __) => const ProductCardSkeleton(),
          ),
        ),
        center: false,
      ));
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.binding.transientCallbackCount, 1);
    });
  });

  group('text scale', () {
    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x (skeletons do not scale with text)', (tester) async {
        await tester.pumpWidget(componentHost(
          tester,
          const SkeletonScope(child: Column(children: [ListRowSkeleton(), ListRowSkeleton()])),
          textScale: scale,
          center: false,
        ));
        expect(tester.takeException(), isNull);
      });
    }
  });
}
