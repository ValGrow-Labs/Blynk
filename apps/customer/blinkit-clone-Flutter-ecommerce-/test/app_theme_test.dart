import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/app_theme.dart';
import 'package:ecom/design/contrast.dart';
import 'package:ecom/design/tokens.dart';

Widget _host(Widget child, {double textScale = 1}) => MaterialApp(
      theme: AppTheme.appTHeme,
      home: MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: Center(child: child)),
      ),
    );

void main() {
  final theme = AppTheme.appTHeme;

  group('colour scheme', () {
    test('primary is ink, never yellow; yellow is only the secondary fill', () {
      expect(theme.colorScheme.primary, BlynkColors.ink);
      expect(theme.colorScheme.onPrimary, BlynkColors.paper);
      expect(theme.colorScheme.secondary, BlynkColors.signal);
      expect(theme.colorScheme.onSecondary, BlynkColors.ink);
      expect(theme.colorScheme.tertiary, BlynkColors.positive);
      expect(theme.colorScheme.error, BlynkColors.problem);
      expect(theme.colorScheme.outline, BlynkColors.lineStrong);
      expect(theme.useMaterial3, isTrue);
    });

    test('no ColorScheme role resolves to yellow except secondary', () {
      final s = theme.colorScheme;
      final roles = <String, Color>{
        'primary': s.primary,
        'onPrimary': s.onPrimary,
        'primaryContainer': s.primaryContainer,
        'onPrimaryContainer': s.onPrimaryContainer,
        'secondaryContainer': s.secondaryContainer,
        'onSecondaryContainer': s.onSecondaryContainer,
        'tertiary': s.tertiary,
        'onTertiary': s.onTertiary,
        'tertiaryContainer': s.tertiaryContainer,
        'onTertiaryContainer': s.onTertiaryContainer,
        'error': s.error,
        'onError': s.onError,
        'errorContainer': s.errorContainer,
        'onErrorContainer': s.onErrorContainer,
        'surface': s.surface,
        'onSurface': s.onSurface,
        'onSurfaceVariant': s.onSurfaceVariant,
        'surfaceDim': s.surfaceDim,
        'surfaceBright': s.surfaceBright,
        'surfaceContainerLowest': s.surfaceContainerLowest,
        'surfaceContainerLow': s.surfaceContainerLow,
        'surfaceContainer': s.surfaceContainer,
        'surfaceContainerHigh': s.surfaceContainerHigh,
        'surfaceContainerHighest': s.surfaceContainerHighest,
        'outline': s.outline,
        'outlineVariant': s.outlineVariant,
        'inverseSurface': s.inverseSurface,
        'onInverseSurface': s.onInverseSurface,
        'inversePrimary': s.inversePrimary,
        'shadow': s.shadow,
        'scrim': s.scrim,
        'surfaceTint': s.surfaceTint,
      };
      roles.forEach((name, color) {
        expect(color, isNot(BlynkColors.signal), reason: '$name must not be yellow');
        expect(color, isNot(BlynkColors.signalPressed), reason: '$name must not be yellow');
      });
      expect(s.secondaryContainer, BlynkColors.well);
      expect(s.onSecondaryContainer, BlynkColors.ink);
      expect(s.inversePrimary, BlynkColors.ink3);
    });

    test('no container role falls back to the Material purple baseline', () {
      final s = theme.colorScheme;
      for (final c in [
        s.primaryContainer,
        s.secondaryContainer,
        s.tertiaryContainer,
        s.errorContainer,
        s.surfaceTint,
        s.inversePrimary,
      ]) {
        expect(c, isNot(const Color(0xFFEADDFF)));
        expect(c, isNot(const Color(0xFFE8DEF8)));
        expect(c, isNot(const Color(0xFF6750A4)));
      }
    });

    test('the historical AppTheme.appTHeme entry point is the same theme', () {
      expect(identical(AppTheme.appTHeme, AppTheme.theme), isTrue);
    });
  });

  group('text theme', () {
    test('no style is smaller than 12', () {
      final t = theme.textTheme;
      for (final s in [
        t.displayLarge,
        t.displayMedium,
        t.displaySmall,
        t.headlineLarge,
        t.headlineMedium,
        t.headlineSmall,
        t.titleLarge,
        t.titleMedium,
        t.titleSmall,
        t.bodyLarge,
        t.bodyMedium,
        t.bodySmall,
        t.labelLarge,
        t.labelMedium,
        t.labelSmall,
      ]) {
        expect(s!.fontSize, greaterThanOrEqualTo(12));
        // 2026-09-24: the type family moved Catamaran -> Poppins to match the
        // reference design. Expectation updated; the assertion is unchanged in
        // strength (still pins every theme style to exactly one family).
        expect(s.fontFamily, BlynkText.family);
      }
    });
  });

  group('resolved colours under the theme', () {
    testWidgets('CircularProgressIndicator is ink', (tester) async {
      await tester.pumpWidget(_host(const CircularProgressIndicator()));
      final ctx = tester.element(find.byType(CircularProgressIndicator));
      final indicator = tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator));
      final color = indicator.color ?? ProgressIndicatorTheme.of(ctx).color;
      expect(color, BlynkColors.ink);
      expect(color, isNot(BlynkColors.signal));
    });

    testWidgets('LinearProgressIndicator is ink on a line track', (tester) async {
      await tester.pumpWidget(_host(const SizedBox(width: 200, child: LinearProgressIndicator(value: 0.5))));
      final ctx = tester.element(find.byType(LinearProgressIndicator));
      final t = ProgressIndicatorTheme.of(ctx);
      expect(t.color, BlynkColors.ink);
      expect(t.linearTrackColor, BlynkColors.line);
    });

    testWidgets('TextField cursor, selection and focused border are ink', (tester) async {
      await tester.pumpWidget(_host(const SizedBox(width: 300, child: TextField())));
      final ctx = tester.element(find.byType(TextField));
      final sel = Theme.of(ctx).textSelectionTheme;
      expect(sel.cursorColor, BlynkColors.ink);
      expect(sel.selectionHandleColor, BlynkColors.ink);
      final decoration = Theme.of(ctx).inputDecorationTheme;
      expect((decoration.focusedBorder! as OutlineInputBorder).borderSide.color, BlynkColors.ink);

      await tester.tap(find.byType(TextField));
      await tester.pump();
      final editable = tester.widget<EditableText>(find.byType(EditableText));
      expect(editable.cursorColor, BlynkColors.ink);
      expect(editable.cursorColor, isNot(BlynkColors.signal));
    });

    testWidgets('the primary colour that Switch and Checkbox default to is ink, not yellow', (tester) async {
      await tester.pumpWidget(_host(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Switch(value: true, onChanged: (_) {}),
            Checkbox(value: true, onChanged: (_) {}),
          ],
        ),
      ));
      final ctx = tester.element(find.byType(Switch));
      expect(Theme.of(ctx).colorScheme.primary, BlynkColors.ink);
      expect(Theme.of(ctx).colorScheme.primary, isNot(BlynkColors.signal));
    });
  });

  group('buttons', () {
    testWidgets('ElevatedButton: 48 dp min, signal fill, ink label, flat', (tester) async {
      await tester.pumpWidget(_host(ElevatedButton(onPressed: () {}, child: const Text('Add'))));
      final size = tester.getSize(find.byType(ElevatedButton));
      expect(size.height, greaterThanOrEqualTo(48));

      final material = tester.widget<Material>(
        find.descendant(of: find.byType(ElevatedButton), matching: find.byType(Material)).first,
      );
      expect(material.color, BlynkColors.signal);
      expect(material.elevation, 0);
      final text = tester.widget<DefaultTextStyle>(
        find.descendant(of: find.byType(ElevatedButton), matching: find.byType(DefaultTextStyle)).first,
      );
      expect(text.style.color, BlynkColors.ink);
    });

    testWidgets('FilledButton: 48 dp min, signal fill, ink label', (tester) async {
      await tester.pumpWidget(_host(FilledButton(onPressed: () {}, child: const Text('Add'))));
      expect(tester.getSize(find.byType(FilledButton)).height, greaterThanOrEqualTo(48));
      final material = tester.widget<Material>(
        find.descendant(of: find.byType(FilledButton), matching: find.byType(Material)).first,
      );
      expect(material.color, BlynkColors.signal);
    });

    // W9: the expected VALUES moved because the design did - the theme now
    // shares `BlynkButton`'s single disabled recipe instead of keeping a
    // second, lower-contrast one. The assertion is the same shape and the
    // pairing it pins is 6.21:1 rather than 4.54:1.
    testWidgets('disabled primary button is the one BlynkDisabled recipe', (tester) async {
      await tester.pumpWidget(_host(const ElevatedButton(onPressed: null, child: Text('Add'))));
      final material = tester.widget<Material>(
        find.descendant(of: find.byType(ElevatedButton), matching: find.byType(Material)).first,
      );
      expect(material.color, BlynkDisabled.fill);
      final text = tester.widget<DefaultTextStyle>(
        find.descendant(of: find.byType(ElevatedButton), matching: find.byType(DefaultTextStyle)).first,
      );
      expect(text.style.color, BlynkDisabled.label);
      expect(contrastRatio(BlynkDisabled.label, BlynkDisabled.fill), greaterThanOrEqualTo(4.5));
    });

    testWidgets('pressed primary button uses signalPressed', (tester) async {
      await tester.pumpWidget(_host(ElevatedButton(onPressed: () {}, child: const Text('Add'))));
      final gesture = await tester.startGesture(tester.getCenter(find.byType(ElevatedButton)));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      final material = tester.widget<Material>(
        find.descendant(of: find.byType(ElevatedButton), matching: find.byType(Material)).first,
      );
      expect(material.color, BlynkColors.signalPressed);
      await gesture.up();
    });

    testWidgets('OutlinedButton: 48 dp, 1.5 dp lineStrong border, ink label', (tester) async {
      await tester.pumpWidget(_host(OutlinedButton(onPressed: () {}, child: const Text('Back'))));
      expect(tester.getSize(find.byType(OutlinedButton)).height, greaterThanOrEqualTo(48));
      final style = theme.outlinedButtonTheme.style!;
      final side = style.side!.resolve(<WidgetState>{})!;
      expect(side.color, BlynkColors.lineStrong);
      expect(side.width, 1.5);
      expect(style.foregroundColor!.resolve(<WidgetState>{}), BlynkColors.ink);
    });

    test('TextButton foreground is ink, not green', () {
      final fg = theme.textButtonTheme.style!.foregroundColor!;
      expect(fg.resolve(<WidgetState>{}), BlynkColors.ink);
      expect(fg.resolve(<WidgetState>{}), isNot(BlynkColors.positive));
      expect(theme.textButtonTheme.style!.textStyle!.resolve(<WidgetState>{})!.fontWeight, FontWeight.w700);
    });

    test('buttons draw a 2 dp ink ring on focus', () {
      final ring = theme.elevatedButtonTheme.style!.side!.resolve(<WidgetState>{WidgetState.focused})!;
      expect(ring.color, BlynkColors.ink);
      expect(ring.width, 2);
    });

    testWidgets('a 48 dp primary button grows with a 2.0 text scale without overflow', (tester) async {
      await tester.pumpWidget(_host(
        SizedBox(
          width: 200,
          child: ElevatedButton(onPressed: () {}, child: const Text('Place order now please')),
        ),
        textScale: 2,
      ));
      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byType(ElevatedButton)).height, greaterThanOrEqualTo(48));
    });
  });

  group('input decoration', () {
    final input = theme.inputDecorationTheme;

    test('well fill, lineStrong 1 dp border, ink 2 dp focus, problem 2 dp error', () {
      expect(input.filled, isTrue);
      expect(input.fillColor, BlynkColors.well);
      final enabled = (input.enabledBorder! as OutlineInputBorder).borderSide;
      expect(enabled.color, BlynkColors.lineStrong);
      expect(enabled.width, 1);
      final focused = (input.focusedBorder! as OutlineInputBorder).borderSide;
      expect(focused.color, BlynkColors.ink);
      expect(focused.width, 2);
      final error = (input.errorBorder! as OutlineInputBorder).borderSide;
      expect(error.color, BlynkColors.problem);
      expect(error.width, 2);
      expect((input.focusedErrorBorder! as OutlineInputBorder).borderSide.width, 2);
    });

    test('hint is ink2 (never muted), label always floats, 48 dp minimum', () {
      expect(input.hintStyle!.color, BlynkColors.ink2);
      expect(input.floatingLabelBehavior, FloatingLabelBehavior.always);
      expect(input.constraints!.minHeight, 48);
    });

    testWidgets('a labelled TextField is at least 48 dp tall', (tester) async {
      await tester.pumpWidget(_host(const SizedBox(
        width: 300,
        child: TextField(decoration: InputDecoration(labelText: 'Phone number')),
      )));
      expect(find.text('Phone number'), findsOneWidget);
      expect(tester.getSize(find.byType(TextField)).height, greaterThanOrEqualTo(48));
    });
  });

  group('other component themes', () {
    testWidgets('selected chip is ink fill with a paper label; unselected is outlined', (tester) async {
      await tester.pumpWidget(_host(
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ChoiceChip(label: const Text('On'), selected: true, onSelected: (_) {}),
            ChoiceChip(label: const Text('Off'), selected: false, onSelected: (_) {}),
          ],
        ),
      ));
      Color? labelColor(String text) =>
          tester.widget<Text>(find.text(text)).style?.color ??
          DefaultTextStyle.of(tester.element(find.text(text))).style.color;
      expect(labelColor('On'), BlynkColors.paper);
      expect(labelColor('Off'), BlynkColors.ink);
      expect(tester.getSize(find.byType(ChoiceChip).first).height, greaterThanOrEqualTo(48));
    });

    test('bottom sheet has lg top radius and the scrim; dialog lg radius', () {
      final sheet = theme.bottomSheetTheme;
      expect(sheet.shape, const RoundedRectangleBorder(borderRadius: BlynkRadius.lgTop));
      expect(sheet.modalBarrierColor, BlynkColors.scrim);
      expect(sheet.dragHandleColor, BlynkColors.lineStrong);
      final dialog = theme.dialogTheme;
      expect(dialog.shape, const RoundedRectangleBorder(borderRadius: BlynkRadius.lgAll));
    });

    test('sheet and dialog take their elevation from BlynkElevation.overlay', () {
      expect(theme.bottomSheetTheme.elevation, BlynkElevation.overlayDp);
      expect(theme.bottomSheetTheme.modalElevation, BlynkElevation.overlayDp);
      expect(theme.bottomSheetTheme.shadowColor, BlynkElevation.overlayShadow);
      expect(theme.dialogTheme.elevation, BlynkElevation.overlayDp);
      expect(theme.dialogTheme.shadowColor, BlynkElevation.overlayShadow);
    });

    test('card is flat with a 1 dp line border and md radius', () {
      final card = theme.cardTheme;
      expect(card.elevation, 0);
      final shape = card.shape! as RoundedRectangleBorder;
      expect(shape.side.color, BlynkColors.line);
      expect(shape.side.width, 1);
      expect(shape.borderRadius, BlynkRadius.mdAll);
    });

    test('divider is line; icon theme is ink 24; progress is ink', () {
      expect(theme.dividerTheme.color, BlynkColors.line);
      expect(theme.iconTheme.color, BlynkColors.ink);
      expect(theme.iconTheme.size, 24);
      expect(theme.progressIndicatorTheme.color, BlynkColors.ink);
    });

    test('snackbar is an ink floating bar with paper text and md radius', () {
      final s = theme.snackBarTheme;
      expect(s.backgroundColor, BlynkColors.ink);
      expect(s.contentTextStyle!.color, BlynkColors.paper);
      expect(s.behavior, SnackBarBehavior.floating);
      expect(s.shape, const RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll));
    });

    testWidgets('a SnackBar renders ink', (tester) async {
      await tester.pumpWidget(_host(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved'))),
            child: const Text('go'),
          ),
        ),
      ));
      await tester.tap(find.text('go'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final material = tester.widget<Material>(
        find.descendant(of: find.byType(SnackBar), matching: find.byType(Material)).first,
      );
      expect(material.color, BlynkColors.ink);
    });

    test('app bar is flat paper with a heading title', () {
      final bar = theme.appBarTheme;
      expect(bar.backgroundColor, BlynkColors.paper);
      expect(bar.elevation, 0);
      expect(bar.scrolledUnderElevation, 0.5);
      expect(bar.titleTextStyle, BlynkText.heading);
      expect(bar.iconTheme!.color, BlynkColors.ink);
    });

    test('navigation bar and rail: paper, ink, 12 px w700 labels', () {
      final nav = theme.navigationBarTheme;
      expect(nav.backgroundColor, BlynkColors.paper);
      expect(nav.height, 64);
      final label = nav.labelTextStyle!.resolve(<WidgetState>{})!;
      expect(label.fontSize, 12);
      expect(label.fontWeight, FontWeight.w700);
      expect(theme.navigationRailTheme.selectedLabelTextStyle!.fontSize, 12);
    });

    test('tap targets stay 48 dp and density standard on every platform', () {
      expect(theme.materialTapTargetSize, MaterialTapTargetSize.padded);
      expect(theme.visualDensity, VisualDensity.standard);
      expect(theme.listTileTheme.minTileHeight, 48);
    });
  });
}
