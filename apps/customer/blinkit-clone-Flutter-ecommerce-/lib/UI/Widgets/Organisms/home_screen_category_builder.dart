import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/category_widget.dart';
import '../Atoms/failure_states.dart';
import '../../../app_design.dart';
import '../../../app_responsive.dart';
import '../../../Services/Providers/product.provider.dart';

class HomeScreenCateogoryWidget extends StatefulWidget {
  const HomeScreenCateogoryWidget({
    super.key,
  });

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
    final responsive = Responsive.of(context);
    // A 4-column grid of small category tiles goes sparse and oversized on
    // a 1920px desktop viewport, so this scales with the same breakpoints
    // as the rest of the app instead of a single fixed count.
    final crossAxisCount = responsive.isDesktop
        ? 8
        : (responsive.isTablet ? 6 : 4);

    final gridDelegate = CategoryTileGridDelegate(
      crossAxisCount: crossAxisCount,
      mainAxisSpacing: AppSpacing.md,
      crossAxisSpacing: AppSpacing.sm,
      labelHeight: CategoryTileGridDelegate.labelHeightFor(context),
    );

    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        if (productProvider.isLoadingCategories) {
          return SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            sliver: SliverGrid(
              gridDelegate: gridDelegate,
              delegate: SliverChildBuilderDelegate(
                (_, __) => const CategoryTileSkeleton(),
                childCount: crossAxisCount,
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
        // Home shows a compact preview; "See all" opens the full screen.
        final preview = categories.take(crossAxisCount * 2).toList();

        return SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          sliver: SliverGrid(
            gridDelegate: gridDelegate,
            delegate: SliverChildBuilderDelegate(
              (BuildContext context, int index) =>
                  CategoryWidget(category: preview[index]),
              childCount: preview.length,
            ),
          ),
        );
      },
    );
  }
}
