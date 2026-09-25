import 'package:flutter_test/flutter_test.dart';
import 'package:ecom/Models/dental_doctor_model.dart';

import 'fixtures/dental_fixtures.dart';

void main() {
  group('dentalSpecialtyFromString', () {
    test('maps every canonical backend value (database/types.ts DentalSpecialty)', () {
      expect(dentalSpecialtyFromString('GENERAL_DENTIST'), DentalSpecialty.generalDentist);
      expect(dentalSpecialtyFromString('ORTHODONTIST'), DentalSpecialty.orthodontist);
      expect(dentalSpecialtyFromString('PERIODONTIST'), DentalSpecialty.periodontist);
      expect(dentalSpecialtyFromString('ENDODONTIST'), DentalSpecialty.endodontist);
      expect(dentalSpecialtyFromString('ORAL_SURGEON'), DentalSpecialty.oralSurgeon);
      expect(dentalSpecialtyFromString('PEDIATRIC_DENTIST'), DentalSpecialty.pediatricDentist);
    });

    test('an unrecognised or null value never crashes - falls back to unknown', () {
      expect(dentalSpecialtyFromString('SOMETHING_NEW'), DentalSpecialty.unknown);
      expect(dentalSpecialtyFromString(null), DentalSpecialty.unknown);
      expect(dentalSpecialtyFromString(''), DentalSpecialty.unknown);
    });
  });

  group('ClinicDoctorModel', () {
    test('parses a ClinicDoctorDto exactly as clinic.service.ts listClinicDoctors returns it', () {
      final doc = ClinicDoctorModel.fromJson(clinicDoctorJson());

      expect(doc.clinicDoctorId, 'cd0000001-0000-0000-0000-000000000001');
      expect(doc.doctorId, 'd0000001-0000-0000-0000-000000000001');
      expect(doc.fullName, 'Dr. Nadeesha Perera');
      expect(doc.specialty, DentalSpecialty.orthodontist);
      expect(doc.photoUrl, 'https://example.com/photo.jpg');
      expect(doc.bio, '10 years of experience.');
      expect(doc.consultationFee, 3500.0);
    });

    test('a null consultation_fee (unset by an admin) parses as null, not zero', () {
      final doc = ClinicDoctorModel.fromJson(clinicDoctorJson(consultationFee: null));
      expect(doc.consultationFee, isNull);
    });

    test('a NUMERIC fee arriving as a string still parses', () {
      final doc = ClinicDoctorModel.fromJson({...clinicDoctorJson(), 'consultation_fee': '3500.00'});
      expect(doc.consultationFee, 3500.0);
    });

    test('an unrecognised specialty falls back to unknown, never crashes', () {
      final doc = ClinicDoctorModel.fromJson(clinicDoctorJson(specialty: 'COSMETIC_DENTIST'));
      expect(doc.specialty, DentalSpecialty.unknown);
      expect(doc.rawSpecialty, 'COSMETIC_DENTIST');
    });

    test('tryParse rejects a payload with no clinic_doctor_id', () {
      expect(ClinicDoctorModel.tryParse(null), isNull);
      expect(ClinicDoctorModel.tryParse({'doctor_id': 'd1'}), isNull);
    });
  });

  group('DoctorModel', () {
    test('parses a DoctorDto exactly as doctor.service.ts getDoctorById returns it, including embedded clinics', () {
      final doctor = DoctorModel.fromJson(doctorJson());

      expect(doctor.id, 'd0000001-0000-0000-0000-000000000001');
      expect(doctor.fullName, 'Dr. Nadeesha Perera');
      expect(doctor.specialty, DentalSpecialty.orthodontist);
      expect(doctor.photoUrl, isNull);
      expect(doctor.bio, isNull);
      expect(doctor.clinics, hasLength(1));

      final clinic = doctor.clinics.single;
      expect(clinic.clinicDoctorId, 'cd0000001-0000-0000-0000-000000000001');
      expect(clinic.clinicId, 'c0000001-0000-0000-0000-000000000001');
      expect(clinic.name, 'Smile Dental Clinic');
      expect(clinic.city, 'Colombo');
      expect(clinic.latitude, 6.9271);
      expect(clinic.longitude, 79.8612);
      expect(clinic.consultationFee, 3500.0);
    });

    test('a doctor practicing at no active clinic parses with an empty list, not a crash', () {
      final doctor = DoctorModel.fromJson(doctorJson(clinics: []));
      expect(doctor.clinics, isEmpty);
    });

    test('a per-clinic null consultation_fee parses as null', () {
      final doctor = DoctorModel.fromJson(doctorJson(clinics: [
        {
          'clinic_doctor_id': 'cd1',
          'clinic_id': 'c1',
          'name': 'Bright Smiles',
          'city': 'Kandy',
          'address_line': '5 Hill Street',
          'latitude': 7.2906,
          'longitude': 80.6337,
          'consultation_fee': null,
        },
      ]));
      expect(doctor.clinics.single.consultationFee, isNull);
    });

    test('tryParse rejects a payload with no id', () {
      expect(DoctorModel.tryParse(null), isNull);
      expect(DoctorModel.tryParse('x'), isNull);
      expect(DoctorModel.tryParse({'full_name': 'No id'}), isNull);
    });
  });
}
