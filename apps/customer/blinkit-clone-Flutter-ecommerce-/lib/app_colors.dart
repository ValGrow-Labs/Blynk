import 'package:flutter/material.dart';

import 'package:ecom/design/tokens.dart';

/// Legacy shim, removed in T25: new code uses [BlynkColors].
class AppColors {
  static const Color primaryYellowColor = BlynkColors.signal;
  static const Color primaryGreenColor = BlynkColors.positive;

  static const Color scaffoldBackgroundColor = BlynkColors.paper;
  // Retired page tint (no token): green text on it measures 4.36:1.
  static const Color greyWhiteColor = Color(0xffEDF2F8);
}
