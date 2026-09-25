// The customer-facing word + [BadgeTone] for a dental appointment's status,
// shared by the My Appointments list and the appointment detail screen so
// both say the same thing - `order_status_labels.dart`'s exact convention,
// reusing the SAME `BadgeTone` enum `StatusBadge` already defines (task F1's
// `AppointmentModel`) rather than inventing a dental-only tone scheme
// (common.md rule 13 / task F4 brief: "map dental's 5 states to whatever
// tone scheme that widget already supports").
import '../UI/Widgets/Atoms/status_badge.dart';
import 'dental_appointment_model.dart';

/// One label + [BadgeTone] pair for a badge.
typedef DentalStatusBadgeSpec = ({BadgeTone tone, String label});

/// The 5 real backend statuses (`DentalAppointmentStatus`,
/// backend/api/src/database/types.ts), plus the derived-only refinements
/// task-F1-report.md and task-F4-brief.md both call for:
///   - a `HELD` row whose five-minute hold has lazily expired reads as
///     "Expired" here - DISPLAY ONLY. The row's real `status` stays `'HELD'`
///     (task-B3-report.md: "lazy expiry by design, no sweep") and this never
///     gates a real action (common.md rule 8) - only `AppointmentModel
///     .isHoldExpiredAt` decides the word shown, using the caller's own
///     clock, never `DateTime.now()` here.
///   - a `CONFIRMED` row whose start time has passed reads as "Completed"
///     (`AppointmentModel.isCompletedAt`, `toListDto`'s own `is_completed`
///     rule) rather than staying "Confirmed" forever.
DentalStatusBadgeSpec dentalAppointmentBadge(AppointmentModel appointment, DateTime now) {
  if (appointment.status == AppointmentStatus.held && appointment.isHoldExpiredAt(now)) {
    return (tone: BadgeTone.neutral, label: 'Expired');
  }
  switch (appointment.status) {
    case AppointmentStatus.held:
      return (tone: BadgeTone.notice, label: 'Reserved');
    case AppointmentStatus.expired:
      return (tone: BadgeTone.neutral, label: 'Expired');
    case AppointmentStatus.confirmed:
      return appointment.isCompletedAt(now)
          ? (tone: BadgeTone.neutral, label: 'Completed')
          : (tone: BadgeTone.positive, label: 'Confirmed');
    case AppointmentStatus.cancelledByCustomer:
      return (tone: BadgeTone.neutral, label: 'Cancelled');
    case AppointmentStatus.cancelledByClinic:
      // Distinguished from a customer's own cancellation (still `neutral`
      // for orders' `cancelled`, but this one wasn't the customer's choice -
      // worth flagging, not just a closed record) - a tone/icon choice only,
      // never worded with a deadline/cutoff (common.md rule 5).
      return (tone: BadgeTone.problem, label: 'Cancelled by clinic');
    case AppointmentStatus.unknown:
      return (tone: BadgeTone.neutral, label: 'Status unavailable');
  }
}
