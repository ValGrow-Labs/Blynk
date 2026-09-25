import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/image_focal.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Models/promotion_model.dart';
import 'package:ecom/UI/Widgets/Atoms/image_well.dart';

import 'fixtures/component_host.dart';

/// Image focal point (backend migration 009).
///
/// Every tile and card in this app draws its picture with [BoxFit.cover]:
/// the image fills the box and whatever does not fit is cropped. That crop
/// was anchored at the centre unconditionally, so a banner whose wording runs
/// along the top lost the wording and an off-centre product lost the product.
/// The operator now picks the point that must survive, in Blynk Ops.
///
/// The load-bearing assertion in this file is the LAST group: the 50/50
/// default maps to exactly [Alignment.center], which is what `cover` already
/// used — so every image already uploaded renders identically to before.

ProductModel _product({int? x, int? y}) => ProductModel(
      id: 'p1',
      categoryId: 'c1',
      categoryName: 'Bakery',
      name: 'Seeded Loaf',
      slug: 'seeded-loaf',
      sku: 'SKU-1',
      unit: '1 pc',
      imageUrl: 'https://images.blynk.test/loaf.png',
      imageFocalX: x ?? kFocalCentrePercent,
      imageFocalY: y ?? kFocalCentrePercent,
      sellingPrice: 320,
      isAvailable: true,
    );

/// The `Image` the well builds for a real photo.
Image _imageOf(WidgetTester tester) => tester.widget<Image>(find.byType(Image));

void main() {
  group('percentage parsing defaults to the centre', () {
    test('a whole percentage is taken as given, including both extremes', () {
      expect(parseFocalPercent(0), 0);
      expect(parseFocalPercent(37), 37);
      expect(parseFocalPercent(100), 100);
      // JSON numbers arrive as num; a string is accepted too.
      expect(parseFocalPercent(12.0), 12);
      expect(parseFocalPercent('64'), 64);
    });

    test('absent, null, unparseable or out of range all mean 50', () {
      // This is the compatibility contract: an API response from a backend
      // that predates migration 009 carries no such field, and the app must
      // carry on cropping from the centre exactly as that pairing always did.
      expect(parseFocalPercent(null), 50);
      expect(parseFocalPercent('top'), 50);
      expect(parseFocalPercent(''), 50);
      expect(parseFocalPercent(-1), 50);
      expect(parseFocalPercent(101), 50);
    });
  });

  group('0-100 maps onto Flutter alignment space', () {
    test('50/50 is exactly Alignment.center', () {
      expect(focalAlignment(50, 50), Alignment.center);
    });

    test('the edges and the quarters land where they should', () {
      expect(focalAlignment(0, 0), const Alignment(-1, -1));
      expect(focalAlignment(100, 100), const Alignment(1, 1));
      expect(focalAlignment(25, 75), const Alignment(-0.5, 0.5));
      // The case the feature exists for: keep the top of the banner.
      expect(focalAlignment(50, 10), const Alignment(0, -0.8));
    });

    test('a value outside the range is clamped, never pushed past the edge', () {
      expect(focalAlignment(-40, 400), const Alignment(-1, 1));
    });
  });

  group('the model layer parses it, and survives an older API', () {
    test('ProductModel reads the stored point', () {
      final product = ProductModel.fromJson(const {
        'id': 'p1',
        'name': 'Seeded Loaf',
        'image_url': 'https://images.blynk.test/loaf.png',
        'image_focal_x': 35,
        'image_focal_y': 12,
        'selling_price': 320,
        'is_available': true,
      });

      expect(product.imageFocalX, 35);
      expect(product.imageFocalY, 12);
      expect(product.imageAlignment, const Alignment(-0.3, -0.76));
    });

    test('ProductModel defaults to 50 when the fields are absent', () {
      final product = ProductModel.fromJson(const {
        'id': 'p1',
        'name': 'Seeded Loaf',
        'selling_price': 320,
        'is_available': true,
      });

      expect(product.imageFocalX, 50);
      expect(product.imageFocalY, 50);
      expect(product.imageAlignment, Alignment.center);
    });

    test('PromotionModel reads the stored point, for IMAGE and ARTWORK alike', () {
      for (final type in const ['IMAGE', 'ARTWORK']) {
        final promotion = PromotionModel.fromJson(<String, dynamic>{
          'id': 'pr1',
          'title': 'Super Market',
          'background_type': type,
          'background_image_url': 'https://images.blynk.test/banner.png',
          'background_focal_x': 50,
          'background_focal_y': 8,
        });

        expect(promotion.backgroundFocalY, 8, reason: type);
        expect(promotion.backgroundAlignment, const Alignment(0, -0.84), reason: type);
      }
    });

    test('PromotionModel defaults to 50 when the fields are absent', () {
      final promotion = PromotionModel.fromJson(const {
        'id': 'pr1',
        'title': 'Weekend Market',
        'background_type': 'IMAGE',
        'background_image_url': 'https://images.blynk.test/banner.png',
      });

      expect(promotion.backgroundFocalX, 50);
      expect(promotion.backgroundFocalY, 50);
      expect(promotion.backgroundAlignment, Alignment.center);
    });

    test('a garbage value never crashes a promotion - it falls back to the centre', () {
      final promotion = PromotionModel.fromJson(const {
        'id': 'pr1',
        'title': 'From a newer backend',
        'background_focal_x': 'left',
        'background_focal_y': 999,
      });

      expect(promotion.backgroundAlignment, Alignment.center);
    });
  });

  group('the well crops from the operator point', () {
    testWidgets('ProductImageWell hands the focal point to BoxFit.cover',
        (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        SizedBox(
          width: 160,
          height: 160,
          child: ProductImageWell(product: _product(x: 25, y: 10)),
        ),
      ));

      final image = _imageOf(tester);
      expect(image.fit, BoxFit.cover);
      expect(image.alignment, const Alignment(-0.5, -0.8));
    });

    testWidgets('BlynkImageWell takes an explicit alignment', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SizedBox(
          width: 160,
          height: 160,
          child: BlynkImageWell(
            imageUrl: 'https://images.blynk.test/loaf.png',
            alignment: Alignment(1, -1),
          ),
        ),
      ));

      expect(_imageOf(tester).alignment, const Alignment(1, -1));
    });
  });

  group('PURELY ADDITIVE - a 50/50 image renders exactly as it did', () {
    testWidgets('an untouched product is byte-for-byte the centre crop',
        (tester) async {
      // The guarantee the whole feature rests on: 50/50 is not "close to"
      // the old behaviour, it IS the old behaviour. Both the fit and the
      // alignment must be what the widget passed before focal points existed.
      await tester.pumpWidget(componentHost(
        tester,
        SizedBox(width: 160, height: 160, child: ProductImageWell(product: _product())),
      ));

      final image = _imageOf(tester);
      expect(image.fit, BoxFit.cover);
      expect(image.alignment, Alignment.center);
    });

    testWidgets('so is a well given no alignment at all', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        const SizedBox(
          width: 160,
          height: 160,
          child: BlynkImageWell(imageUrl: 'https://images.blynk.test/loaf.png'),
        ),
      ));

      expect(_imageOf(tester).alignment, Alignment.center);
    });

    testWidgets('the no-image fallback is untouched by any of this',
        (tester) async {
      // A product with no photo has nothing to crop; the focal point must not
      // leak into the branded fallback's geometry.
      final without = ProductModel.fromJson(const {
        'id': 'p1',
        'category_name': 'Bakery',
        'name': 'Seeded Loaf',
        'selling_price': 320,
        'is_available': true,
        'image_focal_x': 0,
        'image_focal_y': 0,
      });

      await tester.pumpWidget(componentHost(
        tester,
        SizedBox(width: 160, height: 160, child: ProductImageWell(product: without)),
      ));

      expect(find.byType(Image), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
