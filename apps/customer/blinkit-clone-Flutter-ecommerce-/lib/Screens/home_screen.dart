import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/product.provider.dart';

import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/connectivity_banner.dart';
import '../UI/Widgets/Organisms/dental_home_entry.dart';
import '../UI/Widgets/Organisms/home_brand_tagline.dart';
import '../UI/Widgets/Organisms/home_product_sections.dart';
import '../UI/Widgets/Organisms/home_screen_app_bar.dart';
import '../UI/Widgets/Organisms/home_screen_category_builder.dart';
import '../UI/Widgets/Organisms/home_screen_carousel.dart';
import '../UI/Widgets/Organisms/home_screen_search_bar.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// The Shop tab.
///
/// Composition, top to bottom: the brand header (the Blynk lockup, the
/// circular cart / account controls, and the real delivery address block
/// under them) - the full-width search field - the two-tone tagline - the
/// promotional hero **only
/// when the backend returns a live promotion** - the category chips - the
/// dental entry - one honest section header and a grid of the real products
/// behind the selected chip.
///
/// Nothing here is hardcoded content except the tagline, which is brand copy
/// rather than data. Every other section renders backend data or does not
/// render: there is no placeholder hero, no invented "recommended" query, no
/// fixed list of categories, and no rating, review, discount, struck price or
/// wishlist control anywhere - the backend has none of those fields. Sections
/// are separated by space, never by a rule.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  /// Clearance under the last section so the floating cart bar never covers
  /// the final row of cards.
  static const double bottomClearance = BlynkSpace.s48 + BlynkSpace.s24;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  /// 2026-09-24: the category tiles used to **filter this screen in place** —
  /// tapping "Dairy & Eggs" swapped the "Browse all" section underneath for a
  /// "Dairy & Eggs" one and you stayed on Home. They now **open the category**
  /// instead, on the products screen that already exists for exactly that
  /// (`/products`, which takes a slug, titles itself after the category and
  /// lists every product in it).
  ///
  /// So Home no longer holds a selection at all, and the section below the
  /// tiles is always the catalogue-wide "Browse all". Home is the shop front;
  /// browsing one category is its own page.

  /// True while the category tiles or the product grid show a skeleton, so
  /// the one shared pulse runs only then. The empty slug is the provider's
  /// own cache key for the catalogue-wide query.
  bool _isLoading(ProductProvider p) =>
      p.isLoadingCategories || p.isLoadingProducts('');

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final loading = context.select<ProductProvider, bool>(_isLoading);
    final hasSavedContent =
        context.select<ProductProvider, bool>((p) => p.categories.isNotEmpty);

    return Scaffold(
      primary: true,
      backgroundColor: BlynkColors.paper,
      // The cart bar belongs to the shell, so Home never draws its own.
      // On a wide desktop viewport, a single-column feed of sections
      // stretched full-width looks like a mobile layout blown up rather
      // than a real desktop composition - cap and center it instead.
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
          // Pull down for the backend's current catalog. Forced, because
          // the customer asked for it explicitly.
          child: SkeletonScope(
            active: loading,
            child: RefreshIndicator(
              onRefresh: () =>
                  context.read<ProductProvider>().refreshCatalog(force: true),
              child: CustomScrollView(
                // AlwaysScrollable so the pull works even when Home is
                // shorter than the screen.
                physics: const BouncingScrollPhysics(
                  parent: AlwaysScrollableScrollPhysics(),
                ),
                slivers: [
                  const HomeScreenAppBar(),
                  // The search field sits directly under the address block,
                  // where the reference puts it. It is the screen's only way
                  // into Search — the brand row's circular search button was
                  // removed with this restoration.
                  const HomeScreenSearchBar(),
                  // Saved items are showing while the connection is down.
                  SliverToBoxAdapter(
                    child: ConnectivityBanner(
                      hasContent: hasSavedContent,
                      onRetry: () => context
                          .read<ProductProvider>()
                          .refreshCatalog(force: true),
                    ),
                  ),
                  const HomeBrandTagline(),
                  // Renders only when GET /promotions returns a live
                  // promotion; otherwise it is absent, not placeheld.
                  const HomeScreenCarousel(),
                  const SliverToBoxAdapter(
                    child: SizedBox(height: BlynkSpace.s16),
                  ),
                  const HomeScreenCateogoryWidget(),
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.only(top: BlynkSpace.s16),
                      child: DentalHomeEntry(),
                    ),
                  ),
                  // The real products behind the selected chip, titled for
                  // the query that actually runs.
                  // Always the catalogue-wide query: the tiles above open a
                  // category rather than filtering this section.
                  const HomeProductSections(
                    categorySlug: null,
                    categoryName: null,
                  ),
                  const SliverToBoxAdapter(
                    child: SizedBox(height: HomeScreen.bottomClearance),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
