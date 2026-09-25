import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';

// ----------------------------------------------------------------------------
// PARAM SCHEMA
// ----------------------------------------------------------------------------
export const appointmentIdParamSchema = z.object({
  id: z.string().uuid('Invalid appointment id'),
});
export type AppointmentIdParamInput = z.infer<typeof appointmentIdParamSchema>;

// ----------------------------------------------------------------------------
// SHARED FIELD BUILDERS
// ----------------------------------------------------------------------------

/** A Sri Lankan mobile number, normalised to E.164 exactly the way
 * `address.schema.ts` does it - but reported as a clean 400 VALIDATION_ERROR
 * instead of letting `normalizeSriLankanPhone`'s throw escape the parse. */
const sriLankanPhoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return normalizeSriLankanPhone(value);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Invalid Sri Lankan mobile phone number',
      });
      return z.NEVER;
    }
  });

/** An explicit instant. An offset (`Z` or `+05:30`) is required: a bare local
 * datetime would silently be interpreted in the server's zone, and slot
 * identity here is an exact TIMESTAMPTZ equality against the unique index. */
const instantSchema = z
  .string()
  .datetime({ offset: true, message: 'start_at must be an ISO-8601 datetime with an offset (e.g. 2027-06-07T03:30:00Z)' })
  .transform((value) => new Date(value));

/** Client-supplied idempotency key; also the shape of the header form. */
const idempotencyKeySchema = z.string().trim().min(1).max(128);

// ----------------------------------------------------------------------------
// POST /dental/appointments/holds
// ----------------------------------------------------------------------------
export const createHoldSchema = z
  .object({
    clinic_doctor_id: z.string().uuid('clinic_doctor_id must be a valid UUID'),
    start_at: instantSchema,
    idempotency_key: idempotencyKeySchema.optional(),
  })
  .strict();
export type CreateHoldInput = z.infer<typeof createHoldSchema>;

// ----------------------------------------------------------------------------
// POST /dental/appointments/:id/confirm
// ----------------------------------------------------------------------------
/**
 * `.strict()` is load-bearing, not stylistic (plan §15 "slot/time tampering"):
 * confirm reads `clinic_doctor_id`/`start_at` ONLY from the held row it just
 * locked, so a body carrying either of them is rejected outright rather than
 * silently stripped - a client can never confirm a time it did not hold.
 */
export const confirmAppointmentSchema = z
  .object({
    patient_name: z.string().trim().min(2, 'Patient name must be at least 2 characters').max(128),
    patient_phone: sriLankanPhoneSchema,
    patient_notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type ConfirmAppointmentInput = z.infer<typeof confirmAppointmentSchema>;

// ----------------------------------------------------------------------------
// POST /dental/appointments/:id/cancel  (customer - reason optional)
// ----------------------------------------------------------------------------
export const cancelAppointmentSchema = z
  .object({
    reason: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

// ----------------------------------------------------------------------------
// POST /admin/dental/appointments/:id/cancel  (admin - reason REQUIRED)
// ----------------------------------------------------------------------------
export const adminCancelAppointmentSchema = z
  .object({
    reason: z.string().trim().min(1, 'A cancellation reason is required.').max(255),
  })
  .strict();
export type AdminCancelAppointmentInput = z.infer<typeof adminCancelAppointmentSchema>;

// ----------------------------------------------------------------------------
// GET /dental/appointments
// ----------------------------------------------------------------------------
export const APPOINTMENT_LIST_STATUSES = [
  'HELD',
  'EXPIRED',
  'CONFIRMED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_CLINIC',
] as const;

export const appointmentListQuerySchema = z.object({
  status: z.enum(APPOINTMENT_LIST_STATUSES).optional(),
  /** Optional convenience split (brief allowed either approach): `upcoming`
   * = start_at >= now, soonest first; `past` = start_at < now, newest first.
   * Omitted returns every bucket, newest first. */
  bucket: z.enum(['upcoming', 'past']).optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1).default(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100).default(20)),
});
export type AppointmentListQueryInput = z.infer<typeof appointmentListQuerySchema>;
