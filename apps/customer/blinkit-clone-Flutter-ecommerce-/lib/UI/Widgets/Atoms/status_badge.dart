import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

enum BadgeTone { positive, problem, notice, neutral }

/// A status pill. Always an icon plus a word, never colour alone, and never
/// smaller than 12 px text.
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.tone,
    required this.label,
    this.icon,
  });

  final BadgeTone tone;
  final String label;

  /// Defaults to the tone's own glyph.
  final IconData? icon;

  static const double _iconSize = 16;

  ({Color background, Color foreground, IconData icon}) get _look {
    switch (tone) {
      case BadgeTone.positive:
        return (background: BlynkColors.positiveTint, foreground: BlynkColors.positiveInk, icon: BlynkIcons.check);
      case BadgeTone.problem:
        return (background: BlynkColors.problemTint, foreground: BlynkColors.problem, icon: BlynkIcons.warning);
      case BadgeTone.notice:
        return (background: BlynkColors.noticeTint, foreground: BlynkColors.notice, icon: BlynkIcons.pending);
      case BadgeTone.neutral:
        return (background: BlynkColors.well, foreground: BlynkColors.ink3, icon: BlynkIcons.info);
    }
  }

  @override
  Widget build(BuildContext context) {
    final look = _look;
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(color: look.background, borderRadius: BlynkRadius.full),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: BlynkSpace.s12, vertical: BlynkSpace.s4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon ?? look.icon, size: _iconSize, color: look.foreground),
              const SizedBox(width: BlynkSpace.s4),
              Flexible(
                child: Text(
                  label,
                  style: BlynkText.caption.copyWith(color: look.foreground, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
