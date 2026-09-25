import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware.js';
import { appointmentService } from './appointment.service.js';
import {
  adminCancelAppointmentSchema,
  appointmentIdParamSchema,
  appointmentListQuerySchema,
  cancelAppointmentSchema,
  confirmAppointmentSchema,
  createHoldSchema,
} from './appointment.schema.js';

/** The authenticated caller. `requireAuth` runs before every route here, so
 * a missing `req.user` is a wiring bug, not a client error. */
function actorId(req: Request): string {
  if (!req.user) throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
  return req.user.id;
}

/** Same header allow-list as checkout (see app.ts's CORS `allowedHeaders`). */
function idempotencyKeyHeader(req: Request): string | undefined {
  const raw = req.header('Idempotency-Key') ?? req.header('x-idempotency-key');
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Booking lifecycle endpoints (task B3). Inline `schema.parse(...)` per
 * handler, matching dental.controller.ts / catalog.controller.ts.
 */
export class AppointmentController {
  async createHold(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createHoldSchema.parse(req.body);
      const result = await appointmentService.createHold(actorId(req), input, idempotencyKeyHeader(req));
      res.status(result.is_idempotent_replay ? 200 : 201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = appointmentIdParamSchema.parse(req.params);
      const input = confirmAppointmentSchema.parse(req.body);
      const appointment = await appointmentService.confirmAppointment(actorId(req), id, input);
      res.status(200).json({ success: true, data: { appointment } });
    } catch (err) {
      next(err);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = appointmentIdParamSchema.parse(req.params);
      const { reason } = cancelAppointmentSchema.parse(req.body ?? {});
      const appointment = await appointmentService.cancelOwnAppointment(actorId(req), id, reason ?? null);
      res.status(200).json({ success: true, data: { appointment } });
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = appointmentListQuerySchema.parse(req.query);
      const result = await appointmentService.listOwnAppointments(actorId(req), query);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = appointmentIdParamSchema.parse(req.params);
      const appointment = await appointmentService.getOwnedAppointment(actorId(req), id);
      res.status(200).json({ success: true, data: { appointment } });
    } catch (err) {
      next(err);
    }
  }

  /** POST /admin/dental/appointments/:id/cancel - reason is required here. */
  async adminCancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = appointmentIdParamSchema.parse(req.params);
      const { reason } = adminCancelAppointmentSchema.parse(req.body ?? {});
      const appointment = await appointmentService.cancelAppointmentAsAdmin(actorId(req), id, reason);
      res.status(200).json({ success: true, data: { appointment } });
    } catch (err) {
      next(err);
    }
  }
}

export const appointmentController = new AppointmentController();
