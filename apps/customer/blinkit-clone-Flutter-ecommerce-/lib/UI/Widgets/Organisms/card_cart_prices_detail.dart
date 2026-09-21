import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/cart.provider.dart';
import '../../../app_design.dart';
import '../../../Services/store_info.dart';
import '../Atoms/money_text.dart';

/// Order Summary: subtotal from CartProvider plus the flat delivery fee.
///
/// These are the prices the customer saw while shopping. The backend
/// re-prices the order and computes the real total when it's placed (see
/// OrderProvider.placeOrder), so no discount, handling or platform fee is
/// ever invented here.
class CartPriceDetailWidget extends StatelessWidget {
  const CartPriceDetailWidget({super.key, this.footer});

  /// Optional content under the total (the desktop checkout CTA).
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final subtotal = cart.subtotal;
    final itemCount = cart.itemCount;
    final total = subtotal + StoreInfo.flatDeliveryFee;

    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: const Text(
              'Order Summary',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: AppTextColors.primary,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _SummaryRow(
            label: 'Subtotal ($itemCount ${itemCount == 1 ? 'item' : 'items'})',
            amount: subtotal,
          ),
          const SizedBox(height: AppSpacing.sm),
          const _SummaryRow(
            label: 'Delivery Fee',
            amount: StoreInfo.flatDeliveryFee,
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Divider(height: 1, color: AppSurfaces.border),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Expanded(
                child: Text(
                  'Total',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: AppTextColors.primary,
                  ),
                ),
              ),
              MoneyText(
                total,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppTextColors.primary,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          const Text(
            '${StoreInfo.paymentMethodLabel} · final amount is confirmed when you place the order.',
            style: TextStyle(fontSize: 12, color: AppTextColors.secondary),
          ),
          if (footer != null) ...[
            const SizedBox(height: AppSpacing.lg),
            footer!,
          ],
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.label, required this.amount});

  final String label;
  final double amount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 14, color: AppTextColors.secondary),
          ),
        ),
        MoneyText(
          amount,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: AppTextColors.primary,
          ),
        ),
      ],
    );
  }
}
