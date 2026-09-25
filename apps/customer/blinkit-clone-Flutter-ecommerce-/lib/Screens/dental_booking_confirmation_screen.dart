import 'package:flutter/material.dart';

import '../Models/dental_appointment_model.dart';
import '../Models/dental_format.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/money_text.dart';
import '../UI/Widgets/Atoms/status_badge.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// The last step of the booking flow (task F3): mirrors
/// `order_confirmation_screen.dart`'s visual structure (a static check mark,
/// a title, a summary, a primary and a secondary CTA), not its copy.
///
/// The appointment passed in is the `confirmAppointment` response's own
/// `AppointmentModel` - unlike the hold response, this DTO already embeds
/// `doctor`/`clinic` (task-F1-report.md), so nothing here re-fetches anything.
///
/// Copy states payment happens at the clinic, in person - never implies an
/// online payment occurred (common.md rule 2 / plan §11: this phase has zero
/// payment infrastructure, so there is no pay button and no total due).
class DentalBookingConfirmationScreen extends StatelessWidget {
  const DentalBookingConfirmationScreen({super.key, required this.appointment});

  final AppointmentModel appointment;

  /// The success mark. Large enough to own the screen for a moment while
  /// still leaving both actions above the fold on a short phone, and the one
  /// place `positive` green appears here - it is a genuine positive state,
  /// never a CTA fill.
  static const double _markSize = 72;

  @override
  Widget build(BuildContext context) {
    final doctor = appointment.doctor;
    final clinic = appointment.clinic;
    final startAt = appointment.startAt;
    final fee = appointment.consultationFeeSnapshot;

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      body: SafeArea(
        child: ContentFrame(
          maxWidth: _maxWidth,
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // A static check mark: the appointment is booked, nothing
                  // is moving.
                  const ExcludeSemantics(
                    child: Icon(BlynkIcons.check, size: _markSize, color: BlynkColors.positive),
                  ),
                  const SizedBox(height: BlynkSpace.s16),
                  const Text('Appointment confirmed', textAlign: TextAlign.center, style: BlynkText.title),
                  const SizedBox(height: BlynkSpace.s8),
                  const Center(child: StatusBadge(tone: BadgeTone.positive, label: 'Confirmed')),
                  const SizedBox(height: BlynkSpace.s24),
                  DentalCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (doctor != null) ...[
                          Text(doctor.fullName, style: BlynkText.heading),
                          const SizedBox(height: BlynkSpace.s12),
                        ],
                        if (clinic != null) ...[
                          Text(clinic.name, style: BlynkText.body.copyWith(fontWeight: FontWeight.w700)),
                          Text(
                            clinic.addressLine,
                            style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
                          ),
                          const SizedBox(height: BlynkSpace.s12),
                        ],
                        if (startAt != null)
                          Text(
                            formatAppointmentDateTime(startAt),
                            style: BlynkText.body.copyWith(
                              fontWeight: FontWeight.w700,
                              color: BlynkColors.ink,
                            ),
                          ),
                        const SizedBox(height: BlynkSpace.s16),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                'Pay at the clinic, in person',
                                style: BlynkText.caption.copyWith(color: BlynkColors.ink3),
                              ),
                            ),
                            const SizedBox(width: BlynkSpace.s12),
                            if (fee != null)
                              MoneyText(fee, style: BlynkType.price)
                            else
                              Text(
                                'Not available',
                                style: BlynkText.body.copyWith(color: BlynkColors.ink3),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: BlynkSpace.s24),
                  BlynkButton.cta(
                    key: const Key('view-appointment'),
                    label: 'View appointment',
                    onPressed: () => Navigator.of(context)
                        .pushNamed('/dental/appointments/detail', arguments: appointment.id),
                  ),
                  const SizedBox(height: BlynkSpace.s12),
                  BlynkButton.secondary(
                    label: 'Back to home',
                    expand: true,
                    onPressed: () =>
                        Navigator.of(context).pushNamedAndRemoveUntil('/home', (route) => false),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The success moment is a single column, not a stretched phone layout.
const double _maxWidth = BlynkForm.maxWidth; // W8: one form cap, named once
