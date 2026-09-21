import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/product.provider.dart';

import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/connectivity_banner.dart';
import '../UI/Widgets/Organisms/home_product_sections.dart';
import '../UI/Widgets/Organisms/home_screen_app_bar.dart';
import '../UI/Widgets/Organisms/home_screen_category_builder.dart';
import '../UI/Widgets/Organisms/home_screen_search_bar.dart';
import '../UI/Widgets/Organisms/home_screen_carousel.dart';
import '../app_responsive.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  /// True while the category tiles or any of Home's product rails show a
  /// skeleton, so the one shared pulse runs only then.
  static bool _isLoading(ProductProvider p) =>
      p.isLoadingCategories ||
      p.categories
          .take(HomeProductSections.defaultMaxSections)
          .any((c) => p.isLoadingProducts(c.slug));

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final loading = context.select<ProductProvider, bool>(_isLoading);
    final hasSavedContent =
        context.select<ProductProvider, bool>((p) => p.categories.isNotEmpty);

    return Scaffold(
      primary: true,
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
                  // Saved items are showing while the connection is down.
                  SliverToBoxAdapter(
                    child: ConnectivityBanner(
                      hasContent: hasSavedContent,
                      onRetry: () => context
                          .read<ProductProvider>()
                          .refreshCatalog(force: true),
                    ),
                  ),
                  const HomeScreenSearchBar(),
                  const HomeScreenCarousel(),
                  SliverToBoxAdapter(
                    child: AppSectionHeader(
                      title: 'Categories',
                      actionLabel: 'See all',
                      onAction: () =>
                          Navigator.of(context).pushNamed('/categories'),
                    ),
                  ),
                  const HomeScreenCateogoryWidget(),
                  // One rail per real backend category - nothing about the
                  // catalog is hardcoded here, so a category added server
                  // side appears without a code change.
                  const HomeProductSections(),
                  const SliverToBoxAdapter(child: SizedBox(height: 24)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
