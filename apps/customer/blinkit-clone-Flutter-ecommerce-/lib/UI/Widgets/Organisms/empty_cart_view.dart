import 'package:flutter/material.dart';

import '../../../Screens/customer_shell.dart';
import '../Atoms/app_state_views.dart';

/// Shown wherever the cart is empty (Cart and Checkout). Browse groceries
/// goes back to the existing Shop tab rather than opening a new catalog.
///
/// W9: this is now the shared [AppStateView.empty], not a second empty-state
/// dialect. It used to compose its own: a 112 dp tinted medallion instead of
/// the shared glyph, `title` instead of `heading`, `ink2` instead of `ink3`,
/// a 360 instead of 400 measure, and — the part that actually mattered — a
/// raw `ElevatedButton` instead of a [BlynkButton], which was the only
/// primary action in the app still styled by the Material theme rather than
/// by the token layer. Copy, destination and behaviour are unchanged.
class EmptyCartView extends StatelessWidget {
  const EmptyCartView({super.key});

  @override
  Widget build(BuildContext context) {
    return AppStateView.empty(
      title: 'Your cart is empty',
      message: "Add your everyday essentials and we'll deliver them to your doorstep.",
      actionLabel: 'Browse groceries',
      onAction: () => CustomerShell.openShop(context),
    );
  }
}
