import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:ecom/Models/dental_appointment_model.dart';
import 'package:ecom/Models/dental_doctor_model.dart';
import 'package:ecom/Models/user_model.dart';
import 'package:ecom/Screens/dental_booking_review_screen.dart';
import 'package:ecom/Screens/dental_patient_details_screen.dart';
import 'package:ecom/Services/Providers/auth.provider.dart';

import '../fixtures/dental_fixtures.dart';
import '../fixtures/session_fakes.dart';

final _hold = AppointmentModel.tryParse(holdAppointmentJson(heldUntil: '2027-06-07T03:05:00.000Z'))!;
final _doctor = DoctorModel.tryParse(doctorJson())!;
final _pairing = _doctor.clinics.first;

/// Signed in, but with no cached profile - the prefill has nothing to work
/// with, so the fields must stay editable and empty rather than crash.
class _SignedInNoProfile extends AuthProvider {
  @override
  bool get isAuthenticated => true;

  @override
  UserModel? get currentUser => null;
}

void main() {
  Future<void> pumpScreen(
    WidgetTester tester, {
    AuthProvider? auth,
    VoidCallback? onExpired,
  }) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: auth ?? SignedInAuth(),
        child: MaterialApp(
          home: DentalPatientDetailsScreen(
            hold: _hold,
            doctor: _doctor,
            pairing: _pairing,
            onExpired: onExpired ?? () {},
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('prefills name and phone from the signed-in profile, editable', (tester) async {
    await pumpScreen(tester);

    final nameField = tester.widget<TextField>(
      find.descendant(of: find.byKey(const Key('patient-name-field')), matching: find.byType(TextField)),
    );
    final phoneField = tester.widget<TextField>(
      find.descendant(of: find.byKey(const Key('patient-phone-field')), matching: find.byType(TextField)),
    );
    expect(nameField.controller!.text, 'Nimal Perera');
    // SignedInAuth's phone is +94771234567 - the +94 prefix is drawn
    // separately (BlynkTextField.prefix), so only the local part is prefilled.
    expect(phoneField.controller!.text, '771234567');

    // Still editable, not locked - the patient may not be the account holder.
    expect(nameField.enabled, isTrue);
  });

  testWidgets('no cached profile: fields start empty rather than crashing', (tester) async {
    await pumpScreen(tester, auth: _SignedInNoProfile());

    final nameField = tester.widget<TextField>(
      find.descendant(of: find.byKey(const Key('patient-name-field')), matching: find.byType(TextField)),
    );
    expect(nameField.controller!.text, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('validates required fields: empty name and an invalid phone block continue', (tester) async {
    await pumpScreen(tester);

    await tester.enterText(find.byKey(const Key('patient-name-field')), '');
    await tester.enterText(find.byKey(const Key('patient-phone-field')), '123');
    await tester.tap(find.byKey(const Key('patient-details-continue')));
    await tester.pump();

    expect(find.text('Enter a valid name'), findsOneWidget);
    expect(find.text('Enter a valid Sri Lankan mobile number'), findsOneWidget);
    expect(find.byType(DentalBookingReviewScreen), findsNothing);
  });

  testWidgets('the notes field is hard-capped at the backend\'s own limit (500), a courtesy the input itself enforces',
      (tester) async {
    await pumpScreen(tester);

    final notesField = tester.widget<TextField>(
      find.descendant(of: find.byKey(const Key('patient-notes-field')), matching: find.byType(TextField)),
    );
    expect(notesField.maxLength, 500);

    // A direct controller write past the cap (bypassing the field's own
    // input-level enforcement, unlike a real keystroke or paste) is still
    // caught by the validator on submit - belt and suspenders.
    notesField.controller!.text = 'a' * 501;
    await tester.pump();
    await tester.tap(find.byKey(const Key('patient-details-continue')));
    await tester.pump();

    expect(find.text('Keep this under 500 characters'), findsOneWidget);
    expect(find.byType(DentalBookingReviewScreen), findsNothing);
  });

  testWidgets('valid details navigate to the review screen with normalized values', (tester) async {
    await pumpScreen(tester);

    await tester.enterText(find.byKey(const Key('patient-name-field')), '  Jane   Silva  ');
    await tester.enterText(find.byKey(const Key('patient-phone-field')), '0771234567');
    await tester.enterText(find.byKey(const Key('patient-notes-field')), 'Sensitive to cold water.');
    await tester.tap(find.byKey(const Key('patient-details-continue')));
    await tester.pump();
    await tester.pump();

    expect(find.byType(DentalBookingReviewScreen), findsOneWidget);
    final review = tester.widget<DentalBookingReviewScreen>(find.byType(DentalBookingReviewScreen));
    expect(review.patientName, 'Jane Silva');
    expect(review.patientPhone, '+94771234567');
    expect(review.patientNotes, 'Sensitive to cold water.');
    // The hold identity travels forward unchanged - nothing here re-derives it.
    expect(review.hold.id, _hold.id);
  });

  testWidgets('no clinic_doctor_id / start_at field exists anywhere on this form', (tester) async {
    await pumpScreen(tester);
    expect(find.text('clinic_doctor_id'), findsNothing);
    expect(find.text('start_at'), findsNothing);
  });
}
