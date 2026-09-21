import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/adaptive_sheet.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

const _contentKey = ValueKey('sheet-content');

Widget _opener({
  String? label,
  bool isDismissible = true,
  ValueChanged<Object?>? onResult,
}) {
  return Builder(
    builder: (context) => TextButton(
      onPressed: () async {
        final result = await showAdaptiveSheet<String>(
          context,
          semanticLabel: label,
          isDismissible: isDismissible,
          builder: (sheetContext) => Column(
            key: _contentKey,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(padding: EdgeInsets.all(16), child: Text('Choose an address')),
              TextButton(
                onPressed: () => Navigator.of(sheetContext).pop('picked'),
                child: const Text('Pick'),
              ),
            ],
          ),
        );
        onResult?.call(result);
      },
      child: const Text('Open'),
    ),
  );
}

Future<void> _open(WidgetTester tester) async {
  await tester.tap(find.text('Open'));
  await tester.pumpAndSettle();
}

void main() {
  group('compact width (400): bottom sheet', () {
    testWidgets('renders a modal bottom sheet, not a dialog', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 400));
      await _open(tester);
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.byType(Dialog), findsNothing);
      expect(find.text('Choose an address'), findsOneWidget);
    });

    testWidgets('lg top radius, paper fill, 4 x 32 lineStrong drag handle, 50 % black scrim', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 400));
      await _open(tester);

      final material = tester.widget<Material>(find.descendant(of: find.byType(BottomSheet), matching: find.byType(Material)).first);
      expect((material.shape! as RoundedRectangleBorder).borderRadius, BlynkRadius.lgTop);
      expect(material.color, BlynkColors.paper);

      final handle = find.byWidgetPredicate((w) => w is SizedBox && w.width == 32 && w.height == 4);
      expect(handle, findsOneWidget);
      final handleBox = tester.widget<DecoratedBox>(find.descendant(of: handle, matching: find.byType(DecoratedBox)));
      expect((handleBox.decoration as BoxDecoration).color, BlynkColors.lineStrong);

      expect(
        find.byWidgetPredicate((w) => w is ModalBarrier && w.color == BlynkColors.scrim),
        findsWidgets,
      );
      expect(BlynkColors.scrim.a, closeTo(0.5, 0.01));
    });

    testWidgets('sits above the keyboard', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 400, height: 800));
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetViewInsets);
      await _open(tester);
      expect(tester.getBottomLeft(find.byKey(_contentKey)).dy, lessThanOrEqualTo(800 - 300));
    });

    testWidgets('a tap on the scrim, the back gesture and a result all close it', (tester) async {
      Object? result = 'unset';
      await tester.pumpWidget(componentHost(tester, _opener(onResult: (r) => result = r), width: 400));

      await _open(tester);
      await tester.tapAt(const Offset(200, 20));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(result, isNull);

      await _open(tester);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);

      await _open(tester);
      await tester.tap(find.text('Pick'));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(result, 'picked');
    });

    testWidgets('isDismissible: false ignores the scrim tap and the drag', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(isDismissible: false), width: 400));
      await _open(tester);
      await tester.tapAt(const Offset(200, 20));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(tester.widget<BottomSheet>(find.byType(BottomSheet)).enableDrag, isFalse);
    });

    testWidgets('semantics: scopes the route and names it', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, _opener(label: 'Delivery address'), width: 400));
      await _open(tester);
      final node = tester.getSemantics(find.bySemanticsLabel('Delivery address'));
      final flags = node.getSemanticsData().flagsCollection;
      expect(flags.scopesRoute, isTrue);
      expect(flags.namesRoute, isTrue);
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x', (tester) async {
        await tester.pumpWidget(componentHost(tester, _opener(), width: 400, textScale: scale));
        await _open(tester);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('wide width (900): centred dialog', () {
    testWidgets('renders a dialog no wider than 480, centred, with lg radius', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 900));
      await _open(tester);
      expect(find.byType(Dialog), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);

      // The Dialog widget itself spans the route; its Material is the visible surface.
      final surface = find.descendant(of: find.byType(Dialog), matching: find.byType(Material)).first;
      expect(tester.getSize(surface).width, lessThanOrEqualTo(480));
      expect(tester.getCenter(surface).dx, closeTo(450, 1));
      expect(tester.widget<Dialog>(find.byType(Dialog)).shape, const RoundedRectangleBorder(borderRadius: BlynkRadius.lgAll));
    });

    testWidgets('exactly 600 already counts as wide', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 600));
      await _open(tester);
      expect(find.byType(Dialog), findsOneWidget);
    });

    testWidgets('just under 600 is still a bottom sheet', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 599));
      await _open(tester);
      expect(find.byType(BottomSheet), findsOneWidget);
    });

    testWidgets('Escape and the back gesture close it', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(), width: 900));
      await _open(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(Dialog), findsNothing);

      await _open(tester);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(Dialog), findsNothing);
    });

    testWidgets('isDismissible: false keeps it open on a scrim tap', (tester) async {
      await tester.pumpWidget(componentHost(tester, _opener(isDismissible: false), width: 900));
      await _open(tester);
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(find.byType(Dialog), findsOneWidget);
    });

    testWidgets('semantics: scopes the route and names it', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, _opener(label: 'Delivery address'), width: 900));
      await _open(tester);
      final flags = tester.getSemantics(find.bySemanticsLabel('Delivery address')).getSemanticsData().flagsCollection;
      expect(flags.scopesRoute, isTrue);
      expect(flags.namesRoute, isTrue);
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x', (tester) async {
        await tester.pumpWidget(componentHost(tester, _opener(), width: 900, textScale: scale));
        await _open(tester);
        expect(tester.takeException(), isNull);
      });
    }
  });
}
