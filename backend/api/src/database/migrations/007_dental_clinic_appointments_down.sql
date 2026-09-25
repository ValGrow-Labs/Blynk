-- Migration 007 Rollback: drop the dental domain in reverse dependency order.

DROP TABLE IF EXISTS appointment_status_history CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS doctor_blocked_dates CASCADE;
DROP TABLE IF EXISTS doctor_availability CASCADE;
DROP TABLE IF EXISTS clinic_doctors CASCADE;
DROP TABLE IF EXISTS doctors CASCADE;
DROP TABLE IF EXISTS dental_clinics CASCADE;

DROP TYPE IF EXISTS dental_appointment_status_enum;
DROP TYPE IF EXISTS dental_specialty_enum;
