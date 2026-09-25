import 'package:flutter/material.dart';

import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

// Placeholder text is ink2 (4.83:1 on the well), not the retired 2.54:1 muted
// grey.
final TextStyle _placeholder = BlynkText.body.copyWith(color: BlynkColors.ink2);

/// Home's search entry: a full-width field directly under the address block.
///
/// It is a button styled as a field — typing happens on the dedicated search
/// screen, so Home never rebuilds per keystroke. It wears the same recipe as
/// the app's one real text field (`BlynkTextField`): a `well` fill, the `md`
/// radius and a `lineStrong` boundary, so tapping through to Search is
/// visually continuous rather than a jump between two different field looks.
///
/// 2026-09-24 (restored): this field was briefly replaced by a circular search
/// icon in the brand row. The customer asked for the reference's prominent
/// search bar back, and a field that reads as a field is also the larger,
/// more discoverable target. The brand row's circular search button went with
/// this restoration — two search affordances on one screen is duplicate
/// chrome, and the field is the better of the two.
///
/// There is deliberately **no microphone**: the app has no voice search, and a
/// control that does nothing is worse than no control at all.
class HomeScreenSearchBar extends StatelessWidget {
  const HomeScreenSearchBar({super.key});

  /// A search bar stretched across a desktop browser stops reading as a
  /// search field - cap it like a typical desktop search bar.
  static const double desktopMaxWidth = 640;
  static const double tabletMaxWidth = 520;

  /// The placeholder, identical to the Search screen's own hint so the two
  /// surfaces read as one field.
  static const String placeholder = 'Search groceries & essentials';

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);
    final gutter = BlynkSpace.gutterFor(responsive.width);

    return SliverToBoxAdapter(
      child: Container(
        color: BlynkColors.paper,
        width: double.infinity,
        alignment: Alignment.center,
        padding: EdgeInsets.fromLTRB(
          gutter,
          BlynkSpace.s8,
          gutter,
          BlynkSpace.s12,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: responsive.isDesktop
                ? desktopMaxWidth
                : (responsive.isTablet ? tabletMaxWidth : double.infinity),
          ),
          child: Semantics(
            button: true,
            label: 'Search groceries and essentials',
            excludeSemantics: true,
            child: Material(
              color: BlynkColors.well,
              shape: const RoundedRectangleBorder(
                borderRadius: BlynkRadius.mdAll,
                side: BorderSide(color: BlynkColors.lineStrong),
              ),
              child: InkWell(
                borderRadius: BlynkRadius.mdAll,
                onTap: () => Navigator.of(context).pushNamed('/search'),
                child: ConstrainedBox(
                  constraints:
                      const BoxConstraints(minHeight: BlynkControl.minHeight),
                  child: Row(
                    children: [
                      const SizedBox(width: BlynkSpace.s16),
                      const Icon(
                        BlynkIcons.search,
                        color: BlynkColors.ink,
                        size: BlynkIcons.md,
                      ),
                      const SizedBox(width: BlynkSpace.s12),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            vertical: BlynkSpace.s12,
                          ),
                          child: Text(
                            placeholder,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: _placeholder,
                          ),
                        ),
                      ),
                      const SizedBox(width: BlynkSpace.s16),
                    ],
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
