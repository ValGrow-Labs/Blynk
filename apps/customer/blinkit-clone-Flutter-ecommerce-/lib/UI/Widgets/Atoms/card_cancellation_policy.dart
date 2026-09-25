import 'package:flutter/material.dart';

import 'package:ecom/app_design.dart';
import '../../../design/tokens.dart';

class CancellationPolicyCard extends StatelessWidget {
  const CancellationPolicyCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 10),
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(10.0)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Cancellation Policy',
            style: BlynkText.heading,
          ),
          Text(
            // Matches the backend rule: cancellable while PLACED or PACKED.
            'You can cancel your order until it is out for delivery.',
            style: BlynkText.caption.copyWith(fontWeight: FontWeight.w500, color: AppTextColors.secondary),
          ),
        ],
      ),
    );
  }
}
