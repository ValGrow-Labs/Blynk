import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../design/tokens.dart';
import 'image_well.dart';

/// One line of the order's Items section: what it was, how much of it, and
/// what it cost.
///
/// Only the two item states the customer is affected by get a caption. The
/// internal sourcing states (`PENDING`, `SOURCED`, `PACKED`) are the store's
/// business, not the customer's, and are never shown.
class OrderSummaryProductCard extends StatelessWidget {
  const OrderSummaryProductCard({super.key, required this.item});

  final OrderItemModel item;

  /// The line thumbnail. Small enough that a long name keeps the row's width.
  static const double _thumb = 48;

  /// Above this system text scale the thumbnail is dropped. It is decoration —
  /// the backend sends no image for an order item — and at a large font the
  /// name and the amount need the 60 dp more than the picture does. Same
  /// threshold the shared button pair uses to stack.
  static const double _thumbAboveTextScale = 1.3;

  /// The optical gap inside one line's text block — the name, its unit and its
  /// caption are one object, not three stacked rows.
  static const double _lineGap = 2;

  /// The size [_thumbAboveTextScale] is measured against: a body line, because
  /// what competes with the thumbnail for width is text, not a box.
  static const double _textProbe = 14;

  @override
  Widget build(BuildContext context) {
    // RESOLVE_ITEM takes an UNAVAILABLE line out of the totals and out of
    // the amount the rider collects, so the line is struck through: it is
    // shown for the record, but it is not part of the bill.
    final unavailable = item.itemStatus == 'UNAVAILABLE';
    final substituted = item.itemStatus == 'SUBSTITUTED';
    final caption = unavailable
        ? 'Unavailable — not charged'
        : substituted
            ? 'Replaced by the store'
            : null;
    final strike = unavailable ? TextDecoration.lineThrough : null;
    final textScale = MediaQuery.textScalerOf(context).scale(_textProbe) / _textProbe;
    final showsThumb = textScale <= _thumbAboveTextScale;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Order items carry no image field on the backend, so this is the
          // shared no-image well: the app's default product appearance, at
          // identical geometry to a real photo. Decorative — the line's name
          // right beside it is what a screen reader announces.
          if (showsThumb) ...[
            const SizedBox(
              width: _thumb,
              height: _thumb,
              child: BlynkImageWell(glyph: BlynkIcons.product),
            ),
            const SizedBox(width: BlynkSpace.s12),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.productNameSnapshot,
                  style: BlynkText.label.copyWith(decoration: strike),
                ),
                const SizedBox(height: _lineGap),
                Text(
                  '${item.unitSnapshot} × ${item.quantity}',
                  style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
                ),
                if (caption != null) ...[
                  const SizedBox(height: _lineGap),
                  Text(
                    caption,
                    style: BlynkText.caption
                        .copyWith(color: unavailable ? BlynkColors.problem : BlynkColors.ink2),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: BlynkSpace.s12),
          Text(
            formatLkr(item.subtotal),
            style: BlynkType.priceCompact.copyWith(
              color: unavailable ? BlynkColors.ink2 : BlynkColors.ink,
              decoration: strike,
            ),
          ),
        ],
      ),
    );
  }
}
