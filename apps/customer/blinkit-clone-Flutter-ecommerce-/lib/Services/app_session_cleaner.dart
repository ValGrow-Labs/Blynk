import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'Providers/address.provider.dart';
import 'Providers/cart.provider.dart';
import 'Providers/location.provider.dart';
import 'Providers/order.provider.dart';

/// The one place that forgets a customer's data when their session ends
/// (logout, or the server rejecting the login), so the next person on the
/// device never sees it. The product catalog is public and stays cached.
class AppSessionCleaner {
  const AppSessionCleaner._();

  static void clearUserScopedState(BuildContext context) => clearProviders(
        addresses: context.read<AddressProvider>(),
        orders: context.read<OrderProvider>(),
        cart: context.read<CartProvider>(),
        location: context.read<LocationProvider>(),
      );

  static void clearProviders({
    required AddressProvider addresses,
    required OrderProvider orders,
    required CartProvider cart,
    required LocationProvider location,
  }) {
    // Closes the live rider stream and drops its last point.
    location.stopWatching();
    orders.reset();
    addresses.clear();
    cart.clear();
  }
}
