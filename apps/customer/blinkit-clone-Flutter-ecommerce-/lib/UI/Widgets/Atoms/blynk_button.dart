import 'package:flutter/material.dart';

import '../../../app_design.dart' show appButtonTextScale, kStackButtonsAboveTextScale;
import '../../../design/tokens.dart';
import 'blynk_spinner.dart';

enum _BlynkButtonKind { primary, secondary, tertiary, destructive }

/// The one button. Primary is the signal-yellow forward action (one per
/// screen), secondary is an outline, tertiary is plain ink text, destructive
/// is a problem-coloured outline.
///
/// Height is a 48 dp floor that grows with the label (a large system font
/// wraps the text to at most two lines instead of clipping it). [onPressed]
/// null disables it; [loading] keeps the width, swaps the label for a spinner
/// and ignores taps.
class BlynkButton extends StatelessWidget {
  const BlynkButton.primary({
    super.key,
    required this.label,
    required this.onPressed,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
    this.compact = false,
  }) : _kind = _BlynkButtonKind.primary;

  const BlynkButton.secondary({
    super.key,
    required this.label,
    required this.onPressed,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
  })  : compact = false,
        _kind = _BlynkButtonKind.secondary;

  const BlynkButton.tertiary({
    super.key,
    required this.label,
    required this.onPressed,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
  })  : compact = false,
        _kind = _BlynkButtonKind.tertiary;

  const BlynkButton.destructive({
    super.key,
    required this.label,
    required this.onPressed,
    this.leadingIcon,
    this.loading = false,
    this.expand = false,
  })  : compact = false,
        _kind = _BlynkButtonKind.destructive;

  final String label;
  final VoidCallback? onPressed;
  final IconData? leadingIcon;
  final bool loading;
  final bool expand;

  /// A 44 dp visual pill for tight bars (the cart bar). Its tap target stays
  /// 48 dp because the button keeps `MaterialTapTargetSize.padded`.
  final bool compact;
  final _BlynkButtonKind _kind;

  static const double _minHeight = 48;
  static const double _compactHeight = 44;
  static const double _spinner = 18;

  // Focus is a thicker ink outline, never colour alone.
  static const BorderSide _focusRing = BorderSide(color: BlynkColors.ink, width: 2);
  static const RoundedRectangleBorder _shape =
      RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll);

  ButtonStyle _style() {
    final minimum = Size(expand ? double.infinity : 64, compact ? _compactHeight : _minHeight);
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
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) return BlynkColors.well;
            if (states.contains(WidgetState.pressed)) return BlynkColors.signalPressed;
            return BlynkColors.signal;
          }),
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.disabled) ? BlynkColors.ink2 : BlynkColors.onSignal;
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
            return states.contains(WidgetState.disabled) ? BlynkColors.ink2 : ink;
          }),
          overlayColor: noFeedback,
          side: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.focused)) return _focusRing;
            if (states.contains(WidgetState.disabled)) {
              return const BorderSide(color: BlynkColors.line, width: 1.5);
            }
            return BorderSide(color: destructive ? BlynkColors.problem : BlynkColors.lineStrong, width: 1.5);
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
            return states.contains(WidgetState.disabled) ? BlynkColors.ink2 : BlynkColors.ink;
          }),
          textStyle: WidgetStateProperty.resolveWith((states) {
            final emphasised = states.contains(WidgetState.focused) || states.contains(WidgetState.hovered);
            return emphasised ? BlynkText.label.copyWith(decoration: TextDecoration.underline) : BlynkText.label;
          }),
          side: WidgetStateProperty.resolveWith((states) {
            return states.contains(WidgetState.focused) ? _focusRing : null;
          }),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
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
      label: loading ? '$label, loading' : label,
      onTap: interactive ? onPressed : null,
      excludeSemantics: true,
      child: button,
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
