// Small local formatting helpers for the booking flow (task F3) - no `intl`
// dependency, mirroring `order_format.dart`'s own convention exactly. Kept
// separate from `order_format.dart` rather than importing it: its weekday/
// month arrays are private, and dental is its own domain (common.md rule 3)
// even for a small formatting helper like this one.
library;

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _time12h(DateTime d) {
  final hour12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final ampm = d.hour < 12 ? 'AM' : 'PM';
  final minute = d.minute.toString().padLeft(2, '0');
  return '$hour12:$minute $ampm';
}

/// '8:00 AM' in the device's local time - a slot chip / countdown label.
String formatSlotTime(DateTime at) => _time12h(at.toLocal());

/// 'Mon, 7 Jun' in the device's local time - the review/confirmation date.
String formatAppointmentDate(DateTime at) {
  final d = at.toLocal();
  return '${_weekdays[d.weekday - 1]}, ${d.day} ${_months[d.month - 1]}';
}

/// 'Mon, 7 Jun · 8:00 AM' - the combined date/time summary line.
String formatAppointmentDateTime(DateTime at) =>
    '${formatAppointmentDate(at)} · ${formatSlotTime(at)}';

/// 'Mon 7' - a short label for one day-strip chip (no month: the strip only
/// ever shows a couple of weeks, so the month never needs disambiguating).
String formatDayStripLabel(DateTime day) => '${_weekdays[day.weekday - 1]} ${day.day}';

/// 'mm:ss', floored at zero. [remaining] must already be the real
/// `heldUntil - now` the backend returned (common.md / B3: the hold is real,
/// never a client-invented duration) - this only formats it, never derives
/// or extends it.
String formatHoldCountdown(Duration remaining) {
  final clamped = remaining.isNegative ? Duration.zero : remaining;
  final minutes = clamped.inMinutes;
  final seconds = clamped.inSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}
