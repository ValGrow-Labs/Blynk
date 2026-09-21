import 'package:flutter/material.dart';

import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// One top-level destination of an [AdaptiveScaffold].
class AdaptiveDestination {
  const AdaptiveDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    this.hasBadge = false,
    this.badgeDescription,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;

  /// A small dot on the icon; [badgeDescription] is what a screen reader
  /// adds after the label, since a dot alone says nothing.
  final bool hasBadge;
  final String? badgeDescription;

  String get semanticLabel =>
      hasBadge && badgeDescription != null ? '$label, $badgeDescription' : label;
}

/// The app frame that turns navigation into the right control for the width
/// it is given (the ladder in `app_responsive.dart`):
///
///  * compact (< 600): a 64 dp bottom bar,
///  * medium (600-1023): an 80 dp navigation rail,
///  * expanded (>= 1024): a 240 dp extended rail.
///
/// [body] fills the rest. [cartBar] sits at the bottom of the content area
/// (above the bottom bar when compact) and takes no room while it renders
/// nothing.
class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({
    super.key,
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.body,
    this.cartBar,
  }) : assert(destinations.length >= 2);

  final List<AdaptiveDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final Widget body;
  final Widget? cartBar;

  static const double barHeight = 64;
  static const double railWidth = 80;
  static const double extendedRailWidth = 240;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final width =
              constraints.hasBoundedWidth ? constraints.maxWidth : MediaQuery.sizeOf(context).width;
          final cls = Responsive.classOf(width);

          if (cls == ResponsiveClass.compact) {
            return Column(
              children: [
                Expanded(
                  // The bar below owns the bottom inset.
                  child: MediaQuery.removePadding(
                    context: context,
                    removeBottom: true,
                    child: body,
                  ),
                ),
                if (cartBar != null) cartBar!,
                _BottomBar(
                  destinations: destinations,
                  selectedIndex: selectedIndex,
                  onSelected: onSelected,
                ),
              ],
            );
          }

          final extended = cls == ResponsiveClass.expanded;
          return Row(
            children: [
              _Rail(
                destinations: destinations,
                selectedIndex: selectedIndex,
                onSelected: onSelected,
                extended: extended,
              ),
              const VerticalDivider(width: 1, thickness: 1, color: BlynkColors.line),
              Expanded(
                // The rail's own SafeArea covers the left/top; the content
                // column keeps clear of the bottom and right system insets
                // (gesture bar, cutout) and passes the rest down as zero.
                child: SafeArea(
                  left: false,
                  top: false,
                  child: Column(
                    children: [
                      Expanded(child: body),
                      if (cartBar != null) cartBar!,
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

Widget _dot(Widget icon) => Stack(
      clipBehavior: Clip.none,
      children: [
        icon,
        const Positioned(
          key: ValueKey('nav-badge-dot'),
          right: -2,
          top: -2,
          child: SizedBox(
            width: 10,
            height: 10,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: BlynkColors.ink,
                shape: BoxShape.circle,
                border: Border.fromBorderSide(
                  BorderSide(color: BlynkColors.paper, width: 2),
                ),
              ),
            ),
          ),
        ),
      ],
    );

class _BottomBar extends StatelessWidget {
  const _BottomBar({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<AdaptiveDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BlynkColors.paper,
        border: Border(top: BorderSide(color: BlynkColors.line)),
      ),
      child: SafeArea(
        top: false,
        // 64 dp at the design size; it grows with the text scale so a large
        // system font never clips a label.
        child: ConstrainedBox(
          key: const ValueKey('adaptive-bottom-bar'),
          constraints: const BoxConstraints(minHeight: AdaptiveScaffold.barHeight),
          child: IntrinsicHeight(
            child: FocusTraversalGroup(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < destinations.length; i++)
                    Expanded(
                      child: _BarItem(
                        destination: destinations[i],
                        selected: i == selectedIndex,
                        onTap: () => onSelected(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BarItem extends StatefulWidget {
  const _BarItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final AdaptiveDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_BarItem> createState() => _BarItemState();
}

class _BarItemState extends State<_BarItem> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final d = widget.destination;
    final selected = widget.selected;
    final color = selected ? BlynkColors.ink : BlynkColors.ink2;

    Widget icon = Icon(selected ? d.selectedIcon : d.icon, size: BlynkIcons.md, color: color);
    if (d.hasBadge) icon = _dot(icon);

    return Semantics(
      button: true,
      selected: selected,
      label: d.semanticLabel,
      onTap: widget.onTap,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.all(BlynkSpace.s4),
        child: DecoratedBox(
          key: ValueKey('nav-focus-${d.label}'),
          // Focus is a 2 dp ink outline, not colour alone.
          position: DecorationPosition.foreground,
          decoration: BoxDecoration(
            borderRadius: BlynkRadius.mdAll,
            border: _focused ? Border.all(color: BlynkColors.ink, width: 2) : null,
          ),
          child: InkWell(
            borderRadius: BlynkRadius.mdAll,
            onTap: widget.onTap,
            onFocusChange: (focused) => setState(() => _focused = focused),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  key: ValueKey('nav-indicator-${d.label}'),
                  width: 32,
                  height: 3,
                  margin: const EdgeInsets.only(bottom: BlynkSpace.s4),
                  decoration: BoxDecoration(
                    color: selected ? BlynkColors.signal : BlynkColors.clear,
                    borderRadius: BlynkRadius.full,
                  ),
                ),
                icon,
                const SizedBox(height: 2),
                Text(
                  d.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: BlynkText.caption.copyWith(
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Rail extends StatelessWidget {
  const _Rail({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.extended,
  });

  final List<AdaptiveDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final bool extended;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      right: false,
      child: NavigationRail(
        key: const ValueKey('adaptive-rail'),
        extended: extended,
        minWidth: AdaptiveScaffold.railWidth,
        minExtendedWidth: AdaptiveScaffold.extendedRailWidth,
        selectedIndex: selectedIndex,
        onDestinationSelected: onSelected,
        labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
        backgroundColor: BlynkColors.paper,
        // Selected is the filled glyph on a quiet well, never a yellow pill.
        indicatorColor: BlynkColors.well,
        destinations: [
          for (final d in destinations)
            NavigationRailDestination(
              icon: d.hasBadge ? _dot(Icon(d.icon)) : Icon(d.icon),
              selectedIcon: d.hasBadge ? _dot(Icon(d.selectedIcon)) : Icon(d.selectedIcon),
              label: Text(d.label),
              padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s4),
            ),
        ],
      ),
    );
  }
}
