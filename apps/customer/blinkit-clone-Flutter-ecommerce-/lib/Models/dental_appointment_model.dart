// Mirrors the backend's appointment DTOs exactly
// (backend/api/src/modules/dental/appointment.service.ts: toHoldDto /
// toListDto / toDetailDto, task-B3-report.md sections 1 and 12). One model
// covers all three response shapes: `toHoldDto`'s fields are a subset of
// `toListDto`'s, and `toDetailDto` only adds `patient_notes` on top of
// `toListDto` - so every field below is nullable/defaulted exactly where a
// narrower DTO would omit it, rather than three separate classes.
import 'dental_doctor_model.dart';

/// Matches `DentalAppointmentStatus` in `backend/api/src/database/types.ts`
/// (lines 52-57) exactly. `unknown` is the fallback for any value this app
/// doesn't recognise yet.
enum AppointmentStatus {
  held,
  expired,
  confirmed,
  cancelledByCustomer,
  cancelledByClinic,
  unknown,
}

AppointmentStatus appointmentStatusFromString(String? raw) {
  switch (raw) {
    case 'HELD':
      return AppointmentStatus.held;
    case 'EXPIRED':
      return AppointmentStatus.expired;
    case 'CONFIRMED':
      return AppointmentStatus.confirmed;
    case 'CANCELLED_BY_CUSTOMER':
      return AppointmentStatus.cancelledByCustomer;
    case 'CANCELLED_BY_CLINIC':
      return AppointmentStatus.cancelledByClinic;
    default:
      return AppointmentStatus.unknown;
  }
}

DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse(v.toString());

double? _money(Object? v) => v == null ? null : double.tryParse(v.toString());

/// The `doctor` block embedded in `toListDto`/`toDetailDto`
/// (appointment.service.ts lines 87-92): `{ id, full_name, specialty,
/// photo_url }`. Absent entirely from the hold response (`toHoldDto` never
/// includes it).
class AppointmentDoctorSummary {
  final String id;
  final String fullName;
  final DentalSpecialty specialty;
  final String rawSpecialty;
  final String? photoUrl;

  const AppointmentDoctorSummary({
    required this.id,
    required this.fullName,
    required this.specialty,
    required this.rawSpecialty,
    this.photoUrl,
  });

  static AppointmentDoctorSummary? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    return AppointmentDoctorSummary(
      id: (map['id'] ?? '').toString(),
      fullName: (map['full_name'] ?? '').toString(),
      specialty: dentalSpecialtyFromString(map['specialty']?.toString()),
      rawSpecialty: (map['specialty'] ?? '').toString(),
      photoUrl: map['photo_url']?.toString(),
    );
  }
}

/// The `clinic` block embedded in `toListDto`/`toDetailDto`
/// (appointment.service.ts lines 93-98): `{ id, name, city, address_line }`.
/// Absent entirely from the hold response.
class AppointmentClinicSummary {
  final String id;
  final String name;
  final String city;
  final String addressLine;

  const AppointmentClinicSummary({
    required this.id,
    required this.name,
    required this.city,
    required this.addressLine,
  });

  static AppointmentClinicSummary? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    return AppointmentClinicSummary(
      id: (map['id'] ?? '').toString(),
      name: (map['name'] ?? '').toString(),
      city: (map['city'] ?? '').toString(),
      addressLine: (map['address_line'] ?? '').toString(),
    );
  }
}

class AppointmentModel {
  final String id;
  final String clinicDoctorId;
  final AppointmentStatus status;
  final String rawStatus;
  final DateTime? startAt;
  final DateTime? endAt;
  final DateTime? heldUntil;
  final double? consultationFeeSnapshot;
  final String? patientName;
  final String? patientPhone;
  final String? patientNotes;
  final String? cancellationReason;
  final bool isCompleted;
  final bool canCancel;
  final AppointmentDoctorSummary? doctor;
  final AppointmentClinicSummary? clinic;
  final DateTime? createdAt;

  const AppointmentModel({
    required this.id,
    required this.clinicDoctorId,
    required this.status,
    required this.rawStatus,
    this.startAt,
    this.endAt,
    this.heldUntil,
    this.consultationFeeSnapshot,
    this.patientName,
    this.patientPhone,
    this.patientNotes,
    this.cancellationReason,
    this.isCompleted = false,
    this.canCancel = false,
    this.doctor,
    this.clinic,
    this.createdAt,
  });

  /// Plan §5.1's derived "completed" concept
  /// (`status == confirmed && start_at.isBefore(now)`, exactly
  /// `toListDto`'s own `is_completed` rule), for the rare case a screen has a
  /// locally-held appointment without a fresh `is_completed` from the server.
  /// `now` is always an explicit argument - never `DateTime.now()` inside a
  /// model - so callers stay deterministic and testable (mirrors
  /// order_summary_screen.dart's convention for time-dependent logic).
  bool isCompletedAt(DateTime now) =>
      status == AppointmentStatus.confirmed && (startAt?.isBefore(now) ?? false);

  /// Display-only: whether a HELD row's five-minute countdown has lazily
  /// expired, from the client's point of view right now. This is COSMETIC
  /// ONLY (e.g. greying out a countdown chip) - it must never gate whether a
  /// confirm is attempted. A `HELD` row's `status` string stays `'HELD'`
  /// forever past `held_until` (task-B3-report.md §10.2, §12.5: "lazy
  /// expiry by design, no sweep"); only the backend's actual response to
  /// `/confirm` (`410 HOLD_EXPIRED`) is authoritative (common.md rule 8).
  bool isHoldExpiredAt(DateTime now) =>
      status == AppointmentStatus.held && (heldUntil == null || !heldUntil!.isAfter(now));

  factory AppointmentModel.fromJson(Map<String, dynamic> json) {
    return AppointmentModel(
      id: (json['id'] ?? '').toString(),
      clinicDoctorId: (json['clinic_doctor_id'] ?? '').toString(),
      status: appointmentStatusFromString(json['status']?.toString()),
      rawStatus: (json['status'] ?? '').toString(),
      startAt: _date(json['start_at']),
      endAt: _date(json['end_at']),
      heldUntil: _date(json['held_until']),
      consultationFeeSnapshot: _money(json['consultation_fee_snapshot']),
      patientName: json['patient_name']?.toString(),
      patientPhone: json['patient_phone']?.toString(),
      patientNotes: json['patient_notes']?.toString(),
      cancellationReason: json['cancellation_reason']?.toString(),
      isCompleted: json['is_completed'] == true,
      canCancel: json['can_cancel'] == true,
      doctor: AppointmentDoctorSummary.tryParse(json['doctor']),
      clinic: AppointmentClinicSummary.tryParse(json['clinic']),
      createdAt: _date(json['created_at']),
    );
  }

  static AppointmentModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    if ((map['id'] ?? '').toString().isEmpty) return null;
    return AppointmentModel.fromJson(map);
  }
}
