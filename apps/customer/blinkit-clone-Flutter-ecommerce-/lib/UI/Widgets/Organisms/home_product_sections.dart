import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/card_product.dart';
import '../Atoms/entrance_fade.dart';
import '../Atoms/section_header.dart';
import 'products_screen_grid.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/product_ranking.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/Providers/product.provider.dart';

/// Home's product section: one honest section header and a responsive grid of
/// the **real** products behind the chip the customer has selected.
///
/// **The title is what the query is, and what was actually done to it.**
/// There is still no recommendations endpoint in this backend, no popularity
/// signal and no cross-customer data, so the section is never called
/// "Recommended for you", "Popular right now" or "Trending" — those would be
/// invented.
///
/// What it may do, and say, is reorder the catalogue against **this
/// customer's own past orders** (see [rankByPurchaseHistory]). When that
/// ranking actually ran the title is [personalisedTitle], which is a
/// statement of fact the Orders screen can corroborate line for line. When
/// the customer is signed out, or signed in with nothing bought yet, no
/// reordering happens and the title stays [allTitle] — literally
/// `GET /catalog/products`. The claim and the data move together, or not at
/// all.
///
/// Columns, gutter, spacing and tile height all come from [BlynkProductGrid]
/// via [productGridDelegate], the one grid rule, so Home's grid is the same
/// grid as the category and search screens: 2 across on a phone.
class HomeProductSections extends StatefulWidget {
  const HomeProductSections({
    super.key,
    required this.categorySlug,
    required this.categoryName,
  });

  /// The selected category's slug, or `null` for the whole catalogue.
  final String? categorySlug;

  /// The selected category's real backend name, or `null` for "All".
  final String? categoryName;

  /// The honest name for the catalogue-wide query, in the backend's own order.
  static const String allTitle = 'Browse all';

  /// Shown **only** when [rankByPurchaseHistory] actually reordered the grid,
  /// which needs a signed-in customer with at least one product in their
  /// order history. It names its source rather than implying an engine.
  static const String personalisedTitle = 'Based on your orders';

  /// How many rows Home previews before handing over to the full listing.
  /// Home is the way in, not the catalogue; "See all" renders only when there
  /// really is more behind it.
  ///
  /// 6 rows is 12 products on a phone (2 columns) and 24 on a desktop (4).
  /// Raised from 3 on 2026-09-25: three rows showed only 6 of the 41 products
  /// in the catalogue, so Home ran out of shop front long before the customer
  /// ran out of scroll. "See all" still appears, because 41 is still more.
  static const int previewRows = 6;

  static const Key retryKey = Key('home-products-retry');

  @override
  State<HomeProductSections> createState() => _HomeProductSectionsState();
}

class _HomeProductSectionsState extends State<HomeProductSections> {
  String get _key => widget.categorySlug ?? '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void didUpdateWidget(HomeProductSections oldWidget) {
    super.didUpdateWidget(oldWidget);
    // After the frame: the provider notifies its listeners synchronously, and
    // this runs inside a build.
    if (oldWidget.categorySlug != widget.categorySlug) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }
  }

  void _load({bool force = false}) {
    if (!mounted) return;
    context
        .read<ProductProvider>()
        .loadProducts(categorySlug: widget.categorySlug, force: force);
    _loadHistory();
  }

  /// Fetches the customer's own orders once, and only when there is a
  /// customer: a signed-out visitor must not have a request made on their
  /// behalf that can only come back 401, and must not be ranked at all.
  void _loadHistory() {
    if (!mounted || widget.categorySlug != null) return;
    if (!context.read<AuthProvider>().isAuthenticated) return;
    final orders = context.read<OrderProvider>();
    if (orders.hasLoadedOrders || orders.isLoadingOrders) return;
    orders.loadOrders();
  }

  @override
  Widget build(BuildContext context) {
    // Only the catalogue-wide section is ranked. Inside one category the
    // customer has already said what they want, and reordering it would
    // just make the same shelf look different every visit.
    final signal = widget.categorySlug == null
        ? context.select<OrderProvider, PurchaseHistorySignal>(
            (o) => PurchaseHistorySignal.fromOrders(o.orders),
          )
        : PurchaseHistorySignal.none;

    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        final products = rankByPurchaseHistory(productProvider.productsFor(_key), signal);
        // The title follows what actually happened to the list above, so it
        // can never claim a personalisation that did not run.
        final ranked = widget.categorySlug == null && signal.isNotEmpty;
        final title = widget.categoryName ??
            (ranked
                ? HomeProductSections.personalisedTitle
                : HomeProductSections.allTitle);
        final isLoading = productProvider.isLoadingProducts(_key);
        final failure = productProvider.productsFailureFor(_key);

        // Nothing to show and nothing coming: no header over an empty box,
        // and no invented "check back soon" promise about restocking.
        if (!isLoading && products.isEmpty && failure == null) {
          return const SliverToBoxAdapter(child: SizedBox.shrink());
        }

        // A section that failed to load says so and offers a retry, instead
        // of silently vanishing as if the shelf were empty. It stays a
        // compact row rather than a full-page state so the offline banner
        // above it is still the screen's one voice about being offline.
        if (!isLoading && products.isEmpty) {
          return SliverMainAxisGroup(
            slivers: [
              SliverToBoxAdapter(child: BlynkSectionHeader(title: title)),
              SliverToBoxAdapter(
                child: _SectionRetryRow(
                  message: widget.categoryName == null
                      ? "Couldn't load products."
                      : "Couldn't load ${widget.categoryName}.",
                  onRetry: () => _load(force: true),
                ),
              ),
            ],
          );
        }

        return SliverLayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.crossAxisExtent;
            final columns = BlynkProductGrid.columnsFor(width);
            final preview = columns * HomeProductSections.previewRows;
            final hasMore = products.length > preview;
            final visible =
                hasMore ? products.sublist(0, preview) : products;

            return SliverMainAxisGroup(
              slivers: [
                SliverToBoxAdapter(
                  child: BlynkSectionHeader(
                    title: title,
                    // Only rendered when there really is more to see.
                    actionLabel: hasMore ? 'See all' : null,
                    onAction: hasMore
                        ? () => Navigator.of(context).pushNamed(
                              '/products',
                              arguments: widget.categorySlug ?? '',
                            )
                        : null,
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.symmetric(
                    horizontal: BlynkProductGrid.gutterFor(width),
                  ),
                  sliver: SliverGrid.builder(
                    gridDelegate: productGridDelegate(context, width),
                    itemCount: isLoading && products.isEmpty
                        ? columns * 2
                        : visible.length,
                    itemBuilder: (context, index) =>
                        isLoading && products.isEmpty
                            ? const ProductCardSkeleton()
                            // Tiles arrive as a wave rather than all at once.
                            // Keyed by product id so the arrival belongs to
                            // the product, not to the slot: without the key a
                            // reorder (see rankByPurchaseHistory) would replay
                            // the animation on whichever card took the slot.
                            : EntranceFade(
                                key: ValueKey(visible[index].id),
                                delay: EntranceFade.delayFor(index),
                                child: ProductCard(product: visible[index]),
                              ),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }
}

/// The compact per-section failure: one sentence and a "Try again" that asks
/// only for this section's products.
class _SectionRetryRow extends StatelessWidget {
  const _SectionRetryRow({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: BlynkSpace.gutterFor(Responsive.of(context).width),
      ),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: BlynkSpace.s8,
        children: [
          Text(message, style: BlynkText.body),
          BlynkButton.tertiary(
            key: HomeProductSections.retryKey,
            label: 'Try again',
            onPressed: onRetry,
          ),
        ],
      ),
    );
  }
}
