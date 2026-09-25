import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/dental_format.dart';

void main() {
  test('slot time is local and 12-hour', () {
    expect(formatSlotTime(DateTime(2027, 6, 7, 8, 0)), '8:00 AM');
    expect(formatSlotTime(DateTime(2027, 6, 7, 15, 30)), '3:30 PM');
    expect(formatSlotTime(DateTime(2027, 6, 7, 0, 5)), '12:05 AM');
  });

  test('appointment date and combined date/time', () {
    // 2027-06-07 is a Monday.
    expect(formatAppointmentDate(DateTime(2027, 6, 7)), 'Mon, 7 Jun');
    expect(formatAppointmentDateTime(DateTime(2027, 6, 7, 8, 0)), 'Mon, 7 Jun · 8:00 AM');
  });

  test('day strip label is short (no month)', () {
    expect(formatDayStripLabel(DateTime(2027, 6, 7)), 'Mon 7');
  });

  group('hold countdown', () {
    test('formats mm:ss', () {
      expect(formatHoldCountdown(const Duration(minutes: 4, seconds: 32)), '4:32');
      expect(formatHoldCountdown(const Duration(minutes: 5)), '5:00');
      expect(formatHoldCountdown(const Duration(seconds: 9)), '0:09');
    });

    test('a negative duration (already past heldUntil) floors at 0:00, never goes negative', () {
      expect(formatHoldCountdown(const Duration(seconds: -30)), '0:00');
    });
  });
}
