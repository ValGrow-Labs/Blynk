import 'package:flutter/material.dart';

import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// Blynk's own promise, set large directly under the header — the line the
/// reference composition opens on.
///
/// This is **brand copy, not data**: it says nothing about the catalogue, the
/// customer or an order, so there is no backend field it could have come from
/// and nothing here can go stale. Everything below it on Home renders backend
/// data or does not render.
///
/// Two tones on two lines: the promise in [BlynkColors.ink], then the payoff
/// word in Blynk Green one step up the type scale. Green is allowed here for
/// the same reason it is allowed on the logo — it is the brand's own colour in
/// a brand lockup, not a status claim about anything, and it is never used as
/// a fill for an action.
class HomeBrandTagline extends StatelessWidget {
  const HomeBrandTagline({super.key});

  static const String promise = 'Your Daily Essentials,';
  static const String payoff = 'Simplified';

  @override
  Widget build(BuildContext context) {
    final gutter = BlynkSpace.gutterFor(Responsive.of(context).width);

    return SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          gutter,
          BlynkSpace.s8,
          gutter,
          BlynkSpace.s16,
        ),
        child: Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: '$promise\n', style: BlynkText.headline),
              TextSpan(
                text: payoff,
                // One step up the scale and the brand green: "heavier" comes
                // from the type token, not from a weight the font does not
                // ship (Catamaran stops at 800).
                style: BlynkText.display.copyWith(color: BlynkColors.positive),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
