import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// An ink progress spinner. Under reduced motion it is a fixed three-quarter
/// arc (no ticker) instead of the indeterminate rotation.
class BlynkSpinner extends StatelessWidget {
  const BlynkSpinner({super.key, required this.size, this.strokeWidth = 2});

  final double size;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(
        value: reduced ? 0.75 : null,
        strokeWidth: strokeWidth,
        color: BlynkColors.ink,
      ),
    );
  }
}
