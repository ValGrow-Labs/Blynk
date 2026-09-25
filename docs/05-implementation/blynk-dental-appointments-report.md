# Blynk Dental Clinic Appointments — Implementation Report

**Plan:** `docs/superpowers/plans/2026-09-22-blynk-dental-clinic-appointments.md`
**Spec:** phase brief "Blynk Dental Clinic Appointment + Online Payment" (2026-09-22), narrowed by the user's follow-up instruction ("don't add payment features now, we can do it later") to a booking-only Phase 1. See ADR-005.

## 1. Scope

Phase 1 lets a Blynk customer discover participating dental clinics, pick a doctor, see real availability, hold a slot, and confirm a booking — reusing the existing backend's RBAC, transaction/locking patterns, and outbox notification pipeline, and the existing Customer app's design tokens, component library, and `MapProvider` abstraction. Clinics and doctors are managed entirely through Blynk Admin; there is no clinic-portal login, no `CLINIC_STAFF`/`DOCTOR` role, and no online payment anywhere in this pass (ADR-005).

## 2. Backend: schema and module

A new, independent backend module (`backend/api/src/modules/dental/`) with its own migration, its own lifecycle logic, and its own tests — it does not reuse `OrderStatus`, the `orders` table, or any `orders/lifecycle/*` file.

### Schema (migration `007_dental_clinic_appointments.sql`)

**Seven new tables** (not five — an earlier planning-stage estimate undercounted; the actual, implemented and reviewed schema has seven):

| Table | Purpose |
|---|---|
| `dental_clinics` | The physical clinic location (mirrors `dark_stores`): name, city, address, coordinates, contact phone, operating hours, `is_active`. |
| `doctors` | The practitioner identity, independent of any clinic: name, specialty (one of six fixed `dental_specialty_enum` values), photo, bio, `is_active`. |
| `clinic_doctors` | The many-to-many working relationship between a clinic and a doctor — the consultation fee, active/paused flag, and every availability/blocked-date row are scoped to this pairing, not to the doctor globally, because the same dentist can keep different hours and a different fee at two clinics. |
| `doctor_availability` | A recurring weekly template per clinic-doctor pairing (`day_of_week`, `start_time`, `end_time`, `slot_duration_minutes`, `buffer_minutes`, `is_active`). Availability is computed on read from this template — there is no per-slot generation batch job and no materialized slot table. |
| `doctor_blocked_dates` | Exceptions layered on the template: a specific date blocked for a clinic-doctor pairing (leave, holiday, clinic closure), with a reason and the admin who created it. |
| `appointments` | The booking itself: `clinic_doctor_id`, `customer_id`, `start_at`/`end_at`, `status`, hold fields (`held_by`, `held_until`), patient fields (`patient_name`, `patient_phone`, `patient_notes`), `consultation_fee_snapshot`, cancellation fields, and a unique `idempotency_key`. |
| `appointment_status_history` | An immutable append-only log of every status transition (old status, new status, who changed it, when) — the same shape already used for the order-history audit trail. |

Two new enums: `dental_specialty_enum` (6 fixed values: `GENERAL_DENTIST`, `ORTHODONTIST`, `PERIODONTIST`, `ENDODONTIST`, `ORAL_SURGEON`, `PEDIATRIC_DENTIST`) and `dental_appointment_status_enum` (5 values, see §4).

### Double-booking prevention

The database itself, not application trust, is the guarantee. A partial unique index —

```sql
CREATE UNIQUE INDEX uq_appointments_active_slot
  ON appointments (clinic_doctor_id, start_at)
  WHERE status IN ('HELD', 'CONFIRMED');
```

— transplanted line-for-line from the same pattern already proven for rider assignment (`uq_deliveries_active_assignment`). As long as a `(clinic_doctor_id, start_at)` pair has a `HELD` or `CONFIRMED` row, Postgres itself refuses a second one.

Three layers work together, matching `orders/lifecycle/actions/admin.ts assignRider()`'s exact shape:
1. **In-transaction pre-check**: `SELECT ... FOR UPDATE` locks any existing row for the slot before deciding whether to insert, update (reclaim), or refuse.
2. **Application-level refusal**: a live `HELD` row owned by someone else, or a `CONFIRMED` row, is refused with a domain `409` before any write is attempted.
3. **The `23505` backstop**: if two first-time holds race past the pre-check (both see no existing row) and both attempt an `INSERT`, Postgres's unique-index violation on the loser is caught and translated to the same `409`. This is not a theoretical fallback — instrumentation during implementation confirmed the backstop, not the pre-check, is what actually settles every race under real concurrency (15 races observed, all resolved by the `23505` catch). The flagship integration test fires two genuinely concurrent `POST /holds` requests for the same slot from two different customers and asserts exactly one `201`/`HELD` and one `409`, with a direct database query confirming never more than one active row exists at any point.

### The 5-minute hold and confirm flow

`POST /dental/appointments/holds` creates a `HELD` row with `held_until = now() + 5 minutes` and a server-derived `end_at`/`consultation_fee_snapshot` (never client-supplied). `POST /dental/appointments/:id/confirm` requires the caller to be the holder, the hold to be unexpired, and a `.strict()` Zod schema so a client can never smuggle a different `clinic_doctor_id`/`start_at` into the confirm call. Hold expiry is **lazy** — no background sweep, no `setInterval` job: an expired `HELD` row is simply reclaimable by the next request that touches that exact slot, exactly as the plan specified.

### The 5-state lifecycle

```
HELD ──(expires, unconfirmed)──▶ EXPIRED (terminal; lazy, never written — inferred from held_until)
  │
  │ (customer confirms within the hold window)
  ▼
CONFIRMED
  │
  ├──(customer cancels)────▶ CANCELLED_BY_CUSTOMER (terminal; slot reopens immediately)
  ├──(admin/clinic cancels)─▶ CANCELLED_BY_CLINIC    (terminal; slot reopens immediately)
  └──(start_at has passed)──▶ shown as "completed" — derived at read time, never stored
```

Five stored states: `HELD`, `EXPIRED`, `CONFIRMED`, `CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_CLINIC`. `EXPIRED` is defined in the enum but is never actually written by any code path — expiry is fully lazy, matching the plan's "no complicated scheduling engine" instruction. "Completed" and "is this hold visibly expired" are both derived at read time (`is_completed`, and the admin list's `is_expired_hold`), not stored transitions.

### Endpoints

Public discovery (no auth): `GET /dental/clinics`, `/clinics/:id`, `/clinics/:id/doctors`, `/doctors/:id`, `/doctors/:id/availability`, `/doctors/:id/slots`.

Customer (`CUSTOMER` role): `POST /dental/appointments/holds`, `POST /dental/appointments/:id/confirm`, `POST /dental/appointments/:id/cancel`, `GET /dental/appointments`, `GET /dental/appointments/:id`.

Admin (`ADMIN` role, under `/admin/dental`): full CRUD for clinics, doctors, clinic-doctor pairings (+ fee), availability templates, blocked dates, plus an appointment list (filterable by clinic/doctor/status/date range) and admin-cancel (reason required).

All availability is recomputed server-side on every read; the Flutter app never decides a slot is available — it only ever displays what the server last said and re-validates on every write, per the "availability is never client-trusted" rule.

## 3. Customer Flutter app

Nine new screens plus two providers (`DentalProvider`, backed by the same Provider+Dio pattern as the rest of the app) reached by a pushed route from a new Home entry point ("Dental Clinics" card, placed after the Categories grid, before any product rail — not a new bottom-nav tab, matching the existing 4-tab shell). Journey: clinic list/search → clinic detail (with a `ClinicLocationMap` static-pin wrapper around the existing `MapProvider`/`TrackingMapView`) → doctor profile → date/slot picker → hold (with a live countdown) → patient details → review → confirm → confirmation screen → "My appointments" (Upcoming/Past) → appointment detail → cancel. All screens use only existing `BlynkColors`/`BlynkText`/`BlynkSpace`/`BlynkRadius` tokens and existing Atoms (`BlynkButton`, `BlynkTextField`, `AppStateView`, `StatusBadge`, `MoneyText`, `showAdaptiveSheet`); a subsequent design audit pass fixed 9 minor token/copy deviations and confirmed no raw color/spacing literals remained.

Cancellation eligibility is read from the backend's `can_cancel` field on every appointment DTO, never computed client-side — the Flutter app carries no copy of the cancellation rule.

## 4. Admin UI

A new "Dental" section in `apps/admin` (5 pages: Clinics, Doctors, a clinic's doctor roster, Availability/blocked-dates, Appointments), all `ADMIN`-gated, following the existing Catalog admin's list+dialog CRUD pattern. Admin-cancel requires a reason (enforced client- and server-side) and calls the same endpoint the backend's `adminCancel` controller exposes — not a duplicate. Consultation fees are shown as plain numeric fields labelled "indicative … payable at the clinic"; no payment UI of any kind appears anywhere.

## 5. Notifications

Two notification types were added to the existing outbox pattern — SMS only (grepped the entire `orders/` tree for WhatsApp usage in confirmation/cancellation flows and found none, so dental follows the same real precedent rather than the plan's earlier "SMS + WhatsApp" assumption):
- `DENTAL_APPOINTMENT_CONFIRMED` — enqueued atomically in the same transaction as the `CONFIRMED` transition, addressed to the patient phone, stating the consultation fee is "indicative and payable at the clinic."
- `DENTAL_APPOINTMENT_CANCELLED` — enqueued on both customer- and admin-initiated cancellation, addressed to the customer, naming who cancelled and the reason if given. Force-cancelling an abandoned `HELD` row (which never collected a patient phone) sends no notification — there is no contact to notify.

**Appointment reminders were not implemented in this pass.** Only confirmation and cancellation notifications are in scope; see §6.

## 6. What is explicitly NOT built in this phase

- **Online payment** — no gateway, no payment UI, no webhook, no refund flow, no clinic settlement. The only payment-adjacent artifact is `consultation_fee_snapshot`, shown as an indicative figure "payable at the clinic." See ADR-005.
- **Appointment reminders** (DENTAL-11) — blocked on an undecided lead time. Confirmation and cancellation notifications exist; reminders do not, and no lead-time value was invented anywhere to unblock them.
- **A cancellation cutoff / time window** (DENTAL-07) — no cutoff is enforced. A customer can cancel a `CONFIRMED` appointment they own unconditionally, right up to (and past) `start_at`. The eligibility check is isolated in a single named guard, `canCustomerCancel(appointment)` (`backend/api/src/modules/dental/appointment.service.ts`), which today only checks `status === 'CONFIRMED'` and carries an explicit comment that a `start_at`-relative check belongs there once the business decides the window. The same function backs the `can_cancel` field the Flutter/Admin UIs read, so landing a real cutoff later is a one-line change to one function, not a redesign. **No specific cutoff value (e.g. "2 hours") was ever implemented — a planning-stage note suggesting one was superseded by this explicit instruction and does not reflect what was built.**
- **`NO_SHOW` and a stored `COMPLETED` state** — not modeled. "Completed" is derived at read time (`status = 'CONFIRMED' AND start_at < now()`); there is no financial or operational consequence yet worth a stored state for either.
- **Rescheduling** — a customer who wants a different time cancels and re-books; there is no first-class "change this appointment's time" action.
- **A clinic self-service portal** — no `CLINIC_STAFF`/`DOCTOR` role, no clinic login, no clinic-facing app. Every clinic/doctor/availability/blocked-date change goes through Blynk Admin.

## 7. Tests and verification

| Suite | Baseline (before this feature) | Final |
|---|---|---|
| Backend (`npm test`, vitest) | 779 tests, 34 files | **926 tests, 41 files, 0 failed** |
| Flutter (`flutter test`) | 1565 tests | **1738 tests, 0 failed**, `flutter analyze` clean |
| Admin (`npm test`, vitest) | 68 tests | **79 tests, 0 failed**, `typecheck`/`build` clean |

Zero regressions against every baseline across all 11 implementation tasks (B1–B5 backend, F1–F5 Flutter, A1 admin). `npm run test:hygiene` confirmed the shared dev database was left byte-identical after every backend task. The flagship concurrency proof — two customers racing for one slot resolving to exactly one confirmed appointment — was run repeatedly (including a deterministic interleaving that forces the `23505` backstop specifically) and passed every time. Fix rounds were needed and closed clean (0 Critical/0 Important remaining) for tasks B3, B4, F1, and F4; every other task passed independent review on the first attempt.

A dedicated design audit of every new customer and admin screen found 0 Critical, 2 Important (both deferred — a slot-chip tap target and a selected-day-chip border color, neither payment/cutoff-related, both pre-existing patterns elsewhere in the app), and 9 Minor findings, 9 of which were fixed directly (token/copy-only, no logic changes) with the remaining two flagged for a future polish pass.

## 8. Known limitations

- No online payment surface exists to attack or reconcile (by design — see ADR-005); the consultation fee shown to customers is informational only and not verified against what a clinic actually charges.
- No cancellation cutoff and no appointment reminders — both are genuinely open business decisions (DENTAL-07, DENTAL-11), not oversights; inventing a number for either was explicitly avoided throughout implementation.
- Availability computation issues a handful of queries per request rather than a single batched query for wide date ranges; acceptable at the plan's stated scale (a handful of clinics, capped 30-day range query), flagged for a future pass if clinic/doctor counts grow.
- A single-field admin PATCH to clinic operating hours that would invert the clinic's stored hours is caught and rejected cleanly (fixed during B4's review round); no other cross-field validation gaps were found.
- `ClinicLocationMap`'s accessibility label is announced by two Semantics nodes on the real Google map adapter (both say the same correct thing) — a verbosity issue, not a correctness one, left open pending an adapter-aware capability check.
- No physical device or live-backend run was exercised for any new screen or endpoint in this pass; verification is via the automated test suites above.

STATUS: DENTAL CLINIC APPOINTMENTS (PHASE 1, BOOKING ONLY) COMPLETE AND VERIFIED
