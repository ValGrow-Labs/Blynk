import 'package:flutter/material.dart';

import 'package:ecom/app_design.dart';
import 'order_model.dart';

/// How urgently/positively a status should read, independent of the exact
/// word chosen for it. Shared by every surface that colours a status.
enum OrderTone { active, success, neutral, problem }

/// The customer-facing words for each order status (approved wording, C3),
/// shared by the orders list and the order detail so both say the same
/// thing.
String orderStatusLabel(OrderStatus status) {
  switch (status) {
    case OrderStatus.placed:
      return 'Order placed';
    case OrderStatus.packed:
      return 'Packed';
    case OrderStatus.outForDelivery:
      return 'Out for delivery';
    case OrderStatus.delivered:
      return 'Delivered';
    case OrderStatus.cancelled:
      return 'Cancelled';
    case OrderStatus.failed:
      return 'Delivery failed';
    case OrderStatus.customerUnavailable:
      return "We couldn't reach you";
    case OrderStatus.itemUnavailable:
      return 'Item unavailable';
    case OrderStatus.unknown:
      return 'Status unavailable';
  }
}

/// The tone behind a status, used to pick a colour without relying on
/// colour alone to carry meaning (an icon always goes with it).
OrderTone orderStatusTone(OrderStatus status) {
  switch (status) {
    case OrderStatus.delivered:
      return OrderTone.success;
    case OrderStatus.cancelled:
      return OrderTone.neutral;
    case OrderStatus.failed:
    case OrderStatus.customerUnavailable:
    case OrderStatus.itemUnavailable:
      return OrderTone.problem;
    case OrderStatus.unknown:
      return OrderTone.neutral;
    case OrderStatus.placed:
    case OrderStatus.packed:
    case OrderStatus.outForDelivery:
      return OrderTone.active;
  }
}

/// The icon paired with each status label; colour is never the only signal.
IconData orderStatusIcon(OrderStatus status) {
  switch (status) {
    case OrderStatus.placed:
      return Icons.receipt_long_outlined;
    case OrderStatus.itemUnavailable:
      return Icons.error_outline;
    case OrderStatus.packed:
      return Icons.inventory_2_outlined;
    case OrderStatus.outForDelivery:
      return Icons.local_shipping_outlined;
    case OrderStatus.delivered:
      return Icons.check_circle;
    case OrderStatus.cancelled:
      return Icons.cancel_outlined;
    case OrderStatus.failed:
    case OrderStatus.customerUnavailable:
      return Icons.error_outline;
    case OrderStatus.unknown:
      return Icons.help_outline;
  }
}

/// Blynk tokens for each tone. Green is reserved for delivered/paid.
///
/// These are TEXT colours: `order_status_header.dart` renders them at headline
/// size and `order_timeline.dart` at label size, so every one of them has to
/// clear 4.5:1 on **both** surfaces they land on — the order-detail page
/// background (`AppColors.greyWhiteColor`, #EDF2F8) and the white timeline
/// card. That is why `success` is [AppTextColors.positiveOnBackground] rather
/// than `AppColors.primaryGreenColor` (4.36:1 on #EDF2F8) and `neutral` is
/// [AppTextColors.onBackground] rather than `AppTextColors.secondary`
/// (4.29:1). `order_format_test.dart` measures all four tones on both
/// surfaces; keep the colour honest rather than lowering that floor.
Color orderToneColor(OrderTone tone) {
  switch (tone) {
    case OrderTone.active:
      return AppTextColors.primary;
    case OrderTone.success:
      return AppTextColors.positiveOnBackground;
    case OrderTone.neutral:
      return AppTextColors.onBackground;
    case OrderTone.problem:
      return AppTextColors.problem;
  }
}
