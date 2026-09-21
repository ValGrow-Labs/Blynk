import 'package:flutter/material.dart';

import 'package:ecom/app_design.dart';

/// Shown by a map adapter when it cannot show a map: an honest label, not a
/// fake map. Shared by every adapter so the surface looks the same whichever
/// provider is active. Sits under any credit overlay drawn by the caller.
class MapUnavailableCard extends StatelessWidget {
  const MapUnavailableCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('map-unavailable'),
      // A white, hairline-bordered surface like the app's other cards: the old
      // tile grey was 1.00:1 against the order page, so the box disappeared.
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppSurfaces.border),
      ),
      alignment: Alignment.center,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.map_outlined, color: AppTextColors.onBackground, size: 28),
          SizedBox(height: AppSpacing.xs),
          Text(
            'Map unavailable',
            style: TextStyle(color: AppTextColors.onBackground, fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
