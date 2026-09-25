import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/app_toast.dart';
import 'package:ecom/UI/Widgets/Atoms/snackbar_helper.dart';
import 'package:ecom/app_theme.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';
import 'package:ecom/main.dart' show rootScaffoldMessengerKey;

import 'fixtures/component_host.dart';

Widget _app(WidgetTester tester, {required Widget home, double textScale = 1, bool disableAnimations = false}) {
  tester.view.physicalSize = const Size(400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return MaterialApp(
    theme: AppTheme.theme,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
        disableAnimations: disableAnimations,
      ),
      child: child!,
    ),
    home: Scaffold(body: home),
  );
}

Material _snackMaterial(WidgetTester tester) =>
    tester.widget<Material>(find.descendant(of: find.byType(SnackBar), matching: find.byType(Material)).first);

void main() {
  group('showAppToast', () {
    testWidgets('shows a SnackBar with the message via the root messenger, on this (desktop test) platform', (tester) async {
      await tester.pumpWidget(_app(tester, home: const SizedBox()));
      showAppToast(msg: 'Add a delivery address to place your order.');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(SnackBar), findsOneWidget);
      expect(find.text('Add a delivery address to place your order.'), findsOneWidget);
    });

    testWidgets('legacy colour arguments are accepted but the bar stays ink on paper', (tester) async {
      await tester.pumpWidget(_app(tester, home: const SizedBox()));
      showAppToast(msg: 'Enter the 6-digit OTP', backgroundColor: Colors.redAccent, textColor: Colors.white);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(_snackMaterial(tester).color, BlynkColors.ink);
      expect(tester.widget<Text>(find.text('Enter the 6-digit OTP')).style!.color, BlynkColors.paper);
    });

    testWidgets('does nothing (and does not throw) when no messenger is mounted', (tester) async {
      await tester.pumpWidget(const SizedBox());
      expect(() => showAppToast(msg: 'nobody is listening'), returnsNormally);
    });

    test('lib/ has no fluttertoast import and app_toast has no kIsWeb branch', () {
      final offenders = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .where((f) => f.readAsStringSync().contains('fluttertoast'))
          .map((f) => f.path)
          .toList();
      expect(offenders, isEmpty);
      final toast = File('lib/UI/Widgets/Atoms/app_toast.dart').readAsStringSync();
      expect(toast.contains('kIsWeb'), isFalse);
    });
  });

  group('showBlynkSnackBar', () {
    Widget host(WidgetTester tester, void Function(BuildContext) onTap, {double textScale = 1, bool disableAnimations = false}) {
      return _app(
        tester,
        textScale: textScale,
        disableAnimations: disableAnimations,
        home: Builder(
          builder: (context) => Center(
            child: TextButton(onPressed: () => onTap(context), child: const Text('Show')),
          ),
        ),
      );
    }

    testWidgets('ink fill, paper text, floating, md radius, 4 s', (tester) async {
      await tester.pumpWidget(host(tester, (c) => showBlynkSnackBar(context: c, message: 'Saved')));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      final bar = tester.widget<SnackBar>(find.byType(SnackBar));
      expect(bar.behavior, SnackBarBehavior.floating);
      expect(bar.duration, const Duration(seconds: 4));
      expect(bar.shape, const RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll));
      expect(_snackMaterial(tester).color, BlynkColors.ink);
      expect(tester.widget<Text>(find.text('Saved')).style!.color, BlynkColors.paper);
      expect(find.byIcon(BlynkIcons.error), findsNothing);
    });

    testWidgets('closes itself after about four seconds', (tester) async {
      await tester.pumpWidget(host(tester, (c) => showBlynkSnackBar(context: c, message: 'Saved')));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 3400));
      expect(find.text('Saved'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 800));
      await tester.pumpAndSettle();
      expect(find.text('Saved'), findsNothing);
    });

    testWidgets('an action shows its label and calls back', (tester) async {
      var undone = 0;
      await tester.pumpWidget(host(
        tester,
        (c) => showBlynkSnackBar(context: c, message: 'Removed', actionLabel: 'Undo', onAction: () => undone++),
      ));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('Undo'));
      expect(undone, 1);
    });

    testWidgets('with an action the bar still has a 4 s duration, is not persistent, and closes by itself', (tester) async {
      await tester.pumpWidget(host(
        tester,
        (c) => showBlynkSnackBar(context: c, message: 'Removed', actionLabel: 'Undo', onAction: () {}),
      ));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final bar = tester.widget<SnackBar>(find.byType(SnackBar));
      expect(bar.duration, const Duration(seconds: 4));
      expect(bar.persist, isFalse);
      expect(find.text('Removed'), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 3400));
      expect(find.text('Removed'), findsOneWidget, reason: 'still open just before 4 s');
      await tester.pump(const Duration(milliseconds: 800));
      await tester.pumpAndSettle();
      expect(find.text('Removed'), findsNothing);
    });

    testWidgets('an error is marked with a glyph as well as words', (tester) async {
      await tester.pumpWidget(host(tester, (c) => showBlynkSnackBar(context: c, message: 'Could not save', tone: SnackTone.error)));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byIcon(BlynkIcons.error), findsOneWidget);
      expect(find.text('Could not save'), findsOneWidget);
    });

    testWidgets('a new message replaces the current one instead of queueing', (tester) async {
      await tester.pumpWidget(host(tester, (c) {
        showBlynkSnackBar(context: c, message: 'First');
        showBlynkSnackBar(context: c, message: 'Second');
      }));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      expect(find.text('First'), findsNothing);
      expect(find.text('Second'), findsOneWidget);
    });

    testWidgets('works through a messenger key with no context', (tester) async {
      await tester.pumpWidget(_app(tester, home: const SizedBox()));
      showBlynkSnackBar(messengerKey: rootScaffoldMessengerKey, message: 'From a key');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('From a key'), findsOneWidget);
    });

    testWidgets('semantics: the message is a live region', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(host(tester, (c) => showBlynkSnackBar(context: c, message: 'Saved')));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final data = tester.getSemantics(find.text('Saved')).getSemanticsData();
      expect(data.flagsCollection.isLiveRegion, isTrue);
      expect(data.label, contains('Saved'));
      handle.dispose();
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x with an action and a long message', (tester) async {
        await tester.pumpWidget(host(
          tester,
          (c) => showBlynkSnackBar(
            context: c,
            message: 'We could not place your order. Check your connection.',
            actionLabel: 'Try again',
            onAction: () {},
            tone: SnackTone.error,
          ),
          textScale: scale,
        ));
        await tester.tap(find.text('Show'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(tester.takeException(), isNull);
      });
    }

    // T2 (brief item 9): one feedback system with success / error / info.
    // The tone picks the GLYPH; the surface stays ink on every tone, so the
    // meaning is never colour alone (Global Constraints) and no tone adds an
    // unmeasured colour pairing.
    group('tone', () {
      final glyphs = <SnackTone, IconData?>{
        SnackTone.info: null,
        SnackTone.success: BlynkIcons.check,
        SnackTone.error: BlynkIcons.error,
      };

      glyphs.forEach((tone, glyph) {
        testWidgets('${tone.name}: its own glyph, always on the ink surface in paper', (tester) async {
          await tester.pumpWidget(host(
            tester,
            (c) => showBlynkSnackBar(context: c, message: 'Message', tone: tone),
          ));
          await tester.tap(find.text('Show'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));

          expect(find.text('Message'), findsOneWidget);
          final bar = tester.widget<SnackBar>(find.byType(SnackBar));
          expect(bar.backgroundColor, BlynkColors.ink, reason: 'the tone never changes the surface');
          final icons = find.descendant(of: find.byType(SnackBar), matching: find.byType(Icon));
          if (glyph == null) {
            expect(icons, findsNothing);
          } else {
            expect(find.descendant(of: find.byType(SnackBar), matching: find.byIcon(glyph)), findsOneWidget);
            expect(tester.widget<Icon>(icons.first).color, BlynkColors.paper);
            expect(contrastRatio(BlynkColors.paper, BlynkColors.ink), greaterThanOrEqualTo(4.5));
          }
        });
      });

      test('the three tones have three distinct treatments', () {
        expect(glyphs.values.toSet(), hasLength(3));
      });

      testWidgets('info is the default, so no existing call site gained a glyph', (tester) async {
        await tester.pumpWidget(host(tester, (c) => showBlynkSnackBar(context: c, message: 'Saved')));
        await tester.tap(find.text('Show'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.descendant(of: find.byType(SnackBar), matching: find.byType(Icon)), findsNothing);
      });
    });

    testWidgets('text contrast guideline (paper on ink)', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(host(tester, (c) => showBlynkSnackBar(context: c, message: 'Saved', actionLabel: 'Undo', onAction: () {})));
      await tester.tap(find.text('Show'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      handle.dispose();
    });
  });
}
