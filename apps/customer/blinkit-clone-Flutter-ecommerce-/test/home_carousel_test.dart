import 'dart:convert';
import 'dart:io';
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

    testWidgets('renders a gradient background from the API', (tester) async {
      await pumpCarousel(tester);
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await settle(tester);

      final gradient = products.promotions[1];
      expect(gradient.hasGradient, isTrue);
      expect(
        find.byWidgetPredicate((w) {
          if (w is! DecoratedBox) return false;
          final decoration = w.decoration;
          if (decoration is! BoxDecoration) return false;
          final fill = decoration.gradient;
          return fill is LinearGradient &&
              fill.colors.first == const Color(0xFF0C831F) &&
              fill.colors.last == const Color(0xFF5FBF6E);
        }),
        findsOneWidget,
      );
    });

    testWidgets('renders an image background with a legibility scrim',
        (tester) async {
      api.promotionsJson = _imageBackground;
      await pumpCarousel(tester);

      expect(products.promotions.single.hasBackgroundImage, isTrue);
      expect(find.byType(Image), findsWidgets);
      expect(find.text('Weekend Market'), findsOneWidget);
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
    testWidgets('never advances by itself (manual swipe only, WCAG 2.2.2)',
        (tester) async {
      await pumpCarousel(tester);
      expect(find.text('Everyday Essentials'), findsOneWidget);

      // Far longer than the old 6 s timer, in several steps.
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(seconds: 10));
      }
      expect(find.text('Everyday Essentials'), findsOneWidget);
      expect(find.text('Snack Time'), findsNothing);
      expect(find.bySemanticsLabel('Promotion 1 of 2'), findsOneWidget);
      // No periodic timer or animation is left running once the slides settle.
      expect(tester.hasRunningAnimations, isFalse);
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
      expect(find.byType(ElevatedButton), findsNothing);
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

    testWidgets('the widget owns no timer any more', (tester) async {
      final source =
          File('lib/UI/Widgets/Organisms/home_screen_carousel.dart').readAsStringSync();
      expect(source, isNot(contains('Timer')));
      expect(source, isNot(contains("dart:async")));
      expect(source, isNot(contains('periodic')));
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
      expect(focused.findAncestorWidgetOfExactType<ElevatedButton>(), isNotNull);
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
      final cta = find.widgetWithText(ElevatedButton, 'Explore');
      expect(cta, findsOneWidget);
      expect(find.ancestor(of: cta, matching: find.byType(BlynkButton)), findsOneWidget);
      expect(tester.getSize(cta).height, greaterThanOrEqualTo(44));
      expect(tester.getSize(find.ancestor(of: cta, matching: find.byType(Semantics)).first).height, greaterThanOrEqualTo(48));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      handle.dispose();
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
