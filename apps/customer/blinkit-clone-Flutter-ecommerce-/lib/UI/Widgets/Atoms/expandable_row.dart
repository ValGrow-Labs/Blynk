import 'package:flutter/material.dart';

import '../../../design/tokens.dart';

/// A product detail collapsible section ("Product Details", "Nutrition
/// Information", "Reviews" — spec §3 "Expandable row"): a full-width row
/// with a bold label, a trailing chevron that rotates open, and a [line]
/// divider beneath. [child] is only built and shown while expanded.
class ExpandableRow extends StatefulWidget {
  const ExpandableRow({
    super.key,
    required this.title,
    required this.child,
    this.initiallyExpanded = false,
  });

  final String title;
  final Widget child;
  final bool initiallyExpanded;

  @override
  State<ExpandableRow> createState() => _ExpandableRowState();
}

class _ExpandableRowState extends State<ExpandableRow> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final duration = BlynkMotion.resolve(context, BlynkMotion.base);

    return DecoratedBox(
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: BlynkColors.line))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            label: widget.title,
            toggled: _expanded,
            onTap: () => setState(() => _expanded = !_expanded),
            excludeSemantics: true,
            child: Material(
              type: MaterialType.transparency,
              child: InkWell(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16 + 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(widget.title, style: BlynkText.rowLabel),
                      ),
                      AnimatedRotation(
                        turns: _expanded ? 0.5 : 0,
                        duration: duration,
                        child: const Icon(Icons.keyboard_arrow_down, color: BlynkColors.ink, size: BlynkIcons.md),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          ClipRect(
            child: AnimatedSize(
              duration: duration,
              alignment: Alignment.topCenter,
              child: _expanded
                  ? Padding(
                      padding: const EdgeInsets.only(bottom: BlynkSpace.s16),
                      child: widget.child,
                    )
                  : const SizedBox(width: double.infinity),
            ),
          ),
        ],
      ),
    );
  }
}
