import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/dental_format.dart';
import 'package:ecom/Screens/dental_patient_details_screen.dart';
import 'package:ecom/Screens/dental_slot_picker_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';

import '../fixtures/dental_fixtures.dart';
import '../fixtures/session_fakes.dart';

/// `dental_provider_test.dart`'s `_FakeDentalApi` pattern, duplicated per
/// this codebase's own convention (`dental_doctor_profile_screen_test.dart`).
class _FakeDentalApi {
  final calls = <Map<String, dynamic>>[];
  final Map<String, Object Function(Map<String, dynamic>? query, Object? body)> routes = {};

  Future<dynamic> call(String method, String url, {Object? body, Map<String, dynamic>? query}) async {
    final key = '$method $url';
    calls.add({'key': key, 'query': query, 'body': body});
    final r = routes[key];
    if (r == null) throw ApiException(404, 'No route registered for $key.', code: 'NOT_FOUND');
    final v = r(query, body);
    if (v is ApiException) throw v;
    return v;
  }
}

Map<String, dynamic> _envelope(Object? data) => {'success': true, 'data': data};

/// Fixed "now" every test uses: 2027-06-07T03:00:00Z, matching the fixtures'
/// own dates.
DateTime _clock() => DateTime.utc(2027, 6, 7, 3, 0, 0);

Map<String, dynamic> _doctorWithPairing({String doctorId = 'd1', String clinicId = 'c1'}) => doctorJson(
      id: doctorId,
      clinics: [
        {
          'clinic_doctor_id': 'cd1',
          'clinic_id': clinicId,
          'name': 'Smile Dental Clinic',
          'city': 'Colombo',
          'address_line': '123 Galle Road',
          'latitude': 6.9271,
          'longitude': 79.8612,
          'consultation_fee': 3500,
        },
      ],
    );

void main() {
  late _FakeDentalApi api;
  late DentalProvider provider;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call, clock: _clock);
  });

  void routeDoctorAndAvailability({
    String doctorId = 'd1',
    String clinicId = 'c1',
    List<Map<String, dynamic>>? availability,
  }) {
    api.routes['GET /dental/doctors/$doctorId'] =
        (q, b) => _envelope({'doctor': _doctorWithPairing(doctorId: doctorId, clinicId: clinicId)});
    api.routes['GET /dental/doctors/$doctorId/availability'] = (q, b) => _envelope({
          'availability': availability ??
              [
                {'date': '2027-06-07', 'hasAvailability': true},
                {'date': '2027-06-08', 'hasAvailability': false},
              ],
        });
  }

  Future<void> pumpScreen(WidgetTester tester, {String doctorId = 'd1', String clinicId = 'c1'}) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<DentalProvider>.value(value: provider),
          ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
        ],
        child: MaterialApp(
          home: DentalSlotPickerScreen(doctorId: doctorId, clinicId: clinicId),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  // Bounded: the skeleton pulse repeats forever, so pumpAndSettle can't.
  Future<void> settle(WidgetTester tester, {int n = 10}) async {
    for (var i = 0; i < n; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('shows the loading skeleton while the first fetch is in flight', (tester) async {
    final pending = Completer<dynamic>();
    provider = DentalProvider(
      request: (method, url, {body, query}) async {
        if (method == 'GET' && url == '/dental/doctors/d1') return pending.future;
        throw ApiException(404, 'unexpected');
      },
      clock: _clock,
    );

    await pumpScreen(tester);
    expect(find.byKey(const Key('slot-picker-skeleton')), findsOneWidget);

    pending.complete(_envelope({'doctor': _doctorWithPairing()}));
    await settle(tester);
  });

  testWidgets('renders available and unavailable days, and that day\'s slots', (tester) async {
    routeDoctorAndAvailability();
    api.routes['GET /dental/doctors/d1/slots'] = (q, b) => _envelope({
          'date': '2027-06-07',
          'slots': ['2027-06-07T03:30:00.000Z', '2027-06-07T04:10:00.000Z'],
          'blockedReason': null,
        });

    await pumpScreen(tester);
    await settle(tester);

    // Available day (today, 7th).
    expect(find.byKey(const Key('day-chip-2027-6-7')), findsOneWidget);
    // Unavailable day (8th) is present but its chip cannot be tapped.
    final tomorrowInkWell = tester.widget<InkWell>(
      find.descendant(of: find.byKey(const Key('day-chip-2027-6-8')), matching: find.byType(InkWell)),
    );
    expect(tomorrowInkWell.onTap, isNull);

    // Slots for the selected (default: first) day render as local time chips.
    // Formatted with the same helper the widget uses, so this assertion
    // holds regardless of the machine's own timezone.
    expect(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')), findsOneWidget);
    expect(find.text(formatSlotTime(DateTime.parse('2027-06-07T03:30:00.000Z'))), findsOneWidget);
    expect(find.byKey(const Key('slot-chip-2027-06-07T04:10:00.000Z')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a fully booked day shows the "Fully booked" empty state', (tester) async {
    routeDoctorAndAvailability();
    api.routes['GET /dental/doctors/d1/slots'] = (q, b) => _envelope({'date': '2027-06-07', 'slots': []});

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('Fully booked'), findsOneWidget);
  });

  testWidgets('tapping a slot calls hold with the resolved clinic_doctor_id and navigates on success',
      (tester) async {
    routeDoctorAndAvailability();
    api.routes['GET /dental/doctors/d1/slots'] =
        (q, b) => _envelope({'date': '2027-06-07', 'slots': ['2027-06-07T03:30:00.000Z']});
    api.routes['POST /dental/appointments/holds'] = (q, b) => _envelope({
          'appointment': holdAppointmentJson(heldUntil: '2027-06-07T03:05:00.000Z'),
          'is_idempotent_replay': false,
        });

    await pumpScreen(tester);
    await settle(tester);

    await tester.tap(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')));
    await settle(tester);

    expect(find.byType(DentalPatientDetailsScreen), findsOneWidget);
    final holdCall = api.calls.firstWhere((c) => c['key'] == 'POST /dental/appointments/holds');
    final sentBody = holdCall['body'] as Map;
    // clinic_doctor_id came from the resolved pairing (cd1), never the bare doctorId (d1).
    expect(sentBody['clinic_doctor_id'], 'cd1');
    expect(sentBody['start_at'], '2027-06-07T03:30:00.000Z');
  });

  testWidgets('a 409 on hold shows the inline "just booked" message, refreshes slots, and does not navigate',
      (tester) async {
    routeDoctorAndAvailability();
    var slotsCalls = 0;
    api.routes['GET /dental/doctors/d1/slots'] = (q, b) {
      slotsCalls++;
      return _envelope({'date': '2027-06-07', 'slots': ['2027-06-07T03:30:00.000Z']});
    };
    api.routes['POST /dental/appointments/holds'] =
        (q, b) => ApiException(409, 'Someone else is holding this slot.', code: 'SLOT_HELD');

    await pumpScreen(tester);
    await settle(tester);
    final slotsCallsAfterLoad = slotsCalls;

    await tester.tap(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')));
    await settle(tester);

    expect(find.text('This time was just booked by someone else.'), findsOneWidget);
    expect(find.byType(DentalPatientDetailsScreen), findsNothing);
    // The slot list was refreshed (never a silent retry / auto-picked slot).
    expect(slotsCalls, greaterThan(slotsCallsAfterLoad));
  });

  testWidgets('a 422 SLOT_IN_PAST shows "this time has passed" and refreshes the slot list', (tester) async {
    routeDoctorAndAvailability();
    var slotsCalls = 0;
    api.routes['GET /dental/doctors/d1/slots'] = (q, b) {
      slotsCalls++;
      return _envelope({'date': '2027-06-07', 'slots': ['2027-06-07T03:30:00.000Z']});
    };
    api.routes['POST /dental/appointments/holds'] =
        (q, b) => ApiException(422, 'That time has already passed.', code: 'SLOT_IN_PAST');

    await pumpScreen(tester);
    await settle(tester);
    final slotsCallsAfterLoad = slotsCalls;

    await tester.tap(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')));
    await settle(tester);

    expect(find.text('This time has passed. Pick another slot.'), findsOneWidget);
    expect(find.byType(DentalPatientDetailsScreen), findsNothing);
    expect(slotsCalls, greaterThan(slotsCallsAfterLoad));
  });

  testWidgets('no clinic-doctor pairing at this clinic shows a not-found state, not a crash', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({'doctor': doctorJson(id: 'd1', clinics: [])});

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text('Doctor not available'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows the error view with retry, and retry reloads', (tester) async {
    api.routes['GET /dental/doctors/d1'] = (q, b) => ApiException(500, 'Something broke.');

    await pumpScreen(tester);
    await settle(tester);

    expect(find.text("We couldn't load booking details"), findsOneWidget);
    expect(find.byKey(const Key('slot-picker-retry')), findsOneWidget);

    routeDoctorAndAvailability();
    api.routes['GET /dental/doctors/d1/slots'] =
        (q, b) => _envelope({'date': '2027-06-07', 'slots': <String>[]});
    await tester.tap(find.byKey(const Key('slot-picker-retry')));
    await settle(tester);

    expect(find.text("We couldn't load booking details"), findsNothing);
    expect(find.text('Fully booked'), findsOneWidget);
  });
}
