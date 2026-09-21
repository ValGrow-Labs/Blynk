import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/app_colors.dart';
import 'package:ecom/app_design.dart';
import '../Models/order_format.dart';
import '../Models/order_model.dart';
import '../Models/order_status_labels.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Providers/order.provider.dart';
import '../Services/store_info.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../UI/Widgets/Atoms/order_status_chip.dart';
import '../app_responsive.dart';

/// How close to the end of the list (in pixels) a scroll has to get before
/// the next page is requested.
const double _loadMoreThreshold = 200;

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> with WidgetsBindingObserver {
  bool? _wasAuthenticated;

  // Orders are an account endpoint: a browsing guest never triggers the
  // request (and so never sees a 401), and gets a log-in prompt instead.
  bool get _isAuthenticated => context.read<AuthProvider>().isAuthenticated;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _isAuthenticated) context.read<OrderProvider>().refreshOrders(force: true);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Signed in while this tab is already showing: load their orders now.
    final signedIn = context.watch<AuthProvider>().isAuthenticated;
    if (signedIn && _wasAuthenticated == false) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.read<OrderProvider>().refreshOrders(force: true);
      });
    }
    _wasAuthenticated = signedIn;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The list can go stale while the app is backgrounded (an order moves
    // on, a new one arrives) - coming back to the foreground is the moment
    // to ask again, same as the order detail screen. Always refetches page
    // 1, which is fine: that is also what pull-to-refresh does.
    if (state == AppLifecycleState.resumed && _isAuthenticated) {
      context.read<OrderProvider>().loadOrders();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.greyWhiteColor,
      appBar: AppBar(
        automaticallyImplyLeading: true,
        title: const Text("Your Orders"),
      ),
      body: !context.watch<AuthProvider>().isAuthenticated
          ? AppStateView.empty(
              title: 'Log in to see your orders',
              message: 'Your past and current orders appear here.',
              actionLabel: 'Log in',
              onAction: () => Navigator.of(context).pushNamed('/login'),
            )
          : ContentFrame(
        maxWidth: 720,
        gutter: false,
        child: Consumer<OrderProvider>(
        builder: (context, orderProvider, _) {
          final orders = orderProvider.orders;
          // Only the very first load (nothing on screen yet) shows a
          // full-screen spinner - a pull-to-refresh with orders already
          // shown keeps the list visible instead of replacing it.
          final isInitialLoading = orderProvider.isLoadingOrders && orders.isEmpty;
          final failure = orderProvider.ordersFailure;
          final hasError = !isInitialLoading && failure != null && orders.isEmpty;
          final isEmpty = !isInitialLoading && !hasError && orders.isEmpty;
          final showsList = !isInitialLoading && !hasError && !isEmpty;

          // A refresh that fails with orders already on screen must not go
          // silent: the list stays (it is real, just possibly stale) and
          // the failure is said out loud above it, as the first list item -
          // same pattern as order_summary_screen's _RefreshFailedNotice.
          final showsRefreshFailedNotice = showsList && failure != null;
          final noticeOffset = showsRefreshFailedNotice ? 1 : 0;

          final itemCount = showsList ? orders.length + 1 + noticeOffset : 1;

          return NotificationListener<ScrollNotification>(
            onNotification: (notification) {
              if (showsList &&
                  orderProvider.hasMoreOrders &&
                  !orderProvider.isLoadingMore &&
                  notification.metrics.maxScrollExtent - notification.metrics.pixels <=
                      _loadMoreThreshold) {
                orderProvider.loadMoreOrders();
              }
              return false;
            },
            child: RefreshIndicator(
              onRefresh: orderProvider.loadOrders,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                itemCount: itemCount,
                itemBuilder: (context, index) {
                  if (isInitialLoading) {
                    return const PullableState(
                      child: AppStateView.loading('Loading your orders'),
                    );
                  }
                  if (hasError) {
                    return FailureState(
                      failure: failure,
                      title: "Couldn't load your orders.",
                      retryKey: const Key('orders-retry'),
                      onRetry: orderProvider.loadOrders,
                    );
                  }
                  if (isEmpty) {
                    return const PullableState(
                      child: AppStateView.empty(
                        title: "You haven't placed any orders yet.",
                      ),
                    );
                  }
                  if (showsRefreshFailedNotice && index == 0) {
                    return RefreshFailedNotice(
                      key: const Key('orders-refresh-failed'),
                      message: "Couldn't refresh your orders. Pull down to try again.",
                      offline: failure.isOffline,
                    );
                  }
                  final listIndex = index - noticeOffset;
                  if (listIndex == orders.length) {
                    return _ListFooter(provider: orderProvider);
                  }
                  return _OrderRow(order: orders[listIndex]);
                },
              ),
            ),
          );
        },
      ),
      ),
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.provider});

  final OrderProvider provider;

  @override
  Widget build(BuildContext context) {
    if (provider.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
        child: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
        ),
      );
    }
    if (provider.loadMoreError != null) {
      return Semantics(
        button: true,
        label: 'Retry loading more orders',
        excludeSemantics: true,
        onTap: provider.loadMoreOrders,
        child: InkWell(
          onTap: provider.loadMoreOrders,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg, horizontal: AppSpacing.lg),
            child: const Text(
              "Couldn't load more orders. Tap to retry.",
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTextColors.onBackground, fontSize: 12),
            ),
          ),
        ),
      );
    }
    return const SizedBox(height: AppSpacing.lg);
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.order});

  final OrderModel order;

  @override
  Widget build(BuildContext context) {
    final names = order.items.map((i) => i.productNameSnapshot).toList();
    final shownNames = names.take(2).join(', ');
    final remaining = names.length - 2;
    final namesLine = remaining > 0 ? '$shownNames +$remaining more' : shownNames;

    final itemQty = order.items.fold<int>(0, (sum, i) => sum + i.quantity);
    final paymentLabel = order.paymentMethod == 'COD' ? StoreInfo.paymentMethodLabel : order.paymentMethod;
    final total = formatLkr(order.totalAmount);
    final statusLabel = orderStatusLabel(order.status);

    // A finished order (delivered / cancelled) is reference, not news: it
    // keeps every word, at a quieter weight of ink, so a live order is the
    // one the eye lands on first.
    final tone = orderStatusTone(order.status);
    final isClosed = tone == OrderTone.success || tone == OrderTone.neutral;
    final bodyColor = isClosed ? AppTextColors.secondary : AppTextColors.primary;
    const metaStyle = TextStyle(fontSize: 12, color: AppTextColors.secondary);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
      child: Semantics(
        button: true,
        label: '${order.orderNumber}, $statusLabel, $total',
        excludeSemantics: true,
        child: Material(
          color: Colors.white,
          borderRadius: AppRadius.cardBorder,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => Navigator.of(context).pushNamed('/order', arguments: order.id),
            child: Container(
              constraints: const BoxConstraints(minHeight: 48),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                border: Border.all(color: AppSurfaces.border),
                borderRadius: AppRadius.cardBorder,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Wrap (not Row+Spacer) so a long status label on a narrow
                  // screen drops the total to its own line instead of
                  // overflowing - the chip's own text never gets squeezed.
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.xs,
                    children: [
                      OrderStatusChip(status: order.status),
                      Text(
                        total,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: bodyColor,
                        ),
                      ),
                    ],
                  ),
                  if (namesLine.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      namesLine,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, color: bodyColor),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.xs),
                  // Wrap, like the chip+total row above: every fact keeps its
                  // intrinsic width, so nothing is force-split by a flex
                  // share. The reference code stays - as meta rather than as
                  // the first thing the eye lands on - and at 360px it is the
                  // timestamp that drops to a second line rather than any
                  // label losing its tail.
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSpacing.xs,
                    runSpacing: AppSpacing.xs,
                    children: [
                      Text(order.orderNumber, style: metaStyle),
                      const Text('·', style: metaStyle),
                      Text(
                        '$itemQty ${itemQty == 1 ? 'item' : 'items'} · $paymentLabel',
                        style: metaStyle,
                      ),
                      if (order.placedAt != null) ...[
                        const Text('·', style: metaStyle),
                        Text(formatOrderTime(order.placedAt!), style: metaStyle),
                      ],
                    ],
                  ),
                  if (order.showsScheduleNotice) ...[
                    const SizedBox(height: AppSpacing.xs),
                    Row(
                      children: [
                        const Icon(Icons.schedule, size: 14, color: AppTextColors.secondary),
                        const SizedBox(width: AppSpacing.xs),
                        Expanded(
                          child: Text(
                            'Scheduled · ${formatScheduled(order.scheduledFor!)}',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: AppTextColors.secondary),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
