import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/order_model.dart';
import '../../../Services/Exceptions/api_exception.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../Widgets/Atoms/adaptive_sheet.dart';
import '../../Widgets/Atoms/blynk_button.dart';
import '../../../design/tokens.dart';

/// What to tell the customer when the backend refuses (or we never heard
/// back about) a cancellation.
///
/// A refusal is the backend's final word - the order was already on its way,
/// already cancelled, or otherwise not cancellable - and is worded as such.
/// A timeout/network failure is deliberately *not* worded as a failure: the
/// request may well have succeeded, so the screen says it is checking and
/// then refetches the order to show whatever actually happened.
String cancelRefusalMessage(ApiException e) {
  switch (e.code) {
    case 'ORDER_ALREADY_OUT_FOR_DELIVERY':
      return "Your order is already on its way, so it can't be cancelled.";
    case 'ORDER_ALREADY_CANCELLED':
      return 'This order is already cancelled.';
    case 'ORDER_CANNOT_BE_CANCELLED':
      return "This order can't be cancelled now.";
    case 'ORDER_NOT_FOUND':
      return 'This order could not be found.';
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
      return "We couldn't confirm the cancellation. Checking your order…";
  }
  if (e.statusCode == 408 || e.statusCode == 503) {
    return "We couldn't confirm the cancellation. Checking your order…";
  }
  return e.message;
}

/// Section 6 of the order detail: the cancellation policy line and the
/// cancel action.
///
/// The section is only ever built when the backend said `can_cancel: true` -
/// there is no client-side list of cancellable statuses anywhere. The
/// backend's cancel endpoint stays the authority: a stale `true` comes back
/// as a refusal, which is shown as a message, and either way [onChanged]
/// refetches the order so the screen shows the backend's truth (including
/// the new history row on success).
class OrderCancelSection extends StatefulWidget {
  const OrderCancelSection({
    super.key,
    required this.order,
    required this.onChanged,
  });

  final OrderModel order;

  /// The screen's own reload. Awaited after every cancel attempt.
  final Future<void> Function() onChanged;

  @override
  State<OrderCancelSection> createState() => _OrderCancelSectionState();
}

class _OrderCancelSectionState extends State<OrderCancelSection> {
  // Guards the whole attempt (sheet included) so a second tap can never
  // send a second POST while the first one is still in flight.
  bool _busy = false;

  Future<void> _openSheet() async {
    if (_busy) return;

    // The shared adaptive surface (sheet under 600, dialog from 600) rather
    // than a second bottom-sheet recipe: it brings the drag handle, the scrim,
    // the safe area, the keyboard inset and the route semantics with it.
    final confirmed = await showAdaptiveSheet<bool>(
      context,
      semanticLabel: 'Cancel this order?',
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.fromLTRB(
          BlynkSpace.s24,
          BlynkSpace.s8,
          BlynkSpace.s24,
          BlynkSpace.s24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Cancel this order?', style: BlynkText.title),
            const SizedBox(height: BlynkSpace.s8),
            Text(
              "This can't be undone.",
              style: BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
            const SizedBox(height: BlynkSpace.s24),
            // Keeping the order is the forward action, so it is the one
            // yellow action on this surface; cancelling is destructive.
            BlynkButton.cta(
              key: const Key('keep-order'),
              label: 'Keep order',
              onPressed: () => Navigator.of(sheetContext).pop(false),
            ),
            const SizedBox(height: BlynkSpace.s12),
            BlynkButton.destructive(
              key: const Key('confirm-cancel'),
              label: 'Cancel order',
              onPressed: () => Navigator.of(sheetContext).pop(true),
              expand: true,
            ),
          ],
        ),
      ),
    );

    if (confirmed != true || !mounted) return;
    await _cancel();
  }

  Future<void> _cancel() async {
    if (_busy) return;
    setState(() => _busy = true);

    // Captured before the await: the section itself may be gone from the
    // tree by the time the refetched order comes back.
    final messenger = ScaffoldMessenger.of(context);
    final provider = context.read<OrderProvider>();

    final outcome = await provider.cancelOrder(widget.order.id);
    if (!mounted) return;

    if (!outcome.ok) {
      messenger.showSnackBar(
        SnackBar(content: Text(cancelRefusalMessage(outcome.error!))),
      );
    }

    // Always - on a refusal, on a timeout and on success. The screen then
    // shows whatever the backend says, rather than what this widget hoped.
    await widget.onChanged();
    if (!mounted) return;
    setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'You can cancel until your order is out for delivery.',
          style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
        ),
        const SizedBox(height: BlynkSpace.s12),
        // `loading` is the shared duplicate-submission guarantee: the button
        // keeps its size, swallows a second tap and reports disabled to
        // assistive technology, so no second POST can leave this screen.
        BlynkButton.destructive(
          key: const Key('cancel-order-button'),
          label: 'Cancel order',
          onPressed: _openSheet,
          loading: _busy,
          expand: true,
        ),
      ],
    );
  }
}
