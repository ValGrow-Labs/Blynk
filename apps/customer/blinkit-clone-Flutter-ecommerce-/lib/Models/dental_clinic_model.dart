// Mirrors the backend's ClinicDto exactly (backend/api/src/modules/dental/
// clinic.service.ts toClinicDto(), task-B2-report.md endpoints
// `GET /dental/clinics` and `GET /dental/clinics/:id`). `is_active` is
// deliberately NOT a field here: the customer-facing endpoints never return
// it (only `is_active=true` rows are ever visible in the first place -
// clinic.service.ts's own doc comment says admin fields are "never selected
// by the repository methods this calls, let alone returned"), so there is
// nothing here to accidentally treat as a real signal.
class ClinicModel {
  final String id;
  final String name;
  final String city;
  final String addressLine;
  final double latitude;
  final double longitude;
  final String contactPhone;
  final String operatingStartTime;
  final String operatingEndTime;

  const ClinicModel({
    required this.id,
    required this.name,
    required this.city,
    required this.addressLine,
    required this.latitude,
    required this.longitude,
    required this.contactPhone,
    required this.operatingStartTime,
    required this.operatingEndTime,
  });

  factory ClinicModel.fromJson(Map<String, dynamic> json) {
    return ClinicModel(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      city: (json['city'] ?? '').toString(),
      addressLine: (json['address_line'] ?? '').toString(),
      latitude: double.tryParse((json['latitude'] ?? 0).toString()) ?? 0.0,
      longitude: double.tryParse((json['longitude'] ?? 0).toString()) ?? 0.0,
      contactPhone: (json['contact_phone'] ?? '').toString(),
      operatingStartTime: (json['operating_start_time'] ?? '').toString(),
      operatingEndTime: (json['operating_end_time'] ?? '').toString(),
    );
  }

  static ClinicModel? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = json.cast<String, dynamic>();
    if ((map['id'] ?? '').toString().isEmpty) return null;
    return ClinicModel.fromJson(map);
  }
}

/// `GET /dental/clinics`'s envelope: `{ clinics: [...], pagination: {...} }`
/// (clinic.service.ts `listClinics`) - the same `page`/`limit`/`total`/
/// `total_pages` shape `ProductPage` already uses for the catalog.
class ClinicPage {
  final List<ClinicModel> clinics;
  final int page;
  final int limit;
  final int total;
  final int totalPages;

  const ClinicPage({
    required this.clinics,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
  });

  factory ClinicPage.fromJson(Map<String, dynamic> json) {
    final rawClinics = (json['clinics'] as List?) ?? const [];
    final pagination = (json['pagination'] as Map?) ?? const {};
    return ClinicPage(
      clinics: rawClinics.map(ClinicModel.tryParse).whereType<ClinicModel>().toList(),
      page: int.tryParse((pagination['page'] ?? 1).toString()) ?? 1,
      limit: int.tryParse((pagination['limit'] ?? 20).toString()) ?? 20,
      total: int.tryParse((pagination['total'] ?? 0).toString()) ?? 0,
      totalPages: int.tryParse((pagination['total_pages'] ?? 1).toString()) ?? 1,
    );
  }
}
