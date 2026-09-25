import 'dart:io';
import 'dart:ui' show SemanticsAction, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/add_to_cart_button.dart';
import 'package:ecom/UI/Widgets/Atoms/quantity_stepper.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

ProductModel _product({String id = 'p1', String name = 'Kotmale Fresh Milk 1L', bool available = true}) =>
    ProductModel(
      id: id,
      categoryId: 'c1',
      categoryName: 'Dairy & Eggs',
      name: name,
      slug: id,
      sku: 'SKU-$id',
      unit: '1 L',
      sellingPrice: 540,
      isAvailable: available,
    );

Widget _host(
  WidgetTester tester,
  CartProvider cart,
  Widget child, {
  double textScale = 1,
  bool disableAnimations = false,
  double width = 400,
}) {
  return ChangeNotifierProvider<CartProvider>.value(
    value: cart,
    child: componentHost(
      tester,
      child,
      textScale: textScale,
      disableAnimations: disableAnimations,
      width: width,
    ),
  );
}

/// The visible pill: a DecoratedBox with a fill, inside the button.
Finder _fill(Color color) => find.descendant(
      of: find.byType(AddToCartButton),
      matching: find.byWidgetPredicate(
        (w) => w is DecoratedBox && w.decoration is BoxDecoration && (w.decoration as BoxDecoration).color == color,
      ),
    );

/// Counts every element rebuilt at or below an [AddToCartButton], per product.
/// Below matters: a Consumer inside a stateless button would rebuild its own
/// subtree without ever rebuilding the button element itself.
RebuildDirtyWidgetCallback countRebuildsUnderButtons(Map<String, int> builds) {
  return (element, builtOnce) {
    String? id;
    if (element.widget is AddToCartButton) {
      id = (element.widget as AddToCartButton).product.id;
    } else {
      element.visitAncestorElements((ancestor) {
        final widget = ancestor.widget;
        if (widget is AddToCartButton) {
          id = widget.product.id;
          return false;
        }
        return true;
      });
    }
    if (id != null) builds[id!] = (builds[id] ?? 0) + 1;
  };
}

void main() {
  late CartProvider cart;
  late ProductModel milk;

  setUp(() {
    cart = CartProvider();
    milk = _product();
  });

  group('ADD state', () {
    testWidgets('shows ADD, labelled with the product, and a tap puts one in the cart', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));

      expect(find.text('ADD'), findsOneWidget);
      final node = tester.getSemantics(find.bySemanticsLabel('Add Kotmale Fresh Milk 1L'));
      expect(node.flagsCollection.isButton, isTrue);
      expect(node.flagsCollection.isEnabled, Tristate.isTrue);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

      await tester.tap(find.text('ADD'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 1);
      handle.dispose();
    });

    // 2026-09 redesign (plan §8 "yellow add control"): the compact pill's
    // fill is `signal`/`signalPressed` - Blynk Yellow with an `ink` label.
    // An earlier pass had moved it to a second, decorative green chasing the
    // reference mock; that green is gone. Size/behaviour unchanged.
    testWidgets('visual is a 40 dp signal pill; the layout and hit box is 48 dp tall', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));
      expect(tester.getSize(_fill(BlynkCardProduct.addFill)).height, 40);
      expect(tester.getSize(find.byType(AddToCartButton)).height, 48);
      expect(tester.getSize(find.byType(AddToCartButton)).width, greaterThanOrEqualTo(64));
    });

    testWidgets('pressing changes the fill only, never the bounds', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));
      final before = tester.getRect(find.byType(AddToCartButton));
      final pillBefore = tester.getRect(_fill(BlynkCardProduct.addFill));

      final gesture = await tester.startGesture(tester.getCenter(find.text('ADD')));
      await tester.pump(const Duration(milliseconds: 100));
      expect(_fill(BlynkCardProduct.addFillPressed), findsOneWidget);
      expect(_fill(BlynkCardProduct.addFill), findsNothing);
      expect(tester.getRect(find.byType(AddToCartButton)), before);
      expect(tester.getRect(_fill(BlynkCardProduct.addFillPressed)), pillBefore);

      await gesture.up();
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 1);
    });

    testWidgets('the 4 dp above and below the visual pill still hit', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));
      final pill = tester.getRect(_fill(BlynkCardProduct.addFill));
      // 2 dp above the 40 dp pill is inside the 48 dp hit box.
      await tester.tapAt(Offset(pill.center.dx, pill.top - 2));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 1);
    });
  });

  group('unavailable', () {
    testWidgets('N/A: ink2 text (not the muted grey), well fill, disabled semantics, no add', (tester) async {
      final handle = tester.ensureSemantics();
      final gone = _product(available: false);
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: gone)));

      final text = tester.widget<Text>(find.text('N/A'));
      expect(text.style!.color, BlynkColors.ink2);
      expect(_fill(BlynkColors.well), findsOneWidget);

      final node = tester.getSemantics(find.bySemanticsLabel('Kotmale Fresh Milk 1L, currently unavailable'));
      expect(node.flagsCollection.isButton, isTrue);
      expect(node.flagsCollection.isEnabled, Tristate.isFalse);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isFalse);

      await tester.tap(find.text('N/A'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 0);
      handle.dispose();
    });

    testWidgets('N/A text meets the contrast guideline', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: _product(available: false))));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('expanded: "Currently unavailable" is a disabled button that adds nothing', (tester) async {
      final gone = _product(available: false);
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: gone, compact: false, expanded: true)));
      expect(find.text('Currently unavailable'), findsOneWidget);
      await tester.tap(find.text('Currently unavailable'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 0);
      final button = tester.widget<ElevatedButton>(find.byType(ElevatedButton));
      expect(button.onPressed, isNull);
    });
  });

  group('stepper state', () {
    testWidgets('in the cart it becomes - n + with the T2 labels, and goes back to ADD at zero', (tester) async {
      final handle = tester.ensureSemantics();
      cart.add(milk);
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));

      expect(find.byType(QuantityStepper), findsOneWidget);
      expect(find.text('ADD'), findsNothing);
      expect(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.bySemanticsLabel('1 Kotmale Fresh Milk 1L in cart'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 2);
      expect(find.text('2'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 0);
      expect(find.text('ADD'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('plus is disabled at the backend quantity cap', (tester) async {
      for (var i = 0; i < 100; i++) {
        cart.add(milk);
      }
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));
      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 100);
    });

    testWidgets('expanded stepper keeps the labels and works', (tester) async {
      final handle = tester.ensureSemantics();
      cart.add(milk);
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk, compact: false, expanded: true)));
      expect(find.bySemanticsLabel('Remove one Kotmale Fresh Milk 1L'), findsOneWidget);
      expect(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Add one more Kotmale Fresh Milk 1L'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 2);
      // Both halves are >= 48 dp and the bar is 52 dp tall.
      expect(tester.getSize(find.byType(AddToCartButton)).height, 52);
      for (final icon in [Icons.remove, Icons.add]) {
        final half = find.ancestor(of: find.byIcon(icon), matching: find.byType(InkWell));
        expect(tester.getSize(half).width, greaterThanOrEqualTo(48));
        expect(tester.getSize(half).height, greaterThanOrEqualTo(48));
      }
      handle.dispose();
    });

    testWidgets('expanded ADD says "Add to cart" and adds', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk, compact: false, expanded: true)));
      expect(find.text('Add to cart'), findsOneWidget);
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      expect(cart.quantityOf('p1'), 1);
    });
  });

  group('tap target guidelines', () {
    Future<void> check(WidgetTester tester, Widget app) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(app);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      handle.dispose();
    }

    testWidgets('ADD', (tester) async => check(tester, _host(tester, cart, AddToCartButton(product: milk))));

    testWidgets('stepper', (tester) async {
      cart.add(milk);
      await check(tester, _host(tester, cart, AddToCartButton(product: milk)));
    });

    testWidgets('cart-row variant (compact: false)', (tester) async {
      cart.add(milk);
      await check(tester, _host(tester, cart, AddToCartButton(product: milk, compact: false)));
    });

    testWidgets('expanded ADD', (tester) async {
      await check(tester, _host(tester, cart, AddToCartButton(product: milk, compact: false, expanded: true)));
    });

    testWidgets('expanded stepper', (tester) async {
      cart.add(milk);
      await check(tester, _host(tester, cart, AddToCartButton(product: milk, compact: false, expanded: true)));
    });

    testWidgets('every control is at least 48 x 48 at 2.0x text too', (tester) async {
      cart.add(milk);
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk), textScale: 2));
      for (final icon in [Icons.remove, Icons.add]) {
        final hit = find.ancestor(of: find.byIcon(icon), matching: find.byType(InkResponse));
        expect(tester.getSize(hit).width, greaterThanOrEqualTo(48));
        expect(tester.getSize(hit).height, greaterThanOrEqualTo(48));
      }
    });
  });

  group('no overflow in a narrow slot (152 dp and 130 dp cards leave 136 / 114 dp)', () {
    for (final slot in [136.0, 114.0]) {
      for (final scale in kTextScales) {
        for (final quantity in [0, 1, 12]) {
          testWidgets('slot ${slot.toInt()} dp, ${scale}x, qty $quantity', (tester) async {
            for (var i = 0; i < quantity; i++) {
              cart.add(milk);
            }
            await tester.pumpWidget(_host(
              tester,
              cart,
              SizedBox(width: slot, child: Align(alignment: Alignment.centerRight, child: AddToCartButton(product: milk))),
              textScale: scale,
            ));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            expect(tester.getSize(find.byType(AddToCartButton)).width, lessThanOrEqualTo(slot));
            expect(tester.getSize(find.byType(AddToCartButton)).height, 48);
            if (quantity > 0) {
              // The two buttons keep their 48 dp even when the count gives way.
              final hit = find.ancestor(of: find.byIcon(Icons.add), matching: find.byType(InkResponse));
              expect(tester.getSize(hit).width, greaterThanOrEqualTo(48));
            }
          });
        }
      }
    }

    testWidgets('expanded ADD and stepper at 2.0x on a 320 dp bar', (tester) async {
      await tester.pumpWidget(_host(
        tester,
        cart,
        SizedBox(width: 170, child: AddToCartButton(product: milk, compact: false, expanded: true)),
        textScale: 2,
        width: 320,
      ));
      expect(tester.takeException(), isNull);
      cart.add(milk);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('ADD to stepper morph', () {
    testWidgets('the slot never changes height while it morphs and settles at the stepper width', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));
      final addWidth = tester.getSize(find.byType(AddToCartButton)).width;

      await tester.tap(find.text('ADD'));
      final heights = <double>[];
      final widths = <double>[];
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 30));
        final size = tester.getSize(find.byType(AddToCartButton));
        heights.add(size.height);
        widths.add(size.width);
      }
      expect(heights.every((h) => (h - 48).abs() < 0.01), isTrue, reason: '$heights');
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(AddToCartButton)).width, greaterThan(addWidth));
      // The right edge stays put (the control grows leftwards).
      expect(widths.first, greaterThanOrEqualTo(addWidth));
    });

    testWidgets('it runs over BlynkMotion.base and not longer', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk)));
      await tester.tap(find.text('ADD'));
      await tester.pump();
      expect(tester.hasRunningAnimations, isTrue);
      await tester.pump(BlynkMotion.base + const Duration(milliseconds: 20));
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('reduced motion: the swap is immediate and nothing keeps animating', (tester) async {
      await tester.pumpWidget(_host(tester, cart, AddToCartButton(product: milk), disableAnimations: true));
      await tester.tap(find.text('ADD'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(QuantityStepper), findsOneWidget);
      expect(find.text('ADD'), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });
  });

  group('rebuild scope', () {
    testWidgets('another product changing in the cart does not rebuild this button', (tester) async {
      final other = _product(id: 'p2', name: 'Anchor Butter');
      final builds = <String, int>{};
      debugOnRebuildDirtyWidget = countRebuildsUnderButtons(builds);
      addTearDown(() => debugOnRebuildDirtyWidget = null);

      await tester.pumpWidget(_host(
        tester,
        cart,
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [AddToCartButton(product: milk), AddToCartButton(product: other)],
        ),
      ));
      await tester.pumpAndSettle();
      builds.clear();

      cart.add(other);
      await tester.pumpAndSettle();
      cart.add(other);
      await tester.pumpAndSettle();
      expect(builds['p2'], greaterThanOrEqualTo(2), reason: 'the counting hook must see real rebuilds');
      expect(builds['p1'], isNull, reason: 'p1 must not rebuild for p2 cart changes');

      builds.clear();
      cart.add(milk);
      await tester.pumpAndSettle();
      expect(builds['p1'], greaterThanOrEqualTo(1));
      expect(builds['p2'], isNull);
    });

    testWidgets('clearing the cart rebuilds only buttons whose quantity changed', (tester) async {
      final other = _product(id: 'p2', name: 'Anchor Butter');
      cart.add(milk);
      final builds = <String, int>{};
      debugOnRebuildDirtyWidget = countRebuildsUnderButtons(builds);
      addTearDown(() => debugOnRebuildDirtyWidget = null);
      await tester.pumpWidget(_host(
        tester,
        cart,
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [AddToCartButton(product: milk), AddToCartButton(product: other)],
        ),
      ));
      await tester.pumpAndSettle();
      builds.clear();

      cart.clear();
      await tester.pumpAndSettle();
      expect(builds['p1'], greaterThanOrEqualTo(1));
      expect(builds['p2'], isNull);
    });
  });

  test('the source no longer uses a Consumer<CartProvider> per product', () {
    // Structural guard for the C6 finding; the behavioural proof is above.
    final source = File('lib/UI/Widgets/Atoms/add_to_cart_button.dart').readAsStringSync();
    expect(source, isNot(contains('Consumer<CartProvider>')));
    expect(source, contains(RegExp(r'context\s*\.select<CartProvider,\s*int>')));
  });
}
