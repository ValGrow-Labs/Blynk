import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../design/tokens.dart';

/// A rupee amount, formatted only by [formatLkr] (never re-implemented here)
/// and typed only by [BlynkType.price] — the two places money may be decided.
/// Blynk prices are LKR; there is no dollar path anywhere in the app and a
/// guard keeps it that way.
///
/// [compact] (the default) hides the `.00` on a whole amount and shows cents
/// otherwise, exactly as [formatLkr] does; `compact: false` keeps `.00` for
/// aligned bill columns. Paise are never rounded away either way.
class MoneyText extends StatelessWidget {
  const MoneyText(
    this.amount, {
    super.key,
    this.style,
    this.compact = true,
    this.semanticsLabel,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });

  final double amount;
  final TextStyle? style;
  final bool compact;

  /// Overrides the spoken label; defaults to the formatted amount.
  final String? semanticsLabel;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    final text = formatLkr(amount, alwaysShowCents: !compact);
    return Semantics(
      label: semanticsLabel ?? text,
      excludeSemantics: true,
      child: Text(
        text,
        textAlign: textAlign,
        maxLines: maxLines,
        overflow: overflow,
        style: BlynkType.price.merge(style),
      ),
    );
  }
}

/// A struck-through original price, designed to sit next to [MoneyText]:
/// [BlynkType.priceStruck] ([BlynkColors.strike] with a line-through), at the
/// same [amount] formatting rules as [MoneyText].
///
/// **It has no call site and must not get one until the backend really sends
/// an original price.** Plan §3 rejects the reference mock's discount pills
/// and struck prices outright because there is no data source for them, so
/// rendering this from a computed or assumed "was" price would be fabricated
/// commerce data. A guard asserts the call-site count stays at zero; delete
/// the guard together with the first honest caller.
class StruckPrice extends StatelessWidget {
  const StruckPrice(this.amount, {super.key, this.style, this.compact = true});

  final double amount;
  final TextStyle? style;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = formatLkr(amount, alwaysShowCents: !compact);
    return Semantics(
      label: 'was $text',
      excludeSemantics: true,
      child: Text(
        text,
        style: BlynkType.priceStruck.merge(style),
      ),
    );
  }
}
