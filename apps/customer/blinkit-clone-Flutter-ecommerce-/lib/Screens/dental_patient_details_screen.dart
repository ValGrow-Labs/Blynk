import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Models/dental_appointment_model.dart';
import '../Models/dental_doctor_model.dart';
import '../Services/Providers/auth.provider.dart';
import '../Services/Validation/app_validators.dart';
import '../UI/Widgets/Atoms/blynk_button.dart';
import '../UI/Widgets/Atoms/blynk_text_field.dart';
import '../UI/Widgets/Organisms/dental_widgets.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';
import 'dental_booking_review_screen.dart';

/// Step 2 of the booking flow (task F3): who the appointment is for. A full
/// screen push (not a `showAdaptiveSheet`), matching this codebase's own
/// closest precedent for a short standalone form
/// (`add_edit_address_screen.dart`) rather than `showAdaptiveSheet`, which has
/// no existing usage in `lib/` to follow (only a plain confirmation dialog in
/// `logout_dialog.dart`) - documented in task-F3-report.md.
///
/// No `clinic_doctor_id`/`start_at` field exists on this form: those are
/// fixed by the hold already made on the previous screen (brief: "no screen
/// in this flow ever lets the customer edit them once a hold exists").
class DentalPatientDetailsScreen extends StatefulWidget {
  const DentalPatientDetailsScreen({
    super.key,
    required this.hold,
    required this.doctor,
    required this.pairing,
    required this.onExpired,
  });

  /// The `HELD` appointment from `DentalProvider.holdSlot` - carries the real
  /// `heldUntil`/`consultation_fee_snapshot` forward; never recomputed here.
  final AppointmentModel hold;
  final DoctorModel doctor;
  final DoctorClinicModel pairing;

  /// Threaded down to the review screen: its "pick a new time" action after
  /// a 410/409 (or the cosmetic countdown reaching zero) pops the whole
  /// sub-flow back to the slot picker and refreshes its list.
  final VoidCallback onExpired;

  @override
  State<DentalPatientDetailsScreen> createState() => _DentalPatientDetailsScreenState();
}

/// A short form does not become more readable by getting wider on a tablet -
/// the same cap `add_edit_address_screen.dart`-class forms use.
const double _formMaxWidth = BlynkForm.maxWidth; // W8: one form cap, named once

class _DentalPatientDetailsScreenState extends State<DentalPatientDetailsScreen> {
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _notesController;

  String? _nameError;
  String? _phoneError;
  String? _notesError;

  @override
  void initState() {
    super.initState();
    // Prefilled from the signed-in customer's own profile, but editable -
    // the patient may not be the account holder (brief).
    final user = context.read<AuthProvider>().currentUser;
    _nameController = TextEditingController(text: user?.fullName ?? '');
    _phoneController = TextEditingController(
      text: (user?.phone ?? '').startsWith('+94') ? user!.phone.substring(3) : (user?.phone ?? ''),
    );
    _notesController = TextEditingController();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _continue() {
    final name = AppValidators.normalizeText(_nameController.text);
    final phone = AppValidators.normalizePhone(_phoneController.text);
    final notes = AppValidators.optionalText(_notesController.text);

    final nameError = AppValidators.patientName(_nameController.text);
    final phoneError = AppValidators.phone(_phoneController.text);
    final notesError = AppValidators.patientNotes(_notesController.text);

    setState(() {
      _nameError = nameError;
      _phoneError = phoneError;
      _notesError = notesError;
    });
    if (nameError != null || phoneError != null || notesError != null) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => DentalBookingReviewScreen(
          hold: widget.hold,
          doctor: widget.doctor,
          pairing: widget.pairing,
          patientName: name,
          // phone is already validated above, so normalizePhone cannot be
          // null here - the `??` only satisfies the type system.
          patientPhone: phone ?? AppValidators.normalizeText(_phoneController.text),
          patientNotes: notes,
          onExpired: widget.onExpired,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Patient details')),
      body: ContentFrame(
        maxWidth: _formMaxWidth,
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(vertical: BlynkSpace.s16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Who is this appointment for?',
                style: BlynkText.body.copyWith(color: BlynkColors.ink2),
              ),
              const SizedBox(height: BlynkSpace.s24),
            BlynkTextField(
              key: const Key('patient-name-field'),
              label: 'Patient name',
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              maxLength: AppValidators.patientNameMax,
              errorText: _nameError,
              onChanged: (_) {
                if (_nameError != null) setState(() => _nameError = null);
              },
            ),
            const SizedBox(height: BlynkSpace.s16),
            BlynkTextField(
              key: const Key('patient-phone-field'),
              label: 'Patient phone',
              controller: _phoneController,
              prefix: const Text('+94', style: BlynkText.label),
              hintText: '07XXXXXXXX',
              keyboardType: TextInputType.phone,
              maxLength: 16,
              errorText: _phoneError,
              onChanged: (_) {
                if (_phoneError != null) setState(() => _phoneError = null);
              },
            ),
            const SizedBox(height: BlynkSpace.s16),
            BlynkTextField(
              key: const Key('patient-notes-field'),
              label: 'Reason for visit (optional)',
              hintText: 'e.g. tooth pain, routine check-up',
              controller: _notesController,
              maxLines: 3,
              maxLength: AppValidators.patientNotesMax,
              textCapitalization: TextCapitalization.sentences,
              errorText: _notesError,
                onChanged: (_) {
                  if (_notesError != null) setState(() => _notesError = null);
                },
              ),
              const SizedBox(height: BlynkSpace.s24),
            ],
          ),
        ),
      ),
      bottomNavigationBar: DentalBottomBar(
        maxWidth: _formMaxWidth,
        child: BlynkButton.cta(
          key: const Key('patient-details-continue'),
          label: 'Continue',
          onPressed: _continue,
        ),
      ),
    );
  }
}
