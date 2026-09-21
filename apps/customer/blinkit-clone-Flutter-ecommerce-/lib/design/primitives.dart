import 'package:flutter/painting.dart';

/// Raw design values. This is the only file where brand colour hex literals
/// live; everything else reads them through `tokens.dart`.
abstract final class BlynkPalette {
  static const Color signal = Color(0xFFFFE141);
  // Darker than signal (1.29:1) yet ink stays 9.93:1 on it.
  static const Color signalPressed = Color(0xFFE5C700);
  static const Color ink = Color(0xFF1A1D2E);
  static const Color ink2 = Color(0xFF6B7280);
  static const Color ink3 = Color(0xFF4B5563);
  static const Color paper = Color(0xFFFFFFFF);
  static const Color well = Color(0xFFF6F8FB);
  static const Color line = Color(0xFFE5E9F0);
  static const Color lineStrong = Color(0xFF7B8494);
  static const Color positive = Color(0xFF0C831F);
  static const Color positiveInk = Color(0xFF0A741B);
  static const Color positiveTint = Color(0xFFE8F5EA);
  static const Color problem = Color(0xFFB42318);
  static const Color problemTint = Color(0xFFFDECEA);
  static const Color notice = Color(0xFF8A5A00);
  static const Color noticeTint = Color(0xFFFFF6BF);

  /// Black at 50 %.
  static const Color scrim = Color(0x80000000);
  static const Color clear = Color(0x00000000);

  /// Black at 10 % / 16 %: the only two shadows the system allows.
  static const Color shadowRaised = Color(0x1A000000);
  static const Color shadowOverlay = Color(0x29000000);
}

abstract final class BlynkScale {
  static const double s4 = 4;
  static const double s8 = 8;
  static const double s12 = 12;
  static const double s16 = 16;
  static const double s24 = 24;
  static const double s32 = 32;
  static const double s48 = 48;

  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 20;

  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration slow = Duration(milliseconds: 280);

  static const double iconSm = 20;
  static const double iconMd = 24;
  static const double iconLg = 32;
}
