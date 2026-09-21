import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_button.dart';
import 'package:ecom/UI/Widgets/Atoms/offline_banner.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

const _defaultCopy = "You're offline. Showing saved items.";

void main() {
  group('OfflineBanner', () {
    testWidgets('default: notice tint, full width, default copy, no retry', (tester) async {
      await tester.pumpWidget(componentHost(tester, const OfflineBanner(), center: false));
      expect(find.text(_defaultCopy), findsOneWidget);
      expect(find.byType(BlynkButton), findsNothing);
      expect(tester.getSize(find.byType(OfflineBanner)).width, 400);
      final fill = tester.widget<ColoredBox>(find.descendant(of: find.byType(OfflineBanner), matching: find.byType(ColoredBox)).first);
      expect(fill.color, BlynkColors.noticeTint);
      final text = tester.widget<Text>(find.text(_defaultCopy));
      expect(text.style!.color, BlynkColors.notice);
      expect(find.byIcon(BlynkIcons.offline), findsOneWidget);
    });

    testWidgets('the message can be overridden', (tester) async {
      await tester.pumpWidget(componentHost(tester, const OfflineBanner(message: 'No connection'), center: false));
      expect(find.text('No connection'), findsOneWidget);
    });

    testWidgets('retry: a 48 dp "Try again" button that calls back', (tester) async {
      var retries = 0;
      await tester.pumpWidget(componentHost(tester, OfflineBanner(onRetry: () => retries++), center: false));
      final button = find.widgetWithText(TextButton, 'Try again');
      expect(button, findsOneWidget);
      expect(tester.getSize(button).height, greaterThanOrEqualTo(48));
      await tester.tap(button);
      expect(retries, 1);
    });

    testWidgets('semantics: live region carrying the message', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, const OfflineBanner(), center: false));
      final data = tester.getSemantics(find.text(_defaultCopy)).getSemanticsData();
      expect(data.flagsCollection.isLiveRegion, isTrue);
      expect(data.label, _defaultCopy);
      handle.dispose();
    });

    testWidgets('semantics with retry: the message and the button are separate nodes', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, OfflineBanner(onRetry: () {}), center: false));

      final message = tester.getSemantics(find.text(_defaultCopy)).getSemanticsData();
      expect(message.flagsCollection.isLiveRegion, isTrue);
      expect(message.flagsCollection.isButton, isFalse);
      expect(message.label, _defaultCopy, reason: 'the message must not absorb the button label');
      expect(message.hasAction(SemanticsAction.tap), isFalse);

      final button = tester.getSemantics(find.byType(BlynkButton)).getSemanticsData();
      expect(button.flagsCollection.isButton, isTrue);
      expect(button.flagsCollection.isLiveRegion, isFalse);
      expect(button.label, 'Try again');
      expect(button.hasAction(SemanticsAction.tap), isTrue);

      expect(tester.getSemantics(find.text(_defaultCopy)).id, isNot(tester.getSemantics(find.byType(BlynkButton)).id));
      handle.dispose();
    });

    testWidgets('does not animate: no running animations, also under reduced motion', (tester) async {
      await tester.pumpWidget(componentHost(tester, OfflineBanner(onRetry: () {}), center: false, disableAnimations: true));
      await tester.pump();
      expect(tester.hasRunningAnimations, isFalse);
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x with retry', (tester) async {
        await tester.pumpWidget(componentHost(tester, OfflineBanner(onRetry: () {}), center: false, textScale: scale));
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('tap target, labelled target and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(componentHost(tester, OfflineBanner(onRetry: () {}), center: false));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
