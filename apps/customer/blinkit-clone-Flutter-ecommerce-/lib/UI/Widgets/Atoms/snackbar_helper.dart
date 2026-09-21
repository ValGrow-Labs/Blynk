import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// Shows an ink SnackBar (paper text, 4 s, floating) on every platform.
///
/// Pass either a [context] under a `ScaffoldMessenger` or a [messengerKey]
/// (for code with no BuildContext, e.g. the app's root messenger). A new
/// message replaces the current one instead of queueing behind it. An error
/// is marked with an icon as well as the words, never colour alone.
ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? showBlynkSnackBar({
  BuildContext? context,
  GlobalKey<ScaffoldMessengerState>? messengerKey,
  required String message,
  String? actionLabel,
  VoidCallback? onAction,
  bool isError = false,
}) {
  assert(
    (context == null) != (messengerKey == null),
    'Pass exactly one of context or messengerKey.',
  );
  final messenger = context != null ? ScaffoldMessenger.maybeOf(context) : messengerKey!.currentState;
  if (messenger == null) return null;

  final hasAction = actionLabel != null && onAction != null;

  messenger.hideCurrentSnackBar();
  return messenger.showSnackBar(
    SnackBar(
      backgroundColor: BlynkColors.ink,
      behavior: SnackBarBehavior.floating,
      shape: const RoundedRectangleBorder(borderRadius: BlynkRadius.mdAll),
      duration: const Duration(seconds: 4),
      // Flutter keeps a SnackBar with an action open until dismissed; the
      // customer messages here are transient.
      persist: false,
      elevation: 0,
      content: Semantics(
        liveRegion: true,
        child: Row(
          children: [
            if (isError) ...[
              const ExcludeSemantics(
                child: Icon(BlynkIcons.error, size: BlynkIcons.sm, color: BlynkColors.paper),
              ),
              const SizedBox(width: BlynkSpace.s12),
            ],
            Expanded(
              child: Text(message, style: BlynkText.body.copyWith(color: BlynkColors.paper)),
            ),
          ],
        ),
      ),
      action: hasAction
          ? SnackBarAction(
              label: actionLabel,
              textColor: BlynkColors.paper,
              onPressed: onAction,
            )
          : null,
    ),
  );
}
