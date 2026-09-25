# Blynk Dental Clinic Appointment Booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This document is a plan only. No application code was written, no migration was created, no dependency was installed, no file outside `docs/superpowers/plans/` was changed, nothing was committed or pushed.**

**Goal:** Let a Blynk customer discover participating dental clinics, pick a doctor, see real availability, and book an appointment — reusing the existing Blynk backend (RBAC, transaction/locking patterns, outbox notifications, modular-monolith conventions) and the existing Customer app (design tokens, component library, `MapProvider`, Provider+Dio pattern) instead of building parallel infrastructure.

**Scope decision (user instruction, 2026-09-22): online payment is explicitly OUT OF SCOPE for this pass.** The original brief asked for booking **and** online payment together; the user then said *"don't add payment features now, we can do it later."* This plan therefore designs **Phase 1 as a reservation/booking product with no money changing hands in the app** (COD-equivalent: pay the clinic directly, off-platform), and leaves one explicit, minimal seam in the appointment state machine so a payment step can be inserted later **without a redesign**. Payment-gateway research (PayHere/Stripe/etc. comparison) was **intentionally not performed** — see §11.

**Architecture:** A new backend module `backend/api/src/modules/dental/` (own lifecycle sub-package mirroring `orders/lifecycle/`), five new tables reusing existing ID/timestamp/money conventions, availability computed on read (no slot-generation batch job, no Redis, no cron beyond the existing `setInterval` outbox worker pattern), and one partial unique index as the entire double-booking defence — the same belt-and-suspenders shape already used for rider assignment (`uq_deliveries_active_assignment`). Customer UI is new Flutter screens using only existing design tokens and components, reached by a pushed route (not a new bottom-nav tab). Admin CRUD lives in the existing `apps/admin` app; **no clinic self-service portal, no clinic/doctor login accounts in Phase 1**.

**Tech Stack:** Node.js/TypeScript + Express + Kysely + PostgreSQL (existing, unchanged), Flutter (existing Customer app, unchanged toolchain), no new dependencies anywhere.

**Spec:** the phase brief "Blynk Dental Clinic Appointment + Online Payment" (2026-09-22), narrowed by the user's follow-up instruction to booking-only. Inherits every binding constraint of `docs/03-decisions/adr-001..004-*.md` and of the current Customer-app plan `docs/superpowers/plans/2026-09-21-blynk-customer-premium-distribution.md`.

---

## 1. Executive summary

Blynk's backend is a modular monolith with exactly the primitives this feature needs already proven in production code: a generic `requireRoles()` RBAC guard sitting on one `UserRole` enum, a transactional lifecycle-engine pattern (`orders/lifecycle/engine.ts`) that locks rows, rechecks, and applies effects atomically, a partial-unique-index-backed exclusivity pattern (`uq_deliveries_active_assignment`) that is the *exact* mechanism double-booking prevention needs, and a working outbox/worker notification pipeline (SMS + WhatsApp) that needs one small additive field (`scheduled_for`) to support appointment reminders. The Customer app has a token-based design system, a component library that covers every state this feature needs (buttons, fields, status badges, sheets, skeletons), and a provider-neutral `MapProvider` abstraction whose `TrackingMapView` already renders a static single-pin map with zero new code — just a ~20-line wrapper.

What does **not** exist: any payment gateway integration (the `payments` module is an 8-line stub; the `payments` table schema is provisioned but unused — Phase 3 per the PRD, never touched), any concept of "clinic" or "doctor," any appointment scheduling logic, and any clinic-portal/staff-login concept. This plan builds the booking half of the feature end-to-end, reusing the patterns above, and defers the payment half to a follow-up plan once a provider decision is made (§11).

**Bottom line:** this is a medium-sized, additive feature. It needs one new backend module (schema + lifecycle + API), one new Flutter feature area (5-6 screens + 2 providers), one new Admin section, and a small notifications enhancement. It needs **zero** new infrastructure (no Redis, no Kafka, no queue, no microservice) and **zero** changes to the existing grocery order/cart/payment code paths.

---

## 2. Current Blynk architecture findings

Findings below are from two read-only investigations (backend module tree + docs; Customer app UI/nav/design system) plus one Graphify query confirming the module graph. Full evidence trails are in the investigation transcripts; the load-bearing facts are summarized here with file:line citations.

### 2.1 Auth & RBAC — directly reusable

- OTP request/verify (`backend/api/src/modules/auth/auth.service.ts`) issues a 15-minute JWT + 30-day rotating refresh token (hash-only storage, replay detection on reuse). `verifyOtp` re-locks the OTP row with `FOR UPDATE` before consuming it (`auth.service.ts:150`) — the same "lock, recheck, act" shape this plan reuses for slot booking.
- **Roles are one Postgres enum column**: `UserRole = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN'` (`backend/api/src/database/types.ts:3`). `requireAuth` + `requireRoles(...roles)` (`backend/api/src/middleware/{auth,role}.middleware.ts`) is a generic, already-composed guard (`modules/admin/index.ts:34`).
- **Decision this enables**: a new role is one enum value away, not a new auth system. This plan recommends **not adding one in Phase 1** (see §8) because clinic/doctor management is admin-only, but the door is open cheaply if Phase 2 needs it.
- Caveat: OTP self-registration always creates `CUSTOMER` (`auth.service.ts:177-178`); any future staff/doctor account would need admin-provisioning, not self-serve OTP.

### 2.2 Orders lifecycle — the direct template for appointment locking

- `orders/lifecycle/engine.ts` `runTransition()`: one `db.transaction()`, locks rows in a documented canonical order (children before parent), role-checks, checks preconditions, applies effects — all atomic (`engine.ts:17-39`).
- **The exact double-booking pattern already exists**, for a different resource: `orders/lifecycle/actions/admin.ts` `assignRider()` (L19-70) does (1) an in-transaction pre-check for an existing active delivery, throwing `409 ORDER_ALREADY_ASSIGNED` if found, then (2) inserts and catches Postgres `23505` (unique-violation) from a **partial unique index** `uq_deliveries_active_assignment`, translating it to the same 409 — "the last line of defence" per the code's own comment. This plan's slot-locking design (§7) is this exact pattern applied to `(doctor, start_time)` instead of `(order, active delivery)`.
- A second reusable shape: `lockFor('activeDeliveries', ...)` locks candidate rows, locks the parent, **re-reads and compares row-id sets**, and throws a domain 409 if something changed between the two reads (`engine.ts:99-123`) — an optimistic-recheck layered on pessimistic locks. This is the pattern for reclaiming an expired hold (§7.3).
- Idempotency: `Idempotency-Key`/`x-idempotency-key` header, app-level pre-check + DB `UNIQUE` backstop (`order.service.ts:97-108`, `orders.idempotency_key UNIQUE`). Reused as-is for appointment creation.

### 2.3 Payments — confirmed stub, zero gateway code

- The entire `payments` module is 8 lines (`backend/api/src/modules/payments/index.ts`): one `GET /status` route, nothing else. Grep across the whole backend for `stripe|razorpay|payhere|paypal|webhook` returns **zero matches**.
- `PaymentMethod = 'COD' | 'ONLINE'` exists in the DB enum, but `'ONLINE'` is never set by any code path. `docs/04-business/business-rules.md:36`: *"Phase 1 Method: Strictly Cash on Delivery (COD). No online card/wallet payments in Phase 1."* `docs/02-architecture/blynk_database_design.md:1387-1389` explicitly calls online payment gateways **"Phase 3."**
- The `payments` table (`001_initial_schema.sql:400-412`) has `transaction_reference`, `gateway_response JSONB`, a `payment_status` enum (`PENDING|PAID|FAILED|REFUNDED`) — schema-provisioned, code-unused. `order_id UUID UNIQUE` means exactly one payment row per order today (would need relaxing for retry semantics, whenever a gateway is added).
- **This confirms the user's instruction was the right call**: there is no existing online-payment surface to extend cheaply. Adding it now would be materially new engineering, not reuse — exactly the kind of work worth doing as its own scoped effort once a provider is chosen (§11).

### 2.4 Notifications/outbox — reusable, one additive gap

- Real outbox pattern: `notification.repository.ts` `enqueueNotification()` inserts `status: 'QUEUED'`, dedups via `idempotency_key UNIQUE` + `ON CONFLICT DO NOTHING`. A `setInterval`-based worker (`notification.worker.ts:59-61`, no cron/BullMQ — matches ADR-002's "internal background polling workers") claims batches with `SELECT ... FOR UPDATE SKIP LOCKED` ordered by `next_attempt_at ASC`, with exponential backoff on retry.
- **Gap for reminders**: the claim query already treats "`next_attempt_at <= now`" as due — that's mechanically a real scheduler — but `enqueueNotification()` hardcodes `next_attempt_at: new Date()` (`notification.repository.ts:54`) with no way to pass a future time. **This is a small, additive change** (thread an optional `scheduled_for` through `EnqueueOptions` → the insert), not a new subsystem. Cancelling an already-queued-but-not-yet-sent reminder (customer cancels their appointment) needs one small addition too — see §13.
- Channels: SMS (NotifyLK) + WhatsApp Cloud API only. No email, no push.

### 2.5 Multi-tenant analog — `dark_stores` is the model for "clinics"

`dark_stores` (`001_initial_schema.sql:120-135`) already has exactly the shape a "clinic" needs: `code`, `name`, `city`, `address_line`, `latitude`/`longitude`, `contact_phone`, `operating_start_time`/`operating_end_time`, `is_active`. The pattern of a `dark_store_id` FK threading through `orders`/`inventory`/`riders` is the direct precedent for a `clinic_id` FK threading through doctors/availability/appointments. (The *application code* today assumes a single active store — `findActiveDarkStore()` is singular — but the *schema* is multi-tenant-ready; this plan's clinic model follows the schema pattern, not the current single-store application assumption.)

### 2.6 API, validation, error conventions

- URL prefix `env.API_PREFIX` (`/api/v1`), one router mounted per module in `app.ts` (`apiRouter.use('/orders', ordersRouter)` etc.) — a dental module mounts the same way.
- Validation: Zod via `validate({ body, query, params })` middleware, converting `ZodError` into a uniform `400 VALIDATION_ERROR`.
- Error envelope: `{ success: false, error: { code, message, details, timestamp, requestId } }` (`middleware/error.middleware.ts:20-89`). Success envelope: `{ success: true, data: {...} }`.
- ADR-004 (client-side cart): *"Zero Trust in Client Prices"* — the server always recomputes price server-side. Direct analog for appointments: the server always recomputes/re-validates slot availability and fee, never trusts a client-submitted time or price.

### 2.7 Customer app — navigation, design system, map, identity

- **Shell**: `CustomerShell` is a fixed 4-tab `IndexedStack` (Shop/Orders/Help/Profile, `customer_shell.dart:125-176`), explicitly documented as "the four top-level customer destinations." **Recommendation: do not add a 5th tab.** Add Dental as a pushed route reachable from an entry point inside an existing tab (Home or Profile), exactly like `/app/about` and `/user/address` are pushed today (`route_generator.dart:114-123`) without disturbing the 4 tabs.
- **Design tokens** (`lib/design/tokens.dart`, `docs/07-design/blynk-customer-design-system.md`): full `BlynkColors`/`BlynkSpace`/`BlynkRadius`/`BlynkElevation`/`BlynkText`/`BlynkIcons` vocabulary — this feature must use these and nothing else (no new colours, no new spacing/radius values).
- **Component inventory (reuse-as-is)**: `BlynkButton`/`BlynkButtonPair`, `BlynkTextField`, `AppStateView` (`.loading`/`.empty`/`.error`/`.notFound`), `StatusBadge`, `MoneyText`, `showAdaptiveSheet`, `SkeletonScope`, `OfflineBanner`. `QuantityStepper` and `CartBar` are grocery-specific and not a natural fit (no "quantity" concept for an appointment; a persistent "your upcoming appointment" bar would mean touching the shell, which this plan avoids).
- **`MapProvider`** (`lib/UI/Widgets/Organisms/map_provider.dart`, `google_map_view.dart`): `TrackingMapView` accepts an arbitrary `Set<MapMarkerSpec>`; passing exactly one marker with `tone: MapMarkerTone.destination` and no rider marker already produces a static, read-only, single-pin map — the camera-fit-to-bounds logic only activates when a rider marker exists (`google_map_view.dart:340-347`). **No new map abstraction is needed.** A ~20-line `ClinicLocationMap` wrapper (mirroring `order_tracking_map.dart:47-70`'s call pattern) is the entire map integration. It inherits Google/MapLibre provider-swapping and the "Map unavailable" fallback for free.
- **Identity/contact data**: `UserModel{phone, email?, fullName?}` and `AddressModel{recipientName, recipientPhone, ...}` already give a name+phone contact shape usable to prefill "who is this appointment for."
- **Strongest UX analog**: `order_summary_screen.dart:285-334`'s section order — status header → (conditional map) → timeline → items card → bill card → address card → conditional cancel section — is the template for an `AppointmentSummaryScreen`. `checkout_screen.dart` is the template for the booking-review screen. `user_orders_screen.dart:33-72`'s guest-gate + resume-refresh discipline is the template for "My Appointments."

### 2.8 Pre-existing, feature-independent blockers (carried, not introduced)

- **Google Maps rendering is unverified on any physical device**; Android `applicationId` (D2) is undecided, blocking key restriction; release signing is still the debug key. A "clinic map pin" can be *built and tested* against the `MapProvider` contract today but cannot be *claimed to render correctly on a device* until those pre-existing blockers clear (tracked outside this feature).
- **No `apps/customer-web/` (iOS PWA) project exists yet** — it's a decided-but-unbuilt separate plan. Any dental UI for iOS is blocked on that project starting, not on this plan.
- `blynk_architecture.md`'s platform-stack section (React Native + Next.js) is stale relative to the real Flutter implementation; this plan treats the live `lib/` tree and the 2026-09-21 premium-distribution plan as the current source of truth, not that document.
- Nothing in any product/architecture doc anticipated a non-grocery vertical beyond one vague PRD line about a future "partner merchant marketplace" (`blynk_prd.md:134`). This feature is genuinely new scope for the product, not an extension of a planned track.

---

## 3. Proposed dental architecture

```
                         BLYNK CUSTOMER APP (Flutter, existing)
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
            existing grocery flow              NEW: Dental Clinics feature
            (unchanged)                        (pushed route, own providers)
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      │  same Dio client, same auth interceptor
                                      ▼
                         BLYNK BACKEND (Node/TS modular monolith, existing)
                    ┌─────────────────┴─────────────────┐
                    │                                   │
            modules/orders/ (unchanged)          NEW: modules/dental/
            modules/payments/ (unchanged,               ├── dental.repository.ts
              still a stub)                              ├── clinic.service.ts
            modules/notifications/                       ├── doctor.service.ts
              (+1 additive field: scheduled_for)          ├── availability.service.ts
                    │                                     ├── appointment.lifecycle/
                    │                                     │     (mirrors orders/lifecycle/)
                    │                                     └── index.ts (route mounting)
                    └─────────────────┬─────────────────┘
                                      ▼
                         PostgreSQL (existing instance, +5 tables, +1 migration)
```

No new services, no new containers, no new runtime. The dental module is a sibling of `orders/` inside the same Express app, deployed the same way, reusing the same connection pool, the same outbox worker process, the same Admin app.

---

## 4. Customer journey (Phase 1, no payment)

```
Customer
  ↓
Entry point (Home tile or Profile row — NOT a new bottom-nav tab)
  ↓
Dental Clinics (browse / search by city or name)
  ↓
Clinic detail (info, hours, map pin, doctor list)
  ↓
Doctor profile (name, specialty, clinics they work at, indicative fee)
  ↓
Select date (calendar strip; days with zero availability are disabled/dimmed)
  ↓
Available time slots for that date
  ↓
Hold the slot (short-lived reservation, ~5 min — see §7)
  ↓
Appointment details (patient name, phone — prefilled from account; optional short note)
  ↓
Review (clinic, doctor, date/time, patient, indicative fee — "pay at clinic")
  ↓
Confirm booking  (NO payment step here — this is the seam, see §5.4)
  ↓
Appointment confirmation (SMS/WhatsApp + in-app screen)
  ↓
Appointment history (Upcoming / Past)
  ↓
Cancel (if before cutoff) → slot released, clinic notified
```

Every "must be able to" bullet from the original brief is covered **except** "pay online," which is explicitly deferred. "See payment status" becomes, for Phase 1, "see that the appointment is confirmed and that payment happens at the clinic" — a plain-text note, not a payment UI.

---

## 5. Appointment lifecycle

### 5.1 States (Phase 1)

```
HELD  ──(hold expires, unconfirmed)──▶  EXPIRED  (terminal; slot released automatically)
  │
  │ (customer submits patient details within the hold window)
  ▼
CONFIRMED
  │
  ├──(customer cancels, before cutoff)──▶ CANCELLED_BY_CUSTOMER  (terminal; slot released)
  ├──(admin/clinic cancels, any time)───▶ CANCELLED_BY_CLINIC    (terminal; slot released)
  └──(start_at has passed, still CONFIRMED)──▶ shown as "Completed" — DERIVED, not stored
```

Five stored states: `HELD`, `EXPIRED`, `CONFIRMED`, `CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_CLINIC`. "Completed" is computed at read time (`status = 'CONFIRMED' AND start_at < now()`), not a stored transition — one less state to get wrong, and nothing depends on knowing the exact moment an appointment "completed" without payment/reconciliation riding on it. `NO_SHOW` is **not** modeled in Phase 1 (see §10) — it has no financial consequence yet, so tracking it buys nothing beyond what "completed" already shows.

### 5.2 Who can transition what

| Transition | Actor | Guard |
|---|---|---|
| → `HELD` | Customer | slot must be free (§7); rate-limited |
| `HELD` → `CONFIRMED` | Same customer who holds it | hold not expired; patient details valid |
| `HELD` → `EXPIRED` | System (lazy, on next conflicting access — no background delete needed for correctness) | `held_until < now()` |
| `CONFIRMED` → `CANCELLED_BY_CUSTOMER` | Owning customer | before cancellation cutoff (§10, DENTAL-07) |
| `CONFIRMED` → `CANCELLED_BY_CLINIC` | Admin (Phase 1; clinic staff in a future phase) | any time, reason required |
| any → any other | — | **invalid**, rejected with `409`/`422` |

### 5.3 Independence from the grocery order lifecycle

Per the brief's explicit instruction, appointments get their **own** lifecycle module (`modules/dental/appointment.lifecycle/`), own catalogue/actions files mirroring `orders/lifecycle/catalogue.ts` + `actions/*.ts` in shape only — not a shared state machine, not a shared table, not a reuse of `OrderStatus`. The only things shared are the *engineering pattern* (transaction + lock + recheck + apply) and the *notification/outbox infrastructure*.

### 5.4 The payment seam (for later, not built now)

To make a future payment step additive rather than a redesign, this plan reserves:
- `appointments.consultation_fee_snapshot NUMERIC(10,2) NULL` — populated at hold time from the clinic-doctor's fee, displayed as "indicative fee, payable at the clinic." Not wired to any payment logic.
- A documented future state `HELD → PAYMENT_PENDING → CONFIRMED` that would slot in between the two states above **without changing what "HELD" or "CONFIRMED" mean** to any other part of the system (notifications, cancellation, history all key off `CONFIRMED`/cancelled/expired regardless of how it got there).
- No `appointment_payments` table, no gateway client, no webhook route exists or is designed in detail here — that is explicitly §11's follow-up work.

---

## 6. Payment lifecycle

**Not designed in this pass**, per the user's instruction. When payment is added later, it should reuse the existing `payments` table shape (`transaction_reference`, `gateway_response JSONB`, `payment_status` enum) and the same lock-then-settle transactional pattern already proven in `settleCod()` — but the actual state machine, webhook handling, and provider integration need their own scoped plan once §11's provider decision is made. See §5.4 for the one seam this plan does reserve.

---

## 7. Double-booking / slot-locking design

This is the part of the feature that is critical **regardless of payment**, and it reuses an existing, production-proven pattern almost line-for-line.

### 7.1 Why no separate "slots" table

Given the "do not build a complicated scheduling engine unless necessary" instruction and the small Phase-1 clinic count (a handful, per the product's own "launching in Dharga Town & Beruwala" framing), this plan computes availability **on read** from a small weekly template (§9), rather than materializing a row per 30-minute slot per doctor per day (which would need a daily generation batch job — new infrastructure this repo's ADRs explicitly forbid adding without justification). The **only** thing that needs to be a real row, with a real lock, is an actual booking attempt.

### 7.2 The locking primitive (directly transplanted from `assignRider`)

```
CREATE UNIQUE INDEX uq_appointments_active_slot
  ON appointments (clinic_doctor_id, start_at)
  WHERE status IN ('HELD', 'CONFIRMED');
```

One partial unique index. As long as a `(doctor, time)` pair has a `HELD` or `CONFIRMED` row, no second one can exist — enforced by Postgres itself, not by application logic. This is the *entire* double-booking guarantee at the database level; everything else below is about giving customers a clean error instead of a raw constraint violation, and about letting an abandoned hold be reclaimed.

### 7.3 Hold → confirm flow

```
POST /dental/appointments/holds  { clinic_doctor_id, start_at }
  ── db.transaction() ──
  1. SELECT * FROM appointments
       WHERE clinic_doctor_id=$1 AND start_at=$2 AND status IN ('HELD','CONFIRMED')
       FOR UPDATE                                   -- locks any existing row for this slot
  2. if found and status='CONFIRMED'                → 409 SLOT_UNAVAILABLE
  3. if found and status='HELD' and held_until>now() and held_by != me
                                                      → 409 SLOT_HELD (someone else is holding it)
  4. if found and status='HELD' and (held_until<=now() or held_by = me)
                                                      → UPDATE the same row: held_by=me, held_until=now()+5min
  5. if not found                                    → INSERT new row, status='HELD', held_by=me, held_until=now()+5min
  6. re-validate the requested start_at against the doctor's current availability template
       and blocked dates (server-side; client's slot listing may be seconds stale)  → 409 SLOT_UNAVAILABLE if not
  ── commit ──
  Backstop: if step 5's INSERT still races another INSERT (both passed step 1's SELECT
  before either committed), Postgres raises 23505 on the partial unique index →
  caught and translated to the same 409 SLOT_UNAVAILABLE, exactly like assignRider's
  "last line of defence."
```

This is the same "lock candidate rows → lock/recheck → act, with a unique-index backstop for the true race" shape as `lockFor('activeDeliveries', ...)` (§2.2), applied to a new resource. No new locking primitive, no `SERIALIZABLE` isolation, no advisory locks — row-level `FOR UPDATE` under the existing `READ COMMITTED` default, exactly as the rest of the codebase already relies on.

```
POST /dental/appointments/:id/confirm  { patient_name, patient_phone, notes? }
  ── db.transaction() ──
  1. SELECT * FROM appointments WHERE id=$1 FOR UPDATE
  2. must be status='HELD', held_by=me, held_until>now()   — else 410 HOLD_EXPIRED
  3. UPDATE status='CONFIRMED', patient_name=..., patient_phone=..., patient_notes=..., held_until=NULL
  4. enqueue confirmation SMS/WhatsApp + reminder (same transaction, outbox pattern)
  ── commit ──
```

### 7.4 Concurrency scenario walked through

```
Customer A: POST holds(doctor=D, 10:00) at t=0        → 200, HELD, held_until=t+5m
Customer B: POST holds(doctor=D, 10:00) at t=10s       → row found, HELD, not expired, held_by != B
                                                        → 409 SLOT_HELD
Customer A: POST holds/:id/confirm at t=60s            → 200, CONFIRMED
Customer B: retries POST holds(doctor=D, 10:00) at t=90s
                                                        → row found, status='CONFIRMED' → 409 SLOT_UNAVAILABLE
```

Two customers, one slot → exactly one `CONFIRMED` appointment, always. This is the flagship test in §22.

### 7.5 Hold expiry, abandoned holds, retries

- No background sweep is required for **correctness** — expiry is enforced lazily, at the moment another request touches that exact `(doctor, time)` row (step 4 above reclaims it). This matches "do not implement a complicated scheduling engine" and needs no new worker.
- An **optional** cosmetic cleanup (mark long-dead `HELD` rows `EXPIRED` so admin reporting/availability queries don't have to filter on `held_until` forever) can reuse the *existing* `setInterval` outbox-worker pattern if it's ever worth doing — not required for Phase 1, listed as a nice-to-have in §26.
- Idempotency: the hold endpoint also accepts an `Idempotency-Key` header (existing header allow-list), so a client retry after a network timeout replays the same hold instead of creating a duplicate.

### 7.6 What "backend/database must enforce" list looks like here

Per the explicit instruction "do not rely on the Flutter UI to prevent double booking": the Flutter slot list is a *read* of current availability, always re-validated server-side at hold time (§7.3 step 6); the partial unique index is the true enforcement; the app never decides a slot is available — it only ever displays what the server most recently said, and the server re-checks on every write.

---

## 8. Clinic/doctor model

### 8.1 Identity: clinics and doctors are data, not accounts (Phase 1)

Per the explicit instruction to investigate whether clinics/doctors need their own login identity before assuming so: **they do not, in Phase 1.** Clinics and doctors are rows managed entirely by Blynk Admin (`ADMIN` role, existing). There is no `CLINIC_STAFF` or `DOCTOR` login, no clinic-facing app, no clinic onboarding flow. This is the minimum that satisfies the customer journey, matches "do not build a clinic portal unless requirements justify it," and matches the realistic Phase-1 clinic count (a small, hand-onboarded set in Dharga Town & Beruwala).

If Phase 2 needs clinic self-service (a clinic managing its own availability without going through Blynk Admin), the RBAC investigation in §2.1 confirms that's a one-enum-value addition (`CLINIC_STAFF`, maybe `DOCTOR`) plus new admin-provisioned accounts — cheap to add later, not worth building speculatively now.

### 8.2 Doctors can work at multiple clinics (DENTAL-15)

Modeled as a many-to-many join (`clinic_doctors`), not a `clinic_id` FK directly on `doctors`. A doctor's working hours, blocked dates, and fee are all scoped to the **clinic-doctor pairing**, not to the doctor globally, because the same dentist may keep different hours (and even a different fee) at two clinics.

### 8.3 Entities

- **Clinic**: the physical location (mirrors `dark_stores`).
- **Doctor**: the practitioner (name, specialty, photo, bio) — clinic-independent identity.
- **ClinicDoctor**: the working relationship (this clinic, this doctor, this fee, this active/paused flag) — availability and blocked dates hang off this, not off the doctor alone.
- **Specialty**: a small fixed set for Phase 1 (General Dentist, Orthodontist, Periodontist, Endodontist, Oral Surgeon, Pediatric Dentist) — a Postgres enum, not a free-text field or a separate table, to avoid inventing taxonomy management for six values.

---

## 9. Appointment slot architecture

**Recommended: Option B (generated from a template), computed on read — not Option A (pre-created rows) and not a hybrid.**

### 9.1 The template

`doctor_availability` — a recurring **weekly** template per clinic-doctor pairing:

| Column | Purpose |
|---|---|
| `clinic_doctor_id` | which doctor, at which clinic |
| `day_of_week` | 0–6 |
| `start_time`, `end_time` | the working window that day |
| `slot_duration_minutes` | fixed appointment length (Phase 1: one duration per doctor, e.g. 30 min — variable per-service durations are Phase 2, see §20) |
| `buffer_minutes` | gap kept between consecutive slots (cleaning/turnaround time) |
| `is_active` | soft-disable a row without deleting it |

`doctor_blocked_dates` — exceptions layered on top: a specific `date` (leave, holiday, clinic closure) for a `clinic_doctor_id`, with a `reason` and `created_by` (admin). A clinic-wide closure in Phase 1 is modeled as the admin blocking every doctor at that clinic for that date — no separate "clinic closure" concept needed at this scale (Phase 2 candidate if clinic count grows).

### 9.2 Computing `GET /dental/doctors/:id/slots?clinic_id=&date=`

1. Look up the `doctor_availability` row(s) for that clinic-doctor + day-of-week.
2. If none, or a `doctor_blocked_dates` row exists for that exact date → empty list (with a reason if blocked).
3. Generate candidate start times: `start_time, start_time + (duration+buffer), ...` up to `end_time`.
4. Subtract any candidate whose `(clinic_doctor_id, start_time)` already has a `HELD`(unexpired)/`CONFIRMED` row in `appointments` (one indexed query).
5. Return the remainder. This is a pure computation — no stored "slot" rows, nothing to regenerate nightly, nothing to go stale.

`GET /dental/doctors/:id/availability?from=&to=` (for the calendar view — "which days in this range have anything open") runs the same computation per day in the range and returns a lightweight has-any-slots boolean per date, so the Flutter calendar can dim fully-booked/closed days without a slot-by-slot round trip.

### 9.3 What this addresses from the brief

- **Appointment duration**: fixed per doctor (Phase 1); variable per-service duration deferred (§20).
- **Buffer time**: `buffer_minutes` column.
- **Doctor working hours**: the template.
- **Clinic working hours**: `dental_clinics.operating_start_time/end_time` bounds what a clinic-doctor's template is allowed to be (validated at admin-write time, not re-derived at read time).
- **Holidays/doctor leave/clinic closure**: `doctor_blocked_dates`.
- **Multiple clinics, multiple doctors, multiple appointments/day**: all handled by the `clinic_doctor_id` scoping and the per-slot unique index — nothing here is a global lock, so unrelated doctors/clinics never contend with each other.

---

## 10. Refunds and cancellations

**Refunds: not applicable in Phase 1** — there is no payment to refund. This section covers cancellation only.

| Scenario | Phase 1 rule |
|---|---|
| Customer cancels | Allowed up to a cutoff before `start_at` (**DENTAL-07, open decision** — recommend 2 hours, matching a reasonable no-drama window without needing a payment-backed penalty to enforce it). |
| Clinic/admin cancels (doctor unavailable, closure) | Always allowed, any time, reason required, customer notified immediately. |
| Payment failure | N/A (no payment). |
| Slot expired (never confirmed) | Not a "cancellation" — it's an `EXPIRED` hold; nothing to cancel, nothing to notify beyond what already happened (customer simply never got a confirmation). |
| No-show | Not tracked in Phase 1 (§5.1) — no financial or operational consequence yet worth the extra state. |
| Rescheduling | **Not built in Phase 1.** A customer who wants a different time cancels and re-books — this keeps the state machine simple and avoids "does the old payment carry over" questions that don't exist yet anyway. Explicit Phase 2 candidate (DENTAL-16). |

Cancelling (by either party) transitions the row out of `('HELD','CONFIRMED')`, which means the partial unique index in §7.2 stops blocking that `(doctor, time)` pair — the slot reopens immediately, with no separate "release" step to forget.

---

## 11. Customer UX / screen map

All screens use only existing `BlynkColors`/`BlynkText`/`BlynkSpace`/`BlynkRadius` tokens and the existing Atoms inventory (§2.7). No new colours, no medical iconography beyond a couple of *distinct* Material-outlined glyphs added the same test-guarded way existing ones were (e.g. a tooth/appointment icon — must not collide with an existing meaning, per the design system's uniqueness test).

| Screen | Composition (existing pattern reused) | States |
|---|---|---|
| **Entry point** | A card/row on Home or a row in Profile (not a nav tab) — same visual weight as other Profile rows | n/a |
| **Clinic list** | Search field (reuse `SearchScreen` field pattern) + list of clinic cards (name, city, distance-free — no ETA/distance claims per the Maps rule) | loading (`SkeletonScope`), empty (`AppStateView.empty` "No clinics yet"), error (`AppStateView.error` + retry), offline (`OfflineBanner`) |
| **Clinic detail** | Header (name, address, hours from `dental_clinics`), `ClinicLocationMap` (single static pin, §2.7), doctor list (cards: photo, name, specialty, "from LKR X" indicative fee via `MoneyText`) | loading/error/empty same pattern |
| **Doctor profile** | Photo, name, specialty (`StatusBadge`-style chip), bio, list of clinics they work at (if >1), "Book" `BlynkButton.primary` | — |
| **Date picker** | Horizontal calendar strip (7–14 days), days with no availability visually dimmed/disabled (from `.../availability`) | loading, "no upcoming availability" empty state |
| **Time slots** | Grid/list of time chips for the selected date (from `.../slots`), tap → hold | loading, empty ("Fully booked — try another day"), a chip disappearing mid-view if it was just taken by someone else (re-fetch on 409) |
| **Hold/appointment details** | `BlynkTextField`s for patient name/phone (prefilled from `AuthProvider.currentUser`/default address), optional short note field, hold countdown ("Reserved for 4:32") | expiry → `AppStateView` "This hold expired — pick a new time" with a retry action back to the slot list |
| **Review** | Reuses the `checkout_screen.dart` skeleton: summary list (clinic, doctor, date/time, patient) + sticky bottom bar with `BlynkButton.primary` "Confirm booking" — **no payment method row, no payment button** | — |
| **Confirmation** | Static confirmation screen (mirrors `order_confirmation_screen.dart`): "Appointment confirmed", clinic/doctor/time summary, "Pay at the clinic" note, "View appointment" / "Done" | — |
| **Appointment detail** | Mirrors `order_summary_screen.dart:285-334` composition: status header → `ClinicLocationMap` → status-history timeline (`appointment_status_history`) → appointment details card → clinic/contact card → conditional cancel section gated by a computed `canCancel` | error/notFound via `AppStateView` |
| **My appointments** | Mirrors `user_orders_screen.dart`: Upcoming/Past sections (Past = derived "completed"/cancelled/expired), guest-gate prompt if signed out, pull-to-refresh, resume-refresh | empty ("No appointments yet" + "Browse clinics" action) |
| **Cancel** | `showAdaptiveSheet` confirmation (reuse pattern from order cancel), reason optional for customer, required for admin-initiated | — |

No fake medical claims, no fabricated ratings/reviews (not built — see §20), no invented wait-time or "10 minute" style promises. Copy follows the existing voice rules (sentence case, no exclamation marks, error copy says what happened and what to do).

---

## 12. Google Maps reuse

Reuses `MapProvider`/`TrackingMapView` exactly as designed for grocery tracking, with **zero** new abstraction:

- New thin widget `ClinicLocationMap({required GeoPoint location})` → builds one `TrackingMapView` with a single `MapMarkerSpec(tone: MapMarkerTone.destination)`.
- No rider marker ever, so the camera never tries to fit a moving pair of points — it just centres on the clinic.
- No routing, no ETA, no geocoding, no Places API (all already forbidden per `docs/06-deployment/google-maps-platform-setup.md:49-54`, and this feature doesn't need any of them — a static pin is enough).
- "Open in Maps" external-navigation handoff (a plain `url_launcher` deep link to `geo:` / Google Maps app) is a reasonable, cheap addition if wanted — it's not part of the `MapProvider` contract at all, just a button that opens the device's own maps app, so it introduces no new map code and no new Maps API usage.
- Inherits the pre-existing, feature-independent caveat from §2.8: not verified rendering on a physical device yet.

---

## 13. Notifications

Reuses the existing outbox/worker/channel infrastructure as-is, with one additive backend change:

| Event | Channel | Timing |
|---|---|---|
| Appointment confirmed | SMS + WhatsApp (existing providers) | immediate, same transaction as the `CONFIRMED` transition |
| Appointment cancelled (either party) | SMS + WhatsApp | immediate |
| Appointment reminder | SMS | scheduled — e.g. 3 hours before `start_at` (exact lead time: open decision, DENTAL-11) |
| Clinic-initiated cancellation | SMS + WhatsApp, with reason | immediate |

**Additive change needed**: thread an optional `scheduled_for` through `EnqueueOptions` → `enqueueNotification()`'s insert (currently hardcoded to `new Date()`), so a reminder can be enqueued at confirm-time with a future `next_attempt_at`. The existing `SELECT ... FOR UPDATE SKIP LOCKED WHERE next_attempt_at <= now()` claim logic already treats a future timestamp correctly — this is genuinely a few-line change, not a new scheduler.

**Cancelling a queued-but-unsent reminder**: if a customer cancels an appointment after its reminder was already enqueued for later, the reminder must not fire. Recommended approach: on cancel, delete/mark-void the queued notification row by its deterministic `idempotency_key` (e.g. `dental_appointment_${id}_REMINDER`) — one small repository method (`voidQueuedNotification(idempotencyKey)`), reusing the existing dedup key shape rather than adding a status-lookup guard at send time.

No email, no push (neither exists today); no new notification system.

---

## 14. Admin / clinic operations

**Phase 1 = Admin-only, no clinic portal**, per §8.1's reasoning.

```
Blynk Admin (apps/admin, existing React app, ADMIN role)
  ↓
New "Dental" section, same pattern as the existing Catalog admin (adminCatalogRouter as the template)
  ↓
Create Clinic → Create/assign Doctors → Set fee per clinic-doctor → Configure weekly availability
  → Add blocked dates (leave/holiday) → Clinic goes live (is_active=true) → visible to customers
```

Minimum admin surface for Phase 1:
- Clinic CRUD (name, address, geo, hours, contact, active flag).
- Doctor CRUD (name, specialty, photo, bio).
- Clinic-doctor assignment + fee + active flag.
- Availability template CRUD (per clinic-doctor).
- Blocked-dates CRUD (per clinic-doctor).
- Appointment list/search (by clinic/doctor/date/status) + admin-cancel with reason.
- Basic reporting: bookings per clinic/doctor per period, cancellation rate, hold-expiry (drop-off) rate — no payment reporting (nothing to report).

No separate `CLINIC_STAFF`/`DOCTOR` role, no clinic login, no per-clinic permission scoping — all deferred to Phase 2 if/when clinic count outgrows admin-managed onboarding.

---

## 15. Security model

The frontend is never authoritative for any of the following; the backend computes/validates all of them:

| Threat | Mitigation |
|---|---|
| IDOR — customer views/cancels another customer's appointment | Every customer-scoped query filters `WHERE customer_id = req.user.id`; ownership re-checked inside the same transaction as any mutation, not just at the route guard |
| Double booking | §7's partial unique index + transactional recheck — the database itself, not application trust |
| Slot/time tampering | `confirm` re-validates the held row's `clinic_doctor_id`/`start_at` server-side; a client can never confirm a time it didn't successfully hold |
| Price manipulation | `consultation_fee_snapshot` is always read server-side from `clinic_doctors` at hold time; the client never sends a fee (mirrors ADR-004's cart-price rule) |
| Appointment enumeration | UUID identifiers (existing convention); list endpoints always customer- or admin-scoped, never a bare "get any appointment by sequential id" |
| Clinic/doctor data isolation | N/A in Phase 1 — there is no clinic-staff login to isolate (§8.1); revisit when Phase 2 adds one |
| Hold-spam / slot-hoarding | Rate limit hold creation per customer (reuse the existing OTP rate-limiter pattern/infrastructure, new limiter instance) |
| Refund abuse | N/A — no payments, no refunds, in Phase 1 |
| Rate limiting generally | Existing Express rate-limit middleware pattern applied to the new routes, same as auth |
| Sensitive info leakage | Patient notes are never returned in list endpoints (only in the single-appointment detail view, and only to its owner or admin) |

Payment-specific threats from the original brief (amount tampering, callback forgery, replayed webhooks) are **not applicable in Phase 1** — there is no payment surface to attack. They become live concerns the moment §11's follow-up plan adds a gateway, and must be designed then, not assumed safe by omission.

---

## 16. Privacy model

**This is explicitly not a medical-record system.** Minimum data collected for booking:

- Patient name, patient phone (both already collectable via the existing account/address model — no new PII category).
- One optional short free-text note ("reason for visit," not a structured field) — capped length, clearly optional, never a required field.

**Explicitly not collected**: medical history, allergies, diagnoses, insurance details, prior treatment records, any structured health data. If a clinic needs that information, it is a conversation the clinic has directly with the patient at the visit — Blynk does not intermediate or store it.

**Who sees what**:
- **Clinic/Admin** (Phase 1, since there's no separate clinic login — admin acts on the clinic's behalf): appointment time, patient name/phone, the optional note.
- **Blynk Admin**: the same, plus aggregate reporting.
- **Other customers**: nothing — no public patient list, no "X people booked this doctor" social proof.
- **Doctor** (has no login in Phase 1): sees nothing directly through the system; the clinic/admin relays what's needed operationally.

No data is retained longer than the existing account-data retention posture already documented for the grocery product (see `docs/06-deployment` privacy notes referenced by the premium-distribution plan) — this feature does not introduce a new retention policy, it inherits the product's existing one.

---

## 17. Android + iOS PWA considerations

- **Backend**: the dental API is plain REST under the existing `/api/v1` prefix, platform-agnostic by construction (ADR-001) — nothing here is Flutter-specific or web-specific.
- **Android (Flutter, existing app)**: this plan's entire Customer-UX section (§11) targets this app. No new Flutter dependency is needed (no map SDK change, no payment SDK — there is no payment).
- **iOS (React + Vite PWA)**: **blocked** on `apps/customer-web/` not existing yet (§2.8) — this plan does not build iOS UI. When that project starts, it consumes the same REST API this plan defines, with no backend changes needed to support it.
- Because there is no payment in Phase 1, the brief's payment-SDK cross-platform concern (Android native SDK vs. web/PWA compatibility) **does not apply yet** — it becomes relevant only alongside §11's future payment plan, at which point the provider's web-checkout/redirect story (works from any mobile browser) is the natural fit for a PWA anyway, and should be weighed explicitly then.

---

## 18. Payment provider research

**Not performed**, per the user's explicit instruction ("don't add payment features now, we can do it later"). No provider was evaluated, no capability or fee was verified, and none should be assumed. When payment work resumes, it needs its own research pass (Sri Lanka gateway comparison — PayHere and similar local options, Stripe/PayPal Sri Lanka availability, webhook/signature verification mechanics, refund APIs, PCI scope) before any design decision is made — that pass was started and deliberately stopped mid-investigation in this session at the user's request, and should be re-run fresh (not resumed from a partial state) when the time comes.

---

## 19. Payment money-flow options

**Not decided**, for the same reason as §18. The three models from the original brief (Blynk-as-intermediary settling to clinics; clinic-direct merchant accounts with Blynk only recording; per-clinic merchant accounts under a Blynk platform umbrella) each carry different KYC, commission, reconciliation, and legal implications that depend on a business decision (does Blynk take a cut? is Blynk a payments intermediary requiring its own compliance posture, or a lightweight booking layer on top of clinics' own payment relationships?) that has not been made. This plan does not guess at it. **DENTAL-02, DENTAL-03, DENTAL-08, DENTAL-13, DENTAL-14 in the decision table (§25) are all marked DEFERRED, not answered.**

---

## 20. Phase 1 vs future scope

### Phase 1 (this plan)

- Clinic discovery (browse/search), clinic detail, doctor profiles.
- Real availability (weekly template + blocked dates), computed on read.
- Hold → confirm booking, with database-enforced double-booking prevention.
- Cancellation (customer + admin-initiated), no refund logic (none needed).
- Confirmation + reminder notifications (SMS/WhatsApp, existing channels).
- Appointment history (upcoming/past), cancel from history.
- Admin CRUD for clinics/doctors/availability/blocked-dates/appointments.
- Clinic location on the existing map abstraction (static pin).
- Security/privacy model as above; concurrency test suite (§22).

### Explicitly future (Phase 2+)

- **Online payment** (gateway selection, checkout, webhooks, refunds) — the deferred half of the original brief.
- Rescheduling (as a first-class action, not cancel+rebook).
- Recurring appointments.
- Doctor reviews/ratings.
- Clinic self-service portal + `CLINIC_STAFF`/`DOCTOR` login roles.
- Variable appointment durations / service types (e.g. cleaning vs. surgery needing different slot lengths).
- No-show tracking (only meaningful once there's a financial or policy consequence to attach to it).
- Automated reminder-timing tuning / multiple reminder touchpoints.
- Multi-branch clinic chains, insurance integration, teleconsultation, prescriptions/medical records (explicitly out of this product's intended scope per the brief — "not a medical-record system").
- Clinic analytics dashboards beyond the basic Phase-1 admin reporting.

Nothing in the future list is allowed to creep into Phase 1's implementation tasks (§26).

---

## 21. Performance / scalability

Initial scale is small (a handful of clinics, a few doctors each, Dharga Town & Beruwala). Per ADR-002 and the brief's own instruction, this plan introduces **no** microservices, Kafka, Kubernetes, event sourcing, Redis, or PostGIS. Availability computation is a handful of indexed queries per request, not a batch job; the only "worker" involved is the existing `setInterval` outbox poller, already running.

**How this scales later without premature infrastructure**: if clinic/doctor count grows large enough that the per-request availability computation becomes slow, the fix is adding an index or narrowing the query window (e.g. cap the calendar lookahead), not a new architecture. If the realtime SSE module (§2's `location-stream.ts`) is ever reused for a "live queue status" feature, its own documented scaling caveat (in-process only, needs a shared broker beyond one container) already applies and is unrelated to this feature's own scaling story.

---

## 22. Test strategy

### Unit
- Availability computation: template + blocked dates + existing bookings → correct candidate slot list (edge cases: doctor with no template that day, fully-blocked date, back-to-back bookings exactly filling the day, buffer-time math).
- Appointment state transitions: every valid transition succeeds; every invalid transition (e.g. `EXPIRED → CONFIRMED`, `CANCELLED_BY_CUSTOMER → HELD`) is rejected.
- Cancellation-cutoff rule: allowed just before the cutoff, rejected just after.

### Integration
- Full booking flow: hold → confirm → appears in "my appointments."
- **Slot locking under real concurrency** (the flagship test, matching the brief's explicit demand): fire two concurrent `POST /holds` requests for the same `(doctor, time)` from two different customers; assert exactly one succeeds with `200`/`HELD` and the other receives `409`. Repeat for the confirm step. Repeat for "hold expired, then a real race for the reclaimed slot."
- Hold expiry reclaim: hold A, let it expire, hold B for the same slot → succeeds.
- Idempotency: retrying the same `POST /holds` with the same `Idempotency-Key` after a simulated timeout returns the same hold, not a duplicate.
- Cancellation: customer-cancel before/after cutoff; admin-cancel any time; slot reopens immediately after either.
- Notification enqueue: confirm → confirmation SMS/WhatsApp enqueued with the right idempotency key; cancel → reminder (if any was queued) is voided.

### Security
- IDOR: customer A cannot view, confirm, or cancel customer B's appointment (403/404, not a data leak).
- Amount/price tampering: N/A this phase (no payment) — explicitly noted as a gap to close in the Phase 2 payment test plan, not silently skipped without a note.
- Slot-time tampering: attempting to `confirm` a `start_at`/`clinic_doctor_id` different from what was actually held is rejected.
- Rate limiting: hold-spam from one account is throttled.

### E2E (Customer app)
- Browse clinics → pick doctor → pick date → pick slot → hold → fill details → review → confirm → see confirmation → see it in "my appointments" → cancel it → see it move to the cancelled state.
- Guest (signed-out) attempting to book is prompted to log in, not shown a raw 401.
- Offline mid-flow shows the existing `OfflineBanner` pattern, not a crash.

### The specific concurrency proof the brief asked for
> TWO customers + ONE slot = ONLY ONE confirmed appointment.

Implemented as an integration test that opens two real, concurrent DB transactions against the hold endpoint (not two sequential calls — genuinely concurrent, using two separate connections/promises resolved together) and asserts the row count for that `(doctor, time)` in `('HELD','CONFIRMED')` never exceeds 1 at any point, and that the loser receives a domain 409, not a hang or a 500.

---

## 23. Observability / reconciliation

Without payment, reconciliation is materially simpler than the original brief's payment-reconciliation scenarios (no "payment succeeded but appointment not confirmed" class of bug can exist yet). What Phase 1 should log/expose:

- **Log every transition** via `appointment_status_history` (id, appointment_id, old_status, new_status, changed_by, created_at) — the same shape as the order-history pattern already reused for the Flutter `OrderTimeline`-equivalent UI.
- **Admin-visible metrics** (extend the existing `/admin/operations/metrics` pattern, no new observability stack): holds created vs. confirmed vs. expired (funnel/drop-off rate — a customer picking a slot and never finishing is a real signal worth watching even without payment), double-booking-attempt rate (409 count on hold/confirm), cancellation rate by actor (customer vs. clinic), booking volume per clinic/doctor.
- **What would need re-adding once payment exists**: the "payment succeeded but appointment not confirmed" / "confirmed but payment missing" / "duplicate webhook" reconciliation views from the original brief — explicitly deferred to the Phase 2 payment plan, not designed here.

No new accounting system, no new logging infrastructure — this reuses the existing admin-operations pattern and the existing DB.

---

## 24. Required documentation / ADRs

New:
- **`docs/03-decisions/adr-005-dental-appointments-phase-1-no-payment.md`** — records the decision to ship booking without payment, the payment seam left in the schema/state-machine, and that payment needs its own follow-up ADR/plan once a provider is chosen. This is the one decision in this plan that genuinely needs an ADR (a real, consequential architectural choice, not just an implementation detail).
- A short module doc under `docs/05-implementation/` once the feature is actually built (report-after-the-fact convention already used for every other module in this repo, e.g. `blynk-customer-orders-report.md`) — not written now, since nothing is built yet.

Existing docs that need updating **when this plan is executed** (not now — this is planning only):
- `docs/01-product/blynk_prd.md` — add a "Dental Clinic Appointments" feature/vertical section.
- `docs/02-architecture/blynk_architecture.md` and `blynk_backend_api_architecture.md` — add the new `modules/dental/` to the module map.
- `docs/02-architecture/blynk_database_design.md` — document the five new tables and the partial unique index alongside the existing schema documentation.
- `docs/04-business/business-rules.md` — add appointment cancellation-cutoff and booking rules, once DENTAL-07/09 etc. are actually decided (not the placeholder values in this plan).
- `docs/05-implementation/implementation-status.md` — add the feature to the status ledger once work starts.

---

## 25. Decision table

D1/D11/D12/D13-style IDs continue the `DENTAL-` sequence from the brief. **DECIDED** rows reflect this plan's recommendation, adopted because the brief said to make a call rather than invent silently where the direction was clear; **OPEN** rows are genuinely business decisions this plan will not guess at; **DEFERRED** rows are payment-related and explicitly out of scope per the user's instruction.

| ID | Decision | Options | Recommended direction | Why | Blocked until decided |
|---|---|---|---|---|---|
| DENTAL-01 | Is Blynk a marketplace/intermediary or only a booking platform? | (a) booking-only, clinic handles payment/commercial terms directly with the patient; (b) Blynk is a commercial intermediary (commission, settlement) | **(a) for Phase 1** (follows directly from "no payment now"); revisit as part of §11's Phase 2 payment plan | Without payment there is no money to intermediate — the question is dormant until then, not answered | Nothing in Phase 1; the eventual payment/commission model in Phase 2 |
| DENTAL-02 | Who receives payment? | Blynk / clinic direct / clinic's own merchant account | **DEFERRED** | No payment exists yet | Phase 2 payment design |
| DENTAL-03 | Payment gateway/provider? | PayHere / others (not evaluated) | **DEFERRED** | Explicitly not researched this pass | Phase 2 payment design |
| DENTAL-04 | Appointment duration model? | fixed per doctor / variable per service | **Fixed per doctor, Phase 1**; variable-per-service is Phase 2 | Matches "do not build a complicated scheduling engine unless necessary"; six specialties don't yet need per-procedure durations to be useful | Nothing — Phase 1 can ship with this |
| DENTAL-05 | Slot generation model? | pre-created rows / generated-on-read / hybrid | **Generated on read from a weekly template** (§9) | No batch job, no new infra, matches ADR-002 | Nothing — decided in this plan |
| DENTAL-06 | Slot hold duration? | any | **5 minutes** (default) | Long enough to fill a short details form, short enough to keep abandoned holds from blocking real bookers | Nothing — easy to tune later, not a schema decision |
| DENTAL-07 | Cancellation policy (cutoff)? | any | **Recommend 2 hours before `start_at`**; genuinely a business call | No payment-backed penalty exists to make the exact number self-enforcing, so this is really a service-quality choice for the business, not an engineering one | Final cutoff value before customer-facing copy is written |
| DENTAL-08 | Refund policy? | — | **N/A / DEFERRED** | No payment, no refunds | Phase 2 payment design |
| DENTAL-09 | Who manages clinics/doctors? | Blynk Admin only / clinic self-service | **Blynk Admin only, Phase 1** (§8.1) | Matches "do not build a clinic portal unless justified"; realistic Phase-1 clinic count is small | Nothing — decided in this plan |
| DENTAL-10 | Do clinics get staff accounts in Phase 1? | yes/no | **No** | Follows directly from DENTAL-09 | Nothing — decided in this plan |
| DENTAL-11 | Reminder channel(s) and lead time? | SMS/WhatsApp; any lead time | **SMS, ~3 hours before**, reusing existing channels | Matches existing infra exactly; WhatsApp could be added identically if wanted | Exact lead time before copy/QA of the reminder message |
| DENTAL-12 | Clinic location/map requirements? | static pin / routing / distance | **Static pin only** (§12), no routing/ETA/geocoding | Matches the existing Maps-usage rules already in force for grocery delivery | Nothing — decided in this plan |
| DENTAL-13 | Does Blynk charge commission? | yes/no/how much | **DEFERRED** | Downstream of DENTAL-01/02, both deferred | Phase 2 payment/business design |
| DENTAL-14 | Does the clinic set the appointment price, or Blynk? | either | **Clinic sets it (via admin-entered `consultation_fee`, shown as "indicative, payable at clinic")**; who *ultimately* prices it once payment exists is a Phase 2 question | The Phase-1 fee is informational only, so the low-stakes default (clinic-supplied number) is safe to ship now without pre-deciding the eventual commercial model | Nothing for Phase 1 display; revisit when payment is designed |
| DENTAL-15 | Can doctors work at multiple clinics? | yes/no | **Yes** — modeled via `clinic_doctors` join (§8.2) | Realistic for Sri Lankan dental practice; costs nothing extra in the schema | Nothing — decided in this plan |
| DENTAL-16 | Can customers reschedule in Phase 1? | yes/no | **No** — cancel and rebook instead | Keeps the state machine to five states instead of adding a reschedule-linked-pair concept; can be added later without breaking the model | Nothing — decided in this plan |
| DENTAL-17 *(new)* | Without payment, is a `HELD`→`CONFIRMED` booking a real commitment or a casual reservation? | enforce nothing extra / require some non-payment commitment (e.g. OTP re-confirm) | **No extra commitment mechanism in Phase 1** — booking is reservation-based, backed only by the SMS/WhatsApp confirmation and a reasonable cancellation policy | Adding artificial friction (e.g. a second OTP) to compensate for "no payment" contradicts the instruction to keep this simple; revisit if no-show rates prove to be a real problem once the feature ships | Nothing — decided in this plan; monitor via §23's metrics |

---

## 26. Implementation phases

Each phase is independently shippable/testable; later phases depend on earlier ones. No payment phase is included — it is a separate future plan, not phase-numbered here.

- **Phase 0 — Decisions.** Resolve DENTAL-07 and DENTAL-11's exact values (the only two genuinely open, low-risk business calls left); confirm the entry-point location in the Home/Profile UI with the user. *Deliverable: this table's OPEN rows closed.*
- **Phase 1 — Database + backend foundation.** New migration: `dental_clinics`, `doctors`, `clinic_doctors`, `doctor_availability`, `doctor_blocked_dates`, `appointments` (+ the partial unique index), `appointment_status_history`. Repository layer following the existing Kysely pattern. *Acceptance: schema matches §8/§9, migration has a matching `_down.sql`, no application code paths touch it yet.*
- **Phase 2 — Availability computation.** `GET /dental/clinics`, `/clinics/:id`, `/clinics/:id/doctors`, `/doctors/:id`, `/doctors/:id/availability`, `/doctors/:id/slots` — read-only, no booking yet. *Acceptance: unit tests from §22's "Unit" section pass; a hand-built availability template produces the exact expected slot list including blocked-date and buffer-time edge cases.*
- **Phase 3 — Booking / locking.** `POST /dental/appointments/holds`, `POST /dental/appointments/:id/confirm`, `POST /dental/appointments/:id/cancel`, `GET /dental/appointments[/:id]` — the lifecycle module (§5, §7). *Acceptance: the flagship concurrency test (§22) passes; idempotency-key replay verified; every state transition table row (§5.2) has a passing test and every non-listed transition has a failing-as-expected test.*
- **Phase 4 — Customer Flutter UI.** All screens in §11, `ClinicProvider`/`AppointmentProvider` (Provider+Dio pattern), `ClinicLocationMap` wrapper, new route cases, entry point wired into Home/Profile. *Acceptance: widget tests per existing repo convention (loading/empty/error/offline states, 200%-text-scale, semantics), the E2E flow in §22 passes against a real backend.*
- **Phase 5 — Admin UI.** New "Dental" section in `apps/admin` (clinic/doctor/availability/blocked-dates CRUD, appointment list + admin-cancel). *Acceptance: an admin can, end to end, stand up a new clinic with a doctor and a working-hours template, and it becomes bookable in the Customer app.*
- **Phase 6 — Notifications.** The `scheduled_for` additive change (§13), confirmation/cancellation/reminder wiring, the queued-reminder-void-on-cancel path. *Acceptance: confirm → SMS/WhatsApp received in a test environment; a scheduled reminder actually fires at the scheduled time in a worker-integration test; cancelling before the reminder fires voids it.*
- **Phase 7 — E2E / security / docs.** Full E2E suite (§22), IDOR/rate-limit security tests, ADR-005 written, docs listed in §24 updated. *Acceptance: everything in §22 green; docs updated; feature considered Phase-1-complete and ready for the user to decide when to resume payment work (§11).*

---

## 27. Dependencies / blockers

- **None of this plan's own work is blocked on anything.** It can start as soon as the user approves the decision table.
- **Pre-existing, unrelated blockers this feature inherits but does not cause**: Google Maps device verification (§2.8) — affects only whether the clinic-map-pin can be *demonstrated* on a real phone, not whether it can be built/tested; Android release signing/applicationId (D2, tracked elsewhere) — affects only shipping to Play Store, not this feature's development.
- **iOS PWA dental UI is blocked** on `apps/customer-web/` starting to exist — out of this plan's control.
- **Product/business input needed, outside engineering**: which real clinics participate at launch (the brand already committed to "Dharga Town & Beruwala" in customer-facing marketing); the exact cancellation cutoff and reminder lead time (DENTAL-07/11).
- **Payment work is explicitly parked**, not blocked — it can resume at any time as its own scoped plan once the user is ready, per §18.

---

## 28. Estimated implementation complexity by phase

Rough, non-committal sizing (S/M/L) for planning conversation only — not a schedule.

| Phase | Size | Why |
|---|---|---|
| 0 — Decisions | S | Two small business calls |
| 1 — DB/backend foundation | S–M | Six tables, one index, standard repository boilerplate following an established pattern |
| 2 — Availability computation | M | The template math (buffers, blocked dates, day-of-week) needs careful edge-case testing even though it's "just" read queries |
| 3 — Booking/locking | M | Conceptually well-understood (copies an existing pattern), but concurrency code always deserves careful review and the flagship test needs to be genuinely concurrent, not simulated |
| 4 — Customer Flutter UI | L | Most screens by count (9–10), even though each one reuses existing components heavily |
| 5 — Admin UI | M | Standard CRUD screens, existing admin patterns to copy |
| 6 — Notifications | S | One additive backend field + wiring three existing message types |
| 7 — E2E/security/docs | M | Breadth of test scenarios (§22) plus doc updates |

**Overall**: a medium-sized feature — smaller than it would be with payment included, specifically because §18/§19 were deliberately parked. Nothing here requires new infrastructure, new dependencies, or architectural exceptions to the existing ADRs.

---

## Appendix: sources

Backend findings: `backend/api/src/modules/{auth,orders,payments,notifications,admin,users}/**`, `backend/api/src/middleware/**`, `backend/api/src/database/{types.ts,migrations/001_initial_schema.sql}`, `backend/api/src/app.ts`, `docs/02-architecture/blynk_database_design.md`, `docs/03-decisions/adr-{001,002,003,004}-*.md`, `docs/04-business/business-rules.md`.

Customer app findings: `apps/customer/blinkit-clone-Flutter-ecommerce-/lib/{Screens,Models,Services,UI,design}/**`, `docs/07-design/blynk-customer-design-system.md`, `docs/01-product/blynk_prd.md`, `docs/02-architecture/blynk_architecture.md`, `docs/06-deployment/{google-maps-platform-setup.md,customer-android-build-status.md}`, `docs/superpowers/plans/2026-09-21-blynk-customer-premium-distribution.md`.

One Graphify query (`orders lifecycle locking payments notifications outbox dark_stores auth role RBAC`) confirmed the module graph (payments router isolation, notifications worker, orders lifecycle guard tests, admin app) independently of the two read-only investigations above.

Payment-provider research: not performed, per user instruction mid-session (§18).
