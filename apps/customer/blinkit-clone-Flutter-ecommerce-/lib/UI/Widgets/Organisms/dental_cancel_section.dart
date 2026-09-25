import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/dental_appointment_model.dart';
import '../../../Services/Exceptions/api_exception.dart';
import '../../../Services/Providers/dental.provider.dart';
import '../../../Services/Validation/app_validators.dart';
import '../../../design/tokens.dart';
import '../Atoms/adaptive_sheet.dart';
import '../Atoms/blynk_button.dart';
import '../Atoms/blynk_text_field.dart';
import 'dental_widgets.dart';

/// What to tell the customer when the backend refuses (or we never heard
/// back about) a cancellation - `order_cancel_section.dart`'s
/// `cancelRefusalMessage` exactly, remapped to this domain's own error codes
/// (task-B3-report.md / task-F1-report.md's `AppointmentCancelOutcome`).
/// NEVER mentions a deadline/cutoff/countdown (common.md rule 5 / task-F4
/// brief's single most important rule): none of these refusals are
/// time-based on the backend today.
String dentalCancelRefusalMessage(ApiException e) {
  switch (e.code) {
    case 'APPOINTMENT_NOT_CONFIRMED':
      return "This appointment can't be cancelled right now.";
    case 'APPOINTMENT_ALREADY_CANCELLED':
      return 'This appointment is already cancelled.';
    case 'APPOINTMENT_EXPIRED':
      return 'This appointment has expired.';
    case 'APPOINTMENT_NOT_FOUND':
      return 'This appointment could not be found.';
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
      return "We couldn't confirm the cancellation. Checking your appointment…";
  }
  if (e.statusCode == 408 || e.statusCode == 503) {
    return "We couldn't confirm the cancellation. Checking your appointment…";
  }
  return e.message;
}

/// The appointment-detail screen's cancel section (task F4) - shown ONLY
/// when the caller has already confirmed `status == 'CONFIRMED'` (this
/// widget itself has no opinion on when it should be built; the brief's
/// explicit rule lives in `DentalAppointmentDetailScreen`, not here).
///
/// Mirrors `OrderCancelSection`'s structure (a confirm sheet, an in-flight
/// guard so a second tap can never send a second POST, always refetching
/// after every attempt so the screen shows the backend's truth) with one
/// addition the brief calls for: an optional reason field (B3's `{reason?}`
/// cancel body). Cancellation of a `CONFIRMED` appointment is unconditional
/// in this phase (DENTAL-07 is open - see `DentalProvider.cancelAppointment`'s
/// own doc comment) - this section never shows a deadline/cutoff/countdown,
/// unlike `OrderCancelSection`'s "You can cancel until..." line, which does
/// not apply here and is deliberately NOT mirrored.
class DentalCancelSection extends StatefulWidget {
  const DentalCancelSection({
    super.key,
    required this.appointment,
    required this.onChanged,
  });

  final AppointmentModel appointment;

  /// The screen's own reload. Awaited after every cancel attempt (success,
  /// refusal, or timeout alike) - the backend's response is what the screen
  /// shows next, never what this widget assumed happened.
  final Future<void> Function() onChanged;

  @override
  State<DentalCancelSection> createState() => _DentalCancelSectionState();
}

class _DentalCancelSectionState extends State<DentalCancelSection> {
  late final TextEditingController _reasonController = TextEditingController();

  // Guards the whole attempt (sheet included) so a second tap can never send
  // a second POST while the first one is still in flight.
  bool _busy = false;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _openSheet() async {
    if (_busy) return;

    // The app's one adaptive surface (sheet under 600, dialog from 600) -
    // the same one `order_cancel_section.dart` opens, so cancelling an
    // appointment and cancelling an order look identical. It brings the drag
    // handle, the scrim, the safe area, the keyboard inset and the route
    // semantics with it, which is why this file no longer hand-rolls any of
    // them.
    final confirmed = await showAdaptiveSheet<bool>(
      context,
      semanticLabel: 'Cancel this appointment?',
      builder: (sheetContext) => Padding(
        padding: const EdgeInsets.fromLTRB(
          BlynkSpace.s24,
          BlynkSpace.s8,
          BlynkSpace.s24,
          BlynkSpace.s24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Cancel this appointment?', style: BlynkText.title),
            const SizedBox(height: BlynkSpace.s8),
            Text(
              "This can't be undone.",
              style: BlynkText.body.copyWith(color: BlynkColors.ink2),
            ),
            const SizedBox(height: BlynkSpace.s24),
            // Keeping the appointment is the forward action, so it is the
            // one yellow action on this surface; cancelling is destructive.
            BlynkButton.cta(
              key: const Key('keep-appointment'),
              label: 'Keep appointment',
              onPressed: () => Navigator.of(sheetContext).pop(false),
            ),
            const SizedBox(height: BlynkSpace.s12),
            BlynkButton.destructive(
              key: const Key('confirm-cancel-appointment'),
              label: 'Cancel appointment',
              expand: true,
              onPressed: () => Navigator.of(sheetContext).pop(true),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true || !mounted) return;
    await _cancel();
  }

  Future<void> _cancel() async {
    if (_busy) return;
    setState(() => _busy = true);

    // Captured before the await: the SnackBar is anchored to the nearest
    // Scaffold, not to this section's own subtree, so it stays on screen
    // (and readable) even after `onChanged`'s refetch removes this section
    // from the tree below (`order_cancel_section.dart`'s exact convention -
    // this is also what lets the refusal actually be seen: the section is
    // built ONLY while `status == 'CONFIRMED'`, so a refusal that changes
    // the status would otherwise unmount the very widget showing the
    // message before the customer could read it).
    final messenger = ScaffoldMessenger.of(context);
    final provider = context.read<DentalProvider>();
    final reason = AppValidators.optionalText(_reasonController.text);

    final outcome = await provider.cancelAppointment(id: widget.appointment.id, reason: reason);
    if (!mounted) return;

    if (!outcome.ok) {
      messenger.showSnackBar(
        SnackBar(content: Text(dentalCancelRefusalMessage(outcome.error!))),
      );
    }

    // Always - on a refusal, on a timeout and on success. The screen then
    // shows whatever the backend now says (including this section
    // disappearing on its own once `status` is no longer `CONFIRMED`),
    // never what this widget hoped (brief: "do not assume success or let
    // the button re-enable into a stale state").
    await widget.onChanged();
    if (!mounted) return;
    setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const DentalSectionTitle('Cancel appointment'),
        const SizedBox(height: BlynkSpace.s12),
        BlynkTextField(
          key: const Key('cancel-reason-field'),
          label: 'Reason (optional)',
          hintText: 'Let the clinic know why, if you can',
          controller: _reasonController,
          maxLines: 3,
          enabled: !_busy,
        ),
        const SizedBox(height: BlynkSpace.s16),
        BlynkButton.destructive(
          key: const Key('cancel-appointment-button'),
          label: 'Cancel appointment',
          loading: _busy,
          onPressed: _busy ? null : _openSheet,
        ),
      ],
    );
  }
}
