import 'package:flutter/material.dart';

import '../../../Models/order_format.dart';
import '../../../Models/order_model.dart';
import '../../../Models/order_status_labels.dart';
import '../../../app_design.dart' show appCardDecoration;
import '../../../design/tokens.dart';

/// "What happened": one row per `history[]` entry, oldest first, exactly as
/// the backend recorded it. No future/greyed/placeholder steps - a status
/// that never appears in `history` never gets a row here, and a row with
/// `at == null` never invents a time.
class OrderTimeline extends StatelessWidget {
  const OrderTimeline({super.key, required this.history});

  final List<OrderStatusEvent> history;

  /// Fixed-width gutter: the past dots, the final dot and the rail all centre
  /// on the same x, so every row's label starts on the same x too.
  static const double _dotColumn = BlynkSpace.s12;
  static const double _pastDot = 10;

  /// A past dot is the row's own tone at a quieter weight — the wording
  /// already says what happened; this only adds emphasis to it.
  static const double _pastDotAlpha = 0.45;

  /// The optical gap between a row's label and its timestamp; smaller than
  /// [BlynkSpace.s4] because the two lines are one block.
  static const double _timeGap = 2;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) return const SizedBox.shrink();

    return Container(
      key: const Key('order-timeline'),
      padding: const EdgeInsets.all(BlynkSpace.s16),
      // The app's one card recipe, the same one the bill card already uses,
      // instead of this file's own flat white + hairline.
      decoration: appCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('What happened', style: BlynkText.sectionHeader),
          const SizedBox(height: BlynkSpace.s16),
          for (var i = 0; i < history.length; i++) _row(i, history[i], isLast: i == history.length - 1),
        ],
      ),
    );
  }

  Widget _row(int index, OrderStatusEvent event, {required bool isLast}) {
    final label = timelineLabel(event);
    final time = event.at == null ? null : formatOrderTime(event.at!);
    // The row's own recorded status already says the same thing in words -
    // this only adds emphasis to it, it never carries meaning on its own.
    final tone = orderToneColor(orderStatusTone(event.newStatus));

    return Semantics(
      label: time == null ? label : '$label, $time',
      excludeSemantics: true,
      child: Container(
        key: Key('timeline-row-$index'),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Fixed-width gutter: the 10px past dots, the 12px final dot and
            // the rail all centre on the same x, and every row's label
            // therefore starts on the same x too.
            SizedBox(
              width: _dotColumn,
              child: Column(
                children: [
                  Container(
                    width: isLast ? _dotColumn : _pastDot,
                    height: isLast ? _dotColumn : _pastDot,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isLast ? tone : BlynkColors.paper,
                      border: isLast
                          ? null
                          : Border.all(color: tone.withValues(alpha: _pastDotAlpha), width: 2),
                    ),
                  ),
                  if (!isLast)
                    Container(
                      width: 2,
                      height: BlynkSpace.s16,
                      color: BlynkColors.line,
                    ),
                ],
              ),
            ),
            const SizedBox(width: BlynkSpace.s12),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : BlynkSpace.s12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: BlynkText.label.copyWith(color: tone),
                    ),
                    if (time != null) ...[
                      const SizedBox(height: _timeGap),
                      Text(time, style: BlynkText.caption.copyWith(color: BlynkColors.ink2)),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
