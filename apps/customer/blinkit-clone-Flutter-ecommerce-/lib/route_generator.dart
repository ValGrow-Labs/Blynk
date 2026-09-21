import 'package:flutter/material.dart';

import 'package:ecom/Screens/Auth/login_screen.dart';
import 'package:ecom/Screens/Auth/otp_verification_screen.dart';
import 'package:ecom/Screens/app_about_screen.dart';
import 'package:ecom/Screens/categories_screen.dart';
import 'package:ecom/Screens/checkout_screen.dart';
import 'package:ecom/Screens/customer_shell.dart';
import 'package:ecom/Screens/not_found_screen.dart';
import 'package:ecom/Screens/search_screen.dart';
import 'package:ecom/Screens/session_gate.dart';
import 'package:ecom/Screens/product_details_screen.dart';
import 'package:ecom/Models/product_model.dart';
import 'package:ecom/Screens/order_confirmation_screen.dart';
import 'package:ecom/Screens/order_summary_screen.dart';
import 'package:ecom/Screens/products_screen.dart';
import 'package:ecom/Screens/user_address_screen.dart';
import 'package:ecom/Screens/user_cart_screen.dart';

class AppRouter {
  static Route<dynamic>? generateRoute(RouteSettings settings) {
    switch (settings.name) {
      // The start route decides local-first between the shop and the login
      // screen; '/login' is the login screen itself (a guest logging in later,
      // or a session that ended).
      case '/':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const SessionGate(),
        );
      case '/login':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const LoginScreen(),
        );
      case '/otp/verify':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => OTPVerificationScreen(
            data: settings.arguments,
          ),
        );
      // '/home' is the persistent four-tab customer shell (Shop / Orders /
      // Help / Profile), not a bare Home page - it lands on the Shop tab
      // unless the tab index is passed as the argument. Orders, Help and
      // Profile are tabs only: CustomerShell.selectTab opens them.
      case '/home':
        final tab = settings.arguments;
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => CustomerShell(initialTab: tab is int ? tab : 0),
        );
      case '/categories':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CategoriesScreen(),
        );
      case '/search':
        final searchArg = settings.arguments;
        if (searchArg != null && searchArg is! String) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => SearchScreen(
            initialCategorySlug: searchArg as String?,
          ),
        );
      // Accepts the tapped ProductModel (renders instantly, then refreshes)
      // or a bare product id. Neither, or an empty id, is not-found at once
      // instead of a skeleton that never resolves.
      case '/product':
        final args = settings.arguments;
        final initial = args is ProductModel ? args : null;
        final productId = initial?.id ?? (args is String ? args : '');
        if (productId.trim().isEmpty) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => ProductDetailsScreen(
            productId: productId,
            initialProduct: initial,
          ),
        );
      case '/products':
        // No argument means "all products"; any other type is not-found.
        final slug = settings.arguments;
        if (slug != null && slug is! String) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => ProductsScreen(
            categorySlug: (slug as String?) ?? '',
          ),
        );
      case "/cart":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CartScreen(),
        );
      case '/checkout':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const CheckoutScreen(),
        );
      case "/order":
        final orderId = settings.arguments;
        if (orderId is! String || orderId.trim().isEmpty) return _notFound(settings);
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => OrderSummaryScreen(orderId: orderId),
        );
      case "/order/confirm":
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const OrderConfirmationScreen(),
        );
      case '/user/address':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const UserAddressScreen(),
        );
      case '/app/about':
        return MaterialPageRoute(
          settings: settings,
          builder: (_) => const AppAboutScreen(),
        );
      default:
        return _notFound(settings);
    }
  }

  static Route<dynamic> _notFound(RouteSettings settings) => MaterialPageRoute(
        settings: settings,
        builder: (_) => const NotFoundScreen(),
      );
}
