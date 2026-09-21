import 'package:flutter/material.dart';

import 'add_to_cart_button.dart';
import '../../../Models/product_model.dart';
import '../../../app_design.dart';
import 'money_text.dart';

/// The single product tile used by Home rails, category grids and search
/// results. There is deliberately only one of these - every grid in the app
/// renders through it so spacing, price formatting and the add-to-cart
/// affordance can't diverge screen to screen.
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product});

  final ProductModel product;

  static const double _padding = AppSpacing.sm;
  static const double _control = 48; // the ADD / stepper hit box
  static const double _unitLineHeight = 1.25;
  static const double _priceLineHeight = 1.3;

  static double _nameBox(BuildContext context) =>
      MediaQuery.textScalerOf(context).scale(14) * 1.25 * 2 + 1;

  /// Everything in the card except the image, at the current text scale. The
  /// card lays out exactly this, so a rail or grid that gives the card
  /// `heightFor` never overflows and never leaves the image squashed.
  static double chromeHeight(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    return _padding * 2 +
        AppSpacing.sm +
        _nameBox(context) +
        2 +
        scaler.scale(12) * _unitLineHeight +
        AppSpacing.xs +
        scaler.scale(15) * _priceLineHeight +
        _control;
  }

  /// Card height for a card [width] wide: a square image plus [chromeHeight].
  static double heightFor(BuildContext context, double width) =>
      (width - _padding * 2) + chromeHeight(context);

  @override
  Widget build(BuildContext context) {
    final isAvailable = product.isAvailable;

    return InkWell(
      borderRadius: AppRadius.cardBorder,
      onTap: () => Navigator.of(context).pushNamed('/product', arguments: product),
      child: Container(
        decoration: appCardDecoration(),
        padding: const EdgeInsets.all(_padding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.field),
                      child: Container(
                        color: AppSurfaces.subtle,
                        child: ProductImage(product: product),
                      ),
                    ),
                  ),
                  // Only shown when the backend actually reports the product
                  // as unavailable - never inferred or faked client-side.
                  if (!isAvailable)
                    Positioned.fill(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(AppRadius.field),
                        child: Container(
                          color: Colors.white.withValues(alpha: 0.72),
                          alignment: Alignment.center,
                          child: const Text(
                            'Unavailable',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 12,
                              color: AppTextColors.secondary,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            // Always reserves two lines so a one-line name doesn't give its
            // tile a taller image than its two-line neighbour in the row.
            SizedBox(
              height: _nameBox(context),
              child: Text(
                product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  height: 1.25,
                  color: AppTextColors.primary,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              product.unit,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                height: _unitLineHeight,
                color: AppTextColors.secondary,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            // Price on its own line: the 48 dp control needs the full row
            // (a stepper alone is 124 dp, wider than the room beside a price).
            MoneyText(
              product.sellingPrice,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 15,
                height: _priceLineHeight,
                fontWeight: FontWeight.w800,
                color: AppTextColors.primary,
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: AddToCartButton(product: product),
            ),
          ],
        ),
      ),
    );
  }
}

/// The one product image renderer (grid tiles and Product Details), so
/// fit, fade-in and the no-image fallback stay identical everywhere.
class ProductImage extends StatelessWidget {
  const ProductImage({super.key, required this.product, this.fallbackIconSize = 34});

  final ProductModel product;
  final double fallbackIconSize;

  @override
  Widget build(BuildContext context) {
    final url = product.imageUrl;
    if (url == null || url.isEmpty) {
      return _ImageFallback(iconSize: fallbackIconSize);
    }

    return Image.network(
      url,
      fit: BoxFit.contain,
      // Flutter's network image cache handles repeats; this only smooths
      // the first paint so the grid doesn't flash.
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        if (wasSynchronouslyLoaded) return child;
        return AnimatedOpacity(
          opacity: frame == null ? 0 : 1,
          duration: const Duration(milliseconds: 220),
          child: child,
        );
      },
      errorBuilder: (_, __, ___) => _ImageFallback(iconSize: fallbackIconSize),
    );
  }
}

// Seeded products have no image_url yet, so this is what actually renders
// today - a clean placeholder rather than a broken-image glyph.
class _ImageFallback extends StatelessWidget {
  const _ImageFallback({required this.iconSize});

  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppSurfaces.subtle,
      alignment: Alignment.center,
      child: Icon(
        Icons.shopping_basket_outlined,
        color: AppTextColors.muted,
        size: iconSize,
      ),
    );
  }
}
