import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import 'blynk_button.dart';

/// A slim full-width notice shown while the app is showing saved content
/// because there is no connection. Announced as a live region; it does not
/// animate, so reduced motion needs no special case.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({
    super.key,
    this.message = "You're offline. Showing saved items.",
    this.onRetry,
    this.icon = BlynkIcons.offline,
  });

  final String message;

  /// The offline glyph unless the notice is about another failure.
  final IconData icon;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: BlynkColors.noticeTint,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: BlynkSpace.s16,
          vertical: BlynkSpace.s4,
        ),
        child: Row(
          children: [
            ExcludeSemantics(
              child: Icon(icon, size: BlynkIcons.sm, color: BlynkColors.notice),
            ),
            const SizedBox(width: BlynkSpace.s12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s8),
                // The live region is the message only; the retry button stays its own node.
                child: Semantics(
                  liveRegion: true,
                  container: true,
                  child: Text(
                    message,
                    style: BlynkText.caption.copyWith(
                        color: BlynkColors.notice, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ),
            if (onRetry != null)
              BlynkButton.tertiary(label: 'Try again', onPressed: onRetry),
          ],
        ),
      ),
    );
  }
}
