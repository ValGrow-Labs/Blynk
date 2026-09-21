import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Organisms/adaptive_scaffold.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

// Short labels: the test font (Ahem) is wider than Catamaran, so "Profile"
// alone would make the rail wider than its 80 dp minimum here.
const _short = <AdaptiveDestination>[
  AdaptiveDestination(icon: BlynkIcons.shop, selectedIcon: BlynkIcons.shopSelected, label: 'A'),
  AdaptiveDestination(icon: BlynkIcons.orders, selectedIcon: BlynkIcons.ordersSelected, label: 'B'),
];

const _destinations = <AdaptiveDestination>[
  AdaptiveDestination(icon: BlynkIcons.shop, selectedIcon: BlynkIcons.shopSelected, label: 'Shop'),
  AdaptiveDestination(icon: BlynkIcons.orders, selectedIcon: BlynkIcons.ordersSelected, label: 'Orders'),
  AdaptiveDestination(icon: BlynkIcons.help, selectedIcon: BlynkIcons.helpSelected, label: 'Help'),
  AdaptiveDestination(
    icon: BlynkIcons.profile,
    selectedIcon: BlynkIcons.profileSelected,
    label: 'Profile',
  ),
];

void main() {
  late List<int> selections;

  setUp(() => selections = []);

  Widget scaffold({
    int selected = 0,
    List<AdaptiveDestination> destinations = _destinations,
    Widget? cartBar,
  }) =>
      AdaptiveScaffold(
        destinations: destinations,
        selectedIndex: selected,
        onSelected: selections.add,
        body: const Center(child: Text('the body')),
        cartBar: cartBar,
      );

  Future<void> pump(
    WidgetTester tester, {
    double width = 400,
    double height = 800,
    double textScale = 1,
    bool disableAnimations = false,
    int selected = 0,
    List<AdaptiveDestination> destinations = _destinations,
    Widget? cartBar,
  }) async {
    await tester.pumpWidget(
      componentHost(
        tester,
        scaffold(selected: selected, destinations: destinations, cartBar: cartBar),
        width: width,
        height: height,
        textScale: textScale,
        disableAnimations: disableAnimations,
        center: false,
      ),
    );
  }

  final bar = find.byKey(const ValueKey('adaptive-bottom-bar'));
  final rail = find.byKey(const ValueKey('adaptive-rail'));

  group('the ladder picks the control', () {
    testWidgets('compact (400): a 64 dp bottom bar and no rail', (tester) async {
      await pump(tester, width: 400);
      expect(bar, findsOneWidget);
      expect(rail, findsNothing);
      expect(tester.getSize(bar).height, 64);
      expect(tester.getSize(bar).width, 400);
      expect(tester.getRect(bar).bottom, 800);
    });

    testWidgets('just under 600 is still the bottom bar', (tester) async {
      await pump(tester, width: 599);
      expect(bar, findsOneWidget);
      expect(rail, findsNothing);
    });

    testWidgets('medium (800): an 80 dp rail with labels and no bottom bar', (tester) async {
      await pump(tester, width: 800, destinations: _short);
      expect(bar, findsNothing);
      expect(rail, findsOneWidget);
      final r = tester.widget<NavigationRail>(rail);
      expect(r.extended, isFalse);
      expect(r.labelType, NavigationRailLabelType.all);
      expect(r.minWidth, 80);
      expect(tester.getSize(rail).width, 80);
      await pump(tester, width: 800);
      for (final label in ['Shop', 'Orders', 'Help', 'Profile']) {
        expect(find.text(label), findsOneWidget);
      }
    });

    testWidgets('600 is medium and 1023 is medium', (tester) async {
      await pump(tester, width: 600);
      expect(tester.widget<NavigationRail>(rail).extended, isFalse);
      await pump(tester, width: 1023);
      expect(tester.widget<NavigationRail>(rail).extended, isFalse);
    });

    testWidgets('expanded (1200): a 240 dp extended rail', (tester) async {
      await pump(tester, width: 1200);
      expect(bar, findsNothing);
      final r = tester.widget<NavigationRail>(rail);
      expect(r.extended, isTrue);
      expect(r.minExtendedWidth, 240);
      expect(tester.getSize(rail).width, 240);
      expect(find.text('Orders'), findsOneWidget);
    });

    testWidgets('1024 is expanded', (tester) async {
      await pump(tester, width: 1024);
      expect(tester.widget<NavigationRail>(rail).extended, isTrue);
    });

    testWidgets('the body fills what the navigation leaves', (tester) async {
      await pump(tester, width: 400);
      expect(tester.getRect(find.text('the body')).center.dy, closeTo((800 - 64) / 2, 1));
      await pump(tester, width: 800, destinations: _short);
      expect(tester.getRect(find.text('the body')).center.dx, closeTo(80 + 1 + (800 - 81) / 2, 1));
    });
  });

  group('compact bar', () {
    testWidgets('selecting an item reports its index', (tester) async {
      await pump(tester);
      await tester.tap(find.text('Orders'));
      await tester.tap(find.text('Profile'));
      await tester.tap(find.text('Shop'));
      expect(selections, [1, 3, 0]);
    });

    testWidgets('selected: filled ink icon and a 3 dp signal bar; others outlined ink2', (tester) async {
      await pump(tester, selected: 1);

      Icon iconOf(String label) => tester.widget<Icon>(
            find.descendant(
              of: find.byKey(ValueKey('nav-focus-$label')),
              matching: find.byType(Icon),
            ),
          );
      expect(iconOf('Orders').icon, BlynkIcons.ordersSelected);
      expect(iconOf('Orders').color, BlynkColors.ink);
      expect(iconOf('Shop').icon, BlynkIcons.shop);
      expect(iconOf('Shop').color, BlynkColors.ink2);

      BoxDecoration indicator(String label) {
        final c = tester.widget<Container>(find.byKey(ValueKey('nav-indicator-$label')));
        return c.decoration! as BoxDecoration;
      }

      expect(indicator('Orders').color, BlynkColors.signal);
      expect(indicator('Shop').color, BlynkColors.clear);
      final bar3 = tester.widget<Container>(find.byKey(const ValueKey('nav-indicator-Orders')));
      expect(bar3.constraints!.maxHeight, 3);
      // No yellow pill behind the icon: signal is the 3 dp bar only.
      expect(find.byType(AnimatedContainer), findsNothing);
    });

    testWidgets('labels are 12 px w700', (tester) async {
      await pump(tester);
      final text = tester.widget<Text>(find.text('Shop'));
      expect(text.style!.fontSize, 12);
      expect(text.style!.fontWeight, FontWeight.w700);
    });

    testWidgets('the indicator moves in the same frame (nothing tweens, reduced motion or not)',
        (tester) async {
      for (final reduced in [false, true]) {
        await pump(tester, selected: 0, disableAnimations: reduced);
        await pump(tester, selected: 2, disableAnimations: reduced);
        final c = tester.widget<Container>(find.byKey(const ValueKey('nav-indicator-Help')));
        expect((c.decoration! as BoxDecoration).color, BlynkColors.signal);
        expect(tester.hasRunningAnimations, isFalse, reason: 'reduced: $reduced');
      }
    });

    testWidgets('each item is one selectable button with its label', (tester) async {
      final handle = tester.ensureSemantics();
      await pump(tester, selected: 2);

      final help = tester.getSemantics(find.bySemanticsLabel('Help'));
      expect(help.flagsCollection.isButton, isTrue);
      expect(help.flagsCollection.isSelected, Tristate.isTrue);
      final shop = tester.getSemantics(find.bySemanticsLabel('Shop'));
      expect(shop.flagsCollection.isButton, isTrue);
      expect(shop.flagsCollection.isSelected, Tristate.isFalse);
      handle.dispose();
    });

    testWidgets('a badge dot is announced with the label', (tester) async {
      final handle = tester.ensureSemantics();
      await pump(
        tester,
        destinations: [
          _destinations[0],
          const AdaptiveDestination(
            icon: BlynkIcons.orders,
            selectedIcon: BlynkIcons.ordersSelected,
            label: 'Orders',
            hasBadge: true,
            badgeDescription: 'order in progress',
          ),
          _destinations[2],
          _destinations[3],
        ],
      );
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsOneWidget);
      expect(find.bySemanticsLabel('Orders, order in progress'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('no badge dot unless asked for', (tester) async {
      await pump(tester);
      expect(find.byKey(const ValueKey('nav-badge-dot')), findsNothing);
    });

    testWidgets('keyboard: Tab focuses an item with a visible ring, Enter and Space activate', (tester) async {
      await pump(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();

      BoxDecoration ring(String label) =>
          tester.widget<DecoratedBox>(find.byKey(ValueKey('nav-focus-$label'))).decoration as BoxDecoration;
      expect(ring('Shop').border, isNotNull, reason: 'the first item shows a focus ring');
      expect((ring('Shop').border! as Border).top.width, 2);
      expect((ring('Shop').border! as Border).top.color, BlynkColors.ink);
      expect(ring('Orders').border, isNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(selections, [1]);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(selections, [1, 2]);
    });

    testWidgets('the cart bar slot sits directly above the bar and shrinks the body', (tester) async {
      await pump(tester, cartBar: const SizedBox(key: ValueKey('slot'), height: 76));
      final slot = tester.getRect(find.byKey(const ValueKey('slot')));
      expect(slot.bottom, tester.getRect(bar).top);
      expect(slot.height, 76);
      expect(find.text('the body'), findsOneWidget);
      expect(tester.getRect(find.text('the body')).bottom, lessThan(slot.top));
    });
  });

  group('rail', () {
    testWidgets('selecting a destination reports its index', (tester) async {
      await pump(tester, width: 800);
      await tester.tap(find.text('Help'));
      await tester.tap(find.text('Shop'));
      expect(selections, [2, 0]);
    });

    testWidgets('the rail marks the selection and uses the filled icon', (tester) async {
      await pump(tester, width: 800, selected: 3);
      final r = tester.widget<NavigationRail>(rail);
      expect(r.selectedIndex, 3);
      expect(find.byIcon(BlynkIcons.profileSelected), findsOneWidget);
      expect(find.byIcon(BlynkIcons.profile), findsNothing);
      // No yellow pill on the rail either.
      expect(r.indicatorColor, isNot(BlynkColors.signal));
    });

    testWidgets('semantics: a selected, labelled button', (tester) async {
      final handle = tester.ensureSemantics();
      await pump(tester, width: 800, selected: 1);
      expect(find.bySemanticsLabel(RegExp('Orders')), findsWidgets);
      final data = tester.getSemantics(find.bySemanticsLabel(RegExp('Orders')).first);
      expect(data.flagsCollection.isSelected, Tristate.isTrue);
      handle.dispose();
    });

    testWidgets('the cart bar slot sits at the bottom of the content column, beside the rail', (tester) async {
      await pump(tester, width: 800, cartBar: const SizedBox(key: ValueKey('slot'), height: 76));
      final slot = tester.getRect(find.byKey(const ValueKey('slot')));
      expect(slot.bottom, 800);
      expect(slot.left, greaterThanOrEqualTo(80));
    });
  });

  group('guidelines', () {
    for (final width in [400.0, 800.0, 1200.0]) {
      testWidgets('tap targets, labels and contrast at $width dp', (tester) async {
        final handle = tester.ensureSemantics();
        await pump(tester, width: width);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });
    }

    testWidgets('every compact item is at least 48 dp tall and wide', (tester) async {
      await pump(tester, width: 320);
      for (final d in _destinations) {
        final size = tester.getSize(find.byKey(ValueKey('nav-focus-${d.label}')));
        expect(size.height, greaterThanOrEqualTo(48), reason: d.label);
        expect(size.width, greaterThanOrEqualTo(48), reason: d.label);
      }
    });
  });

  group('text scale', () {
    for (final width in [400.0, 800.0, 1200.0]) {
      for (final scale in kTextScales) {
        testWidgets('no overflow at $scale x on $width dp', (tester) async {
          await pump(tester, width: width, textScale: scale, selected: 1);
          expect(tester.takeException(), isNull);
          expect(find.text('Profile'), findsOneWidget);
        });
      }
    }

    testWidgets('the bar is 64 dp at 1.0x and grows (no clamp) at 2.0x, targets stay >= 48 dp', (tester) async {
      await pump(tester, textScale: 1);
      final base = tester.getSize(bar).height;
      expect(base, 64);

      await pump(tester, textScale: 2);
      expect(tester.takeException(), isNull);
      final big = tester.getSize(bar).height;
      expect(big, greaterThan(64));
      // The label really is laid out at 2.0x (no clamp).
      expect(MediaQuery.textScalerOf(tester.element(find.text('Shop'))).scale(10), 20);
      for (final d in _destinations) {
        final size = tester.getSize(find.byKey(ValueKey('nav-focus-${d.label}')));
        expect(size.height, greaterThanOrEqualTo(48), reason: d.label);
        expect(size.width, greaterThanOrEqualTo(48), reason: d.label);
      }
      // Bar stays flush with the bottom edge and above nothing else.
      expect(tester.getRect(bar).bottom, 800);
    });

    testWidgets('2.0x meets the tap-target and label guidelines on the compact bar and the rail', (tester) async {
      final handle = tester.ensureSemantics();
      for (final width in [400.0, 800.0]) {
        await pump(tester, width: width, textScale: 2);
        expect(tester.takeException(), isNull, reason: '$width');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      }
      handle.dispose();
    });
  });

  group('system insets', () {
    Future<void> pumpInset(WidgetTester tester, double width) async {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, app) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              padding: const EdgeInsets.only(bottom: 24, right: 24, left: 10, top: 20),
              viewPadding: const EdgeInsets.only(bottom: 24, right: 24, left: 10, top: 20),
            ),
            child: app!,
          ),
          home: AdaptiveScaffold(
            destinations: _short,
            selectedIndex: 0,
            onSelected: (_) {},
            body: Builder(
              builder: (context) => Align(
                alignment: Alignment.bottomRight,
                child: Text(
                  'pad ${MediaQuery.paddingOf(context).bottom} ${MediaQuery.paddingOf(context).right}',
                  key: const ValueKey('probe'),
                ),
              ),
            ),
            cartBar: const SizedBox(key: ValueKey('slot'), height: 76),
          ),
        ),
      );
    }

    for (final width in [800.0, 1200.0]) {
      testWidgets('rail layout at $width: content and cart slot stay inside the bottom and right insets', (tester) async {
        await pumpInset(tester, width);
        final slot = tester.getRect(find.byKey(const ValueKey('slot')));
        expect(slot.bottom, 800 - 24);
        final probe = tester.getRect(find.byKey(const ValueKey('probe')));
        expect(probe.bottom, lessThanOrEqualTo(slot.top));
        expect(probe.right, lessThanOrEqualTo(width - 24));
        // The rail keeps clear of the left inset.
        expect(tester.getRect(rail).left, greaterThanOrEqualTo(10));
        // Consumed once: the body is not padded a second time.
        expect(find.text('pad 0.0 0.0'), findsOneWidget);
      });
    }

    testWidgets('compact: the bar owns the bottom inset once, the body sees none', (tester) async {
      await pumpInset(tester, 400);
      final barRect = tester.getRect(bar);
      expect(barRect.bottom, 800 - 24, reason: 'the 64 dp bar sits above the inset');
      expect(barRect.height, 64, reason: 'no double padding inside the bar');
      final slot = tester.getRect(find.byKey(const ValueKey('slot')));
      expect(slot.bottom, barRect.top);
      expect(find.textContaining('pad 0.0 '), findsOneWidget);
    });
  });
}
