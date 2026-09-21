import 'package:flutter/widgets.dart';

import 'primitives.dart';

/// Motion answers an action or shows a state change; exits are faster than
/// enters. Every duration goes through [resolve] so reduced motion is honoured.
abstract final class BlynkMotion {
  static const Duration fast = BlynkScale.fast;
  static const Duration base = BlynkScale.base;
  static const Duration slow = BlynkScale.slow;

  static const Curve easeIn = Curves.easeInCubic;
  static const Curve easeOut = Curves.easeOutCubic;

  /// [duration], or zero when the platform asks for reduced motion.
  static Duration resolve(BuildContext context, Duration duration) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : duration;
}
