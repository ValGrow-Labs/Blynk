import 'package:flutter/material.dart';

import '../../../Screens/customer_shell.dart';
import '../../../design/tokens.dart';
import '../../../app_design.dart';

/// Shown wherever the cart is empty (Cart and Checkout). Browse Groceries
/// goes back to the existing Shop tab rather than opening a new catalog.
class EmptyCartView extends StatelessWidget {
  const EmptyCartView({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xxl,
          vertical: AppSpacing.xxxl,
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ExcludeSemantics(
                child: Container(
                  width: 112,
                  height: 112,
                  decoration: const BoxDecoration(
                    color: BlynkColors.well,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: const Icon(
                    Icons.shopping_basket_outlined,
                    size: 52,
                    color: AppTextColors.primary,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              Semantics(
                header: true,
                child: const Text(
                  'Your cart is empty',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w800,
                    color: AppTextColors.primary,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              const Text(
                "Add your everyday essentials and we'll deliver them to your doorstep.",
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.45,
                  color: AppTextColors.secondary,
                ),
              ),
              const SizedBox(height: AppSpacing.xxl),
              // No fixed height: the button's 48 dp floor grows with a large text size.
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => CustomerShell.openShop(context),
                  child: const Text('Browse Groceries'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
