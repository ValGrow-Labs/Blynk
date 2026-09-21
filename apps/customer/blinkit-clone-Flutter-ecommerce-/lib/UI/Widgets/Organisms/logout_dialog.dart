import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Services/Providers/address.provider.dart';
import '../../../Services/Providers/auth.provider.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Providers/location.provider.dart';
import '../../../Services/Providers/order.provider.dart';
import '../../../Services/app_session_cleaner.dart';
import '../../../design/tokens.dart';
import '../Atoms/adaptive_sheet.dart';
import '../Atoms/blynk_button.dart';

/// Asks "Log out?" and, on confirmation, signs the customer out: credentials
/// and every piece of user-scoped state (addresses, orders, cart, live
/// location) are cleared and the login screen replaces the whole stack. The
/// customer can still Skip from there and browse as a guest.
Future<void> showLogoutDialog(BuildContext context) async {
  // Everything the sign-out needs is taken from [context] before any await.
  final auth = context.read<AuthProvider>();
  final addresses = context.read<AddressProvider>();
  final orders = context.read<OrderProvider>();
  final cart = context.read<CartProvider>();
  final location = context.read<LocationProvider>();
  final navigator = Navigator.of(context);
  final confirmed = await showAdaptiveSheet<bool>(
    context,
    semanticLabel: 'Log out',
    builder: (_) => const LogoutSheet(),
  );
  if (confirmed != true) return;

  // Local-first: logout() signs out in memory and bumps the session epoch
  // before its first await, so the UI can leave at once. The storage clear and
  // the server revoke carry on in the background, so a stuck secure
  // storage can never keep a customer on a signed-in screen.
  final finishing = auth.logout();
  AppSessionCleaner.clearProviders(
    addresses: addresses,
    orders: orders,
    cart: cart,
    location: location,
  );
  navigator.pushNamedAndRemoveUntil('/login', (_) => false);
  await finishing;
}

/// The content of the logout confirmation. Pops `true` on "Log out" and
/// `false` on "Cancel".
class LogoutSheet extends StatelessWidget {
  const LogoutSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(BlynkSpace.s24, BlynkSpace.s8, BlynkSpace.s24, BlynkSpace.s24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Log out?', style: BlynkText.heading.copyWith(color: BlynkColors.ink)),
          const SizedBox(height: BlynkSpace.s8),
          Text(
            'You can browse without an account.',
            style: BlynkText.body.copyWith(color: BlynkColors.ink2),
          ),
          const SizedBox(height: BlynkSpace.s24),
          BlynkButtonPair(
            secondary: BlynkButton.secondary(
              label: 'Cancel',
              onPressed: () => Navigator.of(context).pop(false),
            ),
            primary: BlynkButton.destructive(
              label: 'Log out',
              onPressed: () => Navigator.of(context).pop(true),
            ),
          ),
        ],
      ),
    );
  }
}
