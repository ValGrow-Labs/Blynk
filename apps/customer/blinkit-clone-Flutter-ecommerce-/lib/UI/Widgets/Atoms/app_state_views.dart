import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import 'blynk_button.dart';
import 'blynk_spinner.dart';
import 'section_header.dart';

/// The one state view for every empty, error, offline, not-found and loading
/// case in the customer app: an outline glyph, a title, one sentence and at
/// most one action. A failed catalog load and an empty cart read as the same
/// product rather than two error dialects.
///
/// Callers pass customer-facing copy only - never an exception message, a
/// status code or a backend error body. Error and offline variants are live
/// regions so a screen reader announces them.
class AppStateView extends StatelessWidget {
  const AppStateView({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    // Kept so existing call sites compile; the glyph is brand-neutral now.
    this.accent,
    this.actionKey,
  })  : _busy = false,
        _liveRegion = false,
        _secondaryAction = false;

  /// A spinner with a short label ("Loading categories").
  const AppStateView.loading(String label, {super.key})
      : icon = BlynkIcons.info,
        title = label,
        message = null,
        actionLabel = null,
        onAction = null,
        accent = null,
        actionKey = null,
        _busy = true,
        _liveRegion = false,
        _secondaryAction = false;

  const AppStateView.empty({
    super.key,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.actionKey,
  })  : icon = BlynkIcons.empty,
        accent = null,
        _busy = false,
        _liveRegion = false,
        _secondaryAction = false;

  const AppStateView.error({
    super.key,
    required this.title,
    this.message,
    required VoidCallback? onRetry,
    String retryLabel = 'Try again',
    this.actionKey,
  })  : icon = BlynkIcons.error,
        actionLabel = onRetry == null ? null : retryLabel,
        onAction = onRetry,
        accent = null,
        _busy = false,
        _liveRegion = true,
        _secondaryAction = false;

  const AppStateView.offline(VoidCallback? onRetry, {super.key, this.actionKey})
      : icon = BlynkIcons.offline,
        title = "You're offline",
        message = 'Check your connection and try again. Your cart is saved.',
        actionLabel = onRetry == null ? null : 'Try again',
        onAction = onRetry,
        accent = null,
        _busy = false,
        _liveRegion = true,
        _secondaryAction = false;

  const AppStateView.notFound({
    super.key,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.actionKey,
  })  : icon = BlynkIcons.notFound,
        accent = null,
        _busy = false,
        _liveRegion = false,
        _secondaryAction = true;

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  /// Ignored. See the constructor.
  final Color? accent;

  /// Key of the action button, so a screen (or a test) can find its retry.
  final Key? actionKey;

  final bool _busy;
  final bool _liveRegion;

  /// Not-found actions (Go back) are not a forward step, so they are outlined.
  final bool _secondaryAction;

  @override
  Widget build(BuildContext context) {
    final hasAction = actionLabel != null && onAction != null;

    Widget messageBlock = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_busy)
          const BlynkSpinner(size: BlynkIcons.lg, strokeWidth: 3)
        else
          ExcludeSemantics(child: Icon(icon, size: BlynkIcons.lg, color: BlynkColors.ink3)),
        const SizedBox(height: BlynkSpace.s16),
        Text(title, textAlign: TextAlign.center, style: BlynkText.heading),
        if (message != null) ...[
          const SizedBox(height: BlynkSpace.s8),
          Text(
            message!,
            textAlign: TextAlign.center,
            style: BlynkText.body.copyWith(color: BlynkColors.ink3),
          ),
        ],
      ],
    );

    // The live region is the message only, so the retry button stays its own node.
    if (_liveRegion) {
      messageBlock = Semantics(liveRegion: true, container: true, child: messageBlock);
    }

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        messageBlock,
        if (hasAction) ...[
          const SizedBox(height: BlynkSpace.s24),
          _secondaryAction
              ? BlynkButton.secondary(key: actionKey, label: actionLabel!, onPressed: onAction)
              : BlynkButton.primary(key: actionKey, label: actionLabel!, onPressed: onAction),
        ],
      ],
    );

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(BlynkSpace.s24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: content,
        ),
      ),
    );
  }
}

/// Section title with an optional trailing action (e.g. "See all").
///
/// W1 moved the implementation to [BlynkSectionHeader] in
/// `section_header.dart`; this is the compatibility name its existing call
/// sites keep using, so every section header in the app got the redesigned
/// treatment without a screen edit. New code should name
/// [BlynkSectionHeader] directly.
class AppSectionHeader extends StatelessWidget {
  const AppSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => BlynkSectionHeader(
        title: title,
        actionLabel: actionLabel,
        onAction: onAction,
      );
}
