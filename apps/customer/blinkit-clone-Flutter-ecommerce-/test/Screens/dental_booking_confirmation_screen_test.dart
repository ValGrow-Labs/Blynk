import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ecom/Models/dental_appointment_model.dart';
import 'package:ecom/Screens/dental_booking_confirmation_screen.dart';
import 'package:ecom/UI/Widgets/Atoms/money_text.dart';
import 'package:ecom/UI/Widgets/Atoms/status_badge.dart';

import '../fixtures/dental_fixtures.dart';

final _confirmed = AppointmentModel.tryParse(appointmentJson(status: 'CONFIRMED'))!;

void main() {
  Future<void> pumpScreen(WidgetTester tester, {AppointmentModel? appointment}) async {
    await tester.pumpWidget(
      MaterialApp(home: DentalBookingConfirmationScreen(appointment: appointment ?? _confirmed)),
    );
    await tester.pump();
  }

  testWidgets('renders the confirmed appointment summary: doctor, clinic, date/time, fee, status', (tester) async {
    await pumpScreen(tester);

    expect(find.text('Appointment confirmed'), findsOneWidget);
    expect(find.text('Dr. Nadeesha Perera'), findsOneWidget);
    expect(find.text('Smile Dental Clinic'), findsOneWidget);
    expect(find.byType(MoneyText), findsOneWidget);
    expect(tester.widget<MoneyText>(find.byType(MoneyText)).amount, 3500);
    expect(find.byType(StatusBadge), findsOneWidget);
    expect(tester.widget<StatusBadge>(find.byType(StatusBadge)).label, 'Confirmed');
  });

  testWidgets('never mentions online payment - only "pay at the clinic, in person"', (tester) async {
    await pumpScreen(tester);

    expect(
      find.textContaining('Pay at the clinic', findRichText: true, skipOffstage: false),
      findsOneWidget,
    );
    expect(find.textContaining('Pay now', skipOffstage: false), findsNothing);
    expect(find.textContaining('Payment method', skipOffstage: false), findsNothing);
    expect(find.textContaining('Card', skipOffstage: false), findsNothing);
    expect(find.textContaining('online', skipOffstage: false), findsNothing);
  });

  testWidgets('a missing fee (null consultation_fee_snapshot) shows "Not available", never a fabricated 0',
      (tester) async {
    final noFee = AppointmentModel.tryParse(
      appointmentJson(status: 'CONFIRMED', consultationFeeSnapshot: null),
    )!;
    await pumpScreen(tester, appointment: noFee);

    expect(find.byType(MoneyText), findsNothing);
    expect(find.text('Not available'), findsOneWidget);
  });

  testWidgets('"View appointment" navigates to /dental/appointments/detail with the appointment id', (tester) async {
    RouteSettings? lastRoute;
    await tester.pumpWidget(
      MaterialApp(
        home: DentalBookingConfirmationScreen(appointment: _confirmed),
        onGenerateRoute: (settings) {
          lastRoute = settings;
          return MaterialPageRoute(settings: settings, builder: (_) => Scaffold(body: Text('route:${settings.name}')));
        },
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('view-appointment')));
    await tester.pumpAndSettle();

    expect(lastRoute?.name, '/dental/appointments/detail');
    expect(lastRoute?.arguments, _confirmed.id);
  });

  testWidgets('"Back to home" navigates to /home and clears the stack', (tester) async {
    RouteSettings? lastRoute;
    await tester.pumpWidget(
      MaterialApp(
        home: DentalBookingConfirmationScreen(appointment: _confirmed),
        onGenerateRoute: (settings) {
          lastRoute = settings;
          return MaterialPageRoute(settings: settings, builder: (_) => Scaffold(body: Text('route:${settings.name}')));
        },
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Back to home'));
    await tester.pumpAndSettle();

    expect(lastRoute?.name, '/home');
  });
}
