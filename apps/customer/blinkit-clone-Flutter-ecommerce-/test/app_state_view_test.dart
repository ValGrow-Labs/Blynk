
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/app_state_views.dart';
import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

Widget _view(WidgetTester tester, Widget view, {double textScale = 1, double width = 400, double height = 800}) =>
    componentHost(tester, view, textScale: textScale, width: width, height: height, center: false);

Icon _glyph(WidgetTester tester) => tester.widget<Icon>(find.descendant(of: find.byType(AppStateView), matching: find.byType(Icon)).first);

void main() {
  group('existing constructor keeps the same information', () {
    testWidgets('categories error: title, message, "Try Again" action and its callback', (tester) async {
      var retries = 0;
      await tester.pumpWidget(_view(
        tester,
        AppStateView(
          icon: Icons.wifi_off_rounded,
          title: "We couldn't load categories",
          message: 'Check your connection and try again - your cart is safe.',
          actionLabel: 'Try Again',
          onAction: () => retries++,
        ),
      ));
      expect(find.text("We couldn't load categories"), findsOneWidget);
      expect(find.text('Check your connection and try again - your cart is safe.'), findsOneWidget);
      await tester.tap(find.text('Try Again'));
      expect(retries, 1);
    });

    testWidgets('empty categories: no action button when no action is given', (tester) async {
      await tester.pumpWidget(_view(
        tester,
        const AppStateView(
          icon: Icons.storefront_outlined,
          title: 'No categories yet',
          message: 'Our catalog is being stocked. Please check back shortly.',
        ),
      ));
      expect(find.text('No categories yet'), findsOneWidget);
      expect(find.text('Our catalog is being stocked. Please check back shortly.'), findsOneWidget);
      expect(find.byType(ElevatedButton), findsNothing);
    });

    testWidgets('the accent argument is accepted and ignored: the glyph is brand-neutral', (tester) async {
      await tester.pumpWidget(_view(
        tester,
        const AppStateView(icon: Icons.inventory_2_outlined, title: 'Gone', accent: Colors.purple),
      ));
      expect(_glyph(tester).color, BlynkColors.ink3);
    });
  });

  group('layout', () {
    testWidgets('one glyph (32 dp), a heading title, one body sentence in ink3, one primary button', (tester) async {
      await tester.pumpWidget(_view(
        tester,
        AppStateView.empty(title: 'No orders yet', message: 'Your orders will show here.', actionLabel: 'Start shopping', onAction: () {}),
      ));
      final glyph = _glyph(tester);
      expect(glyph.size, 32);
      expect(glyph.icon, BlynkIcons.empty);
      expect(tester.widget<Text>(find.text('No orders yet')).style!.fontSize, BlynkText.heading.fontSize);
      expect(tester.widget<Text>(find.text('No orders yet')).style!.fontWeight, BlynkText.heading.fontWeight);
      final body = tester.widget<Text>(find.text('Your orders will show here.')).style!;
      expect(body.color, BlynkColors.ink3);
      expect(body.fontSize, BlynkText.body.fontSize);
      expect(find.byType(ElevatedButton), findsOneWidget);
      expect(tester.getSize(find.byType(ElevatedButton)).height, greaterThanOrEqualTo(48));
      // Centred on the page.
      expect(tester.getCenter(find.text('No orders yet')).dx, closeTo(200, 1));
    });

    testWidgets('no coloured halo behind the glyph', (tester) async {
      await tester.pumpWidget(_view(tester, const AppStateView.empty(title: 'Nothing here')));
      final halos = find.descendant(
        of: find.byType(AppStateView),
        matching: find.byWidgetPredicate((w) => w is DecoratedBox && (w.decoration is BoxDecoration) && (w.decoration as BoxDecoration).shape == BoxShape.circle),
      );
      expect(halos, findsNothing);
    });
  });

  group('variants', () {
    testWidgets('loading: an ink spinner and the label, no button', (tester) async {
      await tester.pumpWidget(_view(tester, const AppStateView.loading('Loading categories')));
      expect(find.text('Loading categories'), findsOneWidget);
      final spinner = tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator));
      expect(spinner.color, BlynkColors.ink);
      expect(find.byType(ElevatedButton), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('empty: empty glyph, action optional', (tester) async {
      await tester.pumpWidget(_view(tester, const AppStateView.empty(title: 'Your cart is empty', message: 'Add something to get started.')));
      expect(_glyph(tester).icon, BlynkIcons.empty);
      expect(find.byType(ElevatedButton), findsNothing);
    });

    testWidgets('error: error glyph, "Try again" retry, the given copy', (tester) async {
      var retried = false;
      await tester.pumpWidget(_view(
        tester,
        AppStateView.error(title: "Couldn't load results", message: 'Check your connection and try again.', onRetry: () => retried = true),
      ));
      expect(_glyph(tester).icon, BlynkIcons.error);
      await tester.tap(find.text('Try again'));
      expect(retried, isTrue);
    });

    testWidgets('offline: wifi-off glyph, offline title, "Try again"', (tester) async {
      var retried = false;
      await tester.pumpWidget(_view(tester, AppStateView.offline(() => retried = true)));
      expect(_glyph(tester).icon, BlynkIcons.offline);
      expect(find.text("You're offline"), findsOneWidget);
      await tester.tap(find.text('Try again'));
      expect(retried, isTrue);
    });

    testWidgets('notFound: not-found glyph and an outlined (secondary) action', (tester) async {
      var back = false;
      await tester.pumpWidget(_view(
        tester,
        AppStateView.notFound(title: 'Product no longer available', message: 'This item has been removed from the store.', actionLabel: 'Go back', onAction: () => back = true),
      ));
      expect(_glyph(tester).icon, BlynkIcons.notFound);
      expect(find.byType(OutlinedButton), findsOneWidget);
      expect(find.byType(ElevatedButton), findsNothing);
      await tester.tap(find.text('Go back'));
      expect(back, isTrue);
    });

    testWidgets('error and offline without a callback show no action', (tester) async {
      await tester.pumpWidget(_view(tester, const AppStateView.error(title: 'Something went wrong', onRetry: null)));
      expect(find.byType(ElevatedButton), findsNothing);
      await tester.pumpWidget(_view(tester, const AppStateView.offline(null)));
      expect(find.byType(ElevatedButton), findsNothing);
    });
  });

  group('semantics', () {
    void expectLiveMessageAndSeparateButton(WidgetTester tester, String title, String message) {
      final live = tester.getSemantics(find.text(title));
      final liveData = live.getSemanticsData();
      expect(liveData.flagsCollection.isLiveRegion, isTrue);
      expect(liveData.flagsCollection.isButton, isFalse, reason: 'the live message must not be a button');
      expect(liveData.label, '$title\n$message');
      expect(liveData.hasAction(SemanticsAction.tap), isFalse);

      final button = tester.getSemantics(find.byType(BlynkButton));
      final buttonData = button.getSemanticsData();
      expect(buttonData.flagsCollection.isButton, isTrue);
      expect(buttonData.flagsCollection.isLiveRegion, isFalse);
      expect(buttonData.label, 'Try again');
      expect(buttonData.hasAction(SemanticsAction.tap), isTrue);
      expect(button.id, isNot(live.id));
    }

    testWidgets('error: a live-region message node and a separate "Try again" button node', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_view(tester, AppStateView.error(title: "Couldn't load", message: 'Check your connection.', onRetry: () {})));
      expectLiveMessageAndSeparateButton(tester, "Couldn't load", 'Check your connection.');
      handle.dispose();
    });

    testWidgets('offline: a live-region message node and a separate "Try again" button node', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_view(tester, AppStateView.offline(() {})));
      expectLiveMessageAndSeparateButton(tester, "You're offline", 'Check your connection and try again. Your cart is saved.');
      handle.dispose();
    });

    testWidgets('error without an action is still a live region', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_view(tester, const AppStateView.error(title: 'Bad', message: 'msg', onRetry: null)));
      expect(tester.getSemantics(find.text('Bad')).getSemanticsData().flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('empty and not-found are not live regions', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_view(tester, const AppStateView.empty(title: 'No orders yet')));
      expect(tester.getSemantics(find.text('No orders yet')).getSemanticsData().flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('the decorative glyph is excluded from semantics', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_view(tester, const AppStateView.empty(title: 'No orders yet')));
      expect(find.bySemanticsLabel(RegExp('inbox|empty', caseSensitive: false)), findsNothing);
      handle.dispose();
    });
  });

  group('text scale and guidelines', () {
    const longTitle = "We couldn't load your orders";
    const longMessage = 'Check your connection and try again. Your cart is safe.';

    Widget errorView(WidgetTester tester, {required double scale, required double height, VoidCallback? onRetry}) => _view(
          tester,
          AppStateView.error(title: longTitle, message: longMessage, onRetry: onRetry ?? () {}),
          textScale: scale,
          width: 320,
          height: height,
        );

    testWidgets('the text really grows with the scale, nothing is truncated, and the action stays >= 48 dp', (tester) async {
      final titleHeights = <double>[];
      for (final scale in kTextScales) {
        await tester.pumpWidget(errorView(tester, scale: scale, height: 900));
        expect(tester.takeException(), isNull);
        for (final text in [longTitle, longMessage]) {
          expect(tester.renderObject<RenderParagraph>(find.text(text)).didExceedMaxLines, isFalse);
        }
        titleHeights.add(tester.getSize(find.text(longTitle)).height);
        expect(tester.getSize(find.byType(ElevatedButton)).height, greaterThanOrEqualTo(48));
      }
      expect(titleHeights[1], greaterThanOrEqualTo(titleHeights[0]));
      expect(titleHeights[2], greaterThan(titleHeights[0]), reason: 'the title wraps to more lines as the text scale grows');
    });

    testWidgets('a short viewport at 2.0x: the action starts off-screen, scrolls into view and can be tapped', (tester) async {
      var retries = 0;
      await tester.pumpWidget(errorView(tester, scale: 2.0, height: 260, onRetry: () => retries++));
      expect(tester.takeException(), isNull);
      final button = find.text('Try again');
      expect(tester.getRect(button).bottom, greaterThan(260), reason: 'precondition: the content is taller than the viewport');

      await tester.ensureVisible(button);
      await tester.pumpAndSettle();
      final rect = tester.getRect(button);
      expect(rect.top, greaterThanOrEqualTo(0));
      expect(rect.bottom, lessThanOrEqualTo(260));
      await tester.tap(button);
      expect(retries, 1);
    });

    testWidgets('the loading spinner is a fixed arc under reduced motion and rotates otherwise', (tester) async {
      await tester.pumpWidget(componentHost(tester, const AppStateView.loading('Loading'), center: false, disableAnimations: true));
      expect(tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator)).value, isNotNull);
      expect(tester.hasRunningAnimations, isFalse);

      await tester.pumpWidget(componentHost(tester, const AppStateView.loading('Loading'), center: false));
      expect(tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator)).value, isNull);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('tap target, labelled target and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_view(tester, AppStateView.error(title: "Couldn't load", message: 'Check your connection.', onRetry: () {})));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });

  group('inside a sliver (as Search uses it)', () {
    testWidgets('SliverFillRemaining(hasScrollBody: false) lays it out without errors', (tester) async {
      await tester.pumpWidget(componentHost(
        tester,
        CustomScrollView(
          slivers: [
            SliverFillRemaining(
              hasScrollBody: false,
              child: AppStateView(
                icon: Icons.search_off_rounded,
                title: 'Sorry!',
                message: 'We could not find anything.',
                actionLabel: 'Browse Categories',
                onAction: () {},
              ),
            ),
          ],
        ),
        center: false,
      ));
      expect(tester.takeException(), isNull);
      expect(find.text('Browse Categories'), findsOneWidget);
    });
  });
}
