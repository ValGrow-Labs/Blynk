import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';

// The backend's catalog is flat (categories, no nested subcategories - see
// backend/api/src/database/migrations/001_initial_schema.sql), so this is
// repurposed as a "browse other categories" rail using the same real
// category list shown on Home, rather than an invented subcategory taxonomy.
//
// 2026-09 redesign (W3): the rail is a `paper` column that stays put while the
// grid beside it scrolls. The selected row keeps its ink edge bar - that is
// what `audit_fixes_test` pins as the selection signal - and gains the same
// `signal` tile the category chip and the navigation shell use for "where you
// are". That tile is chrome, not an action, so it does not consume the
// screen's one yellow action (T2's reading of plan section 4.3).
class CategorySidebar extends StatelessWidget {
  const CategorySidebar({super.key, required this.activeSlug, required this.onSelect});

  final String activeSlug;
  final ValueChanged<CategoryModel> onSelect;

  /// The rail's own measured width, not a design token and not a breakpoint:
  /// it is the [_tileSize] circle plus the row padding, wide enough for a
  /// two-line 12 px label. Screens ask [widthFor]; the responsive *classes*
  /// still come from the one ladder in `app_responsive.dart`.
  static const double compactWidth = 88;
  static const double expandedWidth = 112;

  static double widthFor(double availableWidth) =>
      Responsive.classOf(availableWidth) == ResponsiveClass.compact
          ? compactWidth
          : expandedWidth;

  /// Diameter of the category circle inside a row.
  static const double _tileSize = 44;

  /// The selected row's edge bar.
  static const double _activeBarWidth = 3;

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<ProductProvider>().categories;

    if (categories.isEmpty) {
      return const SizedBox.shrink();
    }

    return ListView.builder(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
      itemCount: categories.length,
      itemBuilder: (BuildContext context, int index) {
        final category = categories[index];
        final isActive = category.slug == activeSlug;

        return Semantics(
          button: true,
          selected: isActive,
          label: category.name,
          excludeSemantics: true,
          onTap: () => onSelect(category),
          child: InkWell(
            onTap: () => onSelect(category),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: BlynkSpace.s4,
                vertical: BlynkSpace.s8,
              ),
              // A floor, not a height: a large text size grows the row.
              constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
              decoration: BoxDecoration(
                border: isActive
                    ? const Border(
                        right: BorderSide(
                          color: BlynkColors.ink,
                          width: _activeBarWidth,
                        ),
                      )
                    : null,
              ),
              child: Column(
                children: [
                  _CategoryTile(category: category, isActive: isActive),
                  const SizedBox(height: BlynkSpace.s4),
                  Text(
                    category.name,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: isActive
                        ? BlynkText.caption.copyWith(
                            fontWeight: FontWeight.w800,
                            color: BlynkColors.ink,
                          )
                        : BlynkText.caption.copyWith(
                            fontWeight: FontWeight.w600,
                            color: BlynkColors.ink3,
                          ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The circle a category's image (or its fallback glyph) sits in. Selected is
/// a filled `signal` tile, matching `CategoryWidget` on Home and Categories so
/// the app has one selected-category appearance.
class _CategoryTile extends StatelessWidget {
  const _CategoryTile({required this.category, required this.isActive});

  final CategoryModel category;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    final url = category.imageUrl?.trim() ?? '';

    return Container(
      width: CategorySidebar._tileSize,
      height: CategorySidebar._tileSize,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: isActive ? BlynkColors.signal : BlynkColors.well,
        shape: BoxShape.circle,
      ),
      child: url.isEmpty
          ? const Icon(Icons.category_outlined, color: BlynkColors.ink2)
          : Image.network(
              url,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) =>
                  const Icon(Icons.category_outlined, color: BlynkColors.ink2),
            ),
    );
  }
}
