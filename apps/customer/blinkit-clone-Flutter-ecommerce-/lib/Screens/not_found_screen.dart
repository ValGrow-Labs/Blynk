import 'package:flutter/material.dart';

import '../UI/Widgets/Atoms/app_state_views.dart';

/// The fallback for a route that does not exist, or that was opened without
/// what it needs (an order or product id). One way out: back to the shop.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: AppStateView.notFound(
        title: "This page isn't available",
        message: 'It may have moved or no longer exists.',
        actionLabel: 'Go to Shop',
        onAction: () => Navigator.of(context)
            .pushNamedAndRemoveUntil('/home', (route) => false),
      ),
    );
  }
}
