-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 007: Dental clinic appointments (booking-only, no payment)
-- ============================================================================
-- New domain: dental clinics, doctors, the clinic-doctor working relationship,
-- a weekly availability template + blocked-date exceptions, and appointments
-- themselves. This is its own domain (plan
-- docs/superpowers/plans/2026-09-22-blynk-dental-clinic-appointments.md §8-10)
-- and does not touch orders/payments/dark_stores.
--
-- No online payment: `consultation_fee_snapshot` on `appointments` is the
-- only payment-adjacent column, an indicative fee shown as "payable at the
-- clinic" (plan §7, common.md rule 2) - not a payment table, not a status.
--
-- Double-booking prevention: `uq_appointments_active_slot` below is the
-- database-enforced invariant, the same partial-unique-index shape as
-- `uq_deliveries_active_assignment` (001_initial_schema.sql) - the backstop
-- an in-transaction booking action will pre-check against and then catch a
-- Postgres 23505 from, exactly like `assignRider()`
-- (src/modules/orders/lifecycle/actions/admin.ts). That action itself is a
-- later task; this migration only lays the schema foundation for it.

DO $$ BEGIN
    CREATE TYPE dental_specialty_enum AS ENUM (
        'GENERAL_DENTIST',
        'ORTHODONTIST',
        'PERIODONTIST',
        'ENDODONTIST',
        'ORAL_SURGEON',
        'PEDIATRIC_DENTIST'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dental_appointment_status_enum AS ENUM (
        'HELD',
        'EXPIRED',
        'CONFIRMED',
        'CANCELLED_BY_CUSTOMER',
        'CANCELLED_BY_CLINIC'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 1. CLINIC & DOCTOR DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS dental_clinics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) NOT NULL,
    city VARCHAR(64) NOT NULL,
    address_line TEXT NOT NULL,
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    contact_phone VARCHAR(20) NOT NULL,
    operating_start_time TIME NOT NULL,
    operating_end_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_dental_clinic_lat CHECK (latitude BETWEEN -90.0 AND 90.0),
    CONSTRAINT chk_dental_clinic_lon CHECK (longitude BETWEEN -180.0 AND 180.0),
    CONSTRAINT chk_dental_clinic_hours CHECK (operating_end_time > operating_start_time)
);

CREATE TABLE IF NOT EXISTS doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(128) NOT NULL,
    specialty dental_specialty_enum NOT NULL,
    photo_url TEXT,
    bio TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The working relationship (plan §8.2): a doctor's hours, blocked dates and
-- fee are scoped to this pairing, not to the doctor globally, because the
-- same dentist may keep different hours (and a different fee) per clinic.
CREATE TABLE IF NOT EXISTS clinic_doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES dental_clinics(id) ON DELETE RESTRICT,
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    consultation_fee NUMERIC(10, 2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_clinic_doctors_pairing UNIQUE (clinic_id, doctor_id),
    CONSTRAINT chk_clinic_doctors_fee CHECK (consultation_fee IS NULL OR consultation_fee >= 0.00)
);

-- ============================================================================
-- 2. AVAILABILITY DOMAIN (template, computed on read - plan §9)
-- ============================================================================

CREATE TABLE IF NOT EXISTS doctor_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_doctor_id UUID NOT NULL REFERENCES clinic_doctors(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes SMALLINT NOT NULL,
    buffer_minutes SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_doctor_availability_dow CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT chk_doctor_availability_window CHECK (end_time > start_time),
    CONSTRAINT chk_doctor_availability_duration CHECK (slot_duration_minutes > 0),
    CONSTRAINT chk_doctor_availability_buffer CHECK (buffer_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_doctor_availability_clinic_doctor_dow
    ON doctor_availability (clinic_doctor_id, day_of_week);

CREATE TABLE IF NOT EXISTS doctor_blocked_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_doctor_id UUID NOT NULL REFERENCES clinic_doctors(id) ON DELETE CASCADE,
    blocked_date DATE NOT NULL,
    reason VARCHAR(128) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_doctor_blocked_dates UNIQUE (clinic_doctor_id, blocked_date)
);

-- ============================================================================
-- 3. APPOINTMENT DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_doctor_id UUID NOT NULL REFERENCES clinic_doctors(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    status dental_appointment_status_enum NOT NULL DEFAULT 'HELD',
    -- Simpler of the two brief-offered options: held_by is always set to the
    -- customer who created the hold and is never nulled out on confirm/cancel
    -- (a CONFIRMED/terminal row just stops being consulted). Kept nullable
    -- only because ON DELETE SET NULL needs it to be.
    held_by UUID REFERENCES users(id) ON DELETE SET NULL,
    held_until TIMESTAMPTZ,
    patient_name VARCHAR(128),
    patient_phone VARCHAR(20),
    patient_notes VARCHAR(500),
    consultation_fee_snapshot NUMERIC(10, 2),
    cancellation_reason VARCHAR(255),
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_appointments_window CHECK (end_at > start_at),
    CONSTRAINT chk_appointments_fee CHECK (consultation_fee_snapshot IS NULL OR consultation_fee_snapshot >= 0.00)
);

-- THE double-booking guarantee (plan §7.2): exactly one HELD/CONFIRMED row
-- per (clinic_doctor_id, start_at). A cancelled/expired row's slot reopens
-- immediately because it falls outside this WHERE clause - no separate
-- release step. This also directly serves the availability-range-scan query
-- in plan §9.2 step 4 (same columns, same predicate), so no separate
-- non-unique (clinic_doctor_id, start_at) index is added - it would be a
-- redundant duplicate of this one for that query shape.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_active_slot
    ON appointments (clinic_doctor_id, start_at)
    WHERE status IN ('HELD', 'CONFIRMED');

-- "My appointments" queries (customer app) - a different access pattern
-- (by customer, not by clinic-doctor), not served by the index above.
CREATE INDEX IF NOT EXISTS idx_appointments_customer_status
    ON appointments (customer_id, status);

CREATE TABLE IF NOT EXISTS appointment_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    old_status dental_appointment_status_enum,
    new_status dental_appointment_status_enum NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointment_status_history_appointment
    ON appointment_status_history (appointment_id);
