import 'package:flutter/material.dart';

import 'tokens.dart';

/// Catamaran type scale (size / line height). Nothing below 12.
abstract final class BlynkText {
  static const String family = 'Catamaran';

  static const TextStyle display = TextStyle(
    fontFamily: family,
    fontSize: 28,
    height: 34 / 28,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
  );
  static const TextStyle title = TextStyle(
    fontFamily: family,
    fontSize: 20,
    height: 26 / 20,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
  );
  static const TextStyle heading = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 22 / 16,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );
  static const TextStyle body = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
    color: BlynkColors.ink,
  );
  static const TextStyle label = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );
  static const TextStyle caption = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 16 / 12,
    fontWeight: FontWeight.w600,
    color: BlynkColors.ink,
  );

  /// Prices. Catamaran ships no `tnum` feature, so this falls back to its
  /// default lining figures; the flag keeps columns aligned if a font swap adds it.
  static const TextStyle price = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 22 / 16,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  /// Draws an icon-font glyph as text (a map marker image is painted this way,
  /// where no Icon widget exists). Not part of the type scale.
  static TextStyle glyph(IconData icon, double size, Color color) => TextStyle(
        inherit: false,
        fontFamily: icon.fontFamily,
        package: icon.fontPackage,
        fontSize: size,
        color: color,
      );

  /// The scale mapped onto Material's roles so plain `Text` and Material
  /// widgets pick it up without per-call styling.
  static final TextTheme textTheme = TextTheme(
    displayLarge: display,
    displayMedium: display,
    displaySmall: body.copyWith(color: BlynkColors.ink2),
    headlineLarge: display,
    headlineMedium: title,
    headlineSmall: heading,
    titleLarge: title,
    titleMedium: heading,
    titleSmall: label,
    bodyLarge: body,
    bodyMedium: body,
    bodySmall: caption,
    labelLarge: label,
    labelMedium: caption,
    labelSmall: caption,
  );
}
