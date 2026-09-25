import { z } from 'zod';

// ----------------------------------------------------------------------------
// PARAM SCHEMAS (UUID path params) - same inline-parse pattern as
// rider.schema.ts's deliveryParamsSchema / order.schema.ts's id params.
// ----------------------------------------------------------------------------
export const clinicIdParamSchema = z.object({
  id: z.string().uuid('Invalid clinic id'),
});
export type ClinicIdParamInput = z.infer<typeof clinicIdParamSchema>;

export const doctorIdParamSchema = z.object({
  id: z.string().uuid('Invalid doctor id'),
});
export type DoctorIdParamInput = z.infer<typeof doctorIdParamSchema>;

// ----------------------------------------------------------------------------
// CLINIC LIST QUERY (GET /dental/clinics) - page/limit pattern mirrors
// catalog.schema.ts's productQuerySchema.
// ----------------------------------------------------------------------------
export const clinicListQuerySchema = z.object({
  city: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(100).optional(),
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
export type ClinicListQueryInput = z.infer<typeof clinicListQuerySchema>;

// ----------------------------------------------------------------------------
// DATE / AVAILABILITY QUERIES
// ----------------------------------------------------------------------------
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** A plain calendar date string (YYYY-MM-DD) - the clinic-local date the
 * customer is browsing, not a UTC instant. See availability.service.ts for
 * how this gets resolved to an actual TIMESTAMPTZ range. */
const dateOnlySchema = z
  .string()
  .regex(DATE_ONLY_REGEX, 'Must be a date in YYYY-MM-DD format')
  .refine((val) => !Number.isNaN(new Date(`${val}T00:00:00Z`).getTime()), {
    message: 'Must be a valid calendar date',
  });

// Range cap (brief §"Range version"): reject anything over 30 days rather
// than silently clamp it, so a client gets an explicit, testable error
// instead of a quietly-truncated response.
const MAX_AVAILABILITY_RANGE_DAYS = 30;

export const availabilityQuerySchema = z
  .object({
    clinic_id: z.string().uuid('clinic_id must be a valid UUID'),
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .refine((data) => data.from <= data.to, {
    message: '`from` must not be after `to`',
    path: ['to'],
  })
  .refine(
    (data) => {
      const fromMs = new Date(`${data.from}T00:00:00Z`).getTime();
      const toMs = new Date(`${data.to}T00:00:00Z`).getTime();
      const diffDays = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
      return diffDays <= MAX_AVAILABILITY_RANGE_DAYS - 1;
    },
    {
      message: `Date range must not exceed ${MAX_AVAILABILITY_RANGE_DAYS} days`,
      path: ['to'],
    }
  );
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

export const slotsQuerySchema = z.object({
  clinic_id: z.string().uuid('clinic_id must be a valid UUID'),
  date: dateOnlySchema,
});
export type SlotsQueryInput = z.infer<typeof slotsQuerySchema>;
