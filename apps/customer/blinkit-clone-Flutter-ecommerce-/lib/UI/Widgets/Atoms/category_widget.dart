import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show SliverConstraints, SliverGridLayout;

import '../../../Models/category_model.dart';
import '../../../app_design.dart';
import '../../../design/tokens.dart';

/// A single category tile. Used both in Home's compact category rail and in
/// the full Categories screen, so the two can never drift out of sync.
class CategoryWidget extends StatelessWidget {
  const CategoryWidget({
    super.key,
    required this.category,
    this.isActive = false,
    this.onTap,
  });

  final CategoryModel category;
  final bool isActive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: AppRadius.cardBorder,
      onTap: onTap ??
          () => Navigator.pushNamed(
                context,
                '/products',
                arguments: category.slug,
              ),
      // The label takes the height it needs (names like "Biscuits & Snacks"
      // wrap to two lines) and the tile image absorbs whatever is left, so
      // the tile can't overflow its grid cell at narrow widths.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              decoration: BoxDecoration(
                color: BlynkColors.well,
                borderRadius: AppRadius.cardBorder,
                // Selected is a 2 dp ink border, never a yellow wash.
                border: isActive ? Border.all(color: BlynkColors.ink, width: 2) : null,
              ),
              padding: const EdgeInsets.all(AppSpacing.sm),
              alignment: Alignment.center,
              child: category.imageUrl != null && category.imageUrl!.isNotEmpty
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.field),
                      child: Image.network(
                        category.imageUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const _CategoryFallbackIcon(),
                      ),
                    )
                  : const _CategoryFallbackIcon(),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            category.name,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: isActive
                ? BlynkText.caption.copyWith(fontWeight: FontWeight.w800)
                : BlynkText.caption,
          ),
        ],
      ),
    );
  }
}

// Seeded categories currently have no image_url, so this is the honest
// default rather than a broken-image box.
class _CategoryFallbackIcon extends StatelessWidget {
  const _CategoryFallbackIcon();

  @override
  Widget build(BuildContext context) {
    return const Icon(
      Icons.local_grocery_store_outlined,
      color: BlynkColors.ink2,
      size: 26,
    );
  }
}

/// Grid layout for [CategoryWidget] tiles. The tile height is derived from
/// the tile width plus the two-line label at the current text scale (the same
/// pattern as `ProductCard.heightFor`), so a large system font grows the
/// tiles instead of overflowing a fixed aspect ratio.
class CategoryTileGridDelegate extends SliverGridDelegate {
  const CategoryTileGridDelegate({
    required this.crossAxisCount,
    required this.mainAxisSpacing,
    required this.crossAxisSpacing,
    required this.labelHeight,
    this.imageRatio = 0.9,
  });

  final int crossAxisCount;
  final double mainAxisSpacing;
  final double crossAxisSpacing;

  /// Height of the two-line label, from [labelHeightFor].
  final double labelHeight;

  /// Image area height as a fraction of the tile width.
  final double imageRatio;

  /// Two lines of [BlynkText.caption] (16 dp line height) at the current scale.
  static double labelHeightFor(BuildContext context) =>
      MediaQuery.textScalerOf(context).scale(12) * (16 / 12) * 2;

  @override
  SliverGridLayout getLayout(SliverConstraints constraints) {
    final usable = constraints.crossAxisExtent - crossAxisSpacing * (crossAxisCount - 1);
    final tileWidth = usable / crossAxisCount;
    return SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: crossAxisCount,
      mainAxisSpacing: mainAxisSpacing,
      crossAxisSpacing: crossAxisSpacing,
      mainAxisExtent: tileWidth * imageRatio + AppSpacing.sm + labelHeight,
    ).getLayout(constraints);
  }

  @override
  bool shouldRelayout(CategoryTileGridDelegate old) =>
      old.crossAxisCount != crossAxisCount ||
      old.mainAxisSpacing != mainAxisSpacing ||
      old.crossAxisSpacing != crossAxisSpacing ||
      old.labelHeight != labelHeight ||
      old.imageRatio != imageRatio;
}
