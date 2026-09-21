import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/app_state_views.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/card_product.dart';
import '../../../app_design.dart';
import '../../../design/tokens.dart';
import '../../../app_responsive.dart';
import '../../../Services/Providers/product.provider.dart';

/// A horizontal rail of real products for one category. Renders the same
/// [ProductCard] the grids use - there is intentionally no separate
/// "card for lists" implementation to keep in sync.
class CatgorywithProducts extends StatefulWidget {
  const CatgorywithProducts({
    super.key,
    required this.title,
    required this.categorySlug,
  });

  final String title;
  final String categorySlug;

  @override
  State<CatgorywithProducts> createState() => _CatgorywithProductsState();
}

class _CatgorywithProductsState extends State<CatgorywithProducts> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context
          .read<ProductProvider>()
          .loadProducts(categorySlug: widget.categorySlug);
    });
  }

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final cardWidth =
        responsive.isDesktop ? 190.0 : (responsive.isTablet ? 175.0 : 152.0);
    // The card lays out a square image plus its text and 48 dp control block
    // (all text-scale aware); the rail viewport is exactly that tall.
    final railHeight = ProductCard.heightFor(context, cardWidth);

    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        final products = productProvider.productsFor(widget.categorySlug);
        final isLoading = productProvider.isLoadingProducts(widget.categorySlug);

        // A rail that failed to load says so and offers a retry, instead of
        // silently vanishing as if the category had no stock.
        if (!isLoading &&
            products.isEmpty &&
            productProvider.productsFailureFor(widget.categorySlug) != null) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppSectionHeader(title: widget.title),
              _RailRetryRow(
                slug: widget.categorySlug,
                title: widget.title,
                onRetry: () => productProvider.loadProducts(
                  categorySlug: widget.categorySlug,
                ),
              ),
            ],
          );
        }

        // Nothing to show and nothing coming - don't render an empty section
        // header for a category the backend has no stock in.
        if (!isLoading && products.isEmpty) {
          return const SizedBox.shrink();
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppSectionHeader(
              title: widget.title,
              actionLabel: 'See all',
              onAction: () => Navigator.of(context).pushNamed(
                '/products',
                arguments: widget.categorySlug,
              ),
            ),
            SizedBox(
              height: railHeight,
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                itemCount: isLoading ? 4 : products.length,
                physics: const BouncingScrollPhysics(),
                scrollDirection: Axis.horizontal,
                itemBuilder: (context, index) {
                  return Padding(
                    padding: const EdgeInsets.only(right: AppSpacing.md),
                    child: SizedBox(
                      width: cardWidth,
                      child: isLoading
                          ? const ProductCardSkeleton()
                          : ProductCard(product: products[index]),
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The compact per-section failure: one sentence and a "Try again" that asks
/// only for this rail's products.
class _RailRetryRow extends StatelessWidget {
  const _RailRetryRow({required this.slug, required this.title, required this.onRetry});

  final String slug;
  final String title;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: AppSpacing.sm,
        children: [
          Text("Couldn't load $title.", style: BlynkText.body),
          BlynkButton.tertiary(
            key: Key('rail-retry-$slug'),
            label: 'Try again',
            onPressed: onRetry,
          ),
        ],
      ),
    );
  }
}
