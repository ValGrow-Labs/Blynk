import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// ratchet: lower as screens migrate, target 0. These only ever go down.
const int kMaxRawColorLiterals = 3; // Color(0x...)  (AUDITFIX: was 16, measured 15)
const int kMaxRawMaterialColors = 53; // Colors.x (not Colors.transparent)  (AUDITFIX: was 72)
const int kMaxFontSizeLiterals = 117; // fontSize: ...  (AUDITFIX: was 134)
// fontSize: literals below the 12 px floor. Four remain, all in deferred or off-limits files
// (address cards, cancellation policy card, two map overlays); only ever lower this.
const int kMaxSubFloorFontSizes = 4;

/// Files that legitimately hold raw values (token layer, legacy shims, theme).
const _exempt = <String>{
  'lib/app_colors.dart',
  'lib/app_design.dart',
  'lib/app_theme.dart',
};

List<File> _dartFiles(String root) {
  return Directory(root)
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();
}

String _norm(String path) => path.replaceAll(r'\', '/');

int _count(Iterable<File> files, RegExp pattern) =>
    files.fold(0, (sum, f) => sum + pattern.allMatches(f.readAsStringSync()).length);

void main() {
  final all = _dartFiles('lib');
  final screens = all.where((f) {
    final p = _norm(f.path);
    return !p.startsWith('lib/design/') && !_exempt.contains(p);
  }).toList();

  final rawColor = RegExp(r'Color\(0x');
  final materialColors = RegExp(r'(?<![A-Za-z_])Colors\.(?!transparent\b)[A-Za-z]');
  final fontSize = RegExp(r'fontSize\s*:');

  group('design hygiene ratchet (outside lib/design and the legacy shims)', () {
    test('Color(0x...) literals do not grow', () {
      expect(_count(screens, rawColor), lessThanOrEqualTo(kMaxRawColorLiterals));
    });

    test('raw Colors.x usages do not grow', () {
      expect(_count(screens, materialColors), lessThanOrEqualTo(kMaxRawMaterialColors));
    });

    test('fontSize: literals do not grow', () {
      expect(_count(screens, fontSize), lessThanOrEqualTo(kMaxFontSizeLiterals));
    });
  });

  group('audit fixes stay fixed (source guards over lib/UI and lib/Screens)', () {
    final ui = all.where((f) {
      final p = _norm(f.path);
      return p.startsWith('lib/UI/') || p.startsWith('lib/Screens/');
    }).toList();
    final everything = screens; // lib minus lib/design and the three legacy shims

    String read(File f) => f.readAsStringSync();
    Iterable<String> offenders(Iterable<File> files, RegExp pattern) =>
        files.where((f) => pattern.hasMatch(read(f))).map((f) => _norm(f.path));

    test('no ALL-CAPS labels: no .toUpperCase() and no ALL-CAPS string literals in a Text or section label', () {
      expect(offenders(ui, RegExp(r'\.toUpperCase\(\)')), isEmpty);
      // Two or more upper-case words in one literal, e.g. 'DELIVERY ADDRESS'.
      expect(offenders(ui, RegExp(r"""['"][A-Z]{2,}(?: [A-Z&]+)+['"]""")), isEmpty);
    });

    test('no arrow on a button label', () {
      expect(offenders(ui, RegExp(r'Icons\.arrow_forward|Next\s*→|→')), isEmpty);
    });

    test('fontSize literals below the 12 px floor only ever go down', () {
      final low = RegExp(r'fontSize\s*:\s*(\d+(?:\.\d+)?)');
      var count = 0;
      for (final f in everything) {
        for (final m in low.allMatches(read(f))) {
          if (double.parse(m.group(1)!) < 12) count++;
        }
      }
      expect(count, lessThanOrEqualTo(kMaxSubFloorFontSizes));
    });

    test('no decorative gradient: RadialGradient is gone; the one LinearGradient family is the promo scrim/wash', () {
      expect(offenders(everything, RegExp(r'RadialGradient')), isEmpty);
    });

    test('no drop shadow from the legacy card token, and appCardDecoration is flat', () {
      expect(offenders(all, RegExp(r'AppElevation')), isEmpty);
      final design = File('lib/app_design.dart').readAsStringSync();
      expect(design, isNot(contains('AppElevation')));
      expect(design, contains('BlynkElevation.none'));
    });

    test('yellow is never a translucent wash', () {
      expect(
        offenders(everything, RegExp(r'(primaryYellowColor|BlynkColors\.signal)[^;]{0,80}withValues\(\s*alpha')),
        isEmpty,
      );
    });

    test('no orange checkout icons (address cards still carry deepOrange/red: deferred to the address-book redesign)', () {
      expect(offenders(everything, RegExp(r'Colors\.orangeAccent')), isEmpty);
    });

    test('control outlines use lineStrong, not the 1.2:1 hairline', () {
      for (final path in [
        'lib/UI/Widgets/Organisms/home_screen_search_bar.dart',
        'lib/Screens/search_screen.dart',
        'lib/Screens/order_confirmation_screen.dart',
      ]) {
        expect(File(path).readAsStringSync(), isNot(contains('AppSurfaces.border')), reason: path);
      }
      final cancel = File('lib/UI/Widgets/Organisms/order_cancel_section.dart').readAsStringSync();
      expect(cancel, isNot(contains('side: const BorderSide(color: AppSurfaces.border)')));
    });

    test('no "Sorry" and no exclamation mark in a customer-facing title or message', () {
      expect(offenders(ui, RegExp(r"title:\s*'[^']*(Sorry|!)")), isEmpty);
      expect(offenders(ui, RegExp(r"message:\s*'[^']*!")), isEmpty);
    });

    test('the green primary button pattern is gone: no primaryGreenColor fill on a button', () {
      expect(
        offenders(ui, RegExp(r'backgroundColor:\s*(AppColors\.primaryGreenColor|BlynkColors\.positive)')),
        isEmpty,
      );
      for (final path in [
        'lib/Screens/Auth/otp_verification_screen.dart',
        'lib/UI/Widgets/Organisms/login_screen_otp_sheet.dart',
        'lib/Screens/Auth/login_screen.dart',
        'lib/UI/Widgets/Organisms/cart_screen_payment_container.dart',
        'lib/UI/Widgets/Organisms/cart_screen_address_container.dart',
        'lib/UI/Widgets/Organisms/home_screen_app_bar.dart',
        'lib/UI/Widgets/Organisms/home_screen_carousel.dart',
      ]) {
        final source = File(path).readAsStringSync();
        expect(source, isNot(contains('primaryGreenColor')), reason: path);
        expect(source, isNot(contains('BlynkColors.positive')), reason: path);
        expect(source, isNot(contains('Colors.grey')), reason: path);
      }
    });

    test('no fixed-height text box around a primary button or bar', () {
      expect(
        File('lib/UI/Widgets/Organisms/cart_screen_payment_container.dart').readAsStringSync(),
        isNot(contains('height: 70')),
      );
      expect(File('lib/Screens/user_orders_screen.dart').readAsStringSync(), isNot(contains('minHeight: 44')));
    });
  });

  group('lib/design token layer', () {
    final design = all.where((f) => _norm(f.path).startsWith('lib/design/')).toList();

    test('exists and is non-empty', () {
      expect(design, isNotEmpty);
    });

    test('contains no Colors.x', () {
      final offenders = design.where((f) => RegExp(r'(?<![A-Za-z_])Colors\.').hasMatch(f.readAsStringSync()));
      expect(offenders.map((f) => f.path), isEmpty);
    });

    test('raw Color(0x...) appears only in primitives.dart', () {
      final offenders = design
          .where((f) => !_norm(f.path).endsWith('lib/design/primitives.dart'))
          .where((f) => rawColor.hasMatch(f.readAsStringSync()));
      expect(offenders.map((f) => f.path), isEmpty);
    });

    test('has no fontSize: literal outside typography.dart', () {
      final offenders = design
          .where((f) => !_norm(f.path).endsWith('lib/design/typography.dart'))
          .where((f) => fontSize.hasMatch(f.readAsStringSync()));
      expect(offenders.map((f) => f.path), isEmpty);
    });
  });
}
