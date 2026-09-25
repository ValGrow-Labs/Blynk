import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/add_to_cart_button.dart';
import 'package:ecom/UI/Widgets/Atoms/app_skeleton.dart';
import 'package:ecom/UI/Widgets/Atoms/card_product.dart';
import 'package:ecom/UI/Widgets/Organisms/category_with_products.dart';
import 'package:ecom/UI/Widgets/Organisms/products_screen_grid.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

ProductModel _p(
  int i, {
  String? name,
  bool available = true,
  double price = 605.5,
}) =>
    ProductModel(
      id: 'p$i',
      categoryId: 'c1',
      categoryName: 'Dairy & Eggs',
      name: name ?? 'Product $i',
      slug: 'p$i',
      sku: 'SKU-$i',
      unit: '200 g',
      sellingPrice: price,
      isAvailable: available,
    );

const _longName =
    'Kotmale Full Cream Fresh Pasteurised Dairy Milk Tetra Pack 1 Litre Family Size Value Pack';

List<ProductModel> _products() => [
      _p(1),
      _p(2, name: _longName, price: 12345.5),
      _p(3, available: false),
      _p(4),
      _p(5),
      _p(6),
    ];

Future<dynamic> _catalog(String url, Map<String, dynamic> query) async {
  if (url == '/catalog/categories') {
    return {
      'success': true,
      'data': {'categories': <dynamic>[]},
    };
  }
  return _productsResponse();
}

Map<String, dynamic> _productsResponse() {
  final products = _products();
  return {
    'success': true,
    'data': {
      'products': [
        for (final p in products)
          {
            'id': p.id,
            'category_id': 'c1',
            'category_name': 'Dairy & Eggs',
            'name': p.name,
            'slug': p.slug,
            'description': null,
            'sku': p.sku,
            'barcode': null,
            'unit': p.unit,
            'pack_size': null,
            'image_url': null,
            'selling_price': p.sellingPrice,
            'is_available': p.isAvailable,
          },
      ],
      'pagination': {'page': 1, 'limit': 100, 'total': products.length, 'total_pages': 1},
    },
  };
}

Widget _app(
  WidgetTester tester, {
  required Widget home,
  required double width,
  required double textScale,
  required CartProvider cart,
  ProductProvider? products,
  double height = 900,
}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<CartProvider>.value(value: cart),
      ChangeNotifierProvider<ProductProvider>.value(value: products ?? ProductProvider(request: _catalog)),
    ],
    child: MaterialApp(
      theme: AppTheme.theme,
      builder: (context, app) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: app!,
      ),
      home: home,
    ),
  );
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  group('ProductCard geometry helpers', () {
    testWidgets('heightFor grows with the text scale and with the width', (tester) async {
      late double at1, at2, wide;
      await tester.pumpWidget(_app(
        tester,
        cart: CartProvider(),
        width: 400,
        textScale: 1,
        home: Builder(builder: (context) {
          at1 = ProductCard.heightFor(context, 152);
          wide = ProductCard.heightFor(context, 190);
          return const SizedBox();
        }),
      ));
      await tester.pumpWidget(_app(
        tester,
        cart: CartProvider(),
        width: 400,
        textScale: 2,
        home: Builder(builder: (context) {
          at2 = ProductCard.heightFor(context, 152);
          return const SizedBox();
        }),
      ));
      expect(at2, greaterThan(at1));
      // 2026-09-24: the image well is 4:5, not square, so height grows with
      // width at `imageRatio`, not 1:1. Expressed as the rule rather than a
      // number so it keeps meaning if the ratio is tuned again.
      expect(wide - at1, closeTo((190 - 152) * ProductCard.imageRatio, 0.001));
      // Still comfortably taller than the image alone — the chrome (name, unit,
      // price and the 48 dp control) is real and must not be squeezed out.
      expect(at1, greaterThan(ProductCard.imageHeightFor(152)));
    });
  });

  group('a ProductCard in a box of exactly heightFor', () {
    for (final width in [130.0, 152.0, 175.0, 190.0]) {
      for (final scale in kTextScales) {
        testWidgets('${width.toInt()} dp wide at ${scale}x: no overflow, control >= 48', (tester) async {
          final cart = CartProvider()
            ..add(_p(4))
            ..add(_p(5))
            ..add(_p(5));
          for (var i = 0; i < 12; i++) {
            cart.add(_p(6));
          }
          await tester.pumpWidget(_app(
            tester,
            cart: cart,
            width: 900,
            textScale: scale,
            home: Scaffold(
              body: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Builder(builder: (context) {
                  final height = ProductCard.heightFor(context, width);
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final p in _products())
                        Padding(
                          padding: const EdgeInsets.all(8),
                          child: SizedBox(width: width, height: height, child: ProductCard(product: p)),
                        ),
                    ],
                  );
                }),
              ),
            ),
          ));
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          // p1 = ADD, p2 = long name + big price, p3 = N/A, p4 = qty 1, p5 = qty 2, p6 = qty 12.
          for (var button = 0; button < _products().length; button++) {
            final size = tester.getSize(find.byType(AddToCartButton).at(button));
            expect(size.height, 48, reason: 'button $button');
            expect(size.width, lessThanOrEqualTo(width - 16 + 0.01), reason: 'button $button fits the card');
          }
          // The whole control sits inside the card, with the image still visible.
          final card = tester.getRect(find.byType(ProductCard).first);
          final control = tester.getRect(find.byType(AddToCartButton).first);
          expect(control.bottom, lessThanOrEqualTo(card.bottom));
          expect(control.left, greaterThanOrEqualTo(card.left));
          expect(control.right, lessThanOrEqualTo(card.right));
        });
      }
    }
  });

  group('ProductCardSkeleton matches the card silhouette', () {
    for (final width in [130.0, 152.0, 190.0]) {
      for (final scale in kTextScales) {
        testWidgets('${width.toInt()} dp at ${scale}x: fits the same box as the card, same rows', (tester) async {
          late double height;
          await tester.pumpWidget(_app(
            tester,
            cart: CartProvider(),
            width: 900,
            textScale: scale,
            home: Scaffold(
              body: Builder(builder: (context) {
                height = ProductCard.heightFor(context, width);
                return SizedBox(width: width, height: height, child: const ProductCardSkeleton());
              }),
            ),
          ));
          expect(tester.takeException(), isNull);
          final card = tester.getRect(find.byType(ProductCardSkeleton));
          expect(card.height, height);
          // The 48 dp control slot sits at the bottom, like the real card's.
          final blocks = find.descendant(of: find.byType(ProductCardSkeleton), matching: find.byType(AppSkeleton));
          final pill = tester.getRect(blocks.last);
          expect(pill.height, 40);
          // W1: read from the card's own padding token rather than a literal,
          // so the next restyle moves this with the card instead of past it.
          expect(pill.right, card.right - ProductCard.padding);
          expect(card.bottom - pill.bottom, closeTo(ProductCard.padding + 4, 0.01),
              reason: 'centred in a 48 dp slot above the card padding');
          // Image well first, and it is square: the card width minus its padding.
          final image = tester.getRect(blocks.first);
          expect(image.width, ProductCard.imageSideFor(width));
          expect(image.height, greaterThan(0));
        });
      }
    }
  });

  // T2: a skeleton whose silhouette differs from the card's makes the tile
  // visibly re-draw the moment data lands. The geometry group above pins the
  // BOX; this pins the SURFACE it is drawn on. T3 must move both together
  // when it restyles ProductCard.
  group('ProductCardSkeleton wears the card surface, not the generic card', () {
    BoxDecoration decorationOf(WidgetTester tester, Finder of) => tester
        .widget<Container>(find.descendant(of: of, matching: find.byType(Container)).first)
        .decoration! as BoxDecoration;

    testWidgets('same fill, same radius, same elevation, and no stroke the card does not have',
        (tester) async {
      await tester.pumpWidget(_app(
        tester,
        cart: CartProvider(),
        width: 900,
        textScale: 1,
        home: Scaffold(
          body: Builder(
            builder: (context) => Column(
              children: [
                SizedBox(
                  width: 160,
                  height: ProductCard.heightFor(context, 160),
                  child: const ProductCardSkeleton(),
                ),
                SizedBox(
                  width: 160,
                  height: ProductCard.heightFor(context, 160),
                  child: ProductCard(product: _p(1)),
                ),
              ],
            ),
          ),
        ),
      ));
      final skeleton = decorationOf(tester, find.byType(ProductCardSkeleton));
      final card = decorationOf(tester, find.byType(ProductCard));

      expect(skeleton.color, card.color);
      expect(skeleton.borderRadius, card.borderRadius);
      expect(skeleton.boxShadow, card.boxShadow);
      expect(skeleton.border, isNull, reason: 'the real card has no stroke');
      expect(card.border, isNull);
    });

    // Review M-3: these two used to be pinned against BlynkRadius.chip/.pill
    // directly, so a T3 card restyle could move the card's radii and leave the
    // skeleton behind without failing anything. They are now read off the
    // card that is rendered beside the skeleton, exactly like the surface test
    // above — the assertion is "the skeleton matches the card", not "both
    // happen to equal a constant I typed twice".
    testWidgets('the image and control blocks carry the radii the CARD renders', (tester) async {
      await tester.pumpWidget(_app(
        tester,
        cart: CartProvider(),
        width: 900,
        textScale: 1,
        home: Scaffold(
          body: Builder(
            builder: (context) => Column(
              children: [
                SizedBox(
                  width: 160,
                  height: ProductCard.heightFor(context, 160),
                  child: const ProductCardSkeleton(),
                ),
                SizedBox(
                  width: 160,
                  height: ProductCard.heightFor(context, 160),
                  child: ProductCard(product: _p(1)),
                ),
              ],
            ),
          ),
        ),
      ));

      // What the card really draws: the image well is the first ClipRRect
      // inside it, the add control the DecoratedBox inside AddToCartButton.
      final cardImageRadius = tester
          .widget<ClipRRect>(
            find.descendant(of: find.byType(ProductCard), matching: find.byType(ClipRRect)).first,
          )
          .borderRadius;
      final cardAddRadius = (tester
              .widget<DecoratedBox>(
                find
                    .descendant(
                      of: find.byType(AddToCartButton),
                      matching: find.byType(DecoratedBox),
                    )
                    .first,
              )
              .decoration as BoxDecoration)
          .borderRadius;

      final blocks = find.descendant(
        of: find.byType(ProductCardSkeleton),
        matching: find.byType(AppSkeleton),
      );
      final skeletonImage = tester.widget<AppSkeleton>(blocks.first).radius;
      final skeletonControl = tester.widget<AppSkeleton>(blocks.last).radius;

      expect(BorderRadius.circular(skeletonImage), cardImageRadius,
          reason: 'the placeholder image well must not pop when the photo lands');
      expect(BorderRadius.circular(skeletonControl), cardAddRadius,
          reason: 'the placeholder control must not pop when the ADD button lands');
      // Both are still token values, not stray numbers.
      expect(skeletonImage, BlynkRadius.chip);
      expect(skeletonControl, BlynkRadius.pill);
    });
  });

  group('products grid (buildProductsGrid)', () {
    for (final width in [320.0, 360.0, 412.0, 800.0]) {
      for (final scale in kTextScales) {
        testWidgets('${width.toInt()} dp at ${scale}x: no overflow, every card fits its tile', (tester) async {
          final cart = CartProvider()
            ..add(_p(1))
            ..add(_p(2));
          await tester.pumpWidget(_app(
            tester,
            cart: cart,
            width: width,
            textScale: scale,
            home: Scaffold(body: Builder(builder: (context) => buildProductsGrid(context, _products()))),
          ));
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          final cards = find.byType(ProductCard);
          expect(cards, findsWidgets);
          final expected = ProductCard.heightFor(
            tester.element(cards.first),
            tester.getSize(cards.first).width,
          );
          expect(tester.getSize(cards.first).height, closeTo(expected, 0.01));
          expect(tester.getSize(find.byType(AddToCartButton).first).height, 48);
        });
      }
    }
  });

  group('home rail (CatgorywithProducts)', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in kTextScales) {
        testWidgets('${width.toInt()} dp at ${scale}x: no overflow, rail is exactly one card tall', (tester) async {
          final products = ProductProvider(request: _catalog);
          await tester.pumpWidget(_app(
            tester,
            cart: CartProvider()..add(_p(1)),
            products: products,
            width: width,
            textScale: scale,
            home: const Scaffold(
              body: SingleChildScrollView(child: CatgorywithProducts(title: 'Dairy', categorySlug: 'dairy')),
            ),
          ));
          await tester.pump();
          await tester.pump();
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          expect(find.byType(ProductCard), findsWidgets);
          final context = tester.element(find.byType(ProductCard).first);
          expect(
            tester.getSize(find.byType(ProductCard).first).height,
            closeTo(ProductCard.heightFor(context, 152), 0.01),
          );
          expect(tester.getSize(find.byType(AddToCartButton).first).height, 48);
        });
      }
    }
  });

  group('search grid', () {
    for (final width in [320.0, 360.0, 412.0]) {
      for (final scale in kTextScales) {
        testWidgets('${width.toInt()} dp at ${scale}x: results do not overflow', (tester) async {
          final products = ProductProvider(request: (url, query) async {
            if (url == '/catalog/categories') {
              return {
                'success': true,
                'data': {'categories': <dynamic>[]},
              };
            }
            return _productsResponse();
          });
          await tester.pumpWidget(_app(
            tester,
            cart: CartProvider()..add(_p(2)),
            products: products,
            width: width,
            textScale: scale,
            home: const SearchScreen(),
          ));
          await tester.pump();
          await tester.enterText(find.byType(TextField), 'milk');
          await tester.pump(const Duration(milliseconds: 400));
          await tester.pump();
          await tester.pump();
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          expect(find.byType(ProductCard), findsWidgets);
          expect(tester.getSize(find.byType(AddToCartButton).first).height, 48);
        });
      }
    }
  });
}
