// One flow-level test for the whole booking sub-flow (task F3): slot-pick ->
// hold -> patient details -> review -> confirm -> confirmation, using F1's
// injectable-request test harness with realistic mocked responses (never a
// live backend).
//
// Placed under `test/`, not `integration_test/`: every existing file in
// `integration_test/` (`order_lifecycle_flow_test.dart`,
// `live_customer_flow_test.dart`, `admin_to_customer_flow_test.dart`,
// `live_location_tracking_flow_test.dart`) drives the real app against a
// live backend over real HTTP - none of them accept a mocked request
// function. A mocked flow test belongs with this codebase's own widget-test
// harness instead (`test/Screens/*_test.dart`'s `_FakeDentalApi` /
// `DentalProvider(request: ...)` convention), which is what this file uses -
// documented as a deviation from the brief's literal "integration_test/ if
// that's where existing flow tests live" in task-F3-report.md.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Screens/dental_booking_confirmation_screen.dart';
import 'package:ecom/Screens/dental_booking_review_screen.dart';
import 'package:ecom/Screens/dental_patient_details_screen.dart';
import 'package:ecom/Screens/dental_slot_picker_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/UI/Widgets/Atoms/status_badge.dart';

import 'fixtures/dental_fixtures.dart';
import 'fixtures/session_fakes.dart';

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

Map<String, dynamic> _doctorWithPairing({String doctorId = 'd1', String clinicId = 'c1'}) => doctorJson(
      id: doctorId,
      fullName: 'Dr. Nadeesha Perera',
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
  testWidgets(
    'slot-pick -> hold -> patient details -> review -> confirm -> confirmation, with meaningful data at every step',
    (tester) async {
      final api = _FakeDentalApi();
      final provider = DentalProvider(request: api.call, clock: () => DateTime.utc(2027, 6, 7, 3, 0, 0));

      api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({'doctor': _doctorWithPairing()});
      api.routes['GET /dental/doctors/d1/availability'] = (q, b) => _envelope({
            'availability': [
              {'date': '2027-06-07', 'hasAvailability': true},
            ],
          });
      api.routes['GET /dental/doctors/d1/slots'] = (q, b) => _envelope({
            'date': '2027-06-07',
            'slots': ['2027-06-07T03:30:00.000Z'],
            'blockedReason': null,
          });
      api.routes['POST /dental/appointments/holds'] = (q, b) => _envelope({
            'appointment': holdAppointmentJson(
              id: 'a1',
              heldUntil: '2027-06-07T03:05:00.000Z',
              startAt: '2027-06-07T03:30:00.000Z',
            ),
            'is_idempotent_replay': false,
          });
      api.routes['POST /dental/appointments/a1/confirm'] = (q, b) => _envelope({
            'appointment': appointmentJson(
              id: 'a1',
              status: 'CONFIRMED',
              startAt: '2027-06-07T03:30:00.000Z',
              patientName: 'Jane Silva',
              patientPhone: '+94771234567',
              patientNotes: 'Sensitive to cold water.',
            ),
          });

      Future<void> settle({int n = 10}) async {
        for (var i = 0; i < n; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
      }

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<DentalProvider>.value(value: provider),
            ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
          ],
          child: const MaterialApp(
            home: DentalSlotPickerScreen(doctorId: 'd1', clinicId: 'c1'),
          ),
        ),
      );
      await settle();

      // Step 1: the slot picker resolved the pairing and shows the one slot.
      expect(find.byType(DentalSlotPickerScreen), findsOneWidget);
      expect(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')), findsOneWidget);

      // Step 2: tapping it holds the slot and lands on patient details.
      await tester.tap(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')));
      await settle();

      expect(find.byType(DentalPatientDetailsScreen), findsOneWidget);
      final holdBody = api.calls.firstWhere((c) => c['key'] == 'POST /dental/appointments/holds')['body'] as Map;
      expect(holdBody['clinic_doctor_id'], 'cd1');
      expect(holdBody['start_at'], '2027-06-07T03:30:00.000Z');

      // Prefilled from the signed-in profile, but overwritten here to prove
      // the form's own values (not the profile's) are what travels forward.
      await tester.enterText(find.byKey(const Key('patient-name-field')), 'Jane Silva');
      await tester.enterText(find.byKey(const Key('patient-phone-field')), '0771234567');
      await tester.enterText(find.byKey(const Key('patient-notes-field')), 'Sensitive to cold water.');

      // Step 3: continuing reaches the review screen with the real hold data.
      await tester.tap(find.byKey(const Key('patient-details-continue')));
      await settle();

      expect(find.byType(DentalBookingReviewScreen), findsOneWidget);
      expect(find.text('Dr. Nadeesha Perera'), findsOneWidget);
      expect(find.text('Smile Dental Clinic'), findsOneWidget);
      expect(find.byType(MoneyText), findsOneWidget);
      expect(tester.widget<MoneyText>(find.byType(MoneyText)).amount, 3500);
      expect(find.textContaining('Reserved for'), findsOneWidget);

      // Step 4: confirming calls the real endpoint with the real patient
      // details and no clinic_doctor_id/start_at (those are fixed by the hold).
      await tester.tap(find.byKey(const Key('confirm-booking')));
      await settle();

      final confirmBody = api.calls.firstWhere((c) => c['key'] == 'POST /dental/appointments/a1/confirm')['body']
          as Map;
      expect(confirmBody['patient_name'], 'Jane Silva');
      expect(confirmBody['patient_phone'], '+94771234567');
      expect(confirmBody['patient_notes'], 'Sensitive to cold water.');
      expect(confirmBody.containsKey('clinic_doctor_id'), isFalse);
      expect(confirmBody.containsKey('start_at'), isFalse);

      // Step 5: confirmation shows the real confirmed appointment, never any
      // online-payment copy.
      expect(find.byType(DentalBookingConfirmationScreen), findsOneWidget);
      expect(find.text('Appointment confirmed'), findsOneWidget);
      expect(find.byType(StatusBadge), findsOneWidget);
      expect(tester.widget<StatusBadge>(find.byType(StatusBadge)).label, 'Confirmed');
      expect(
        find.textContaining('Pay at the clinic', findRichText: true, skipOffstage: false),
        findsOneWidget,
      );
      expect(find.textContaining('online', skipOffstage: false), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a 409 on hold shows the inline message and keeps the customer on the slot picker (no navigation)',
      (tester) async {
    final api = _FakeDentalApi();
    final provider = DentalProvider(request: api.call, clock: () => DateTime.utc(2027, 6, 7, 3, 0, 0));

    api.routes['GET /dental/doctors/d1'] = (q, b) => _envelope({'doctor': _doctorWithPairing()});
    api.routes['GET /dental/doctors/d1/availability'] = (q, b) => _envelope({
          'availability': [
            {'date': '2027-06-07', 'hasAvailability': true},
          ],
        });
    api.routes['GET /dental/doctors/d1/slots'] =
        (q, b) => _envelope({'date': '2027-06-07', 'slots': ['2027-06-07T03:30:00.000Z']});
    api.routes['POST /dental/appointments/holds'] =
        (q, b) => ApiException(409, 'Someone else is holding this slot.', code: 'SLOT_HELD');

    Future<void> settle({int n = 10}) async {
      for (var i = 0; i < n; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<DentalProvider>.value(value: provider),
          ChangeNotifierProvider<AuthProvider>.value(value: SignedInAuth()),
        ],
        child: const MaterialApp(home: DentalSlotPickerScreen(doctorId: 'd1', clinicId: 'c1')),
      ),
    );
    await settle();

    await tester.tap(find.byKey(const Key('slot-chip-2027-06-07T03:30:00.000Z')));
    await settle();

    expect(find.text('This time was just booked by someone else.'), findsOneWidget);
    expect(find.byType(DentalPatientDetailsScreen), findsNothing);
    expect(find.byType(DentalSlotPickerScreen), findsOneWidget);
  });
}
