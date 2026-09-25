import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';

/// A text field with an always-visible label above it, optional helper text
/// and an inline error (2 dp problem border + icon + text, announced as a live
/// region). Never forces upper case.
class BlynkTextField extends StatefulWidget {
  const BlynkTextField({
    super.key,
    required this.label,
    this.controller,
    this.focusNode,
    this.hintText,
    this.helperText,
    this.errorText,
    this.autofillHints,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.inputFormatters,
    this.obscureText = false,
    this.maxLength,
    this.maxLines = 1,
    this.prefix,
    this.suffix,
    this.showClear = true,
    this.enabled = true,
    this.autofocus = false,
    this.onChanged,
    this.onSubmitted,
  });

  final String label;
  final TextEditingController? controller;
  final FocusNode? focusNode;
  final String? hintText;
  final String? helperText;
  final String? errorText;
  final Iterable<String>? autofillHints;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? inputFormatters;
  final bool obscureText;
  final int? maxLength;
  final int? maxLines;
  final Widget? prefix;
  final Widget? suffix;

  /// Show the 48 dp "Clear" button while the field is non-empty.
  final bool showClear;
  final bool enabled;
  final bool autofocus;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  State<BlynkTextField> createState() => _BlynkTextFieldState();
}

class _BlynkTextFieldState extends State<BlynkTextField> {
  TextEditingController? _ownController;
  late final FocusNode _ownFocus = FocusNode();

  TextEditingController get _controller => widget.controller ?? (_ownController ??= TextEditingController());
  FocusNode get _focus => widget.focusNode ?? _ownFocus;

  @override
  void dispose() {
    _ownController?.dispose();
    _ownFocus.dispose();
    super.dispose();
  }

  static OutlineInputBorder _border(Color color, double width) => OutlineInputBorder(
        borderRadius: BlynkRadius.mdAll,
        borderSide: BorderSide(color: color, width: width),
      );

  @override
  Widget build(BuildContext context) {
    final hasError = widget.errorText != null && widget.errorText!.isNotEmpty;

    final restBorder = hasError
        ? _border(BlynkColors.problem, 2)
        : _border(widget.enabled ? BlynkColors.lineStrong : BlynkColors.line, 1);
    final focusBorder = _border(hasError ? BlynkColors.problem : BlynkColors.ink, 2);

    final field = ListenableBuilder(
      listenable: _controller,
      builder: (context, _) {
        final showClear = widget.showClear && widget.enabled && !widget.obscureText && _controller.text.isNotEmpty;
        Widget? suffix;
        if (showClear || widget.suffix != null) {
          suffix = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (showClear)
                IconButton(
                  tooltip: 'Clear',
                  icon: const Icon(BlynkIcons.close, size: BlynkIcons.sm),
                  constraints: const BoxConstraints.tightFor(width: 48, height: 48),
                  onPressed: () {
                    _controller.clear();
                    widget.onChanged?.call('');
                    _focus.requestFocus();
                  },
                ),
              if (widget.suffix != null) widget.suffix!,
            ],
          );
        }

        return TextField(
          controller: _controller,
          focusNode: _focus,
          enabled: widget.enabled,
          autofocus: widget.autofocus,
          autofillHints: widget.autofillHints,
          keyboardType: widget.keyboardType,
          textInputAction: widget.textInputAction,
          textCapitalization: widget.textCapitalization,
          inputFormatters: widget.inputFormatters,
          obscureText: widget.obscureText,
          maxLength: widget.maxLength,
          maxLines: widget.obscureText ? 1 : widget.maxLines,
          onChanged: widget.onChanged,
          onSubmitted: widget.onSubmitted,
          style: BlynkText.body,
          cursorColor: BlynkColors.ink,
          decoration: InputDecoration(
            hintText: widget.hintText,
            hintStyle: BlynkText.body.copyWith(color: BlynkColors.ink2),
            filled: true,
            fillColor: widget.enabled ? BlynkColors.well : BlynkColors.paper,
            // The counter is decoration, not information a shopper needs.
            counterText: '',
            constraints: const BoxConstraints(minHeight: 48),
            isDense: false,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: BlynkSpace.s16,
              vertical: BlynkSpace.s12,
            ),
            // 2026-09-24: `prefixIconConstraints` stretches this box to 48 dp,
            // and `Padding` does not centre its child — so a text prefix like
            // "+94" sat at the TOP of the box while the input text is centred,
            // which read as two stacked lines inside one field. `Center` with
            // `widthFactor: 1` keeps the box hugging the prefix horizontally
            // while centring it on the input's baseline row.
            prefixIcon: widget.prefix == null
                ? null
                : Center(
                    widthFactor: 1,
                    child: Padding(
                      padding: const EdgeInsetsDirectional.only(
                          start: BlynkSpace.s12, end: BlynkSpace.s8),
                      child: widget.prefix,
                    ),
                  ),
            prefixIconConstraints: const BoxConstraints(minHeight: 48),
            suffixIcon: suffix,
            suffixIconConstraints: const BoxConstraints(minHeight: 48),
            border: restBorder,
            enabledBorder: restBorder,
            disabledBorder: restBorder,
            focusedBorder: focusBorder,
            errorBorder: restBorder,
            focusedErrorBorder: focusBorder,
          ),
        );
      },
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        ExcludeSemantics(
          child: Text(widget.label, style: BlynkText.label),
        ),
        const SizedBox(height: BlynkSpace.s8),
        Semantics(
          label: widget.label,
          child: field,
        ),
        if (hasError)
          Padding(
            padding: const EdgeInsets.only(top: BlynkSpace.s8),
            child: Semantics(
              liveRegion: true,
              container: true,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(BlynkIcons.error, size: BlynkIcons.xs, color: BlynkColors.problem),
                  ),
                  const SizedBox(width: BlynkSpace.s4),
                  Expanded(
                    child: Text(
                      widget.errorText!,
                      style: BlynkText.caption.copyWith(color: BlynkColors.problem),
                    ),
                  ),
                ],
              ),
            ),
          )
        else if (widget.helperText != null)
          Padding(
            padding: const EdgeInsets.only(top: BlynkSpace.s8),
            child: Text(
              widget.helperText!,
              style: BlynkText.caption.copyWith(color: BlynkColors.ink2),
            ),
          ),
      ],
    );
  }
}
