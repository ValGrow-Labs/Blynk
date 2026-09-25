import 'package:flutter/material.dart';

import '../../../Models/order_model.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../Atoms/card_product_order_summary.dart';
import '../../../design/tokens.dart';

/// Section 3 of the order detail: what was ordered, straight from the
/// order's item snapshots (name, unit, quantity and line subtotal as the
/// backend recorded them at placement).
class OrderSummaryProductsDetails extends StatelessWidget {
  const OrderSummaryProductsDetails({
    super.key,
    required this.order,
  });

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final itemCount = order.items.fold<int>(0, (sum, i) => sum + i.quantity);

    return Container(
      key: const Key('order-items'),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      // The app's one card recipe, the same one the bill card uses.
      decoration: appCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Items', style: BlynkText.sectionHeader)),
              Text(
                '$itemCount ${itemCount == 1 ? 'item' : 'items'}',
                style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
              ),
            ],
          ),
          const SizedBox(height: BlynkSpace.s8),
          for (final item in order.items) OrderSummaryProductCard(item: item),
        ],
      ),
    );
  }
}
