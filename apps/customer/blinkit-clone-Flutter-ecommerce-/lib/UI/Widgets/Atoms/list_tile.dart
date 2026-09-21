import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// One account row: the whole row is a single 48 dp+ target, the trailing
/// chevron is a plain icon (not a button of its own).
Widget customListTile({
  required IconData icon,
  required String title,
  required VoidCallback callback,
}) {
  return Semantics(
    button: true,
    label: title,
    excludeSemantics: true,
    onTap: callback,
    child: InkWell(
      onTap: callback,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: BlynkSpace.s8,
            vertical: BlynkSpace.s8,
          ),
          child: Row(
            children: [
              Icon(icon, color: BlynkColors.ink, size: BlynkIcons.md),
              const SizedBox(width: BlynkSpace.s16),
              Expanded(child: Text(title, style: BlynkText.heading)),
              const Icon(
                BlynkIcons.chevron,
                color: BlynkColors.ink3,
                size: BlynkIcons.md,
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
