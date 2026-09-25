/// The dental flow's shared surfaces.
///
/// **There is no dental design system.** Everything here resolves to the same
/// component tokens the rest of the app already renders — the card is
/// literally the product card's surface (`BlynkCardProduct.surface` /
/// `.radius` / `.elevation`) and the glyph tile is literally the product
/// image well's tint, radius and glyph colour (`BlynkWell`). A customer
/// should not be able to tell dental was built later, so nothing in this file
/// may introduce a value of its own.
library;

import 'package:flutter/material.dart';

import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// The frame sizes the dental flow needs beyond the token layer.
abstract final class DentalLayout {
  /// The rounded map surface on the clinic and appointment pages.
  ///
  /// W8: now [BlynkMap.frameHeight] — the app had two map heights (this one
  /// at 200, `order_tracking_map.dart` at 220) and now has one. The alias
  /// stays so the two dental screens keep naming what they are sizing.
  static const double mapFrameHeight = BlynkMap.frameHeight;

  /// The doctor's photo on their own profile — the one place the tile is the
  /// page's opening image rather than a row's anchor.
  static const double profileTileSize = 96;
}

/// A dental card: paper, the card radius, the one soft elevation token and
/// **no border** — identical to a product tile. Supply [onTap] to make the
/// whole card the target (it is then at least [BlynkControl.minHeight] tall).
class DentalCard extends StatelessWidget {
  const DentalCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(BlynkSpace.s16),
    this.semanticLabel,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  /// Spoken in place of the card's own content when the card is tappable, so
  /// a row reads as one button rather than as four loose strings.
  final String? semanticLabel;

  static const BoxDecoration decoration = BoxDecoration(
    color: BlynkCardProduct.surface,
    borderRadius: BlynkCardProduct.radius,
    boxShadow: BlynkCardProduct.elevation,
  );

  @override
  Widget build(BuildContext context) {
    final content = Padding(padding: padding, child: child);
    if (onTap == null) {
      return DecoratedBox(decoration: decoration, child: content);
    }

    final tappable = DecoratedBox(
      decoration: decoration,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BlynkCardProduct.radius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
            child: content,
          ),
        ),
      ),
    );

    if (semanticLabel == null) return tappable;
    return Semantics(
      button: true,
      label: semanticLabel,
      excludeSemantics: true,
      child: tappable,
    );
  }
}

/// The rounded tinted tile that stands in for a photo on a clinic, doctor or
/// appointment row.
///
/// Neither clinics nor appointments have an image on the backend and most
/// doctors have no `photo_url`, so this is the default appearance, exactly as
/// the product image well's fallback is. It is built from the **same** tokens
/// as that fallback — [BlynkWell.tint], [BlynkWell.radius] and
/// [BlynkWell.fallbackGlyph] — so the two read as one system, and it occupies
/// a fixed square so a real photo could replace it with no layout shift.
class DentalGlyphTile extends StatelessWidget {
  const DentalGlyphTile({
    super.key,
    this.glyph = BlynkIcons.dental,
    this.size = defaultSize,
    this.imageUrl,
  });

  final IconData glyph;
  final double size;

  /// A real photo when the backend has one (doctors only). Null, empty or a
  /// failed load falls back to the glyph **in the same box**.
  final String? imageUrl;

  /// Big enough to anchor a row, small enough to leave the name dominant.
  static const double defaultSize = 56;

  /// The glyph fills the same share of the tile the product fallback's glyph
  /// fills of its medallion, so a 56 dp row tile and a 96 dp profile tile
  /// both read correctly without a caller passing a size.
  static const double _glyphFraction = 0.5;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl?.trim();
    final fallback = Center(
      child: Icon(
        glyph,
        size: size * _glyphFraction,
        color: BlynkWell.fallbackGlyph,
      ),
    );

    return SizedBox(
      width: size,
      height: size,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: BlynkWell.tint,
          borderRadius: BlynkWell.radius,
        ),
        child: ClipRRect(
          borderRadius: BlynkWell.radius,
          child: url == null || url.isEmpty
              ? fallback
              : Image.network(
                  url,
                  fit: BoxFit.cover,
                  width: size,
                  height: size,
                  errorBuilder: (_, __, ___) => fallback,
                ),
        ),
      ),
    );
  }
}

/// A label / value pair inside a [DentalCard] — the one way a fact is printed
/// anywhere in the dental flow.
class DentalFact extends StatelessWidget {
  const DentalFact({super.key, required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: BlynkText.label),
        const SizedBox(height: BlynkSpace.s4),
        DefaultTextStyle.merge(
          style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
          child: child,
        ),
      ],
    );
  }
}

/// A quiet fact pill — a glyph plus one short true string, on the `well`
/// tint. Used for a clinic's real operating hours; never for a badge the
/// backend cannot supply.
class DentalInfoPill extends StatelessWidget {
  const DentalInfoPill({super.key, required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BlynkColors.well,
        borderRadius: BlynkRadius.pillAll,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: BlynkSpace.s12,
          vertical: BlynkSpace.s8,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: BlynkIcons.xs, color: BlynkColors.ink2),
            const SizedBox(width: BlynkSpace.s8),
            Flexible(
              child: Text(label, style: BlynkText.caption.copyWith(color: BlynkColors.ink3)),
            ),
          ],
        ),
      ),
    );
  }
}

/// The sticky bar that carries a step's one yellow action.
///
/// It caps its content to the same width `ContentFrame` would on a large
/// screen, but **shrink-wraps its height** — `ContentFrame` deliberately
/// fills the space it is given, which is right for a page body and wrong for
/// a `bottomNavigationBar` (it would take the whole screen and leave the body
/// zero high).
class DentalBottomBar extends StatelessWidget {
  const DentalBottomBar({super.key, required this.child, this.maxWidth});

  final Widget child;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BlynkColors.paper,
        border: Border(top: BorderSide(color: BlynkColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final available = constraints.hasBoundedWidth
                ? constraints.maxWidth
                : MediaQuery.sizeOf(context).width;
            var cap = ContentFrame.capFor(Responsive.classOf(available));
            if (maxWidth != null && maxWidth! < cap) cap = maxWidth!;
            return Padding(
              padding: EdgeInsets.symmetric(
                horizontal: BlynkSpace.gutterFor(available),
                vertical: BlynkSpace.s16,
              ),
              child: Align(
                alignment: Alignment.topCenter,
                heightFactor: 1,
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: cap),
                  // The Column is load-bearing, not decoration: it hands the
                  // action an unbounded main axis. `BlynkButton.cta` centres
                  // its label with a Container alignment, which fills any
                  // bounded height it is given - inside a bar that would make
                  // the button (and so the bar) as tall as the screen.
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [child],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// The rounded map surface. Styling only — the map itself is
/// `ClinicLocationMap` over the frozen `MapProvider` abstraction, which this
/// widget never touches.
class DentalMapFrame extends StatelessWidget {
  const DentalMapFrame({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: DentalLayout.mapFrameHeight,
      child: ClipRRect(
        borderRadius: BlynkWell.radius,
        child: child,
      ),
    );
  }
}

/// The section title used between blocks in the dental flow. Sections are
/// separated by **space, not rules** — there is deliberately no divider.
class DentalSectionTitle extends StatelessWidget {
  const DentalSectionTitle(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Text(title, style: BlynkText.sectionHeader),
    );
  }
}
