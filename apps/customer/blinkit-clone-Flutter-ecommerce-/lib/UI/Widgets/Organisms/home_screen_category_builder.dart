import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/category_widget.dart';
import '../Atoms/failure_states.dart';
import '../Atoms/section_header.dart';
import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';

/// Home's category carousel: a "Categories / See all" header over one
/// horizontally scrolling row of circular tiles, in the backend's own
/// display order, with an "All" tile first.
///
/// 2026-09-24: the tiles are **links**, not a filter. Tapping one opens
/// `/products` for that category — the screen that already exists for
/// browsing one category, and which titles itself after it, carries its own
/// category sidebar and lists everything in it. They used to re-query the
/// section underneath and leave you on Home, which meant Home slowly turned
/// into a category screen instead of sending you to one.
///
/// "All" opens the same screen with no slug — every product — so it behaves
/// exactly like the real categories beside it rather than being a control
/// dressed up as one. Nothing here is ever drawn selected: Home holds no
/// filter to be selected for.
///
/// "See all" goes to `/categories`, the full grid of every category.
///
/// The tile itself is the shared [CategoryWidget], so Home and the Categories
/// screen can never drift apart. Rail height is **measured** from the circle
/// plus the reserved label at the current text scale, never a fixed ratio, so
/// a large system font grows the rail instead of clipping it.
class HomeScreenCateogoryWidget extends StatefulWidget {
  const HomeScreenCateogoryWidget({super.key});

  /// The "All" tile. Its slug is the empty string the provider already uses
  /// as its "every product" cache key, so nothing about it is invented or
  /// hidden from the backend.
  static const CategoryModel allChip =
      CategoryModel(id: '', name: 'All', slug: '');

  /// "All" has no name for `fallbackGlyphFor` to map, so its grocery-basket
  /// glyph is named here. It is the same size and surface as every real
  /// category — it reads as one of them, not as a control bolted on front.
  static const IconData allGlyph = BlynkIcons.product;

  /// One tile's width: the circle, plus a little room either side so a
  /// two-word name has somewhere to wrap without touching its neighbour.
  /// Read off [CategoryWidget] so the rail and the Categories grid cannot
  /// drift apart.
  static double tileWidthFor(double width) =>
      CategoryWidget.diameterFor(width) + BlynkSpace.s16;

  /// The rail's height: the circle plus the gap and the reserved label at
  /// the live text scale.
  static double heightFor(BuildContext context, double width) =>
      CategoryWidget.heightFor(context, CategoryWidget.diameterFor(width));

  /// How many skeleton tiles the loading rail shows. Enough to fill a phone
  /// and read as a row, not so many that the lazy list builds off-screen work.
  static const int skeletonCount = 5;

  @override
  State<HomeScreenCateogoryWidget> createState() => _HomeScreenCateogoryWidgetState();
}

class _HomeScreenCateogoryWidgetState extends State<HomeScreenCateogoryWidget> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ProductProvider>().loadCategories();
    });
  }

  @override
  Widget build(BuildContext context) {
    final width = Responsive.of(context).width;
    final gutter = BlynkSpace.gutterFor(width);
    final tileWidth = HomeScreenCateogoryWidget.tileWidthFor(width);
    final railHeight = HomeScreenCateogoryWidget.heightFor(context, width);

    Widget rail({required int count, required IndexedWidgetBuilder builder}) {
      return SizedBox(
        height: railHeight,
        // No visible scrollbar: on web and desktop Flutter draws one over a
        // horizontal list by default, which cuts across the labels and makes
        // a premium rail look like a scroll area.
        child: ScrollConfiguration(
          behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false),
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            // Gutter-aligned on both edges, so the first tile lines up with
            // the section header above it.
            padding: EdgeInsets.symmetric(horizontal: gutter),
            itemCount: count,
            separatorBuilder: (_, __) => const SizedBox(width: BlynkSpace.s12),
            itemBuilder: (context, index) =>
                SizedBox(width: tileWidth, child: builder(context, index)),
          ),
        ),
      );
    }

    // Shown over the rail itself and over the loading rail, so the section
    // does not pop into place once categories arrive. Not shown over the
    // failure state, which states its own title.
    Widget titled(Widget child) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            BlynkSectionHeader(
              title: 'Categories',
              actionLabel: 'See all',
              actionKey: const Key('categories-see-all'),
              onAction: () => Navigator.of(context).pushNamed('/categories'),
              padding: EdgeInsets.fromLTRB(gutter, BlynkSpace.s8, BlynkSpace.s8, BlynkSpace.s12),
            ),
            child,
          ],
        );

    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        if (productProvider.isLoadingCategories) {
          return SliverToBoxAdapter(
            child: titled(
              rail(
                count: HomeScreenCateogoryWidget.skeletonCount,
                builder: (_, __) => const CategoryTileSkeleton(),
              ),
            ),
          );
        }

        final failure = productProvider.categoriesFailure;
        if (failure != null) {
          return SliverToBoxAdapter(
            child: FailureState(
              failure: failure,
              title: "We couldn't load categories",
              retryKey: const Key('categories-retry'),
              scrollable: false,
              onRetry: () => productProvider.loadCategories(force: true),
            ),
          );
        }

        final categories = productProvider.categories;
        if (categories.isEmpty) {
          return const SliverToBoxAdapter(child: SizedBox.shrink());
        }

        // "All" first, then every real category the backend returned.
        return SliverToBoxAdapter(
          child: titled(
            rail(
            count: categories.length + 1,
            builder: (context, index) {
              final isAll = index == 0;
              final category =
                  isAll ? HomeScreenCateogoryWidget.allChip : categories[index - 1];
              // `null` is the products screen's own "every product" argument.
              final slug = isAll ? null : category.slug;

              // Merged so the tile is announced once, as a link, rather than
              // as a label and a target side by side.
              return MergeSemantics(
                child: Semantics(
                  button: true,
                  child: CategoryWidget(
                    category: category,
                    glyph: isAll ? HomeScreenCateogoryWidget.allGlyph : null,
                    onTap: () => Navigator.of(context).pushNamed(
                      '/products',
                      arguments: slug,
                    ),
                  ),
                ),
              );
              },
            ),
          ),
        );
      },
    );
  }
}
