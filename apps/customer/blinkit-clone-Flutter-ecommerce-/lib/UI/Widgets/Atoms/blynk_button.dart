import 'package:flutter/material.dart';

import '../../../app_design.dart' show appButtonTextScale, kStackButtonsAboveTextScale;
import '../../../design/tokens.dart';
import 'blynk_spinner.dart';

enum _BlynkButtonKind { primary, secondary, tertiary, destructive, cta, promo }

/// The one button. Primary is the signal-yellow forward action (one per
/// screen), secondary is an outline, tertiary is plain ink text, destructive
/// is a problem-coloured outline. [cta] is the redesign's full-width
/// forward action — a **flat [BlynkCta.fill] (Blynk Yellow) surface with an
/// [BlynkCta.label] (ink) label**, never a gradient — and [promo] is the
/// pill that sits on top of a promotional surface. Reuse them instead of
/// building a new button type, so no screen paints its own fill.
///
/// Height is a 48 dp floor that grows with the label (a large system font
/// wraps the text to at most two lines instead of clipping it). [onPressed]
/// null disables it.
///
/// **[loading] is a correctness feature, not a look.** While it is true the
/// button keeps its enabled appearance and its width (so nothing jumps), but
/// the gesture handler is replaced with a no-op and the semantics node reports
/// `enabled: false` with a ", loading" suffix — so neither a second tap nor an
/// assistive-technology activation can fire [onPressed] again. That is what
/// stops a double-tapped Checkout from placing two orders. Every kind
/// (primary, secondary, tertiary, destructive, cta, promo) behaves this way;
/// `blynk_button_test.dart` asserts it as behaviour, by counting invocations.
///
/// The caller still owns the flag: set `loading` in the same synchronous step
/// that starts the request, before the first `await`.
class BlynkButton extends StatelessWidget {
  const BlynkButton.primary({
    super.key,
    required this.label,
    required this.onPressed,
    this.semanticLabel,
    this.leadingIcon,
    this.trailingIcon,
    this.loading = false,
    this.expand = false,
    this.compact = false,
  }) : _kind = _BlynkButtonKind.primary;

  const BlynkButton.secondary({
    super.key,
    required this.label,
    required this.onPressed,
    this.semanticLabel,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
  })  : compact = false,
        trailingIcon = null,
        _kind = _BlynkButtonKind.secondary;

  const BlynkButton.tertiary({
    super.key,
    required this.label,
    required this.onPressed,
    this.semanticLabel,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
  })  : compact = false,
        trailingIcon = null,
        _kind = _BlynkButtonKind.tertiary;

  const BlynkButton.destructive({
    super.key,
    required this.label,
    required this.onPressed,
    this.semanticLabel,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
  })  : compact = false,
        trailingIcon = null,
        _kind = _BlynkButtonKind.destructive;

  /// The redesign's primary CTA ("Add to cart", "Checkout"): full-width by
  /// default, a flat [BlynkCta.fill] (Blynk Yellow) surface, radius 20, a
  /// dark bold [BlynkCta.labelStyle]. [trailingIcon] is for
  /// `Icons.arrow_forward` only — never render a "→" character in [label].
  /// Pressed swaps to [BlynkCta.fillPressed]; disabled falls back to
  /// [BlynkCta.fillDisabled] with a [BlynkCta.labelDisabled] (`ink3`) label —
  /// never a washed-out yellow, which would still read as the action, and
  /// never `ink2`, which is only 3.97:1 on that fill.
  const BlynkButton.cta({
    super.key,
    required this.label,
    required this.onPressed,
    this.semanticLabel,
    this.leadingIcon,
    this.trailingIcon,
    this.loading = false,
    this.expand = true,
  })  : compact = false,
        _kind = _BlynkButtonKind.cta;

  /// The redesign's secondary/promo CTA ("Shop Now" inside the promo
  /// banner): a pill (height ~44, full radius), solid [BlynkCta.promoFill]
  /// (ink) fill, [BlynkCta.promoLabel] (paper) label. It is deliberately
  /// **not** a second yellow and **not** a second green: it sits on top of a
  /// `signal` or photographic promo surface, which is already that screen's
  /// yellow moment (plan §4.3). [trailingIcon] is for `Icons.arrow_forward`
  /// only.
  const BlynkButton.promo({
    super.key,
    required this.label,
    required this.onPressed,
    this.semanticLabel,
    this.trailingIcon,
    this.loading = false,
    this.expand = false,
  })  : leadingIcon = null,
        compact = false,
        _kind = _BlynkButtonKind.promo;

  final String label;

  /// What a screen reader announces instead of [label], for a button whose
  /// visible word only makes sense next to the row it sits in ("Change" ->
  /// "Change delivery address"). The visible label is unchanged; omit it and
  /// the two are the same, which is the case for almost every button.
  final String? semanticLabel;

  final VoidCallback? onPressed;
  final IconData? leadingIcon;

  /// `Icons.arrow_forward` only, never a "→" character. Available on
  /// `primary`, `cta` and `promo` — the three kinds that are a *forward*
  /// action. `secondary`, `tertiary` and `destructive` pin it to null:
  /// an arrow on a non-primary action reads as a second forward path.
  final IconData? trailingIcon;
  final bool loading;
  final bool expand;

  /// A 44 dp visual pill for tight bars (the cart bar). Its tap target stays
  /// 48 dp because the button keeps `MaterialTapTargetSize.padded`.
  final bool compact;
  final _BlynkButtonKind _kind;

  // Geometry and the disabled recipe come from the token layer, so no value
  // here can drift from it.
  static const double _minHeight = BlynkControl.minHeight;
  static const double _compactHeight = BlynkControl.compactHeight;
  static const double _spinner = BlynkControl.spinner;

  // Focus is a thicker ink outline, never colour alone.
  static const BorderSide _focusRing =
      BorderSide(color: BlynkCta.focusRing, width: BlynkCta.focusRingWidth);
  static const RoundedRectangleBorder _shape =
      RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll);

  ButtonStyle _style() {
    final minimum =
        Size(expand ? double.infinity : BlynkControl.minWidth, compact ? _compactHeight : _minHeight);
    final padding = WidgetStatePropertyAll<EdgeInsetsGeometry>(
      EdgeInsets.symmetric(
        horizontal: _kind == _BlynkButtonKind.tertiary ? BlynkSpace.s12 : BlynkSpace.s24,
        vertical: compact ? BlynkSpace.s8 : BlynkSpace.s12,
      ),
    );
    const noFeedback = WidgetStatePropertyAll<Color>(BlynkColors.clear);

    switch (_kind) {
      case _BlynkButtonKind.primary:
        return ButtonStyle(
          minimumSize: WidgetStatePropertyAll(minimum),
          tapTargetSize: MaterialTapTargetSize.padded,
          padding: padding,
          shape: const WidgetStatePropertyAll(_shape),
          elevation: const WidgetStatePropertyAll(0),
          shadowColor: noFeedback,
          surfaceTintColor: noFeedback,
          // The pressed state is the fill change alone, so nothing shifts.
          overlayColor: noFeedback,
          textStyle: const WidgetStatePropertyAll(BlynkText.label),
          // T2: one disabled recipe for every kind of button. Primary used to
          // grey out to `well`/`ink2` (4.54:1) while the CTA — the same role
          // at a different size — used BlynkCta's `line`/`ink3` (6.21:1).
          // Two recipes for one state is the drift the token layer exists to
          // stop, and this direction is the higher-contrast one.
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) return BlynkDisabled.fill;
            if (states.contains(WidgetState.pressed)) return BlynkCta.fillPressed;
            return BlynkCta.fill;
          }),
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.disabled) ? BlynkDisabled.label : BlynkCta.label;
          }),
          side: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.focused) ? _focusRing : null;
          }),
        );
      case _BlynkButtonKind.secondary:
      case _BlynkButtonKind.destructive:
        final destructive = _kind == _BlynkButtonKind.destructive;
        final ink = destructive ? BlynkColors.problem : BlynkColors.ink;
        return ButtonStyle(
          minimumSize: WidgetStatePropertyAll(minimum),
          padding: padding,
          shape: const WidgetStatePropertyAll(_shape),
          elevation: const WidgetStatePropertyAll(0),
          shadowColor: noFeedback,
          surfaceTintColor: noFeedback,
          textStyle: const WidgetStatePropertyAll(BlynkText.label),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.pressed) ? BlynkColors.well : BlynkColors.paper;
          }),
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.disabled) ? BlynkDisabled.label : ink;
          }),
          overlayColor: noFeedback,
          side: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.focused)) return _focusRing;
            if (states.contains(WidgetState.disabled)) {
              return const BorderSide(color: BlynkColors.line, width: BlynkControl.outlineWidth);
            }
            return BorderSide(
                color: destructive ? BlynkColors.problem : BlynkColors.lineStrong,
                width: BlynkControl.outlineWidth);
          }),
        );
      case _BlynkButtonKind.tertiary:
        return ButtonStyle(
          minimumSize: WidgetStatePropertyAll(minimum),
          padding: padding,
          shape: const WidgetStatePropertyAll(_shape),
          elevation: const WidgetStatePropertyAll(0),
          overlayColor: WidgetStatePropertyAll(BlynkColors.ink.withValues(alpha: 0.06)),
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.disabled) ? BlynkDisabled.label : BlynkColors.ink;
          }),
          textStyle: WidgetStateProperty.resolveWith((states) {
            final emphasised = states.contains(WidgetState.focused) || states.contains(WidgetState.hovered);
            return emphasised ? BlynkText.label.copyWith(decoration: TextDecoration.underline) : BlynkText.label;
          }),
          side: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.focused) ? _focusRing : null;
          }),
        );
      case _BlynkButtonKind.cta:
      case _BlynkButtonKind.promo:
        // These kinds render through _FlatCta/_PromoPill in build();
        // _style() (the ElevatedButton/OutlinedButton/TextButton machinery)
        // is never reached for them.
        throw StateError('_style() is not used for $_kind');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_kind == _BlynkButtonKind.cta) {
      return _FlatCta(
        label: label,
        semanticLabel: semanticLabel,
        onPressed: onPressed,
        leadingIcon: leadingIcon,
        trailingIcon: trailingIcon,
        loading: loading,
        expand: expand,
      );
    }
    if (_kind == _BlynkButtonKind.promo) {
      return _PromoPill(
        label: label,
        semanticLabel: semanticLabel,
        onPressed: onPressed,
        trailingIcon: trailingIcon,
        loading: loading,
        expand: expand,
      );
    }

    final enabled = onPressed != null;
    final interactive = enabled && !loading;
    // While loading the button keeps its enabled look but swallows the tap.
    final VoidCallback? handler = !enabled ? null : (loading ? () {} : onPressed);

    Widget content = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (leadingIcon != null) ...[
          Icon(leadingIcon, size: BlynkIcons.sm),
          const SizedBox(width: BlynkSpace.s8),
        ],
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (trailingIcon != null) ...[
          const SizedBox(width: BlynkSpace.s8),
          Icon(trailingIcon, size: BlynkIcons.sm),
        ],
      ],
    );

    if (loading) {
      content = Stack(
        alignment: Alignment.center,
        children: [
          Opacity(opacity: 0, child: content),
          const BlynkSpinner(size: _spinner),
        ],
      );
    }

    final style = _style();
    final Widget button = _kind == _BlynkButtonKind.primary
        ? ElevatedButton(onPressed: handler, style: style, child: content)
        : _kind == _BlynkButtonKind.tertiary
            ? TextButton(onPressed: handler, style: style, child: content)
            : OutlinedButton(onPressed: handler, style: style, child: content);

    return Semantics(
      // Its own node, so a merging ancestor (a promo slide) cannot absorb the button.
      container: true,
      button: true,
      enabled: interactive,
      label: loading ? '${semanticLabel ?? label}, loading' : (semanticLabel ?? label),
      onTap: interactive ? onPressed : null,
      excludeSemantics: true,
      child: button,
    );
  }
}

/// [BlynkButton.cta]: the flat-yellow primary action. A custom tappable
/// surface (not [ElevatedButton]) so the pressed/disabled fills, the focus
/// ring and the two-line label behaviour all come straight from
/// [BlynkCta] rather than from a Material `ButtonStyle` approximation.
class _FlatCta extends StatefulWidget {
  const _FlatCta({
    required this.label,
    required this.semanticLabel,
    required this.onPressed,
    required this.leadingIcon,
    required this.trailingIcon,
    required this.loading,
    required this.expand,
  });

  final String label;

  /// Announced in place of [label]; see [BlynkButton.semanticLabel].
  final String? semanticLabel;

  final VoidCallback? onPressed;
  final IconData? leadingIcon;
  final IconData? trailingIcon;
  final bool loading;
  final bool expand;

  // Review M-3: geometry comes from the component token, so the widget and
  // BlynkCta cannot drift apart.
  static const double _minHeight = BlynkCta.minHeight;
  static const double _spinner = BlynkControl.spinner;

  @override
  State<_FlatCta> createState() => _FlatCtaState();
}

class _FlatCtaState extends State<_FlatCta> {
  bool _pressed = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final interactive = enabled && !widget.loading;
    final VoidCallback? handler = !enabled ? null : (widget.loading ? () {} : widget.onPressed);
    final labelColor = enabled ? BlynkCta.label : BlynkCta.labelDisabled;
    final fill = !enabled
        ? BlynkCta.fillDisabled
        : (_pressed ? BlynkCta.fillPressed : BlynkCta.fill);

    Widget content = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.leadingIcon != null) ...[
          Icon(widget.leadingIcon, size: BlynkCta.iconSize, color: labelColor),
          const SizedBox(width: BlynkSpace.s8),
        ],
        Flexible(
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.ctaLabel.copyWith(color: labelColor),
          ),
        ),
        if (widget.trailingIcon != null) ...[
          const SizedBox(width: BlynkSpace.s8),
          Icon(widget.trailingIcon, size: BlynkCta.iconSize, color: labelColor),
        ],
      ],
    );

    if (widget.loading) {
      content = Stack(
        alignment: Alignment.center,
        children: [
          Opacity(opacity: 0, child: content),
          const BlynkSpinner(size: _FlatCta._spinner),
        ],
      );
    }

    return Semantics(
      container: true,
      button: true,
      enabled: interactive,
      label: widget.loading
          ? '${widget.semanticLabel ?? widget.label}, loading'
          : (widget.semanticLabel ?? widget.label),
      onTap: interactive ? widget.onPressed : null,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BlynkRadius.lgAll,
          onTap: handler,
          onHighlightChanged: enabled ? (p) => setState(() => _pressed = p) : null,
          onFocusChange: (f) => setState(() => _focused = f),
          // Feedback is the fill change alone; no ripple on the flat yellow.
          highlightColor: BlynkColors.clear,
          splashColor: BlynkColors.clear,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: _FlatCta._minHeight,
              minWidth: widget.expand ? double.infinity : BlynkControl.minWidth,
            ),
            child: Container(
              width: widget.expand ? double.infinity : null,
              padding: BlynkCta.padding,
              decoration: BoxDecoration(
                borderRadius: BlynkCta.radius,
                color: fill,
                border: _focused
                    ? Border.all(color: BlynkCta.focusRing, width: BlynkCta.focusRingWidth)
                    : null,
              ),
              // W8: centring happens HERE, not via `Container.alignment`.
              // A Container that carries an `alignment` expands to fill any
              // BOUNDED height it is given, so a `.cta` inside a Row or a
              // `Scaffold.bottomNavigationBar` slot silently took the whole
              // budget (W4 measured a sticky bar ~836 dp tall with the page
              // body at zero height — clean analyze, no exception, and every
              // `find.*` on the body quietly matching nothing).
              // `heightFactor: 1` makes the box hug its child's height while
              // still centring it; `widthFactor` is dropped only when the
              // button is asked to expand.
              child: Align(
                heightFactor: 1,
                widthFactor: widget.expand ? null : 1,
                child: content,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// [BlynkButton.promo]: the solid-ink "Shop Now" pill that sits on a promo
/// surface.
class _PromoPill extends StatefulWidget {
  const _PromoPill({
    required this.label,
    required this.semanticLabel,
    required this.onPressed,
    required this.trailingIcon,
    required this.loading,
    required this.expand,
  });

  final String label;

  /// Announced in place of [label]; see [BlynkButton.semanticLabel].
  final String? semanticLabel;

  final VoidCallback? onPressed;
  final IconData? trailingIcon;
  final bool loading;
  final bool expand;

  static const double _minHeight = BlynkCta.promoMinHeight;
  static const double _spinner = BlynkControl.spinnerCompact;

  @override
  State<_PromoPill> createState() => _PromoPillState();
}

class _PromoPillState extends State<_PromoPill> {
  bool _pressed = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final interactive = enabled && !widget.loading;
    final VoidCallback? handler = !enabled ? null : (widget.loading ? () {} : widget.onPressed);
    final labelColor = enabled ? BlynkCta.promoLabel : BlynkCta.labelDisabled;
    final fill = !enabled
        ? BlynkCta.fillDisabled
        : (_pressed ? BlynkCta.promoFillPressed : BlynkCta.promoFill);

    Widget content = Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Flexible(
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: BlynkText.label.copyWith(color: labelColor),
          ),
        ),
        if (widget.trailingIcon != null) ...[
          const SizedBox(width: BlynkSpace.s8),
          Icon(widget.trailingIcon, size: BlynkCta.iconSize, color: labelColor),
        ],
      ],
    );

    if (widget.loading) {
      content = Stack(
        alignment: Alignment.center,
        children: [
          Opacity(opacity: 0, child: content),
          const BlynkSpinner(size: _PromoPill._spinner),
        ],
      );
    }

    return Semantics(
      container: true,
      button: true,
      enabled: interactive,
      label: widget.loading
          ? '${widget.semanticLabel ?? widget.label}, loading'
          : (widget.semanticLabel ?? widget.label),
      onTap: interactive ? widget.onPressed : null,
      excludeSemantics: true,
      // W9: the pill is a 44 dp VISUAL inside a 48 dp TARGET, which is what
      // `MaterialTapTargetSize.padded` gives every other kind of button. It
      // had neither, so wiring it into the promo carousel (its first real
      // call site) would have shipped a sub-48 target on the app's most
      // prominent action.
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: BlynkControl.minHeight),
        child: Center(
          heightFactor: 1,
          widthFactor: widget.expand ? null : 1,
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BlynkCta.promoRadius,
              onTap: handler,
              onHighlightChanged: enabled ? (p) => setState(() => _pressed = p) : null,
              onFocusChange: (f) => setState(() => _focused = f),
              highlightColor: BlynkColors.clear,
              splashColor: BlynkColors.clear,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: _PromoPill._minHeight,
                  minWidth: widget.expand ? double.infinity : BlynkControl.minWidth,
                ),
                child: Container(
                  width: widget.expand ? double.infinity : null,
                  padding: BlynkCta.promoPadding,
                  decoration: BoxDecoration(
                    color: fill,
                    borderRadius: BlynkCta.promoRadius,
                    border: _focused
                        ? Border.all(color: BlynkCta.focusRing, width: BlynkCta.focusRingWidth)
                        : null,
                  ),
                  // W8: identical shape to _FlatCta's — see the note there. The
                  // promo pill sits inside a carousel slide, which is exactly the
                  // bounded-height context the old `alignment:` filled.
                  child: Align(
                    heightFactor: 1,
                    widthFactor: widget.expand ? null : 1,
                    child: content,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A secondary (left, narrower) and primary (right, wider) action side by
/// side. They share one height, and they stack (primary on top) when the text
/// scale or the available width would squeeze a label. Generalises
/// `AppButtonPair` for [BlynkButton]s.
class BlynkButtonPair extends StatelessWidget {
  const BlynkButtonPair({
    super.key,
    required this.secondary,
    required this.primary,
  });

  final Widget secondary;
  final Widget primary;

  /// Below this width two side-by-side labels no longer fit comfortably.
  ///
  /// Deliberately **not** a design token and deliberately public: it is this
  /// widget's own wrap threshold, measured from its two labels, not a page
  /// breakpoint. Plan §19's ladder (600 / 1024) is what a *screen* reaches for;
  /// putting 300 beside those in the token layer would invite a screen to use
  /// it as a fourth breakpoint. It is published here so a caller and a test can
  /// name it instead of repeating the number.
  static const double stackBelowWidth = 300;

  @override
  Widget build(BuildContext context) {
    final scaled = appButtonTextScale(context) > kStackButtonsAboveTextScale;
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow = constraints.hasBoundedWidth && constraints.maxWidth < stackBelowWidth;
        if (scaled || narrow) {
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              primary,
              const SizedBox(height: BlynkSpace.s8),
              secondary,
            ],
          );
        }
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: secondary),
              const SizedBox(width: BlynkSpace.s12),
              Expanded(flex: 2, child: primary),
            ],
          ),
        );
      },
    );
  }
}
