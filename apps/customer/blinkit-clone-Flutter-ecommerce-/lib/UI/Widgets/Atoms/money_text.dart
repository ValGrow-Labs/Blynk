import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../design/tokens.dart';

/// A rupee amount, formatted only by [formatLkr] (never re-implemented here).
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
        style: BlynkText.price.merge(style),
      ),
    );
  }
}
