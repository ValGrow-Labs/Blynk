import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:ecom/app_colors.dart';
import '../Models/order_model.dart';
import '../Services/Exceptions/api_exception.dart';
import '../Services/Providers/location.provider.dart';
import '../Services/Providers/order.provider.dart';
import '../UI/Widgets/Atoms/card_order_details.dart';
import '../UI/Widgets/Organisms/map_provider.dart';
import '../UI/Widgets/Organisms/order_bill_card.dart';
import '../UI/Widgets/Organisms/order_cancel_section.dart';
import '../UI/Widgets/Organisms/order_status_header.dart';
import '../UI/Widgets/Organisms/order_summary_screen_product_details_card.dart';
import '../UI/Widgets/Organisms/order_timeline.dart';
import '../UI/Widgets/Organisms/order_tracking_map.dart';
import '../app_design.dart';

/// The backend's `delivery.assignment_status` once the rider has collected the
/// order and is on the way (the value the API sends: exact, upper-case).
const String _pickedUpAssignmentStatus = 'PICKED_UP';

/// True only in the window where the customer may see the rider live: the
/// order is OUT_FOR_DELIVERY *and* its delivery is PICKED_UP. Never before
/// pickup (PACKED / ASSIGNED), and never once the rider has arrived
/// (ARRIVED_AT_CUSTOMER) or the order is delivered, failed or cancelled.
///
/// Pure: the one place both the map section and the location-stream watch ask.
bool isLiveTrackable(OrderModel order) =>
    order.status == OrderStatus.outForDelivery &&
    order.delivery?.assignmentStatus == _pickedUpAssignmentStatus;

/// The order detail screen: everything the backend knows about one order,
/// in the order the customer asks it in - where is it, what happened, what
/// was in it, what it costs, where it's going, and (only if the backend says
/// so) how to cancel it.
///
/// Nothing here is inferred: no clock, no timers, no polling and no
/// progress the backend hasn't recorded. It refetches on pull-to-refresh,
/// when the app returns to the foreground, after every cancel attempt, and
/// once when the live location stream reports that the server closed it.
///
/// While [isLiveTrackable] it shows the live map and keeps the
/// [LocationProvider] watching this order; see [_OrderSummaryScreenState].
class OrderSummaryScreen extends StatefulWidget {
  const OrderSummaryScreen({super.key, required this.orderId, this.mapBuilder});

  final String orderId;

  /// Test seam, passed straight to [OrderTrackingMap]: lets widget tests swap
  /// the native map for a fake. Production callers leave it null.
  final TrackingMapBuilder? mapBuilder;

  @override
  State<OrderSummaryScreen> createState() => _OrderSummaryScreenState();
}

class _OrderSummaryScreenState extends State<OrderSummaryScreen> with WidgetsBindingObserver {
  OrderModel? _order;
  ApiException? _error;
  bool _loading = true;

  // Bumped by every _load(). A refetch can be triggered from three places
  // (pull-to-refresh, a foreground resume, the cancel section), so two can
  // overlap; without this, the slower/older response could land last and
  // put a stale order back on screen.
  int _loadGeneration = 0;

  // --- live location watch -------------------------------------------------
  //
  // The screen owns one rule: the LocationProvider watches an order exactly
  // while that order is live-trackable AND the app is in the foreground.
  // `watch()` clears all provider state, so it is called only on the edge
  // (not watching -> watching), never on every refresh.

  /// Cached on first use rather than in initState: an order that is never
  /// trackable never needs the provider (so a tree without one still works).
  LocationProvider? _location;

  /// The order id the provider is currently watching, or null.
  String? _watchedOrderId;

  /// True from the app going to the background until it is resumed. A fetch
  /// that answers while backgrounded still updates the screen but must not
  /// open a connection.
  bool _inBackground = false;

  /// Set when a server close has been turned into a refetch, cleared when the
  /// provider's `closed` goes false again (a fresh watch, or stopWatching), so
  /// one close is one refetch and later notifications cause none.
  bool _closeRefetchDone = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final location = _location;
    if (location != null) {
      location.removeListener(_onLocationChanged);
      _stopWatch(location);
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        // An order can change while the app is in the background (packed,
        // dispatched, cancelled by the store). Coming back to the foreground
        // is the moment to ask again - instead of polling on a timer. The
        // refetch also re-evaluates the live-tracking gate, so a still
        // trackable order gets a fresh watch from _syncWatch.
        _inBackground = false;
        _load();
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        // No window is visible: nobody can see the rider, so do not hold an
        // SSE connection (battery, data, a server slot) open. `hidden`
        // precedes `paused` on mobile, so acting on both is idempotent.
        // `inactive` is deliberately NOT here: the app is still visible then
        // (notification shade, a system dialog, split-screen) and tearing the
        // stream down for a glance at the shade would reset the map for
        // nothing.
        _inBackground = true;
        final location = _location;
        if (location != null) _stopWatch(location);
      case AppLifecycleState.inactive:
        break;
    }
  }

  /// Makes the provider's watch match the order: watch when it has become
  /// trackable (or a different order is now shown), stop when it stopped
  /// being trackable, leave it alone otherwise.
  void _syncWatch(OrderModel? order) {
    if (!mounted) return;

    if (order == null || !isLiveTrackable(order) || _inBackground) {
      final location = _location;
      if (location != null) _stopWatch(location);
      return;
    }

    var location = _location;
    if (location == null) {
      location = context.read<LocationProvider>();
      location.addListener(_onLocationChanged);
      _location = location;
    }
    if (_watchedOrderId == order.id) return; // already watching: keep its state
    if (_watchedOrderId != null) location.stopWatching(); // a different order
    _watchedOrderId = order.id;
    location.watch(order.id);
  }

  void _stopWatch(LocationProvider location) {
    if (_watchedOrderId == null) return;
    _watchedOrderId = null;
    location.stopWatching();
  }

  /// Runs on every LocationProvider notification (rider points, ticks...). It
  /// only acts on the edge into `closed`: the server ended the stream
  /// authoritatively (arrived / delivered / failed / cancelled), so ask the
  /// backend what the order is now instead of showing "out for delivery"
  /// forever. Guarded so one close is one refetch.
  void _onLocationChanged() {
    final closed = _location?.closed ?? false;
    if (!closed) {
      _closeRefetchDone = false;
      return;
    }
    if (_closeRefetchDone || _watchedOrderId == null) return;
    _closeRefetchDone = true;
    _load();
  }

  Future<void> _load() async {
    final gen = ++_loadGeneration;
    // `_loading` starts true, so the initState call finds it already set and
    // never calls setState before the first build.
    if (!_loading) setState(() => _loading = true);

    try {
      final order = await context.read<OrderProvider>().fetchOrder(widget.orderId);
      if (!mounted || gen != _loadGeneration) return;
      setState(() {
        _order = order;
        _error = null;
        _loading = false;
      });
      _syncWatch(order);
    } on ApiException catch (e) {
      if (!mounted || gen != _loadGeneration) return;
      setState(() {
        _error = e;
        _loading = false;
      });
      // The order on screen is unchanged (stale but real); re-establish the
      // watch for it if a background trip stopped it.
      _syncWatch(_order);
    } catch (e) {
      if (!mounted || gen != _loadGeneration) return;
      setState(() {
        _error = ApiException(500, e.toString());
        _loading = false;
      });
      _syncWatch(_order);
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    final error = _error;

    return Scaffold(
      backgroundColor: AppColors.greyWhiteColor,
      appBar: AppBar(
        elevation: 0,
        title: Text(order?.orderNumber ?? 'Order'),
      ),
      // Pull-to-refresh works from every state, including the error and
      // not-found ones - a scrollable list is always underneath.
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.xxxl,
          ),
          children: order == null
              ? [
                  if (_loading)
                    const _CenteredState(child: CircularProgressIndicator())
                  else
                    // fetchOrder either returns an order or throws, so with
                    // no order and no load running there is always an error
                    // to show.
                    _ErrorState(
                      error: error ?? ApiException(500, 'Order was not returned by the server.'),
                      onRetry: _load,
                    ),
                ]
              : _sections(order, error),
        ),
      ),
    );
  }

  /// Sections 1-6 of the detail design, in order.
  ///
  /// [refreshError] is a failure that happened while this order was already
  /// on screen. The order stays (it is real, just possibly stale) and the
  /// failure is said out loud above it - otherwise a refetch that silently
  /// failed would leave the customer reading old state as if it were
  /// current, which matters most right after a cancel timeout, where the
  /// message promised "Checking your order...".
  List<Widget> _sections(OrderModel order, ApiException? refreshError) {
    return [
      if (refreshError != null) ...[
        const _RefreshFailedNotice(),
        const SizedBox(height: AppSpacing.md),
      ],
      // 1. Status, directly on the page background rather than in a card.
      OrderStatusHeader(order: order),
      const SizedBox(height: AppSpacing.lg),
      // 1b. The live map - only while the rider has the order and is on the
      // way (never before pickup, never after arrival/delivery/failure).
      if (isLiveTrackable(order)) ...[
        OrderTrackingMap(
          key: const ValueKey('order-tracking'),
          order: order,
          mapBuilder: widget.mapBuilder,
        ),
        const SizedBox(height: AppSpacing.lg),
      ],
      // 2. What happened - only rows the backend actually recorded.
      if (order.history.isNotEmpty) ...[
        OrderTimeline(history: order.history),
        const SizedBox(height: AppSpacing.md),
      ],
      // 3. Items.
      OrderSummaryProductsDetails(order: order),
      const SizedBox(height: AppSpacing.md),
      // 4. Bill + the one payment line.
      OrderBillCard(order: order),
      const SizedBox(height: AppSpacing.md),
      // 5. Delivery to.
      OrderDetailsCard(order: order),
      // 6. Cancel - shown only when the backend's can_cancel says so. The
      // stable key keeps its State (and its in-flight guard) alive when the
      // children above it change, e.g. when the refresh notice appears
      // while a cancel is still running.
      if (order.canCancel) ...[
        const SizedBox(height: AppSpacing.xl),
        OrderCancelSection(
          key: const ValueKey('order-cancel'),
          order: order,
          onChanged: _load,
        ),
      ],
    ];
  }
}

/// A state (loading/error) is still a single item inside the scrollable
/// ListView, tall enough that a downward drag always reaches the
/// RefreshIndicator's trigger distance.
class _CenteredState extends StatelessWidget {
  const _CenteredState({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: MediaQuery.sizeOf(context).height * 0.72),
      child: Center(child: child),
    );
  }
}

/// Shown above an order that is already on screen when a refetch failed.
/// Quiet, not alarming (the order below it is still real), and it offers the
/// gesture that is already there rather than a button that would retry on
/// its own - no timers, no auto-retry.
class _RefreshFailedNotice extends StatelessWidget {
  const _RefreshFailedNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('order-refresh-failed'),
      padding: const EdgeInsets.all(AppSpacing.md),
      // Deliberately not a card: a tighter radius and a muted border, so it
      // reads as a strip above the order rather than as a fifth data card.
      // White (not AppSurfaces.tile) because the page behind it is
      // #EDF2F8 - a tile fill there would be 1.01:1, i.e. no body at all.
      decoration: BoxDecoration(
        borderRadius: AppRadius.fieldBorder,
        color: Colors.white,
        border: Border.all(color: AppTextColors.muted),
      ),
      child: const Row(
        children: [
          Icon(Icons.cloud_off_outlined, size: 18, color: AppTextColors.problem),
          SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              "Couldn't refresh this order. Pull down to try again.",
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppTextColors.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.onRetry});

  final ApiException error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    // A 404/400 is the backend's final answer about this id: retrying it
    // would only ask the same question again, so there is no retry button.
    final notFound = error.statusCode == 404 || error.statusCode == 400;

    return _CenteredState(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              notFound ? Icons.receipt_long_outlined : Icons.error_outline,
              size: 48,
              color: AppTextColors.muted,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              notFound ? 'This order could not be found.' : "Couldn't load this order.",
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w700, color: AppTextColors.primary),
            ),
            if (!notFound) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                error.message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppTextColors.secondary),
              ),
              const SizedBox(height: AppSpacing.lg),
              ElevatedButton(
                key: const Key('order-retry'),
                onPressed: onRetry,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryYellowColor,
                  foregroundColor: AppTextColors.onYellow,
                  minimumSize: const Size(0, 48),
                ),
                child: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
