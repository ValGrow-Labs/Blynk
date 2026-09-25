import 'package:flutter/material.dart';

import 'package:ecom/app_colors.dart';
import 'package:ecom/design/tokens.dart';

// Legacy shims below (AppSpacing, AppRadius, AppTextColors,
// AppSurfaces, appCardDecoration): removed in T25. New code uses Blynk* tokens.

/// Spacing scale. Screens use these instead of ad-hoc numbers so vertical
/// rhythm stays consistent between sections that were written months apart.
class AppSpacing {
  static const double xs = BlynkSpace.s4;
  static const double sm = BlynkSpace.s8;
  static const double md = BlynkSpace.s12;
  static const double lg = BlynkSpace.s16;
  static const double xl = 20; // off the 4-pt scale; retired in T25
  static const double xxl = BlynkSpace.s24;
  static const double xxxl = BlynkSpace.s32;
}

class AppRadius {
  static const double chip = 999; // fully rounded
  static const double button = 14;
  static const double card = 16;
  static const double sheet = 22;
  static const double field = BlynkRadius.md;

  static BorderRadius get cardBorder => BorderRadius.circular(card);
  static BorderRadius get buttonBorder => BorderRadius.circular(button);
  static BorderRadius get fieldBorder => BorderRadius.circular(field);
  static BorderRadius get sheetBorder => const BorderRadius.vertical(
        top: Radius.circular(sheet),
      );
}

/// Text colours. Blynk's body text is a dark navy rather than pure black -
/// pure black against white is harsher than it needs to be at small sizes.
class AppTextColors {
  static const Color primary = BlynkColors.ink;
  static const Color secondary = BlynkColors.ink2;
  // 2.54:1 on white: fails the text floor, which is why it has no token
  // equivalent and never gained one.
  //
  // W8: it now has **zero call sites in lib/**. The last one was
  // `dental_home_entry.dart`'s trailing chevron, which moved to
  // `BlynkColors.ink2`. It is kept declared only so `audit_fixes_test.dart`
  // can keep measuring that it fails the floor - the evidence for not using
  // it. Do not reintroduce it; use `ink2` or `ink3`.
  static const Color muted = Color(0xff9CA3AF);
  static const Color onYellow = BlynkColors.onSignal;

  /// Secondary-weight text that sits on the page background rather than
  /// inside a white card. `secondary` measures 4.83:1 on white but only
  /// 4.29:1 on `AppColors.greyWhiteColor`, so anything on the page itself
  /// uses this instead.
  static const Color onBackground = BlynkColors.ink3; // 6.72:1 on #EDF2F8

  /// The positive-status green for SMALL TEXT on the page background (for
  /// example the "Live" caption). `AppColors.primaryGreenColor` is 4.90:1 on
  /// white but only 4.36:1 on `AppColors.greyWhiteColor`, below the 4.5:1 AA
  /// bar for text this size; this darker green measures 5.29:1 on #EDF2F8 and
  /// 5.95:1 on white. Keep `primaryGreenColor` for icons, dots and fills.
  static const Color positiveOnBackground = BlynkColors.positiveInk;

  /// Something went wrong or is being destroyed: failure states and the
  /// destructive action. Deliberately a dark red rather than a pure red -
  /// it has to pass 4.5:1 as body text, not just shout.
  static const Color problem = BlynkColors.problem;
}

/// Neutral surfaces used behind images and placeholder tiles.
class AppSurfaces {
  static const Color subtle = BlynkColors.well;
  // Retired tile fill (no token): 1.12:1 against white paper (1.00 only against the old grey page).
  static const Color tile = Color(0xffEEF2F7);
  static const Color border = BlynkColors.line;
}

/// Shared decoration for the app's card surfaces so a product tile, an
/// order row and an address card don't each invent their own radius.
///
/// 2026-09 redesign (spec §2 "Soft shadow is back"): cards float on the
/// [BlynkElevation.soft] token instead of being flat; the hairline outside
/// edge stays alongside it.
BoxDecoration appCardDecoration({Color? color}) {
  return BoxDecoration(
    color: color ?? BlynkColors.paper,
    borderRadius: AppRadius.cardBorder,
    // Outside stroke: the edge is drawn beyond the box, so adding it moved no layout.
    border: Border.all(color: BlynkColors.line, strokeAlign: BorderSide.strokeAlignOutside),
    boxShadow: BlynkElevation.soft,
  );
}

/// Blynk Yellow is the primary action colour; Blynk Green is reserved for
/// success/positive status so it stays meaningful instead of becoming the
/// whole palette.
ButtonStyle appPrimaryButtonStyle({EdgeInsetsGeometry? padding}) {
  return ElevatedButton.styleFrom(
    backgroundColor: AppColors.primaryYellowColor,
    foregroundColor: AppTextColors.onYellow,
    elevation: 0,
    padding: padding ??
        const EdgeInsets.symmetric(
          horizontal: AppSpacing.xxl,
          vertical: AppSpacing.md + 2,
        ),
    // 15 px w800 — the size [appButtonTextScale] measures against.
    textStyle: BlynkText.rowLabel.copyWith(fontWeight: FontWeight.w800),
    shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
  );
}

/// Text scale (1.0 = the design size) the current [MediaQuery] applies to a
/// 15 px label, the size the app's buttons use.
double appButtonTextScale(BuildContext context) => MediaQuery.textScalerOf(context).scale(15) / 15;

/// Above this text scale a secondary + primary button pair stacks vertically.
const double kStackButtonsAboveTextScale = 1.3;

/// A secondary (left, narrower) and primary (right, wider) action side by side.
/// Neither is a fixed height: the caller gives each a minimum height (a floor)
/// and each grows with its label, so a large system font wraps the text instead of clipping it (a fixed
/// height cut labels in half at 1.6x). The pair always has one shared height,
/// and above [kStackButtonsAboveTextScale] it stacks (primary on top) so
/// neither label is squeezed into half a narrow row.
class AppButtonPair extends StatelessWidget {
  const AppButtonPair({
    super.key,
    required this.secondary,
    required this.primary,
  });

  /// The lower-emphasis action (Cancel).
  final Widget secondary;

  /// The primary action (Confirm / Save).
  final Widget primary;

  @override
  Widget build(BuildContext context) {
    if (appButtonTextScale(context) > kStackButtonsAboveTextScale) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          primary,
          const SizedBox(height: AppSpacing.sm),
          secondary,
        ],
      );
    }
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: secondary),
          const SizedBox(width: AppSpacing.md),
          Expanded(flex: 2, child: primary),
        ],
      ),
    );
  }
}
