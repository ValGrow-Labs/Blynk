import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// What a transient message is telling the customer. The surface stays ink on
/// every tone — the **glyph** and the words carry the meaning, never a colour
/// (Global Constraints: no colour-only meaning), and no tone introduces a
/// pairing that has not been contrast-measured.
enum SnackTone {
  /// Plain confirmation or neutral news ("Address saved"). No glyph.
  info,

  /// Something the customer asked for worked ("Order placed").
  success,

  /// Something did not work. The words must be the mapped `CustomerError`
  /// copy — never an exception message, a status code or a backend body.
  error,
}

/// Shows an ink SnackBar (paper text, 4 s, floating) on every platform.
///
/// Pass either a [context] under a `ScaffoldMessenger` or a [messengerKey]
/// (for code with no BuildContext, e.g. the app's root messenger). A new
/// message replaces the current one instead of queueing behind it.
///
/// [tone] picks the glyph: none for [SnackTone.info], a check for
/// [SnackTone.success], an error glyph for [SnackTone.error]. All three
/// render `paper` on `ink` (16.68:1), so the tone is never colour alone and
/// adds no unmeasured pairing.
ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? showBlynkSnackBar({
  BuildContext? context,
  GlobalKey<ScaffoldMessengerState>? messengerKey,
  required String message,
  String? actionLabel,
  VoidCallback? onAction,
  SnackTone tone = SnackTone.info,
}) {
  assert(
    (context == null) != (messengerKey == null),
    'Pass exactly one of context or messengerKey.',
  );
  final messenger = context != null ? ScaffoldMessenger.maybeOf(context) : messengerKey!.currentState;
  if (messenger == null) return null;

  final hasAction = actionLabel != null && onAction != null;
  final IconData? glyph = switch (tone) {
    SnackTone.info => null,
    SnackTone.success => BlynkIcons.check,
    SnackTone.error => BlynkIcons.error,
  };

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
            if (glyph != null) ...[
              ExcludeSemantics(
                child: Icon(glyph, size: BlynkIcons.sm, color: BlynkColors.paper),
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
