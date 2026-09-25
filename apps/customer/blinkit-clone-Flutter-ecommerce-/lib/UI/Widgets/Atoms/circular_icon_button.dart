import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// A circular chrome button: the header's search/cart buttons, the product
/// detail screen's back/share buttons (spec §3 "Circular icon button").
///
/// The visual circle is [size] (40-44 dp per the spec), but the tap target
/// is always >= 48 dp regardless of [size]. [elevated] adds the [
/// BlynkElevation.soft] shadow used by the detail screen's floating buttons;
/// the header's are flat. [badgeCount] renders the cart count badge (a small
/// [BlynkNav.countBadgeFill] ink pill with a paper numeral — not a second
/// yellow, so the screen's one yellow moment stays with its action) at the
/// top-right; omit it (or pass 0/null) where there is nothing to count.
class CircularIconButton extends StatefulWidget {
  const CircularIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    required this.semanticLabel,
    this.size = 44,
    this.elevated = false,
    this.badgeCount,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String semanticLabel;

  /// Visual diameter; 40-44 dp per the spec.
  final double size;

  /// Adds [BlynkElevation.soft] behind the circle.
  final bool elevated;

  /// The cart badge. Null or <= 0 renders no badge.
  final int? badgeCount;

  static const double _hit = 48;

  @override
  State<CircularIconButton> createState() => _CircularIconButtonState();
}

class _CircularIconButtonState extends State<CircularIconButton> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final badge = widget.badgeCount ?? 0;

    Widget circle = Container(
      width: widget.size,
      height: widget.size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: BlynkColors.paper,
        shape: BoxShape.circle,
        border: Border.all(color: BlynkColors.line),
        boxShadow: widget.elevated ? BlynkElevation.soft : BlynkElevation.none,
      ),
      child: Icon(widget.icon, size: BlynkIcons.md, color: BlynkColors.ink),
    );

    if (badge > 0) {
      circle = Stack(
        clipBehavior: Clip.none,
        children: [
          circle,
          Positioned(right: -4, top: -4, child: _CountBadge(count: badge)),
        ],
      );
    }

    return Semantics(
      button: true,
      enabled: enabled,
      label: badge > 0 ? '${widget.semanticLabel}, $badge items' : widget.semanticLabel,
      onTap: enabled ? widget.onPressed : null,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkResponse(
          onTap: widget.onPressed,
          onFocusChange: (focused) => setState(() => _focused = focused),
          radius: widget.size / 2,
          highlightShape: BoxShape.circle,
          containedInkWell: false,
          child: SizedBox(
            width: CircularIconButton._hit,
            height: CircularIconButton._hit,
            child: Center(
              child: DecoratedBox(
                // Focus is a 2 dp ink ring, never colour alone.
                position: DecorationPosition.foreground,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: _focused ? Border.all(color: BlynkColors.ink, width: 2) : null,
                ),
                child: circle,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final label = count > 99 ? '99+' : '$count';
    return Container(
      constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: BlynkNav.countBadgeFill,
        borderRadius: BlynkRadius.full,
        border: Border.all(color: BlynkNav.countBadgeBorder, width: 1.5),
      ),
      alignment: Alignment.center,
      child: Text(
        label,
        style: BlynkNav.countBadgeStyle.copyWith(color: BlynkNav.countBadgeLabel, height: 1),
      ),
    );
  }
}
