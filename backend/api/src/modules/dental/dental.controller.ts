import { Request, Response, NextFunction } from 'express';
import { clinicService } from './clinic.service.js';
import { doctorService } from './doctor.service.js';
import {
  clinicListQuerySchema,
  clinicIdParamSchema,
  doctorIdParamSchema,
  availabilityQuerySchema,
  slotsQuerySchema,
} from './dental.schema.js';

/**
 * Read-only discovery/availability endpoints (task B2). No hold/confirm/
 * cancel here - that's B3's appointment.lifecycle module. Schema parsing
 * follows catalog.controller.ts's inline `schema.parse(...)` pattern (this
 * module doesn't use the `validate()` middleware, matching its structural
 * template).
 */
export class DentalController {
  // --------------------------------------------------------------------------
  // CLINICS
  // --------------------------------------------------------------------------

  async listClinics(req: Request, res: Response, next: NextFunction) {
    try {
      const query = clinicListQuerySchema.parse(req.query);
      const result = await clinicService.listClinics(query);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async getClinicById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = clinicIdParamSchema.parse(req.params);
      const clinic = await clinicService.getClinicById(id);
      res.status(200).json({ success: true, data: { clinic } });
    } catch (err) {
      next(err);
    }
  }

  async listClinicDoctors(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = clinicIdParamSchema.parse(req.params);
      const doctors = await clinicService.listClinicDoctors(id);
      res.status(200).json({ success: true, data: { doctors } });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // DOCTORS
  // --------------------------------------------------------------------------

  async getDoctorById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = doctorIdParamSchema.parse(req.params);
      const doctor = await doctorService.getDoctorById(id);
      res.status(200).json({ success: true, data: { doctor } });
    } catch (err) {
      next(err);
    }
  }

  async getDoctorAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = doctorIdParamSchema.parse(req.params);
      const query = availabilityQuerySchema.parse(req.query);
      const availability = await doctorService.getDoctorAvailability(
        id,
        query.clinic_id,
        query.from,
        query.to
      );
      res.status(200).json({ success: true, data: { availability } });
    } catch (err) {
      next(err);
    }
  }

  async getDoctorSlots(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = doctorIdParamSchema.parse(req.params);
      const query = slotsQuerySchema.parse(req.query);
      const result = await doctorService.getDoctorSlots(id, query.clinic_id, query.date);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const dentalController = new DentalController();
