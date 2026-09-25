import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware.js';
import { dentalAdminService } from './dental-admin.service.js';
import {
  adminAppointmentListQuerySchema,
  attachDoctorToClinicSchema,
  clinicDoctorIdPathParamSchema,
  clinicIdPathParamSchema,
  createAvailabilitySchema,
  createBlockedDateSchema,
  createClinicSchema,
  createDoctorSchema,
  idParamSchema,
  updateAvailabilitySchema,
  updateClinicDoctorSchema,
  updateClinicSchema,
  updateDoctorSchema,
} from './dental-admin.schema.js';

/** `requireAuth` runs before every route this controller serves (wired in
 * dental/index.ts), so a missing `req.user` is a wiring bug. Same helper
 * shape as appointment.controller.ts's `actorId`. */
function actorId(req: Request): string {
  if (!req.user) throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
  return req.user.id;
}

/** `?is_active=true|false` - same optional boolean-from-query parsing as
 * catalog.controller.ts's `getCategoriesAdmin`. */
function isActiveFilter(req: Request): boolean | undefined {
  return req.query.is_active === undefined ? undefined : req.query.is_active === 'true';
}

/**
 * Task B4 - admin CRUD (clinics, doctors, clinic-doctor pairings,
 * availability templates, blocked dates) + the admin appointment list.
 * Inline `schema.parse(...)` per handler, matching dental.controller.ts /
 * catalog.controller.ts's pattern (this module doesn't use the `validate()`
 * middleware). Every route is ADMIN-only, guarded in dental/index.ts.
 */
export class DentalAdminController {
  // --------------------------------------------------------------------------
  // CLINICS
  // --------------------------------------------------------------------------

  async createClinic(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createClinicSchema.parse(req.body);
      const clinic = await dentalAdminService.createClinicAdmin(input);
      res.status(201).json({ success: true, data: { clinic } });
    } catch (err) {
      next(err);
    }
  }

  async listClinics(req: Request, res: Response, next: NextFunction) {
    try {
      const clinics = await dentalAdminService.listClinicsAdmin(isActiveFilter(req));
      res.status(200).json({ success: true, data: { clinics } });
    } catch (err) {
      next(err);
    }
  }

  async getClinicById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const clinic = await dentalAdminService.getClinicByIdAdmin(id);
      res.status(200).json({ success: true, data: { clinic } });
    } catch (err) {
      next(err);
    }
  }

  async updateClinic(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = updateClinicSchema.parse(req.body);
      const clinic = await dentalAdminService.updateClinicAdmin(id, input);
      res.status(200).json({ success: true, data: { clinic } });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // DOCTORS
  // --------------------------------------------------------------------------

  async createDoctor(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createDoctorSchema.parse(req.body);
      const doctor = await dentalAdminService.createDoctorAdmin(input);
      res.status(201).json({ success: true, data: { doctor } });
    } catch (err) {
      next(err);
    }
  }

  async listDoctors(req: Request, res: Response, next: NextFunction) {
    try {
      const doctors = await dentalAdminService.listDoctorsAdmin(isActiveFilter(req));
      res.status(200).json({ success: true, data: { doctors } });
    } catch (err) {
      next(err);
    }
  }

  async getDoctorById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const doctor = await dentalAdminService.getDoctorByIdAdmin(id);
      res.status(200).json({ success: true, data: { doctor } });
    } catch (err) {
      next(err);
    }
  }

  async updateDoctor(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = updateDoctorSchema.parse(req.body);
      const doctor = await dentalAdminService.updateDoctorAdmin(id, input);
      res.status(200).json({ success: true, data: { doctor } });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // CLINIC-DOCTOR RELATIONSHIP
  // --------------------------------------------------------------------------

  async attachDoctorToClinic(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinic_id } = clinicIdPathParamSchema.parse(req.params);
      const input = attachDoctorToClinicSchema.parse(req.body);
      const clinicDoctor = await dentalAdminService.attachDoctorToClinic(clinic_id, input);
      res.status(201).json({ success: true, data: { clinic_doctor: clinicDoctor } });
    } catch (err) {
      next(err);
    }
  }

  async updateClinicDoctor(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = updateClinicDoctorSchema.parse(req.body);
      const clinicDoctor = await dentalAdminService.updateClinicDoctor(id, input);
      res.status(200).json({ success: true, data: { clinic_doctor: clinicDoctor } });
    } catch (err) {
      next(err);
    }
  }

  async listClinicDoctorRoster(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinic_id } = clinicIdPathParamSchema.parse(req.params);
      const doctors = await dentalAdminService.listClinicDoctorRosterAdmin(clinic_id);
      res.status(200).json({ success: true, data: { doctors } });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // AVAILABILITY TEMPLATE
  // --------------------------------------------------------------------------

  async createAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinic_doctor_id } = clinicDoctorIdPathParamSchema.parse(req.params);
      const input = createAvailabilitySchema.parse(req.body);
      const availability = await dentalAdminService.createAvailability(clinic_doctor_id, input);
      res.status(201).json({ success: true, data: { availability } });
    } catch (err) {
      next(err);
    }
  }

  async listAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinic_doctor_id } = clinicDoctorIdPathParamSchema.parse(req.params);
      const availability = await dentalAdminService.listAvailabilityAdmin(clinic_doctor_id);
      res.status(200).json({ success: true, data: { availability } });
    } catch (err) {
      next(err);
    }
  }

  async updateAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const input = updateAvailabilitySchema.parse(req.body);
      const availability = await dentalAdminService.updateAvailability(id, input);
      res.status(200).json({ success: true, data: { availability } });
    } catch (err) {
      next(err);
    }
  }

  async deleteAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      await dentalAdminService.deleteAvailability(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // BLOCKED DATES
  // --------------------------------------------------------------------------

  async createBlockedDate(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinic_doctor_id } = clinicDoctorIdPathParamSchema.parse(req.params);
      const input = createBlockedDateSchema.parse(req.body);
      const blockedDate = await dentalAdminService.createBlockedDate(clinic_doctor_id, input, actorId(req));
      res.status(201).json({ success: true, data: { blocked_date: blockedDate } });
    } catch (err) {
      next(err);
    }
  }

  async listBlockedDates(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinic_doctor_id } = clinicDoctorIdPathParamSchema.parse(req.params);
      const blockedDates = await dentalAdminService.listBlockedDatesAdmin(clinic_doctor_id);
      res.status(200).json({ success: true, data: { blocked_dates: blockedDates } });
    } catch (err) {
      next(err);
    }
  }

  async deleteBlockedDate(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      await dentalAdminService.deleteBlockedDate(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // APPOINTMENTS (admin visibility)
  // --------------------------------------------------------------------------

  async listAppointments(req: Request, res: Response, next: NextFunction) {
    try {
      const query = adminAppointmentListQuerySchema.parse(req.query);
      const result = await dentalAdminService.listAdminAppointments(query);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const dentalAdminController = new DentalAdminController();
