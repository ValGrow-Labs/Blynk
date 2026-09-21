import 'package:flutter/material.dart';

import 'cart_bar.dart';

/// Floating cart CTA for the routes pushed above the shell (product list,
/// search, product details), which keep their own bar. The shell's four tabs
/// share one [CartBar] in the shell itself, so this is never used on a tab.
class BottomStickyContainer extends StatelessWidget {
  const BottomStickyContainer({super.key});

  @override
  Widget build(BuildContext context) {
    return const Align(
      alignment: Alignment.bottomCenter,
      child: CartBar(bottomSafeArea: true),
    );
  }
}
