import { z } from 'zod';

/**
 * A rider's own reported position for one delivery (plan §5). Deliberately
 * carries no order_id/rider_id/customer_id/tracking status - those are all
 * derived server-side from the authenticated caller and the URL's delivery
 * id (plan §D.4), never trusted from the body.
 */
export const updateLocationSchema = z.object({
  latitude: z
    .number({ required_error: 'latitude is required', invalid_type_error: 'latitude must be a number' })
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z
    .number({ required_error: 'longitude is required', invalid_type_error: 'longitude must be a number' })
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  accuracy: z
    .number({ required_error: 'accuracy is required', invalid_type_error: 'accuracy must be a number' })
    .positive('accuracy must be a positive number of meters'),
  captured_at: z
    .string({ required_error: 'captured_at is required' })
    .datetime({ message: 'captured_at must be an ISO 8601 timestamp' }),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
