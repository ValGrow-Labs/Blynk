import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/dental_appointment_model.dart';
import 'package:ecom/Models/dental_doctor_model.dart';
import 'package:ecom/Screens/dental_booking_confirmation_screen.dart';
import 'package:ecom/Screens/dental_booking_review_screen.dart';
import 'package:ecom/Services/Exceptions/api_exception.dart';
import 'package:ecom/Services/Providers/dental.provider.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';

import '../fixtures/dental_fixtures.dart';

/// `dental_provider_test.dart`'s `_FakeDentalApi` pattern, duplicated per
/// this codebase's own convention.
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

const _confirmUrl = 'POST /dental/appointments/a0000001-0000-0000-0000-000000000001/confirm';

final _doctor = DoctorModel.tryParse(doctorJson())!;
final _pairing = _doctor.clinics.first;

AppointmentModel _hold({String heldUntil = '2027-06-07T03:05:00.000Z'}) =>
    AppointmentModel.tryParse(holdAppointmentJson(heldUntil: heldUntil))!;

void main() {
  late _FakeDentalApi api;
  late DentalProvider provider;
  late DateTime testNow;

  setUp(() {
    api = _FakeDentalApi();
    provider = DentalProvider(request: api.call);
    testNow = DateTime.utc(2027, 6, 7, 3, 0, 0);
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    AppointmentModel? hold,
    VoidCallback? onExpired,
  }) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<DentalProvider>.value(
        value: provider,
        child: MaterialApp(
          home: DentalBookingReviewScreen(
            hold: hold ?? _hold(),
            doctor: _doctor,
            pairing: _pairing,
            patientName: 'Jane Silva',
            patientPhone: '+94771234567',
            patientNotes: 'Sensitive to cold water.',
            onExpired: onExpired ?? () {},
            now: () => testNow,
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('shows clinic, doctor, date/time and the fee', (tester) async {
    await pumpScreen(tester);

    expect(find.text('Dr. Nadeesha Perera'), findsOneWidget);
    expect(find.text('Smile Dental Clinic'), findsOneWidget);
    expect(find.byType(MoneyText), findsOneWidget);
    final money = tester.widget<MoneyText>(find.byType(MoneyText));
    expect(money.amount, 3500);
  });

  testWidgets('shows the live countdown, ticking down as the injected clock advances', (tester) async {
    await pumpScreen(tester);

    expect(find.text('Reserved for 5:00'), findsOneWidget);

    testNow = testNow.add(const Duration(seconds: 61));
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('Reserved for 3:59'), findsOneWidget);
  });

  testWidgets('the countdown reaching zero shows the dedicated "hold expired" state, confirm disappears',
      (tester) async {
    await pumpScreen(tester);

    testNow = testNow.add(const Duration(minutes: 6));
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('Your hold expired'), findsOneWidget);
    expect(find.byKey(const Key('confirm-booking')), findsNothing);
  });

  testWidgets('an already-past heldUntil shows the expired state immediately, no ticking needed', (tester) async {
    await pumpScreen(tester, hold: _hold(heldUntil: '2027-06-07T02:00:00.000Z'));
    expect(find.text('Your hold expired'), findsOneWidget);
  });

  testWidgets('"Pick a new time" on the expired state calls onExpired', (tester) async {
    var called = false;
    await pumpScreen(tester, hold: _hold(heldUntil: '2027-06-07T02:00:00.000Z'), onExpired: () => called = true);

    await tester.tap(find.byKey(const Key('review-pick-new-time')));
    expect(called, isTrue);
  });

  testWidgets('confirm succeeds: navigates to the confirmation screen', (tester) async {
    api.routes[_confirmUrl] = (q, b) => _envelope({'appointment': appointmentJson(status: 'CONFIRMED')});

    await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('confirm-booking')));
    await tester.pump();
    await tester.pump();

    expect(find.byType(DentalBookingConfirmationScreen), findsOneWidget);
    final sentBody = api.calls.firstWhere((c) => c['key'] == _confirmUrl)['body'] as Map;
    expect(sentBody['patient_name'], 'Jane Silva');
    expect(sentBody['patient_phone'], '+94771234567');
    expect(sentBody.containsKey('clinic_doctor_id'), isFalse);
    expect(sentBody.containsKey('start_at'), isFalse);
  });

  testWidgets('a 410 HOLD_EXPIRED from confirm routes to the expired-hold state, not a raw error', (tester) async {
    api.routes[_confirmUrl] = (q, b) => ApiException(410, 'Hold expired.', code: 'HOLD_EXPIRED');

    await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('confirm-booking')));
    await tester.pump();
    await tester.pump();

    expect(find.text('Your hold expired'), findsOneWidget);
    expect(find.textContaining('HOLD_EXPIRED'), findsNothing);
  });

  testWidgets('a 409 APPOINTMENT_NOT_HELD from confirm routes to the same expired-hold state', (tester) async {
    api.routes[_confirmUrl] = (q, b) => ApiException(409, 'Not held.', code: 'APPOINTMENT_NOT_HELD');

    await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('confirm-booking')));
    await tester.pump();
    await tester.pump();

    expect(find.text('Your hold expired'), findsOneWidget);
  });

  testWidgets('a generic confirm failure shows an inline message and stays on the review screen', (tester) async {
    api.routes[_confirmUrl] = (q, b) => ApiException(500, 'Something broke.');

    await pumpScreen(tester);
    await tester.tap(find.byKey(const Key('confirm-booking')));
    await tester.pump();
    await tester.pump();
    await tester.pump();

    // The error text sits below the fold of the review list at this test
    // viewport size, so it needs `skipOffstage: false` (still real content,
    // just not currently scrolled into view).
    expect(find.byKey(const Key('confirm-error'), skipOffstage: false), findsOneWidget);
    // Still on the review screen with a working confirm button - a real
    // error is retryable, unlike an expired hold.
    expect(find.byKey(const Key('confirm-booking')), findsOneWidget);
    expect(find.byType(DentalBookingConfirmationScreen), findsNothing);
  });

  testWidgets('no online-payment copy or button anywhere on this screen', (tester) async {
    await pumpScreen(tester);

    expect(
      find.textContaining('payable at the clinic', findRichText: true, skipOffstage: false),
      findsWidgets,
    );
    expect(find.textContaining('Pay now', skipOffstage: false), findsNothing);
    expect(find.textContaining('Payment method', skipOffstage: false), findsNothing);
    expect(find.textContaining('Card', skipOffstage: false), findsNothing);
    expect(find.textContaining('online', skipOffstage: false), findsNothing);
  });
}
