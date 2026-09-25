import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/dental_clinic_model.dart';

import 'fixtures/dental_fixtures.dart';

void main() {
  group('ClinicModel', () {
    test('parses a ClinicDto exactly as clinic.service.ts toClinicDto returns it', () {
      final clinic = ClinicModel.fromJson(clinicJson());

      expect(clinic.id, 'c0000001-0000-0000-0000-000000000001');
      expect(clinic.name, 'Smile Dental Clinic');
      expect(clinic.city, 'Colombo');
      expect(clinic.addressLine, '123 Galle Road');
      expect(clinic.latitude, 6.9271);
      expect(clinic.longitude, 79.8612);
      expect(clinic.contactPhone, '+94112345678');
      expect(clinic.operatingStartTime, '09:00:00');
      expect(clinic.operatingEndTime, '18:00:00');
    });

    test('parses numeric-as-string coordinates (NUMERIC columns can arrive as strings)', () {
      final clinic = ClinicModel.fromJson({...clinicJson(), 'latitude': '6.9271', 'longitude': '79.8612'});
      expect(clinic.latitude, 6.9271);
      expect(clinic.longitude, 79.8612);
    });

    test('tryParse rejects non-map and empty-id payloads', () {
      expect(ClinicModel.tryParse(null), isNull);
      expect(ClinicModel.tryParse('x'), isNull);
      expect(ClinicModel.tryParse({'name': 'No id'}), isNull);
    });

    test('missing fields fall back to empty/zero, never a crash', () {
      final clinic = ClinicModel.fromJson({'id': 'c1'});
      expect(clinic.name, '');
      expect(clinic.latitude, 0.0);
      expect(clinic.longitude, 0.0);
    });
  });

  group('ClinicPage', () {
    test('parses the clinics list + pagination envelope', () {
      final page = ClinicPage.fromJson({
        'clinics': [clinicJson(id: 'c1'), clinicJson(id: 'c2'), 'junk'],
        'pagination': {'page': 1, 'limit': 20, 'total': 2, 'total_pages': 1},
      });

      expect(page.clinics, hasLength(2));
      expect(page.clinics.map((c) => c.id), ['c1', 'c2']);
      expect(page.page, 1);
      expect(page.total, 2);
      expect(page.totalPages, 1);
    });

    test('missing pagination defaults sanely', () {
      final page = ClinicPage.fromJson({'clinics': []});
      expect(page.page, 1);
      expect(page.limit, 20);
      expect(page.total, 0);
      expect(page.totalPages, 1);
    });
  });
}
