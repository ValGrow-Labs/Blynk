import 'package:flutter/material.dart';

import 'design/tokens.dart';

/// Shared breakpoints so every screen agrees on what "desktop" or "tablet"
/// means, instead of each file inventing its own thresholds.
class AppBreakpoints {
  static const double tablet = 600;
  static const double desktop = 1024;
}

/// The three width classes of the single responsive ladder (plan section 6).
enum ResponsiveClass { compact, medium, expanded }

/// Central place for responsive decisions (column counts, content width
/// caps) so screens adapt their composition instead of just scaling a
/// mobile layout up or down.
class Responsive {
  final double width;

  const Responsive(this.width);

  factory Responsive.of(BuildContext context) =>
      Responsive(MediaQuery.of(context).size.width);

  /// Classifies an *available* width (a `LayoutBuilder` constraint, not
  /// necessarily the screen) against [AppBreakpoints], the only thresholds.
  static ResponsiveClass classOf(double width) {
    if (width >= AppBreakpoints.desktop) return ResponsiveClass.expanded;
    if (width >= AppBreakpoints.tablet) return ResponsiveClass.medium;
    return ResponsiveClass.compact;
  }

  ResponsiveClass get responsiveClass => classOf(width);

  bool get isDesktop => width >= AppBreakpoints.desktop;
  bool get isTablet =>
      width >= AppBreakpoints.tablet && width < AppBreakpoints.desktop;
  bool get isMobile => width < AppBreakpoints.tablet;

  /// Product/category grid column count for the current width.
  int get gridColumns {
    if (width >= 1600) return 6;
    if (width >= 1280) return 5;
    if (isDesktop) return 4;
    if (isTablet) return 3;
    return 2;
  }

  /// Caps single-column/list content width on wide desktop viewports so it
  /// doesn't stretch edge-to-edge; returns the full width on mobile.
  double get contentMaxWidth {
    if (isDesktop) return (width * 0.6).clamp(900.0, 1400.0);
    if (isTablet) return 700.0;
    return width;
  }

  double get horizontalPadding {
    if (isDesktop) return 56.0;
    if (isTablet) return 32.0;
    return 16.0;
  }
}

/// Centres [child] in a column whose width follows the ladder: full width when
/// compact, 840 when medium, 1200 when expanded (further limited by
/// [maxWidth], e.g. 720 for list screens). It measures the width it is given
/// with a `LayoutBuilder`, so it is right inside a rail layout too.
///
/// [gutter] adds the page gutter (`BlynkSpace.gutterFor`) on both sides;
/// screens whose content already carries its own side padding turn it off so
/// their compact layout does not change.
class ContentFrame extends StatelessWidget {
  const ContentFrame({
    super.key,
    required this.child,
    this.maxWidth,
    this.gutter = true,
  });

  final Widget child;
  final double? maxWidth;
  final bool gutter;

  /// The ladder's own cap for a width class; compact is uncapped.
  static double capFor(ResponsiveClass c) => switch (c) {
        ResponsiveClass.compact => double.infinity,
        ResponsiveClass.medium => 840,
        ResponsiveClass.expanded => 1200,
      };

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final available = constraints.hasBoundedWidth
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        var cap = capFor(Responsive.classOf(available));
        if (maxWidth != null && maxWidth! < cap) cap = maxWidth!;
        return Padding(
          padding: gutter
              ? EdgeInsets.symmetric(horizontal: BlynkSpace.gutterFor(available))
              : EdgeInsets.zero,
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: cap),
              child: child,
            ),
          ),
        );
      },
    );
  }
}
