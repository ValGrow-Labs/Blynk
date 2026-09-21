import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/cart.provider.dart';
import '../../../app_design.dart';
import '../../../Models/order_format.dart';
import 'add_to_cart_button.dart';
import 'card_product.dart';
import 'money_text.dart';

/// One cart line. Everything shown comes from the [CartLine] held by
/// CartProvider; quantity changes go through the shared [AddToCartButton]
/// stepper, so the cart, product cards and Product Details can't drift
/// apart.
class CartProductCard extends StatelessWidget {
  const CartProductCard({
    super.key,
    required this.line,
    this.interactive = true,
  });

  final CartLine line;

  /// False for the frozen copy shown while a removed line animates out -
  /// its product is no longer in the cart, so it must not offer controls.
  final bool interactive;

  // Rows at least this wide put price and stepper on the name's line.
  static const double _wideRowBreakpoint = 520;

  @override
  Widget build(BuildContext context) {
    final product = line.product;

    return Container(
      decoration: appCardDecoration(),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= _wideRowBreakpoint;
          final imageSize = wide ? 80.0 : 72.0;

          final image = Semantics(
            button: interactive,
            label: interactive ? 'View ${product.name}' : null,
            excludeSemantics: true,
            child: InkWell(
              borderRadius: AppRadius.fieldBorder,
              onTap: interactive
                  ? () => Navigator.of(context)
                      .pushNamed('/product', arguments: product)
                  : null,
              child: Container(
                width: imageSize,
                height: imageSize,
                padding: const EdgeInsets.all(AppSpacing.sm - 2),
                decoration: BoxDecoration(
                  color: AppSurfaces.subtle,
                  borderRadius: AppRadius.fieldBorder,
                ),
                child: ProductImage(product: product, fallbackIconSize: 28),
              ),
            ),
          );

          final details = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.25,
                  fontWeight: FontWeight.w700,
                  color: AppTextColors.primary,
                ),
              ),
              if (product.unit.trim().isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  product.unit,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppTextColors.secondary,
                  ),
                ),
              ],
            ],
          );

          final price = _LinePrice(line: line, alignEnd: wide);
          final stepper = interactive
              ? AddToCartButton(product: product, compact: false)
              // Same footprint as the live stepper (48 dp tall) so the fade-out
              // copy doesn't shift while it leaves.
              : const SizedBox(height: 48, width: 124);
          final remove = _RemoveButton(line: line, enabled: interactive);

          if (wide) {
            return Row(
              children: [
                image,
                const SizedBox(width: AppSpacing.lg),
                Expanded(child: details),
                const SizedBox(width: AppSpacing.lg),
                SizedBox(width: 120, child: price),
                const SizedBox(width: AppSpacing.lg),
                stepper,
                const SizedBox(width: AppSpacing.xs),
                remove,
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              image,
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: details),
                        remove,
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    // Wrap: at a large text size the stepper drops below the
                    // price instead of squeezing it.
                    SizedBox(
                      width: double.infinity,
                      child: Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: AppSpacing.sm,
                        children: [price, stepper],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _LinePrice extends StatelessWidget {
  const _LinePrice({required this.line, required this.alignEnd});

  final CartLine line;
  final bool alignEnd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment:
          alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        MoneyText(
          line.lineTotal,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w800,
            color: AppTextColors.primary,
          ),
        ),
        if (line.quantity > 1)
          Text(
            '${line.quantity} × ${formatLkr(line.product.sellingPrice)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12,
              color: AppTextColors.secondary,
            ),
          ),
      ],
    );
  }
}

class _RemoveButton extends StatelessWidget {
  const _RemoveButton({required this.line, required this.enabled});

  final CartLine line;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Remove ${line.product.name}',
      onPressed: enabled
          ? () => context.read<CartProvider>().remove(line.product.id)
          : null,
      icon: const Icon(Icons.delete_outline_rounded, size: 20),
      color: AppTextColors.secondary,
      disabledColor: AppTextColors.muted,
      // A 48 x 48 hit target (it sat at 40 x 40 with compact density).
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      padding: EdgeInsets.zero,
    );
  }
}
