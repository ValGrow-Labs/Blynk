import 'dart:convert';
import 'dart:ui' show PointerDeviceKind, SemanticsAction;

import 'package:flutter/gestures.dart' show kPrimaryButton;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show SemanticsNode;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/cart.provider.dart';
import 'package:ecom/Services/Providers/product.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Organisms/home_screen_carousel.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

/// Captured from the running backend (GET /api/v1/promotions) after
/// creating promotions in the Blynk Ops app. The endpoint returns active
/// promotions only, already in display order.
const _twoPromotions = '''
{"success":true,"data":{"promotions":[
 {"id":"p1","title":"Everyday Essentials","subtitle":"Milk, eggs and daily staples","image_url":"http://localhost:4000/uploads/promotions/a.png","background_type":"SOLID","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":"Explore","cta_destination_type":"CATEGORY","cta_destination_value":"dairy-eggs","display_order":1},
 {"id":"p2","title":"Snack Time","subtitle":"Biscuits and tea-time picks","image_url":null,"background_type":"GRADIENT","background_color":"#0C831F","background_color_end":"#5FBF6E","background_image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":2}
]}}''';

const _reordered = '''
{"success":true,"data":{"promotions":[
 {"id":"p2","title":"Snack Time","subtitle":"Biscuits and tea-time picks","image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1},
 {"id":"p1","title":"Everyday Essentials","subtitle":"Milk, eggs and daily staples","image_url":"http://localhost:4000/uploads/promotions/a.png","background_type":"SOLID","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":"Explore","cta_destination_type":"CATEGORY","cta_destination_value":"dairy-eggs","display_order":2}
]}}''';

const _catalogPromotion = '''
{"success":true,"data":{"promotions":[
 {"id":"p3","title":"Shop the whole store","subtitle":null,"image_url":null,"cta_label":"Browse all","cta_destination_type":"CATALOG","cta_destination_value":null,"display_order":1}
]}}''';


const _imageBackground = '''
{"success":true,"data":{"promotions":[
 {"id":"p4","title":"Weekend Market","subtitle":"Straight from the market","image_url":null,"background_type":"IMAGE","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/bg.png","cta_label":"Shop now","cta_destination_type":"CATALOG","cta_destination_value":null,"display_order":1}
]}}''';

/// ARTWORK: a finished banner the operator uploaded as-is. Same storage as
/// IMAGE (`background_image_url`); the app draws no scrim, headline or
/// subtitle over it. `title` and `subtitle` are still sent - `title` is the
/// slide's accessibility label.
const _artworkBackground = '''
{"success":true,"data":{"promotions":[
 {"id":"p6","title":"Avurudu Festival Sale","subtitle":"Baked into the banner","image_url":null,"background_type":"ARTWORK","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/avurudu-banner.png","cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1}
]}}''';

/// The same banner, with a destination but no button label: the whole card
/// becomes the tap target.
const _artworkTappableCard = '''
{"success":true,"data":{"promotions":[
 {"id":"p7","title":"Avurudu Festival Sale","subtitle":null,"image_url":null,"background_type":"ARTWORK","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/avurudu-banner.png","cta_label":null,"cta_destination_type":"CATEGORY","cta_destination_value":"sweets","display_order":1}
]}}''';

/// An artwork banner that still wants the app's own button.
const _artworkWithCta = '''
{"success":true,"data":{"promotions":[
 {"id":"p8","title":"Avurudu Festival Sale","subtitle":null,"image_url":null,"background_type":"ARTWORK","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/avurudu-banner.png","cta_label":"Shop now","cta_destination_type":"CATALOG","cta_destination_value":null,"display_order":1}
]}}''';

/// A background_type this build has never heard of. The backend can gain one
/// at any time; a promotion is not worth a crash.
const _unknownBackgroundType = '''
{"success":true,"data":{"promotions":[
 {"id":"p9","title":"From a newer backend","subtitle":"Still readable","image_url":null,"background_type":"HOLOGRAM","background_color":"#FFE141","background_color_end":null,"background_image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1}
]}}''';

/// Migration 009: the same banner with a focal point near the TOP - the case
/// the feature exists for, where the artwork's wording runs along the top
/// edge and a centre crop would cut it off.
const _artworkTopFocal = '''
{"success":true,"data":{"promotions":[
 {"id":"p10","title":"Super Market","subtitle":null,"image_url":null,"background_type":"ARTWORK","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/supermarket.png","background_focal_x":50,"background_focal_y":8,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1}
]}}''';

/// An IMAGE background (scrim, headline and all) with its own focal point.
const _imageBottomFocal = '''
{"success":true,"data":{"promotions":[
 {"id":"p11","title":"Weekend Market","subtitle":"Straight from the market","image_url":null,"background_type":"IMAGE","background_color":null,"background_color_end":null,"background_image_url":"http://localhost:4000/uploads/promotions/bg.png","background_focal_x":80,"background_focal_y":100,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1}
]}}''';

const _brokenBackground = '''
{"success":true,"data":{"promotions":[
 {"id":"p5","title":"Broken colours","subtitle":null,"image_url":null,"background_type":"SOLID","background_color":"not-a-colour","background_color_end":null,"background_image_url":null,"cta_label":null,"cta_destination_type":null,"cta_destination_value":null,"display_order":1}
]}}''';

const _noPromotions = '{"success":true,"data":{"promotions":[]}}';

class _FakeApi {
  String promotionsJson = _twoPromotions;
  bool failPromotions = false;
  int promotionCalls = 0;

  Future<dynamic> call(String url, Map<String, dynamic> query) async {
    if (url == '/promotions') {
      promotionCalls++;
      if (failPromotions) throw ApiException(503, 'promotions unavailable');
      return jsonDecode(promotionsJson);
    }
    return jsonDecode('{"success":true,"data":{}}');
  }
}

void main() {
  late _FakeApi api;
  late ProductProvider products;
  RouteSettings? lastRoute;

  Future<void> pumpCarousel(
    WidgetTester tester, {
    Size size = const Size(430, 900),
    bool disableAnimations = false,
  }) async {
    lastRoute = null;
    products = ProductProvider(request: api.call);

    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: products),
          ChangeNotifierProvider(create: (_) => CartProvider()),
        ],
        child: MaterialApp(
          theme: AppTheme.appTHeme,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(disableAnimations: disableAnimations),
            child: child!,
          ),
          home: const Scaffold(
            body: CustomScrollView(slivers: [HomeScreenCarousel()]),
          ),
          onGenerateRoute: (settings) {
            lastRoute = settings;
            return MaterialPageRoute(
              builder: (_) => Scaffold(body: Text('route:${settings.name}')),
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  setUp(() => api = _FakeApi());

  group('backend-driven content', () {
    testWidgets('renders the promotions the API returned', (tester) async {
      await pumpCarousel(tester);

      expect(api.promotionCalls, 1);
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.text('Milk, eggs and daily staples'), findsOneWidget);
      expect(find.text('Explore'), findsOneWidget);
      expect(find.byType(PageView), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
    });

    testWidgets('carries no campaign content of its own', (tester) async {
      api.promotionsJson = _noPromotions;
      await pumpCarousel(tester);

      // The old hardcoded campaigns must not survive anywhere.
      for (final old in [
        'Everyday Essentials',
        'Fresh Picks',
        'Daily Grocery Run',
        'Shop Fresh',
      ]) {
        expect(find.textContaining(old), findsNothing, reason: old);
      }
    });

    testWidgets('shows promotions in the order the API returned them',
        (tester) async {
      await pumpCarousel(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);

      // Admin reorders; the customer app reflects the new order on refresh.
      api.promotionsJson = _reordered;
      await products.loadPromotions(force: true);
      await settle(tester);

      expect(products.promotions.first.title, 'Snack Time');
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('a promotion without a foreground image still composes',
        (tester) async {
      await pumpCarousel(tester);

      // Page two of the fixture has no foreground image and no CTA: the
      // background carries the card rather than an empty placeholder box.
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.text('Biscuits and tea-time picks'), findsOneWidget);
      expect(products.promotions[1].hasGradient, isTrue);
      expect(tester.takeException(), isNull);
    });
  });


  group('admin-controlled background', () {
    testWidgets('renders a solid background from the API', (tester) async {
      await pumpCarousel(tester);

      final promotion = products.promotions.first;
      expect(promotion.backgroundType, 'SOLID');
      expect(promotion.backgroundStart, const Color(0xFFFFE141));
      // The card paints that colour, not a palette the app chose.
      expect(
        find.byWidgetPredicate(
          (w) => w is ColoredBox && w.color == const Color(0xFFFFE141),
        ),
        findsWidgets,
      );
    });

    // 2026-09 premium redesign (W2): the app renders no gradient anywhere, so
    // a GRADIENT promotion paints its stored `background_color` FLAT and its
    // `background_color_end` is not drawn. The colour on screen is still
    // exactly the operator's; nothing is invented to replace the second stop.
    testWidgets('a GRADIENT promotion paints its stored colour flat, with no gradient',
        (tester) async {
      await pumpCarousel(tester);
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      final gradient = products.promotions[1];
      expect(gradient.hasGradient, isTrue);
      expect(gradient.backgroundStart, const Color(0xFF0C831F));
      expect(
        find.byWidgetPredicate(
          (w) => w is ColoredBox && w.color == const Color(0xFF0C831F),
        ),
        findsWidgets,
      );
      // The second stop reaches no painted surface...
      expect(
        find.byWidgetPredicate(
          (w) => w is ColoredBox && w.color == const Color(0xFF5FBF6E),
        ),
        findsNothing,
      );
      // ...and the carousel constructs no gradient at all.
      expect(
        find.byWidgetPredicate((w) =>
            w is DecoratedBox &&
            w.decoration is BoxDecoration &&
            (w.decoration as BoxDecoration).gradient != null),
        findsNothing,
      );
    });

    testWidgets('renders an image background under one flat ink scrim',
        (tester) async {
      api.promotionsJson = _imageBackground;
      await pumpCarousel(tester);

      expect(products.promotions.single.hasBackgroundImage, isTrue);
      expect(find.byType(Image), findsWidgets);
      expect(find.text('Weekend Market'), findsOneWidget);
      // The scrim is one flat wash, not a gradient, and it is dark enough for
      // `paper` headline text over any photograph (worst case: a white one).
      final scrim = tester.widgetList<ColoredBox>(find.byType(ColoredBox)).firstWhere(
            (b) => b.color.a > 0 && b.color.a < 1,
          );
      final composited = Color.alphaBlend(scrim.color, BlynkColors.paper);
      expect(contrastRatio(BlynkColors.paper, composited),
          greaterThanOrEqualTo(4.5));
      expect(tester.takeException(), isNull);
    });

    // ------------------------------------------------------------------
    // ARTWORK: a finished banner, drawn full-bleed. The operator's file
    // already carries its own artwork and wording, so the app adds none of
    // its own - and nothing about IMAGE, SOLID or GRADIENT changes.
    // ------------------------------------------------------------------
    testWidgets('an ARTWORK promotion fills the card with no scrim',
        (tester) async {
      api.promotionsJson = _artworkBackground;
      await pumpCarousel(tester);

      final promotion = products.promotions.single;
      expect(promotion.hasArtwork, isTrue);
      // It is NOT an IMAGE background: the scrim branch must not claim it.
      expect(promotion.hasBackgroundImage, isFalse);
      expect(find.byType(Image), findsWidgets);

      // No translucent wash of any kind over the banner.
      final scrims = tester
          .widgetList<ColoredBox>(find.byType(ColoredBox))
          .where((b) => b.color.a > 0 && b.color.a < 1);
      expect(scrims, isEmpty, reason: 'ARTWORK is drawn exactly as uploaded');
      expect(tester.takeException(), isNull);
    });


    // ------------------------------------------------------------------
    // Focal point (migration 009). The card crops its background with
    // `cover`; the operator picks which point survives that crop.
    // ------------------------------------------------------------------
    testWidgets('an ARTWORK banner crops from the operator focal point',
        (tester) async {
      api.promotionsJson = _artworkTopFocal;
      await pumpCarousel(tester);

      final promotion = products.promotions.single;
      expect(promotion.backgroundFocalX, 50);
      expect(promotion.backgroundFocalY, 8);

      // The card-filling image is the one drawn with `cover`; the foreground
      // visual (absent here) is the only other Image a slide can carry.
      final background = tester
          .widgetList<Image>(find.byType(Image))
          .firstWhere((image) => image.fit == BoxFit.cover);
      expect(background.alignment, const Alignment(0, -0.84));
      expect(tester.takeException(), isNull);
    });

    testWidgets('an IMAGE background honours it too, scrim and all',
        (tester) async {
      api.promotionsJson = _imageBottomFocal;
      await pumpCarousel(tester);

      final background = tester
          .widgetList<Image>(find.byType(Image))
          .firstWhere((image) => image.fit == BoxFit.cover);
      expect(background.alignment, const Alignment(0.6, 1));
      // The headline and its flat ink scrim are untouched by the crop anchor.
      expect(find.text('Weekend Market'), findsOneWidget);
      expect(
        tester
            .widgetList<ColoredBox>(find.byType(ColoredBox))
            .where((b) => b.color.a > 0 && b.color.a < 1),
        isNotEmpty,
      );
    });

    testWidgets(
        'a promotion the backend sent WITHOUT a focal point still crops from the centre',
        (tester) async {
      // The additive guarantee. `_imageBackground` is the fixture captured
      // before migration 009 existed: it carries no focal field at all, and
      // the card must render exactly as it always has.
      api.promotionsJson = _imageBackground;
      await pumpCarousel(tester);

      expect(products.promotions.single.backgroundFocalX, 50);
      expect(products.promotions.single.backgroundFocalY, 50);

      final background = tester
          .widgetList<Image>(find.byType(Image))
          .firstWhere((image) => image.fit == BoxFit.cover);
      expect(background.alignment, Alignment.center);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an ARTWORK promotion draws neither headline nor subtitle',
        (tester) async {
      api.promotionsJson = _artworkBackground;
      await pumpCarousel(tester);

      // The words are in the operator's picture; painting them again would
      // collide with the baked-in text.
      expect(find.text('Avurudu Festival Sale'), findsNothing);
      expect(find.text('Baked into the banner'), findsNothing);
    });

    testWidgets('an ARTWORK slide keeps the same card radius as every other type',
        (tester) async {
      api.promotionsJson = _artworkBackground;
      await pumpCarousel(tester);
      final artworkClip = tester
          .widget<ClipRRect>(find.descendant(
            of: find.byType(HomeScreenCarousel),
            matching: find.byType(ClipRRect),
          ).first)
          .borderRadius;
      final artworkSize = tester.getSize(find.byType(PageView));
      final artworkCard = tester.getSize(find.descendant(
        of: find.byType(HomeScreenCarousel),
        matching: find.byType(ClipRRect),
      ).first);

      // Tear the tree down so the carousel's State (and its one-shot
      // promotions load) really runs again for the second fixture.
      await tester.pumpWidget(const SizedBox.shrink());

      api.promotionsJson = _imageBackground;
      await pumpCarousel(tester);
      final imageClip = tester
          .widget<ClipRRect>(find.descendant(
            of: find.byType(HomeScreenCarousel),
            matching: find.byType(ClipRRect),
          ).first)
          .borderRadius;

      expect(artworkClip, imageClip);
      // The carousel must not resize or reshape as the reader swipes between
      // slide types.
      expect(artworkSize, tester.getSize(find.byType(PageView)));
      expect(
        artworkCard,
        tester.getSize(find.descendant(
          of: find.byType(HomeScreenCarousel),
          matching: find.byType(ClipRRect),
        ).first),
      );
    });

    testWidgets('an unrecognised background_type degrades instead of throwing',
        (tester) async {
      api.promotionsJson = _unknownBackgroundType;
      await pumpCarousel(tester);

      // Nothing matches, so the slide behaves like a SOLID one: the stored
      // colour flat, with the headline and subtitle still drawn.
      final promotion = products.promotions.single;
      expect(promotion.backgroundType, 'HOLOGRAM');
      expect(promotion.hasArtwork, isFalse);
      expect(promotion.hasBackgroundImage, isFalse);
      expect(promotion.hasGradient, isFalse);
      expect(find.text('From a newer backend'), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (w) => w is ColoredBox && w.color == const Color(0xFFFFE141),
        ),
        findsWidgets,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unparseable colour falls back to the neutral surface',
        (tester) async {
      api.promotionsJson = _brokenBackground;
      await pumpCarousel(tester);

      expect(products.promotions.single.backgroundStart, isNull);
      expect(find.text('Broken colours'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('carries no palette of its own', (tester) async {
      // Two promotions, both SOLID with the same colour: if the widget were
      // still rotating its own palette they would differ.
      api.promotionsJson = _twoPromotions.replaceAll(
        '"background_type":"GRADIENT","background_color":"#0C831F","background_color_end":"#5FBF6E"',
        '"background_type":"SOLID","background_color":"#FFE141","background_color_end":null',
      );
      await pumpCarousel(tester);

      expect(
        products.promotions.every((p) => p.backgroundColor == '#FFE141'),
        isTrue,
      );
    });
  });

  group('graceful states', () {
    testWidgets('no active promotions hides the carousel entirely',
        (tester) async {
      api.promotionsJson = _noPromotions;
      await pumpCarousel(tester);

      expect(find.byType(PageView), findsNothing);
      expect(tester.takeException(), isNull);
      expect(products.promotionsLoaded, isTrue);
    });

    testWidgets('a failed promotions call hides it without crashing Home',
        (tester) async {
      api.failPromotions = true;
      await pumpCarousel(tester);

      expect(find.byType(PageView), findsNothing);
      expect(tester.takeException(), isNull);
      expect(products.promotions, isEmpty);
    });

    testWidgets('a single promotion shows no pagination track',
        (tester) async {
      api.promotionsJson = _catalogPromotion;
      await pumpCarousel(tester);

      expect(find.text('Shop the whole store'), findsOneWidget);
      // The pagination track only appears with more than one promotion.
      expect(find.bySemanticsLabel(RegExp(r'Promotion \d+ of')), findsNothing);
    });
  });

  group('behaviour', () {
    // 2026-09-24: the carousel now DOES advance on its own — the product owner
    // asked for it. The WCAG 2.2.2 obligation does not disappear with that
    // decision, it moves: moving content must be pausable. So these assert the
    // guards rather than the absence of motion.
    testWidgets('advances by itself after the dwell', (tester) async {
      await pumpCarousel(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);

      await tester.pump(const Duration(seconds: 7));
      await tester.pumpAndSettle();

      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 2 of 2'), findsOneWidget);
    });

    testWidgets('a touch stops it for good (WCAG 2.2.2: pausable)',
        (tester) async {
      await pumpCarousel(tester);

      // The shopper reaches for the slide.
      await tester.startGesture(tester.getCenter(find.byType(PageView)));
      await tester.pump();

      // Well past several dwell periods: it must not move under them, and it
      // must not quietly resume a few seconds later either.
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(seconds: 10));
      }
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
    });

    testWidgets('reduced motion switches auto-advance off entirely',
        (tester) async {
      await pumpCarousel(tester, disableAnimations: true);
      expect(find.text('Everyday Essentials'), findsOneWidget);

      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(seconds: 10));
      }
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.text('Snack Time'), findsNothing);
    });

    testWidgets('swipe moves to the next promotion', (tester) async {
      await pumpCarousel(tester);

      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('CTA opens the destination the admin chose', (tester) async {
      await pumpCarousel(tester);

      await tester.tap(find.text('Explore'));
      await settle(tester);

      expect(lastRoute?.name, '/products');
      expect(lastRoute?.arguments, 'dairy-eggs');
    });

    testWidgets('a CATALOG promotion opens the full catalog', (tester) async {
      api.promotionsJson = _catalogPromotion;
      await pumpCarousel(tester);

      await tester.tap(find.text('Browse all'));
      await settle(tester);

      expect(lastRoute?.name, '/products');
      expect(lastRoute?.arguments, '');
    });

    testWidgets('an informational promotion has no button', (tester) async {
      await pumpCarousel(tester);
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.byType(BlynkButton), findsNothing);
    });
  });

  // An ARTWORK slide has no on-screen words at all: the campaign's headline
  // lives inside the uploaded picture. Without a semantic label a screen
  // reader would announce nothing where every other slide reads out its
  // headline, so the backend keeps `title` required purely to be spoken here.
  group('ARTWORK slide: accessibility and tap behaviour', () {
    testWidgets('exposes the promotion title as its semantic label',
        (tester) async {
      final handle = tester.ensureSemantics();
      api.promotionsJson = _artworkBackground;
      await pumpCarousel(tester);

      // Not drawn as text anywhere...
      expect(find.text('Avurudu Festival Sale'), findsNothing);
      // ...but announced.
      expect(find.bySemanticsLabel('Avurudu Festival Sale'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a labelled CTA is still drawn, reachable and 48 dp',
        (tester) async {
      final handle = tester.ensureSemantics();
      api.promotionsJson = _artworkWithCta;
      await pumpCarousel(tester);

      // An artwork banner may still want the app's real button.
      final cta = find.widgetWithText(BlynkButton, 'Shop now');
      expect(cta, findsOneWidget);
      expect(tester.getSize(cta).height, greaterThanOrEqualTo(48));
      expect(find.bySemanticsLabel('Avurudu Festival Sale'), findsOneWidget);

      await tester.tap(find.text('Shop now'));
      await settle(tester);
      expect(lastRoute?.name, '/products');
      expect(lastRoute?.arguments, '');
      handle.dispose();
    });

    testWidgets('with no button label the whole card opens the destination',
        (tester) async {
      final handle = tester.ensureSemantics();
      api.promotionsJson = _artworkTappableCard;
      await pumpCarousel(tester);

      expect(products.promotions.single.isTappableCard, isTrue);
      expect(find.byType(BlynkButton), findsNothing);

      final node = tester
          .getSemantics(find.bySemanticsLabel('Avurudu Festival Sale'))
          .getSemanticsData();
      expect(node.flagsCollection.isButton, isTrue);
      expect(node.hasAction(SemanticsAction.tap), isTrue);

      // Same destination behaviour as every other slide type.
      await tester.tap(find.byType(PageView));
      await settle(tester);
      expect(lastRoute?.name, '/products');
      expect(lastRoute?.arguments, 'sweets');
      handle.dispose();
    });

    testWidgets('a decorative ARTWORK slide is not announced as a control',
        (tester) async {
      final handle = tester.ensureSemantics();
      api.promotionsJson = _artworkBackground;
      await pumpCarousel(tester);

      final node = tester
          .getSemantics(find.bySemanticsLabel('Avurudu Festival Sale'))
          .getSemanticsData();
      expect(node.flagsCollection.isButton, isFalse);
      expect(node.hasAction(SemanticsAction.tap), isFalse);

      await tester.tap(find.byType(PageView));
      await settle(tester);
      expect(lastRoute, isNull, reason: 'nothing to open');
      handle.dispose();
    });

    testWidgets('the card meets the tap-target guideline at every phone width',
        (tester) async {
      for (final size in const [Size(320, 640), Size(414, 896)]) {
        final handle = tester.ensureSemantics();
        api.promotionsJson = _artworkWithCta;
        await pumpCarousel(tester, size: size);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        expect(tester.takeException(), isNull);
        handle.dispose();
      }
    });

    testWidgets('no clipping at 1.3x and 2.0x text scale', (tester) async {
      for (final scale in const [1.3, 2.0]) {
        api.promotionsJson = _artworkWithCta;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await pumpCarousel(tester, size: const Size(320, 640));
        expect(tester.takeException(), isNull, reason: '${scale}x');
      }
    });
  });

  group('manual pager (no auto-advance, no tappable dots)', () {
    Finder indicator() => find.byKey(const ValueKey('promo-pager'));

    testWidgets('the pager is one labelled node and its pills are not controls',
        (tester) async {
      final handle = tester.ensureSemantics();
      await pumpCarousel(tester);

      expect(find.bySemanticsLabel(RegExp(r'Promotion \d+ of')), findsOneWidget);
      expect(indicator(), findsOneWidget);
      for (final control in [GestureDetector, InkWell, InkResponse]) {
        expect(
          find.descendant(of: indicator(), matching: find.byType(control)),
          findsNothing,
          reason: '$control inside the pager',
        );
      }
      handle.dispose();
    });

    testWidgets('tapping a pill does nothing; swiping still moves and relabels',
        (tester) async {
      final handle = tester.ensureSemantics();
      await pumpCarousel(tester);

      final track = tester.getRect(find.descendant(
        of: indicator(),
        matching: find.byType(Row),
      ));
      // The second (inactive) pill sits at the right end of the track.
      await tester.tapAt(Offset(track.right - 6, track.center.dy));
      await settle(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);

      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);
      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 2 of 2'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('reduced motion: the entrance and pill animations have zero duration',
        (tester) async {
      await pumpCarousel(tester, disableAnimations: true);

      for (final slide in tester.widgetList<AnimatedSlide>(find.byType(AnimatedSlide))) {
        expect(slide.duration, Duration.zero);
      }
      for (final scale in tester.widgetList<AnimatedScale>(find.byType(AnimatedScale))) {
        expect(scale.duration, Duration.zero);
      }
      final pills = tester.widgetList<AnimatedContainer>(find.descendant(
        of: indicator(),
        matching: find.byType(AnimatedContainer),
      ));
      expect(pills, isNotEmpty);
      for (final pill in pills) {
        expect(pill.duration, Duration.zero);
      }
    });

    testWidgets('normal motion keeps the entrance animation', (tester) async {
      await pumpCarousel(tester);
      final slide = tester.widget<AnimatedSlide>(find.byType(AnimatedSlide).first);
      expect(slide.duration, greaterThan(Duration.zero));
    });

    // 2026-09-24: the widget owns a timer again, on purpose. What must stay
    // true is that it is cancelled — a periodic timer that outlives its State
    // keeps firing against a disposed context. `pumpWidget` with a different
    // tree disposes the carousel; the test binding fails the test if any timer
    // is still pending at the end, which is the real assertion here.
    testWidgets('its timer does not outlive the widget', (tester) async {
      await pumpCarousel(tester);
      await tester.pump(const Duration(seconds: 2));

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 30));

      expect(tester.takeException(), isNull);
    });
  });

  group('reachable without a touch gesture (WCAG 2.1.1 / 2.5.1)', () {
    Finder ring() => find.byKey(const ValueKey('carousel-focus-ring'));
    final group = RegExp(r'^Promotion \d of 2$');

    Future<void> tab(WidgetTester tester) async {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
    }

    Future<void> arrow(WidgetTester tester, LogicalKeyboardKey key) async {
      await tester.sendKeyEvent(key);
      await settle(tester);
    }

    testWidgets('a mouse can drag the pager', (tester) async {
      await pumpCarousel(tester);
      final gesture = await tester.startGesture(
        tester.getCenter(find.byType(PageView)),
        kind: PointerDeviceKind.mouse,
        buttons: kPrimaryButton,
      );
      await gesture.moveBy(const Offset(-120, 0));
      await gesture.moveBy(const Offset(-200, 0));
      await gesture.up();
      await settle(tester);
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('touch, mouse, stylus and trackpad are drag devices; no desktop scrollbar',
        (tester) async {
      await pumpCarousel(tester);
      final context = tester.element(find.byType(PageView));
      final behavior = ScrollConfiguration.of(context);
      expect(
        behavior.dragDevices,
        containsAll(<PointerDeviceKind>{
          PointerDeviceKind.touch,
          PointerDeviceKind.mouse,
          PointerDeviceKind.stylus,
          PointerDeviceKind.trackpad,
        }),
      );
      // Our own behaviour also drops the desktop scrollbar.
      expect(
        find.descendant(of: find.byType(HomeScreenCarousel), matching: find.byType(Scrollbar)),
        findsNothing,
      );
    });

    testWidgets('Tab lands on the carousel with a double ring, then moves on (no trap)',
        (tester) async {
      await pumpCarousel(tester);
      expect(ring(), findsNothing);

      await tab(tester);
      expect(ring(), findsOneWidget);
      // 2 dp ink outside, 2 dp paper inside: 3:1 on any slide colour or photo.
      final sides = [
        for (final box in tester.widgetList<DecoratedBox>(
          find.descendant(of: ring(), matching: find.byType(DecoratedBox)),
        ))
          ((box.decoration as BoxDecoration).border! as Border).top,
      ];
      expect(sides.map((s) => s.color), [BlynkColors.ink, BlynkColors.paper]);
      expect(sides.every((s) => s.width == 2), isTrue);

      // The next stop is the slide's own CTA, and the ring is the region's only.
      await tab(tester);
      expect(ring(), findsNothing);
      final focused = FocusManager.instance.primaryFocus!.context!;
      expect(focused.findAncestorWidgetOfExactType<BlynkButton>(), isNotNull);
    });

    testWidgets('Right and Left arrows change the page and stop at the ends', (tester) async {
      await pumpCarousel(tester);
      await tab(tester);

      await arrow(tester, LogicalKeyboardKey.arrowLeft);
      expect(find.text('Everyday Essentials'), findsOneWidget, reason: 'no previous slide');

      await arrow(tester, LogicalKeyboardKey.arrowRight);
      expect(find.text('Snack Time'), findsOneWidget);

      await arrow(tester, LogicalKeyboardKey.arrowRight);
      expect(find.text('Snack Time'), findsOneWidget, reason: 'no next slide');

      await arrow(tester, LogicalKeyboardKey.arrowLeft);
      expect(find.text('Everyday Essentials'), findsOneWidget);
    });

    testWidgets('arrows also work while a slide button has focus', (tester) async {
      await pumpCarousel(tester);
      await tab(tester);
      await tab(tester); // the CTA
      await arrow(tester, LogicalKeyboardKey.arrowRight);
      expect(find.text('Snack Time'), findsOneWidget);
    });

    testWidgets('an arrow move animates over BlynkMotion.base', (tester) async {
      await pumpCarousel(tester);
      await tab(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 60));
      final page = tester.widget<PageView>(find.byType(PageView)).controller!.page!;
      expect(page, inExclusiveRange(0.0, 1.0), reason: 'mid-animation, not a jump');
      await tester.pump(BlynkMotion.base);
      expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1.0);
    });

    testWidgets('reduced motion: an arrow jumps at once and nothing animates', (tester) async {
      await pumpCarousel(tester, disableAnimations: true);
      await tab(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pump();
      expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1.0);
      await tester.pump();
      expect(find.text('Snack Time'), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('screen reader: "Promotion N of M" with increase, decrease and scroll actions',
        (tester) async {
      final handle = tester.ensureSemantics();
      await pumpCarousel(tester);

      SemanticsNode node() => tester.getSemantics(find.bySemanticsLabel(group));

      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
      expect(node().getSemanticsData().hasAction(SemanticsAction.increase), isTrue);
      expect(node().getSemanticsData().hasAction(SemanticsAction.scrollLeft), isTrue);
      expect(node().getSemanticsData().hasAction(SemanticsAction.decrease), isFalse,
          reason: 'first slide');

      tester.semantics.performAction(find.semantics.byLabel(group), SemanticsAction.increase);
      await settle(tester);
      expect(find.text('Snack Time'), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 2 of 2'), findsOneWidget);
      expect(node().getSemanticsData().hasAction(SemanticsAction.decrease), isTrue);
      expect(node().getSemanticsData().hasAction(SemanticsAction.scrollRight), isTrue);
      expect(node().getSemanticsData().hasAction(SemanticsAction.increase), isFalse,
          reason: 'last slide');

      tester.semantics.performAction(find.semantics.byLabel(group), SemanticsAction.decrease);
      await settle(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the slide CTA is still its own reachable button', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpCarousel(tester);
      final cta = tester.getSemantics(find.bySemanticsLabel('Explore')).getSemanticsData();
      expect(cta.flagsCollection.isButton, isTrue);
      expect(cta.hasAction(SemanticsAction.tap), isTrue);
      handle.dispose();
    });

    testWidgets('the slide CTA is a BlynkButton with a 48 dp target', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpCarousel(tester);
      // W9: the pill is `BlynkButton.promo`, so the visual box is the pill
      // itself rather than a Material ElevatedButton. Both halves of the old
      // assertion are kept: >= 44 dp of visual and >= 48 dp of target.
      final cta = find.widgetWithText(BlynkButton, 'Explore');
      expect(cta, findsOneWidget);
      final pill = find.descendant(of: cta, matching: find.byType(InkWell));
      expect(tester.getSize(pill).height, greaterThanOrEqualTo(44));
      expect(tester.getSize(cta).height, greaterThanOrEqualTo(48));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      handle.dispose();
    });

    // W9. The slide background is whatever colour the operator stored, and
    // `#FFE141` (the app's own signal yellow) is a real captured value - see
    // `_twoPromotions`. A `signal`-filled action on it measured 1.00:1 and
    // disappeared. The pill must clear the 4.5:1 text floor against EVERY
    // background the API can hand this widget, so this is driven from the
    // fixtures rather than from one hand-picked colour.
    testWidgets('the slide CTA is never the slide background colour', (tester) async {
      await pumpCarousel(tester);
      final pill = tester.widget<Container>(
        find.descendant(
          of: find.widgetWithText(BlynkButton, 'Explore'),
          matching: find.byType(Container),
        ).first,
      );
      final fill = (pill.decoration! as BoxDecoration).color!;
      expect(fill, isNot(BlynkColors.signal), reason: 'never a second yellow on a yellow slide');
      // Every FLAT background the fixtures prove the API can return. (An
      // IMAGE slide is not in this list: it is covered by a full-bleed ink
      // scrim, so the pill reads by its paper label rather than by its edge.)
      for (final background in <Color>[
        const Color(0xFFFFE141), // _twoPromotions slide 1 (SOLID)
        const Color(0xFF0C831F), // _twoPromotions slide 2 (GRADIENT start)
        BlynkColors.paper,
      ]) {
        expect(
          contrastRatio(fill, background),
          greaterThanOrEqualTo(3),
          reason: 'the pill body must separate from the slide it sits on',
        );
      }
      expect(contrastRatio(BlynkCta.promoLabel, fill), greaterThanOrEqualTo(4.5));
      // The defect, still measurable: this is what the button used to be.
      expect(contrastRatio(BlynkColors.signal, const Color(0xFFFFE141)), lessThan(1.1));
    });

    testWidgets('the position dots are ink (current) and lineStrong (others), never green', (tester) async {
      await pumpCarousel(tester);
      final dots = find.descendant(of: find.byType(HomeScreenCarousel), matching: find.byType(AnimatedContainer));
      final colors = tester
          .widgetList<AnimatedContainer>(dots)
          .map((c) => (c.decoration! as BoxDecoration).color)
          .whereType<Color>()
          .toSet();
      expect(colors, {BlynkColors.ink, BlynkColors.lineStrong});
    });

    testWidgets('a single promotion offers no pager label, actions or focus stop', (tester) async {
      final handle = tester.ensureSemantics();
      api.promotionsJson = _catalogPromotion;
      await pumpCarousel(tester);
      expect(find.bySemanticsLabel(RegExp(r'Promotion \d+ of')), findsNothing);
      await tab(tester);
      expect(ring(), findsNothing);
      handle.dispose();
    });
  });

  group('layout', () {
    for (final size in const [
      Size(320, 640),
      Size(375, 812),
      Size(414, 896),
      Size(768, 1024),
      Size(1280, 720),
      Size(1920, 1080),
    ]) {
      testWidgets('no overflow at ${size.width}x${size.height}',
          (tester) async {
        await pumpCarousel(tester, size: size);

        expect(tester.takeException(), isNull);
        expect(find.text('Everyday Essentials'), findsOneWidget);

        final width = size.width;
        await tester.drag(find.byType(PageView), Offset(-width * 0.8, 0));
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(find.text('Snack Time'), findsOneWidget);
      });
    }
  });
}
