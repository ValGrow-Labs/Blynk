import 'package:flutter/material.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/card_product.dart';
import '../../../Models/product_model.dart';
import '../../../app_responsive.dart';

Widget buildProductsGrid(BuildContext context, List<ProductModel> products) {
  // Fixed at 2 columns regardless of viewport made this grid look identical
  // (and increasingly sparse/oversized) from a 375px phone up to a 1920px
  // desktop monitor - scale with the shared breakpoints instead.
  final crossAxisCount = Responsive.of(context).gridColumns;

  if (products.isEmpty) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24.0),
        child: Text('No products in this category yet.'),
      ),
    );
  }

  const padding = 4.0;
  const spacing = 8.0;

  // A fixed aspect ratio made tiles grow ever taller as columns widen and
  // ignored the user's text size; the card's own height (square image plus
  // its scaled text and 48 dp control) is measured from the tile width instead.
  return LayoutBuilder(
    builder: (context, constraints) {
      final tileWidth =
          (constraints.maxWidth - padding * 2 - spacing * (crossAxisCount - 1)) / crossAxisCount;
      return GridView.builder(
        padding: const EdgeInsets.all(padding),
        physics: const BouncingScrollPhysics(),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: crossAxisCount,
          mainAxisSpacing: spacing,
          crossAxisSpacing: spacing,
          mainAxisExtent: ProductCard.heightFor(context, tileWidth),
        ),
        itemCount: products.length,
        itemBuilder: (BuildContext context, int index) {
          return ProductCard(product: products[index]);
        },
      );
    },
  );
}

/// The grid's loading state: the same columns and tile height as
/// [buildProductsGrid], with one shared pulse for all the skeleton cards.
Widget buildProductsSkeletonGrid(BuildContext context) {
  final crossAxisCount = Responsive.of(context).gridColumns;
  const padding = 4.0;
  const spacing = 8.0;

  return LayoutBuilder(
    builder: (context, constraints) {
      final tileWidth =
          (constraints.maxWidth - padding * 2 - spacing * (crossAxisCount - 1)) / crossAxisCount;
      return SkeletonScope(
        child: GridView.builder(
          padding: const EdgeInsets.all(padding),
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            mainAxisSpacing: spacing,
            crossAxisSpacing: spacing,
            mainAxisExtent: ProductCard.heightFor(context, tileWidth),
          ),
          itemCount: crossAxisCount * 3,
          itemBuilder: (_, __) => const ProductCardSkeleton(),
        ),
      );
    },
  );
}
