import 'package:flutter/material.dart';

import 'primitives.dart';

export 'motion.dart';
export 'typography.dart';

/// Semantic colour roles. Yellow is only ever a fill for the forward action
/// (label [onSignal]); green is only ever a true positive state.
abstract final class BlynkColors {
  static const Color signal = BlynkPalette.signal;
  static const Color signalPressed = BlynkPalette.signalPressed;
  static const Color ink = BlynkPalette.ink;
  static const Color ink2 = BlynkPalette.ink2;
  static const Color ink3 = BlynkPalette.ink3;
  static const Color paper = BlynkPalette.paper;
  static const Color well = BlynkPalette.well;
  static const Color line = BlynkPalette.line;
  static const Color lineStrong = BlynkPalette.lineStrong;
  static const Color positive = BlynkPalette.positive;
  static const Color positiveInk = BlynkPalette.positiveInk;
  static const Color positiveTint = BlynkPalette.positiveTint;
  static const Color problem = BlynkPalette.problem;
  static const Color problemTint = BlynkPalette.problemTint;
  static const Color notice = BlynkPalette.notice;
  static const Color noticeTint = BlynkPalette.noticeTint;
  static const Color scrim = BlynkPalette.scrim;
  static const Color clear = BlynkPalette.clear;

  static const Color onSignal = ink;
  static const Color onPositive = paper;
}

abstract final class BlynkSpace {
  static const double s4 = BlynkScale.s4;
  static const double s8 = BlynkScale.s8;
  static const double s12 = BlynkScale.s12;
  static const double s16 = BlynkScale.s16;
  static const double s24 = BlynkScale.s24;
  static const double s32 = BlynkScale.s32;
  static const double s48 = BlynkScale.s48;

  /// Page gutter: 16 compact, 24 medium, 32 expanded.
  static double gutterFor(double width) {
    if (width < 600) return s16;
    if (width < 1024) return s24;
    return s32;
  }
}

abstract final class BlynkRadius {
  static const double sm = BlynkScale.radiusSm;
  static const double md = BlynkScale.radiusMd;
  static const double lg = BlynkScale.radiusLg;

  static const BorderRadius smAll = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius mdAll = BorderRadius.all(Radius.circular(md));
  static const BorderRadius lgAll = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius lgTop = BorderRadius.vertical(top: Radius.circular(lg));

  /// Stepper and badge pills only.
  static const BorderRadius full = BorderRadius.all(Radius.circular(999));
}

/// Flat everywhere except the floating cart bar ([raised]) and modal
/// sheets/dialogs ([overlayDp] and [overlayShadow]).
abstract final class BlynkElevation {
  static const List<BoxShadow> none = <BoxShadow>[];

  static const List<BoxShadow> raised = <BoxShadow>[
    BoxShadow(color: BlynkPalette.shadowRaised, blurRadius: 16, offset: Offset(0, 4)),
  ];

  /// Sheets and dialogs are Material surfaces, so their shadow is an
  /// elevation level plus a colour rather than a [BoxShadow] list.
  static const double overlayDp = 3;
  static const Color overlayShadow = BlynkPalette.shadowOverlay;
}

/// One family: Material outlined. Filled glyphs only for selected nav items
/// and state icons (check, warning).
abstract final class BlynkIcons {
  static const double sm = BlynkScale.iconSm;
  static const double md = BlynkScale.iconMd;
  static const double lg = BlynkScale.iconLg;

  static const IconData shop = Icons.storefront_outlined;
  static const IconData shopSelected = Icons.storefront;
  static const IconData orders = Icons.receipt_long_outlined;
  static const IconData ordersSelected = Icons.receipt_long;
  static const IconData addressBook = Icons.menu_book_outlined;
  static const IconData addressBookSelected = Icons.menu_book;
  static const IconData packed = Icons.inventory_2_outlined;
  static const IconData cart = Icons.shopping_bag_outlined;
  static const IconData cartSelected = Icons.shopping_bag;
  static const IconData search = Icons.search;
  static const IconData help = Icons.help_outline;
  static const IconData helpSelected = Icons.help;
  static const IconData profile = Icons.person_outline;
  static const IconData profileSelected = Icons.person;
  static const IconData back = Icons.arrow_back;
  static const IconData close = Icons.close;
  static const IconData check = Icons.check_circle;
  static const IconData warning = Icons.warning;
  static const IconData offline = Icons.wifi_off;
  static const IconData addressHome = Icons.home_outlined;
  static const IconData addressWork = Icons.work_outline;
  static const IconData addressOther = Icons.place_outlined;
  static const IconData delivered = Icons.task_alt;
  static const IconData outForDelivery = Icons.local_shipping_outlined;

  // State-view and badge glyphs (not part of the `distinct` set below).
  static const IconData empty = Icons.inbox_outlined;
  static const IconData error = Icons.error_outline;
  static const IconData notFound = Icons.search_off;
  static const IconData pending = Icons.schedule;
  static const IconData info = Icons.info_outline;

  // Account rows (not part of the `distinct` set below).
  static const IconData chevron = Icons.chevron_right;
  static const IconData share = Icons.share_outlined;
  static const IconData logout = Icons.logout;

  /// The icons that must read as different things from each other.
  static const List<IconData> distinct = <IconData>[
    shop,
    orders,
    addressBook,
    packed,
    cart,
    search,
    help,
    profile,
    back,
    close,
    check,
    warning,
    offline,
    addressHome,
    addressWork,
    addressOther,
    delivered,
    outForDelivery,
  ];
}
