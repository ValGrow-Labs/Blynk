import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/UI/Widgets/Atoms/blynk_text_field.dart';
import 'package:ecom/design/tokens.dart';

import 'fixtures/component_host.dart';

InputDecoration _decoration(WidgetTester tester) => tester.widget<TextField>(find.byType(TextField)).decoration!;

Widget _field(
  WidgetTester tester, {
  String? errorText,
  String? helperText,
  bool enabled = true,
  TextEditingController? controller,
  double textScale = 1,
  Widget? suffix,
  ValueChanged<String>? onChanged,
  List<TextInputFormatter>? formatters,
}) {
  return componentHost(
    tester,
    SizedBox(
      width: 320,
      child: BlynkTextField(
        label: 'Mobile number',
        controller: controller,
        hintText: '07X XXX XXXX',
        helperText: helperText,
        errorText: errorText,
        enabled: enabled,
        suffix: suffix,
        onChanged: onChanged,
        keyboardType: TextInputType.phone,
        autofillHints: const [AutofillHints.telephoneNumber],
        inputFormatters: formatters,
      ),
    ),
    textScale: textScale,
  );
}

void main() {
  group('BlynkTextField', () {
    testWidgets('default: label always visible above the field, well fill, lineStrong border, 48 dp', (tester) async {
      await tester.pumpWidget(_field(tester));
      final label = find.text('Mobile number');
      expect(label, findsOneWidget);
      expect(tester.getBottomLeft(label).dy, lessThanOrEqualTo(tester.getTopLeft(find.byType(TextField)).dy));
      final d = _decoration(tester);
      expect(d.filled, isTrue);
      expect(d.fillColor, BlynkColors.well);
      final border = d.enabledBorder! as OutlineInputBorder;
      expect(border.borderSide.color, BlynkColors.lineStrong);
      expect(border.borderSide.width, 1);
      expect(tester.getSize(find.byType(TextField)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('the label stays visible when the field has text (not placeholder-only)', (tester) async {
      final controller = TextEditingController(text: '0771234567');
      addTearDown(controller.dispose);
      await tester.pumpWidget(_field(tester, controller: controller));
      expect(find.text('Mobile number'), findsOneWidget);
      expect(find.text('0771234567'), findsOneWidget);
    });

    testWidgets('focus is a 2 dp ink border', (tester) async {
      await tester.pumpWidget(_field(tester));
      final focused = _decoration(tester).focusedBorder! as OutlineInputBorder;
      expect(focused.borderSide.color, BlynkColors.ink);
      expect(focused.borderSide.width, 2);
    });

    testWidgets('helper text shows below the field', (tester) async {
      await tester.pumpWidget(_field(tester, helperText: 'We send a code to this number'));
      final helper = find.text('We send a code to this number');
      expect(helper, findsOneWidget);
      expect(tester.getTopLeft(helper).dy, greaterThanOrEqualTo(tester.getBottomLeft(find.byType(TextField)).dy));
    });

    testWidgets('error: 2 dp problem border, glyph and text below, live region; replaces helper', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_field(tester, errorText: 'Enter a valid mobile number', helperText: 'helper'));
      final d = _decoration(tester);
      for (final border in [d.enabledBorder!, d.focusedBorder!, d.errorBorder!, d.border!]) {
        final b = border as OutlineInputBorder;
        expect(b.borderSide.color, BlynkColors.problem);
        expect(b.borderSide.width, 2);
      }
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(find.text('Enter a valid mobile number'), findsOneWidget);
      expect(find.text('helper'), findsNothing);
      expect(tester.getTopLeft(find.text('Enter a valid mobile number')).dy, greaterThan(tester.getBottomLeft(find.byType(TextField)).dy - 1));

      final node = tester.getSemantics(find.text('Enter a valid mobile number'));
      expect(node.getSemanticsData().flagsCollection.isLiveRegion, isTrue);
      expect(node.getSemanticsData().label, contains('Enter a valid mobile number'));
      handle.dispose();
    });

    testWidgets('the field has an accessible name from its label and is a text field', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_field(tester));
      final data = tester.getSemantics(find.byType(TextField)).getSemanticsData();
      expect(data.label, contains('Mobile number'));
      expect(data.flagsCollection.isTextField, isTrue);
      handle.dispose();
    });

    testWidgets('disabled: not editable, quieter border', (tester) async {
      await tester.pumpWidget(_field(tester, enabled: false));
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
      expect(((_decoration(tester).disabledBorder!) as OutlineInputBorder).borderSide.color, BlynkColors.line);
    });

    testWidgets('clear button: hidden when empty, 48 dp with a "Clear" tooltip when not, and clears', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);
      String? last;
      await tester.pumpWidget(_field(tester, controller: controller, onChanged: (v) => last = v));
      expect(find.byTooltip('Clear'), findsNothing);

      await tester.enterText(find.byType(TextField), '0771234567');
      await tester.pump();
      final clear = find.byTooltip('Clear');
      expect(clear, findsOneWidget);
      final size = tester.getSize(clear);
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));

      await tester.tap(clear);
      await tester.pump();
      expect(controller.text, isEmpty);
      expect(last, '');
      expect(find.byTooltip('Clear'), findsNothing);
    });

    testWidgets('a custom suffix sits next to the clear button', (tester) async {
      final controller = TextEditingController(text: 'abc');
      addTearDown(controller.dispose);
      await tester.pumpWidget(_field(tester, controller: controller, suffix: const Icon(Icons.lock_outline)));
      expect(find.byIcon(Icons.lock_outline), findsOneWidget);
      expect(find.byTooltip('Clear'), findsOneWidget);
    });

    testWidgets('never forces upper case; forwards keyboard, autofill and formatters', (tester) async {
      await tester.pumpWidget(_field(tester, formatters: [FilteringTextInputFormatter.digitsOnly]));
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.textCapitalization, TextCapitalization.none);
      expect(field.keyboardType, TextInputType.phone);
      expect(field.autofillHints, contains(AutofillHints.telephoneNumber));
      expect(field.inputFormatters, isNotEmpty);
      await tester.enterText(find.byType(TextField), 'a1b2');
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '12');
    });

    for (final scale in kTextScales) {
      testWidgets('no overflow at ${scale}x with an error and a value', (tester) async {
        final controller = TextEditingController(text: '0771234567');
        addTearDown(controller.dispose);
        await tester.pumpWidget(_field(
          tester,
          controller: controller,
          errorText: 'Enter a valid Sri Lankan mobile number',
          textScale: scale,
        ));
        expect(tester.takeException(), isNull);
        expect(tester.getSize(find.byType(TextField)).height, greaterThanOrEqualTo(48));
      });
    }

    testWidgets('tap target and labelled target guidelines (incl. the clear button)', (tester) async {
      final handle = tester.ensureSemantics();
      final controller = TextEditingController(text: '077');
      addTearDown(controller.dispose);
      await tester.pumpWidget(_field(tester, controller: controller));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      handle.dispose();
    });

    testWidgets('text contrast guideline with an error and helper', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_field(tester, errorText: 'Enter a valid mobile number'));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });
}
