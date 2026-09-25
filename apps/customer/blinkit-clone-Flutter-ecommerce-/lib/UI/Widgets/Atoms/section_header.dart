import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import 'blynk_button.dart';

/// The one section header in the app: a title and at most one trailing text
/// action. It replaces the ad-hoc "title Row + TextButton" pairs that had
/// drifted across roughly a dozen screens.
///
/// Two rules it exists to hold:
/// * **Sections are separated by space, not rules** — there is no divider
///   here and there must not be one added.
/// * **The action is a text button, never a yellow CTA.** It is a
///   [BlynkButton.tertiary], so it cannot consume the screen's one yellow
///   action and it inherits the shared ≥48 dp target, focus ring and disabled
///   recipe rather than forking them.
///
/// The action renders only when both [actionLabel] and [onAction] are given —
/// a label with nothing behind it would be dead chrome.
class BlynkSectionHeader extends StatelessWidget {
  const BlynkSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
    this.padding = defaultPadding,
    this.actionKey,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  /// Outer padding. The default carries the page gutter on the left and the
  /// section's vertical rhythm; a caller already inside a gutter passes
  /// [EdgeInsets.zero] or its own.
  final EdgeInsets padding;

  final Key? actionKey;

  /// Generous above, tighter below, so the header reads as belonging to the
  /// content under it. The right inset is smaller because the text button
  /// carries its own padding.
  static const EdgeInsets defaultPadding = EdgeInsets.fromLTRB(
    BlynkSpace.s16,
    BlynkSpace.s24,
    BlynkSpace.s8,
    BlynkSpace.s12,
  );

  @override
  Widget build(BuildContext context) {
    final showAction = actionLabel != null && onAction != null;

    return Padding(
      padding: padding,
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                title,
                // One line, as before. Two would read better at 2.0x text
                // scale, but a section header that grows by a whole line
                // pushes everything below it down on every section of a long
                // page - measurably enough to move a Home rail's retry row
                // off-screen. The page rhythm wins; the title ellipsises.
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: BlynkText.sectionHeader,
              ),
            ),
          ),
          if (showAction)
            BlynkButton.tertiary(
              key: actionKey,
              label: actionLabel!,
              onPressed: onAction,
            ),
        ],
      ),
    );
  }
}
