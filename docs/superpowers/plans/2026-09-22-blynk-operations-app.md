# Blynk Operations App — Unified Admin + Rider + Dental Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, once it is approved and a separate implementation pass is explicitly authorized. This document is planning only — see §31 "Final rule."

**Goal:** Design a new standalone `apps/operations` application letting one authorized Blynk operator perform business/admin work, rider/delivery work, and dental-clinic administration from a single mobile-first app, without touching or weakening `apps/admin`, `apps/rider`, or `apps/inventory`.

**Architecture:** A new independent React 18 + Vite + TypeScript app, structurally identical in shape to `apps/admin`/`apps/rider`/`apps/inventory` (own `api/client.ts`, own `auth/AuthContext.tsx`, own `styles.css`, own port, own token namespace — the established, three-times-repeated pattern in this monorepo), consuming existing backend REST endpoints directly. The one operator holds a single `users` row with `role='ADMIN'` (unlocking every existing ADMIN-gated capability, including dental admin, with **zero** backend change) plus an optional linked `riders` row (0-or-1, exactly like any other rider) for delivery capability, unlocked by a small, explicit, additive widening of the rider-route role-guards from `requireRoles('RIDER')` to `requireRoles(['RIDER','ADMIN'])` in the small number of places that check it — never a frontend-only pretense of capability.

**Tech Stack:** React 18, Vite 5, TypeScript, react-router-dom, the existing Node/Express/Kysely/PostgreSQL backend (`backend/api`), the existing bearer-JWT + OTP auth system, the existing per-domain audit-trail pattern (`*_by_user_id`/`changed_by` FK columns).

**Spec:** This document is self-originating — the user's own 33-section investigation brief (reproduced/answered section-by-section below) is the spec. Source of truth for the already-implemented dental backend: `docs/superpowers/plans/2026-09-22-blynk-dental-clinic-appointments.md`, cross-checked against the actual implementation (`backend/api/src/modules/dental/`, task reports in `.superpowers/sdd/2026-09-22-blynk-dental-clinic-appointments/`) wherever the two differ.

## Global Constraints

- Do NOT modify `apps/admin/`, `apps/rider/`, or `apps/inventory/` source code, ever, in this plan or its implementation.
- Do NOT merge any existing app's source into Operations; do NOT import across app boundaries (no `apps/operations` importing from `apps/admin/src/...`).
- Do NOT weaken any existing role guard. Every backend change is additive (widens an allow-list) or entirely new (a new route), never a removal or relaxation of an existing check.
- Do NOT introduce new infrastructure: no Redis, no Kafka, no microservices, no WebSockets, no new databases, no capability/permission engine, no event sourcing.
- Do NOT invent a business decision. Every open question is logged in §30 as OPEN, not silently answered.
- Reuse the existing JWT/OTP auth, the existing single-`role`-column RBAC model, the existing per-domain audit pattern, the existing `MapProvider`-equivalent conventions where genuinely reusable, and the existing outbox notification system.
- This is planning only: no application code, no backend code, no migrations, no dependency installation, no commits, no pushes. The only repository change from this task is this document.

---

## 1. Executive summary

The current Blynk backend has a **strictly single-role-per-user** authorization model: one Postgres enum column (`users.role`), one JWT claim, checked twice independently (route middleware `requireRoles()` and a second, separate check inside the order-lifecycle engine). There is **no** capability/permission system, **no** multi-role table, and **no** precedent anywhere in the three existing frontend apps (Admin, Rider, Inventory) for one session holding two roles or two tokens.

Despite that, the cleanest, most secure, least-invasive design for "one operator, both admin and rider capability" turns out to require only a **small, explicit, additive backend change** — not a new role, not a new permission system, not a schema migration, not two identities. The operator is a single `users` row with `role='ADMIN'` (which alone unlocks every admin capability including the just-shipped dental admin module, with zero backend change), optionally linked to a single `riders` row exactly like any other rider (the schema already permits this — `riders.user_id` has no constraint requiring the linked user's role to be `RIDER`). The **only** backend change needed is widening the rider-delivery route guards and the lifecycle engine's rider-transition role checks from `requireRoles('RIDER')` to `requireRoles(['RIDER','ADMIN'])` — a pattern already used elsewhere in this codebase (`requireRoles(['ADMIN','PACKING_STAFF'])`), touching roughly 5-8 call sites, never removing or loosening anything an existing RIDER-only user relies on.

This is recommended over a new `OPS` role (large blast radius — every ADMIN- and RIDER-gated route across the whole backend would need updating), a capability-permission engine (zero precedent, real over-engineering for one operator), and a dual-session/dual-token design (zero precedent, and it actively **fragments the audit trail** across two `user_id`s for one physical person — the opposite of what §20's audit requirement wants).

The new `apps/operations` app is a new, independent React+Vite+TypeScript app — the fourth in a row built this way, following the exact structural precedent of Admin/Rider/Inventory (each has its own copy of a ~150-line `apiRequest`/token-store/`AuthContext`/`Layout` pattern; there is no shared package to extract from or depend on). It reuses backend endpoints Admin, Rider, and the dental admin module already expose, with the only genuinely new backend surface being (a) the RBAC widening above and (b) an admin rider-management CRUD API that **does not exist today in any form** (currently a rider can only be created by direct DB seeding).

## 2. Current architecture findings

**Monorepo shape**: no root `package.json`, no workspaces tool, no `packages/` directory. `apps/{admin,customer,inventory,rider}` are four fully independent projects. `apps/admin`, `apps/inventory`, `apps/rider` are React 18 + Vite 5 + TypeScript, each on its own fixed dev port (`5173`/`5174`/`5175`, `strictPort: true`), each in the backend's `CORS_ORIGINS` allowlist (`backend/api/.env.example:49`). `apps/customer` is Flutter.

**Auth**: pure bearer-JWT, OTP-based login (no passwords). Access token: HS256, 15 min TTL, payload `{sub, phone, role}` — one scalar `role`, nothing else (`backend/api/src/modules/auth/token.service.ts:8-12,17-28`). Refresh token: **not** a JWT — an opaque random token (`crypto.randomBytes(40)`), hashed and stored in `refresh_tokens` (`token.service.ts:67-71`; `001_initial_schema.sql:185-194`), 30-day TTL, single-use rotation with breach detection (revoke-all-on-reuse, `auth.service.ts:221-287`). `requireAuth` (`middleware/auth.middleware.ts:25-50`) sets `req.user = {id, phone, role}`; `requireRoles(...roles)` (`middleware/role.middleware.ts:9-28`) does scalar membership (`allowedRoles.includes(req.user.role)`) and already accepts an array (used today as `requireRoles(['ADMIN','PACKING_STAFF'])` in several admin routes) — this is the exact mechanism this plan reuses for the Operations RBAC widening.

**RBAC has two independent enforcement points, not one**: (1) route middleware `requireRoles()`; (2) the order-lifecycle engine's own check, `entry.roles.includes(req.actor.role)` (`modules/orders/lifecycle/engine.ts:30-35`, `Actor = {id, role}` at `lifecycle/types.ts:16-19`). Any change touching rider-triggered order transitions must update **both** — they are duplicated, currently-consistent, single-role assumptions, not one shared source of truth.

**`UserRole` enum**: `'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN'` (`database/types.ts:3`; Postgres enum `001_initial_schema.sql:15`). One column on one `users` table (`users.role`, `001_initial_schema.sql:164`). A user has **exactly one** role today; `users.phone` is `UNIQUE` so one phone maps to one `users` row. There is no `user_roles`/capability/permission/scope table anywhere — an exhaustive grep of `backend/api/src` for those terms returned zero RBAC hits (only unrelated English usage in comments).

**`riders` table**: `id, user_id UUID NOT NULL UNIQUE REFERENCES users(id), dark_store_id NOT NULL, vehicle_type, vehicle_registration_number, emergency_contact_phone, is_available (dead/unused — nothing reads or writes it), is_active, created_at, updated_at` (`001_initial_schema.sql:418-429`). **`user_id` is `UNIQUE`** — the database itself forbids more than one `riders` row per `users` row; this is a hard 0-or-1 relationship, not an application convention. Nothing in the schema requires the linked user's `role` to be `RIDER` — a `riders` row can technically point at an `ADMIN`-role user today with no constraint violation; the only reason that combination doesn't currently work end-to-end is that every rider-scoped **route** is gated `requireRoles('RIDER')` before the rider-profile lookup ever runs.

**Rider identity resolution**: the JWT/`/auth/me` response carries **no `riderId`** at all (`token.service.ts` payload; `apps/rider/src/api/types.ts:9-14`). Every rider-scoped call resolves "my rider profile" server-side, fresh, via `riderRepository.findRiderByUserId(req.user.id)` (`rider.service.ts:15-24`) — never cached client-side, never taken from the request. No profile → `403 RIDER_PROFILE_NOT_FOUND`; `is_active=false` → `403 RIDER_INACTIVE`. This is a significant, favorable fact for the Operations design: **the moment an ADMIN-role user's route guard is widened to allow them through, the exact same ownership-resolution machinery that already protects every other rider "just works" for them too** — no riderId needs to be threaded through any new code.

**IDOR guard on delivery routes**: uniform and consistent everywhere it was checked — every delivery read/write filters `WHERE rider_id = <resolved from token's user id>`; a wrong-rider or malformed id returns `404 DELIVERY_NOT_FOUND`, **never** `403` (so existence is never disclosed) — both in plain queries (`rider.repository.ts`) and in the lifecycle engine's locked path (`lifecycle/engine.ts:86-97`, `lockFor` case `'riderDelivery'`: `SELECT ... WHERE id=:deliveryId AND rider_id=:riderId FOR UPDATE`).

**Delivery lifecycle** (rider-triggered): `riderPickup` (delivery `ASSIGNED|ACCEPTED` + order `PACKED` → delivery `PICKED_UP`, order `OUT_FOR_DELIVERY`), `riderArrive` (→ `ARRIVED_AT_CUSTOMER`), `riderFail` (→ `FAILED`, with reason), `riderCollectCod` (→ `DELIVERED`, amount re-validated **under the row lock** against the live order total, not a stale client-supplied figure) — all in `modules/orders/lifecycle/actions/rider.ts`, all wrapped in one `db.transaction()` with child-before-parent row locking (`lifecycle/engine.ts:27,41-50`). Endpoints: `GET/PATCH /riders/deliveries[/:id[/status]]`, `POST /riders/deliveries/:id/collect-cod`, `POST /riders/deliveries/:id/location` — router double-mounted at both `/rider` and `/riders` (`backend/api/src/app.ts:134-135`), all `requireAuth + requireRoles('RIDER')` today (`modules/riders/index.ts:18-51`).

**Rider assignment / double-booking prevention**: `assignRider` (`modules/orders/lifecycle/actions/admin.ts:19-59`, `ADMIN`-only) — pre-check + insert + catch Postgres `23505` on a **partial unique index**, `uq_deliveries_active_assignment ON deliveries(order_id) WHERE assignment_status NOT IN ('FAILED','REJECTED')` (`001_initial_schema.sql:449-452`). This is the exact pattern the dental module's `uq_appointments_active_slot` was explicitly modeled on (cited by name in `007_dental_clinic_appointments.sql`).

**Live location tracking**: write endpoint `POST /riders/deliveries/:id/location`, ownership-checked the same way, trackable window = `assignment_status='PICKED_UP' AND order_status='OUT_FOR_DELIVERY'` (re-read fresh every call, not cached), atomic conditional `UPDATE ... WHERE (location_captured_at IS NULL OR location_captured_at < $new)` (no explicit transaction needed), 5s rate floor, 60s future-skew cap, 5min stale-broadcast threshold. Customer-facing read side is an in-process SSE broadcaster (`modules/realtime/location-stream.ts`, single-container only — a known, documented limitation, not something to "fix" for Operations). Tracking is tied to the **delivery lifecycle state**, not to any app-level "mode" concept — this is important for §9/§21 below. **The rider app itself has no map** (confirmed: zero map-library dependency, zero map-related source file) — it shows only a text status readout (`TrackingStatus.tsx`), never a coordinate. The only map abstraction (`MapProvider`) in the whole monorepo lives in the Flutter customer app and is not portable to a React/web app as-is.

**Audit trail**: every actor-tracking column found across the whole schema (`order_status_history.changed_by_user_id`, `orders.cancelled_by_user_id`, `inventory_adjustments.created_by_user_id`, `sourcing_records.sourced_by_user_id`, `doctor_blocked_dates.created_by`, `appointments.held_by`/`cancelled_by`, `appointment_status_history.changed_by`) is a direct FK to `users.id` — consistently traceable to one authenticated identity, never a free-text field, never a second identity table. **Important gap**: the schema has a dedicated `audit_logs` table (`001_initial_schema.sql:479-490`) that is **defined but has zero writers anywhere in the code** — the real "audit trail" today is entirely these per-domain FK columns, not a generic log. This matters directly for §20: whatever Operations does, "who did this" is answered by the same `user_id` already flowing through these columns — provided the operator is genuinely one `user_id`, not two.

**No admin rider-management exists today, in any form.** `GET /admin/riders` (admin-only) is read-only, unfiltered, active-riders-only, exists solely to populate the "assign rider" picker dialog. There is no route to create, activate, deactivate, or edit a rider anywhere in the backend — riders exist only via direct DB seeding (`backend/api/src/database/seeds/dev_seed.ts`). This is a genuine gap Operations will need to either fill (new backend endpoints) or explicitly leave out of Phase 1 (see §14, §26).

**Frontend conventions**: Admin, Inventory, and Rider each independently re-implement the same ~150-line pattern (`api/client.ts` with a single `apiRequest<T>()`, single-flight 401-refresh, `ApiError` class; `auth/AuthContext.tsx` with an OTP flow and a client-side-only role allow-list check; `components/Layout.tsx` nav shell; own `styles.css`) under their own `localStorage` token-key namespace (`blynk.admin.*` / `blynk.inventory.*` / `blynk.rider.*`) and own dev port. This is **not** accidental duplication to be "fixed" — the Inventory implementation report explicitly documents this as a deliberate non-extraction ("a shared package would have meant restructuring the Admin app, which this phase must not touch; for about 150 lines that isn't worth it"), and the pattern has now been used three times without extraction. **Operations should follow the same precedent**: its own copy of the pattern, its own token namespace (`blynk.operations.*`), its own port, never an import from `apps/admin` or `apps/rider`.

**Design system**: no shared CSS/token file across the React apps — each has its own `styles.css`, sharing only brand primitives (Blynk Yellow `#ffe141`, Green `#0c831f`, Catamaran typeface, 4px radius) by convention/copy-paste, not by import. Admin's own comment describes itself as "a dense internal tool," Inventory's as "the ledger" (numbers-first, mono type). Operations should establish its own similarly-scoped visual identity — reusing the brand primitives, not copying either app's specific styling wholesale, and explicitly **not** modifying either source file to "share" anything.

**Deployment**: no production deployment documentation exists for *any* frontend app today (`docs/06-deployment/deployment.md` is entirely backend/Docker-focused). Operations establishes no new precedent here beyond what Admin/Inventory/Rider already lack — its `npm run build` (`tsc -b && vite build`) produces a static `dist/`, same as the other three, and production hosting is an open question for all four, not something this plan needs to solve.

## 3. Existing Admin/Rider capability map

**Admin app** (`apps/admin`, port 5173, `AdminOnly`/`RequireOperations` client-side gates, `OPERATIONS_ROLES=['ADMIN','PACKING_STAFF']`):

| Route | Backend calls | Roles |
|---|---|---|
| `/` Dashboard | `GET /admin/dashboard` | ADMIN only |
| `/orders` | `GET /admin/orders[?status=...]`, `GET /admin/orders/:id`, `PATCH /admin/orders/:id/status`, `POST /admin/orders/:id/assign-rider` | ADMIN + PACKING_STAFF (assign-rider and several status transitions are ADMIN-only within this page, enforced client-side by `apps/admin/src/lib/orders.ts:90-104`'s rule table, and server-side by the lifecycle catalogue) |
| `/products`, `/products/new`, `/products/:id`, `/categories`, `/promotions` | `GET/POST/PATCH /admin/{products,categories,promotions}`, `PATCH /admin/promotions/reorder`, `DELETE /admin/promotions/:id`, `POST/DELETE /admin/media` | ADMIN only |
| `/dental/clinics`, `/dental/clinics/:clinicId`, `/dental/clinic-doctors/:clinicDoctorId`, `/dental/doctors`, `/dental/appointments` | `/admin/dental/*` (clinics, doctors, clinic-doctor pairings, availability, blocked dates, appointment list + admin-cancel) | ADMIN only |

Admin does **not** own: order-item sourcing/resolve-unavailable (Inventory-only), any rider create/activate/deactivate/edit capability (doesn't exist anywhere).

**Rider app** (`apps/rider`, port 5175, Capacitor-wrapped for Android background location, `RequireRider` client-side gate checking `role==='RIDER'`):

| Route | Backend calls | Notes |
|---|---|---|
| `/` Queue | `GET /riders/deliveries` | Assigned-delivery list, ~30s poll-based revalidation |
| `/deliveries/:id` Delivery | `GET /riders/deliveries/:id`, `PATCH /riders/deliveries/:id/status`, `POST /riders/deliveries/:id/collect-cod`, `POST /riders/deliveries/:id/location` | Pickup/arrive/fail/COD-collect actions, tied to the delivery state machine in §2; location posting only while trackable |

**Inventory app** (`apps/inventory`, port 5174, `INVENTORY_ROLES=['ADMIN','PACKING_STAFF']`, distinct capability matrix from Admin via `auth/can.ts`): stock list/detail/adjust/tracking-mode, ledger, order-sourcing queue (source-item, resolve-unavailable), suppliers CRUD (no delete). Not relevant to Operations' rider/dental scope, but its order-sourcing capability is the one thing Admin's own Orders page does *not* cover — noted for completeness; **out of scope for Operations Phase 1** unless OPS-04 decides otherwise (see §30).

## 4. Existing Dental capability map

Fully implemented this session (source of truth: `docs/superpowers/plans/2026-09-22-blynk-dental-clinic-appointments.md`, actual implementation in `backend/api/src/modules/dental/`). Seven tables: `dental_clinics`, `doctors`, `clinic_doctors`, `doctor_availability`, `doctor_blocked_dates`, `appointments`, `appointment_status_history`. Admin-facing endpoints, all `requireAuth + requireRoles('ADMIN')` (`modules/dental/index.ts`, mounted at `/admin/dental` by `modules/admin/index.ts:33`):

- Clinics: `POST/GET/PATCH /admin/dental/clinics[/:id]` (no hard delete — `is_active` toggle only).
- Doctors: `POST/GET/PATCH /admin/dental/doctors[/:id]` (same, no hard delete).
- Clinic-doctor pairings: `POST /admin/dental/clinics/:id/doctors`, `PATCH /admin/dental/clinic-doctors/:id`, `GET /admin/dental/clinics/:id/doctors` — with real relationship validation (rejects inactive/missing clinic or doctor, rejects duplicate pairing).
- Availability: `POST/GET/PATCH/DELETE` on `/admin/dental/clinic-doctors/:id/availability[/:availId]` — cross-validated against the parent clinic's operating hours.
- Blocked dates: `POST/GET/DELETE /admin/dental/clinic-doctors/:id/blocked-dates[/:blockedId]`.
- Appointments: `GET /admin/dental/appointments?clinic_id=&doctor_id=&status=&from=&to=` (includes a derived `is_expired_hold` flag for stale HELD rows — the DB status stays raw `HELD`, this is a display-only derivation, not a stored state); admin-cancel is `POST /admin/dental/appointments/:id/cancel` — owned by the booking module (`appointment.controller.ts`), not the admin CRUD module, requires a `reason`, no ownership restriction, allowed from `HELD` or `CONFIRMED`, no time cutoff.

Customer-facing booking endpoints (`requireRoles('CUSTOMER')`) are **out of scope for Operations** — Operations manages the supply side (clinics/doctors/availability) and views/cancels appointments; it never books one as a patient.

**Since Operations' operator holds `role='ADMIN'`, every one of these endpoints is already reusable with zero backend change** — this is the most directly "free" capability area of the whole app.

## 5. Proposed Operations App architecture

New directory `apps/operations/`, React 18 + Vite 5 + TypeScript, following the Admin/Inventory/Rider precedent exactly:

- `src/api/client.ts` — own `apiRequest<T>()`, own token store (`blynk.operations.accessToken`/`blynk.operations.refreshToken` in `localStorage`), single-flight 401-refresh, `ApiError` class. A fresh implementation, not an import from any existing app.
- `src/api/resources.ts` — typed wrappers over the exact backend endpoints listed in §3/§4/§26, grouped by domain (`auth`, `orders`, `riders` (both the assign-picker read and the new rider-management CRUD from §26), `catalog`, `dental`).
- `src/auth/AuthContext.tsx` — OTP login (`requestOtp`/`verifyOtp`), restores session via `GET /auth/me`, client-side role gate `OPERATIONS_ROLES=['ADMIN']` (a courtesy check only, exactly like Admin's own comment says about its equivalent — the backend is authoritative). No dual-token logic — one token, one role, exactly like every other app; "delivery capability" is not a second token, it's simply whether the account's linked `riders` row lets specific already-widened routes succeed (§6).
- `src/components/Layout.tsx` — mobile-first shell (bottom tab bar, not a desktop sidebar — a deliberate deviation from Admin's sidebar-first layout per the user's explicit "avoid... a giant desktop admin dashboard squeezed onto mobile" instruction), with the Operations/Delivery mode switch as a UI-only concept (§21).
- `src/pages/` — one file per screen, mirroring Admin/Dental's existing page-per-route convention.
- `vite.config.ts` — new fixed port, e.g. `5176` (`strictPort: true`, matching the established one-port-per-app convention; add to `backend/api/.env.example` `CORS_ORIGINS` and `.env`, the only backend-adjacent change needed to stand the app up at all — same as when Inventory was added).
- Routing: `react-router-dom`, same library every other app already uses.
- State management: plain React state + the same `useLoad`/`useRevalidate`-style hooks Rider already uses for poll-based list refresh — no new state library.
- Responsive behavior: mobile-first single-column layout as the primary target; graceful scaling to tablet/desktop reusing the same CSS techniques Admin/Inventory already use for their own responsive concerns, but never designed desktop-first.

**No shared package is created.** Per §2's finding, there is no existing shared code to extract from, and creating a first-ever `packages/` directory is explicitly out of scope for this plan (a future refactor, not required here) — Operations copies the pattern, exactly as Inventory and Rider each did before it.

## 6. Authentication/RBAC recommendation

Evaluated against the user's own criteria (security, implementation complexity, compatibility with existing Admin/Rider, future scalability, auditability, IDOR protection, least privilege, migration impact, ability to identify the actual rider, ability to identify who performed admin actions):

| Option | Security | Complexity | Compat. w/ existing apps | Auditability | Migration impact | Verdict |
|---|---|---|---|---|---|---|
| **A. New `OPS` role** | Good if done fully, but large surface to get right — every ADMIN- and RIDER-gated route (dozens) plus the lifecycle engine's catalogue would need the new role added | High — touches nearly every `requireRoles()` call site in the backend | No existing-app impact if done correctly, but easy to miss a route | Fine (still one `user_id`) | New enum value, wide blast radius of call-site edits | Viable only if Operations needs a *restricted subset* of ADMIN's powers (see OPS-04) — otherwise strictly more work than B for no security gain |
| **B. Existing ADMIN role + linked rider profile (RECOMMENDED)** | Strong — backend explicitly authorizes each capability at the route it's needed, reuses every existing ownership/IDOR check unmodified | Low — ~5-8 additive `requireRoles([...])` call-site widenings (route middleware + lifecycle catalogue's rider-transition `roles` arrays), zero schema change | Zero impact on Admin or Rider app behavior; RIDER-only users completely unaffected | **Best** — one `user_id` end-to-end, every existing `*_by_user_id`/`changed_by` column already traces correctly | None — `riders.user_id` already permits linking to any user regardless of that user's `role` | **RECOMMENDED for Phase 1** |
| **C. Capability-based permissions** | Would be strong once built, but zero existing precedent — a whole new subsystem | Very high — new table/middleware, migrate every route eventually to stay consistent | No impact if additive, but real engineering investment | Fine, same one-`user_id` property as B | New table + migration + new middleware layer | Over-engineered for one operator; revisit only if Operations grows into a genuine multi-operator, multi-permission-tier product (ties to OPS-12) |
| **D. Separate operations identity/session** | Weaker on the metric that matters most here — two `user_id`s for one physical person | Medium-high — dual-token session management, mode-switch-triggers-reauth UX, zero precedent to build on | No impact on other apps, but invents a session pattern nothing else in the repo does | **Worse** — fragments the audit trail across two identities for the same person, directly working against §20's requirement | Requires provisioning + maintaining two separate `users` rows per operator | Not recommended |
| **E. Other** | — | — | — | — | — | No option beats B given the schema facts found; not pursued further |

**Recommendation: Option B.** One `users` row (`role='ADMIN'`) is the operator's single identity everywhere — admin dashboard, catalog, dental, order actions, and (once the small backend widening below ships) delivery actions. A single, optional, linked `riders` row (created the same way any rider is created — see the gap noted in §14/§26) gives them delivery capability. The **only** backend change (§26) is:

1. In `backend/api/src/modules/riders/index.ts`: widen `requireRoles('RIDER')` to `requireRoles(['RIDER','ADMIN'])` on the five rider routes (`GET /deliveries`, `GET /deliveries/:id`, `PATCH /deliveries/:id/status`, `POST /deliveries/:id/collect-cod`, `POST /deliveries/:id/location`).
2. In the order-lifecycle catalogue (wherever `rider.ts`'s actions declare their `roles: ['RIDER']` entries — `modules/orders/lifecycle/catalogue.ts` or equivalent), widen those specific entries to `['RIDER','ADMIN']` too, since the engine's own check is independent of the route middleware (§2).

Nothing else changes. An ADMIN-role user with **no** linked `riders` row still gets `403 RIDER_PROFILE_NOT_FOUND` the instant they try a rider action (exactly the existing behavior for any user without a rider profile) — this widening creates no blanket "every admin can now do rider things" hole, only an opt-in one for whichever specific identity is deliberately provisioned with both.

## 7. Rider identity model

Because rider identity is resolved server-side from `req.user.id` on every call and never appears in the token (§2), the model is simple and requires no new concept:

- **Operator logs in** → gets a standard access token with `role='ADMIN'`, exactly like today.
- **Entering Delivery Mode** in the Operations UI is a **pure navigation/UX event** — it does not re-authenticate, does not fetch a second token, does not call any new "become a rider" endpoint. It simply routes to the delivery screens and lets their existing `GET /riders/deliveries` etc. calls succeed or fail based on what the backend already knows.
- **First delivery-scoped call** (e.g. loading the delivery queue) resolves the operator's `riders` row via the same `findRiderByUserId` lookup every rider already goes through. Three outcomes, all already-implemented backend behavior:
  - No linked `riders` row → `403 RIDER_PROFILE_NOT_FOUND`. Operations' Delivery Mode should show a clear, honest empty/error state ("No rider profile is linked to this account yet") rather than pretending Delivery Mode is available — this is the "operator has no rider profile" case from §4 of the brief, now answered: **it's just the existing 403, surfaced with Operations-appropriate copy, not a new backend concept.**
  - Rider profile `is_active=false` → `403 RIDER_INACTIVE`, same treatment.
  - Rider profile active → Delivery Mode works exactly like the Rider app, calling the same endpoints.
- **"Operator has multiple rider profiles"**: structurally impossible today (`riders.user_id UNIQUE`, DB-enforced) — not an application concern to handle, a schema fact to document. If the business ever needs one operator to be a rider at multiple dark stores, that requires a schema change (dropping the `UNIQUE` constraint and rethinking `dark_store_id NOT NULL` on `riders`) — explicitly **out of scope**, logged as OPS-03.
- **"Another rider is logged into the normal Rider App"**: no conflict — Operations and Rider use independent token namespaces (`blynk.operations.*` vs `blynk.rider.*`) and, if the operator's `riders` row is the *same* row a separate physical rider account might otherwise use, that's a provisioning question (don't link one `riders` row's `user_id` to an identity someone else also logs in as) — not a technical race, since `riders.user_id` is unique per account already. If the *operator themself* is also signed into the Rider app in a second browser/device with the *same* account, both sessions would resolve to the same rider profile and the same underlying `deliveries` rows — this is no different from a normal rider signing into two devices today (not specially handled by the current system; not a new problem Operations introduces).
- **"Operator signs out" / "operator switches modes"**: signing out clears the one Operations token pair, same as any app. Switching modes is nothing more than client-side navigation — **it must never look like or be implemented as a re-authentication step**, per the brief's explicit instruction that mode is a UX concept, not a security boundary.

## 8. Operations navigation

Bottom-tab, mobile-first (not Admin's desktop sidebar):

```
[Home] [Orders] [Delivery] [Catalog/Dental] [More]
```

- **Home**: the operational dashboard (§9).
- **Orders**: Admin's existing order-board capability (view/pack/assign/hand-over/deliver/fail/restage/cancel), reusing `GET/PATCH /admin/orders*` exactly as Admin does.
- **Delivery**: the rider queue + active delivery screens, reusing `GET/PATCH /riders/deliveries*` exactly as the Rider app does — this is "Delivery Mode."
- **Catalog/Dental**: a grouped section (products/categories/promotions + the dental clinics/doctors/availability/appointments screens) — grouped together because both are "manage the business's static configuration," distinct from the day-to-day Orders/Delivery operational flow. (Inventory/sourcing is explicitly **not** included per §3/§26 unless OPS-04 says otherwise.)
- **More**: rider management (§13, contingent on the new backend endpoints in §26), settings, sign-out.

This deliberately avoids a literal "Operations Mode vs Delivery Mode" top-level toggle screen (§21's suggested structure) in favor of always-visible tabs — simpler navigation, and switching between order-packing and making a delivery doesn't require a deliberate "mode" decision most of the time; "Delivery" is just always one tab away. (Marked RECOMMENDED, not DECIDED — see OPS-21 note in §30's spirit; a mode-selector-first structure is a legitimate alternative if user testing suggests operators want a harder mental switch between "wearing the business hat" and "wearing the rider hat.")

## 9. Operations Home

A single screen assembled entirely from existing read endpoints, no new aggregation endpoint required for Phase 1:

- **Active delivery** (if any): `GET /riders/deliveries` filtered to the one row in an active state — reuses the Rider app's own query.
- **Orders needing attention**: `GET /admin/orders?status=PLACED,ITEM_UNAVAILABLE` (packing queue) and `...?status=PACKED` (ready for rider) — both already used by Admin's Orders page.
- **Orders on the road / completed today**: `GET /admin/orders?status=OUT_FOR_DELIVERY` and `...?status=DELIVERED&since=<today>` — same pattern as Admin's `closedSince()`.
- **Today's dental appointments**: `GET /admin/dental/appointments?from=<today>&to=<today>` — already supports date filtering.
- **Upcoming appointments**: same endpoint, wider date range.
- **Inventory alerts**: explicitly **not included in Phase 1** unless OPS-04 brings Inventory into scope — no inventory endpoint is called by Admin today either, so there's nothing "free" to reuse here; adding it means depending on Inventory's own `/admin/inventory*` endpoints, which is a scope decision, not a technical blocker.
- **Active riders**: `GET /admin/riders` (already read-only, already used by the assign-rider picker).

No polling faster than what Admin/Rider already do (Rider's own list views poll at ~30s) — Home should match that cadence, not introduce a tighter one. No WebSocket, no SSE for this screen (SSE already exists only for the customer-facing live-location stream, a different concern).

## 10. Order management

Reuses Admin's exact capability and endpoints from §3 — view, pack, assign rider, hand over, mark delivered/failed/customer-unavailable, restage, cancel — all through `PATCH /admin/orders/:id/status` and `POST /admin/orders/:id/assign-rider`, gated the same way Admin already gates them (client-side rule table mirroring the backend catalogue, per `apps/admin/src/lib/orders.ts`'s own documented philosophy: "They decide nothing: the API re-checks every step"). Operations' order screens should port that same rule-table pattern (a fresh implementation, not an import) rather than inventing new client-side business logic. Sourcing (finding stock for an item, marking it unavailable) stays in Inventory's domain and is out of scope here per §3.

## 11. Delivery mode

Reuses the Rider app's exact capability and endpoints from §3/§7 — assigned-delivery list, active delivery, pickup, out-for-delivery (implicit in pickup), arrived, failed delivery (with reason), COD collection, delivery completion. Every ownership/ID-guard behavior (§2's `404`-not-`403` pattern) is inherited unmodified because Operations calls the exact same backend routes the Rider app calls, once §6's RBAC widening ships. Operations' Delivery screens should port (not import) the Rider app's own state-machine-mirroring client logic (`apps/rider/src/lib/delivery.ts`) as a reference pattern.

## 12. Catalog

Products/categories/promotions CRUD, reusing Admin's exact endpoints from §3 (`/admin/products*`, `/admin/categories*`, `/admin/promotions*`, `/admin/media` for images). No new pricing rules, no client-side price computation — the backend remains the sole price authority, exactly as it is for Admin and for the customer app.

## 13. Inventory

**Recommendation: out of scope for Operations Phase 1.** Admin itself does not surface inventory/stock capability (that's Inventory-app-only per §3), and bringing it into Operations means depending on an entirely separate endpoint family (`/admin/inventory*`) that nothing in Operations otherwise touches. If the business decides Operations should show stock alerts or allow adjustments, that's a deliberate scope expansion (OPS-04) for a later phase, reusing Inventory's existing endpoints/rules — never duplicating Inventory's stock-calculation logic client-side.

## 14. Rider management

**This is the one area with a genuine capability gap** (§2, §26): no admin-facing rider create/activate/deactivate/edit capability exists in the backend today, in any app. Operations "should support" this per the brief's §13, but doing so requires **new backend endpoints** (classified D in §26's reuse matrix), not just new frontend screens over existing APIs. Recommendation: Phase 1 ships Operations with the **existing read-only** `GET /admin/riders` capability (rider list showing active riders + their open-delivery count, exactly what Admin's assign-dialog already shows, now as its own screen) and explicitly defers create/activate/deactivate to a follow-up phase once the new backend endpoints exist (§26, §29 phase O8). Do not build a rider-management UI against endpoints that don't exist.

## 15. Dental clinic management

Reuses every admin dental endpoint from §4 with zero backend change: create/edit/activate/deactivate clinics, full field set already supported by the schema (name, address, contact phone, lat/lng, operating hours). Operations' clinic screens should port the Admin app's existing `DentalClinics.tsx`/`DentalClinicDoctors.tsx` page *logic* (not the files themselves) — same form shape, same validation-error surfacing (the merge-then-validate hours check, the clean `INVALID_CLINIC_HOURS` error), since Admin's dental pages are the freshest, most-reviewed reference implementation in the whole codebase for this exact domain.

## 16. Dental doctor management

Reuses `/admin/dental/doctors*` exactly — create/edit doctors, specialty enum (`GENERAL_DENTIST|ORTHODONTIST|PERIODONTIST|ENDODONTIST|ORAL_SURGEON|PEDIATRIC_DENTIST`, verified against the real backend enum this session), bio, photo URL, `is_active` toggle (no hard delete, same reasoning as clinics — preserves appointment-history integrity).

## 17. Doctor/clinic relationships

Reuses `POST /admin/dental/clinics/:id/doctors` (attach, with `consultation_fee`) and `PATCH /admin/dental/clinic-doctors/:id` (fee/active updates) exactly, including the existing relationship-validation guard (rejects inactive/missing clinic or doctor, rejects duplicate pairing with a clean domain error rather than a raw constraint violation).

## 18. Doctor availability

Reuses `POST/GET/PATCH /admin/dental/clinic-doctors/:id/availability[/:availId]` exactly, including the cross-validation against the parent clinic's operating hours (the one genuinely cross-entity rule this domain enforces at write time).

## 19. Blocked dates

Reuses `POST/GET/DELETE /admin/dental/clinic-doctors/:id/blocked-dates[/:blockedId]` exactly, including the duplicate-date rejection (translated from the DB's own unique constraint).

## 20. Dental appointment management

Reuses `GET /admin/dental/appointments?clinic_id=&doctor_id=&status=&from=&to=` (filterable list, includes patient name/phone/notes — operationally necessary, already exposed to ADMIN today per the dental plan's own "who sees what" design) and `POST /admin/dental/appointments/:id/cancel` (owned by the booking module, not the CRUD module — reason required, no ownership restriction, works on `HELD` or `CONFIRMED`, no cutoff). The `is_expired_hold` derived flag (§4) should render as a visually distinct "expired" state, not an indistinguishable active hold — matching how the existing dental admin frontend already renders it. **No medical records, no diagnoses, no prescriptions** — this is enforced simply by there being no such fields anywhere in the schema to display; Operations cannot accidentally show what was never collected.

## 21. Maps/live location

- **Delivery Mode**: reuse the exact tracking-lifecycle logic the Rider app already has (`apps/rider/src/lib/tracker-session.ts`/`tracking.ts`/`tracking-plugin.ts` as the reference pattern to port, not import) — tracking starts/stops tied to delivery state (`PICKED_UP` + `OUT_FOR_DELIVERY`), never to Operations' own "Delivery Mode" toggle. Per §2, **the rider app itself has no map, only a status readout** — Operations' Delivery screens should match that (no map needed for the rider's own location-sharing status), avoiding new map-integration work entirely for this part.
- **Dental clinic location**: the *only* place Operations genuinely needs to render a map, since a clinic has a fixed lat/lng an operator may want to see (matching the customer app's `ClinicLocationMap` single-pin, no-routing pattern). Because Operations is a React/web app and the only existing `MapProvider` abstraction lives in the Flutter customer app (not portable), this requires **new, but small and tightly scoped**, web map integration — e.g. a static single-pin embed (Google Static Maps API image, matching the "single pin, no routing/ETA/geocoding" constraint already established for the customer app) rather than a full interactive JS map SDK. Classified as reuse-matrix category C (§26) — a small, safe, additive frontend capability, not a new architecture.
- **No admin-wide live map** — matches the existing, deliberate "D6: no admin live map" decision already made for the live-location system; Operations does not reopen that decision.

## 22. Notifications

Operations has no notification-sending role of its own — it reuses the same outbox-backed system every other module already uses (order notifications via the lifecycle engine, dental confirm/cancel via the existing dental notification templates). Operations may want **read visibility** into notification history for an order/appointment it's looking at, but no `GET` endpoint for that exists today in any app (Admin doesn't show notification history either) — out of scope for Phase 1 unless a new, small, read-only endpoint is explicitly requested. **No reminder system** — reminders remain unimplemented for dental (DENTAL-11, still open) and Operations must not invent one.

## 23. Offline/error behavior

- Show an explicit offline state (reusing whatever connectivity-detection pattern the customer Flutter app already established conceptually, reimplemented for the web via `navigator.onLine` + failed-request detection — no new library).
- Prevent unsafe mutations while offline: disable action buttons (pack/assign/pickup/collect-cod/cancel/etc.) rather than optimistically applying them and silently failing.
- Never show a false-positive success state for a mutation whose response didn't come back — every action screen should reflect the server's actual response, not an assumed one (this mirrors the "backend is always authoritative" principle already enforced throughout the dental and order-lifecycle work this session).
- Retry only genuinely idempotent reads (list refreshes) automatically; mutations are never auto-retried without the operator re-triggering them, avoiding accidental double-pack/double-collect-cod scenarios.
- **No offline mutation queue** — not justified for Phase 1, and nothing in the existing architecture supports one; building one would be new infrastructure the brief explicitly says to avoid without proof of need.

## 24. Responsive design

Mobile-first, matching the brief's explicit instruction. Primary layout: single-column, bottom-tab nav (§8). Tablet/desktop: graceful reflow using the same responsive CSS techniques Admin/Inventory already use for their own concerns (not a literal copy of either file), but never the primary design target — Operations should read like a purpose-built mobile operations tool that also happens to work on a larger screen, not a shrunk-down admin dashboard.

## 25. Performance

No new polling beyond what Admin/Rider already do (≈30s list revalidation), no WebSockets, no Redis, no new background workers, no new services. Real-time-feeling behavior (e.g. seeing a new order land) is achieved the same way Admin already achieves it today: periodic revalidation + manual pull-to-refresh, not a push mechanism. This matches ADR-002's "no Kafka, no Redis, no microservices, internal `setInterval` background workers only" constraint, which Operations does not need to touch at all since it introduces zero background work of its own.

## 26. Backend API reuse matrix

| Capability | Classification | Detail |
|---|---|---|
| Admin dashboard, orders, catalog (products/categories/promotions/media), dental (clinics/doctors/pairings/availability/blocked-dates/appointments+admin-cancel) | **A — reuse unchanged** | Operator's `role='ADMIN'` already grants everything; zero backend change |
| Rider delivery queue/detail/status-transitions/COD/location | **B — needs a new authorization capability** | Widen `requireRoles('RIDER')` → `requireRoles(['RIDER','ADMIN'])` on 5 routes in `modules/riders/index.ts`, and widen the matching `roles: ['RIDER']` entries in the order-lifecycle catalogue's rider-action definitions to `['RIDER','ADMIN']`. No schema change; no weakening of existing checks. |
| `GET /admin/riders` (read-only active-rider list) | **A — reuse unchanged** | Already ADMIN-gated |
| Dental clinic-location map (single static pin) | **C — small safe extension** | New, tightly-scoped frontend integration (a static map image call), not a backend change; classified here because it's the one place genuinely new client capability is needed, even though it's small |
| Rider create/activate/deactivate/edit | **D — new backend endpoint genuinely required** | Does not exist in any form today (§2, §14) — needs new `POST/PATCH /admin/riders[/:id]`-style endpoints, ADMIN-gated, following the exact validation/error-shape conventions the dental admin module (§15-19) already established this session. **Not built in this plan** — logged for a future phase (§29 O8), only if OPS-04/OPS-13-adjacent decisions confirm it's wanted. |
| Inventory/stock/sourcing/suppliers | **Out of scope for Phase 1** | Existing Inventory-app endpoints would need to be reused (classification A) *if* this scope is added later — no technical blocker, purely a scope decision (OPS-04) |
| Notification history read view | **Out of scope for Phase 1** | No existing endpoint anywhere to reuse (not even Admin has this); would be D if ever pursued |
| Appointment reminders | **Explicitly not pursued** | DENTAL-11 remains open; Operations must not invent this |

## 27. New backend requirements

Exactly two, both small and additive, both already using established patterns:

1. **RBAC widening** (§6, §26 row B) — no new code paths, no new tables, just allow-list widening in two already-existing locations (route middleware array, lifecycle catalogue array). Smallest possible footprint for the capability it unlocks.
2. **Rider management CRUD** (§26 row D) — genuinely new (`POST/PATCH /admin/riders[/:id]`), deferred to a later phase (§29), not built in this plan, and not required to stand up Operations' Phase 1 (which can ship with read-only rider visibility, exactly matching what Admin already has).

No other backend change is required for anything in §8-§22. The dental clinic-location map (§21, §26 row C) is a frontend-only addition (a static map image request against Google's Static Maps API, keyed the same way the customer app's Google Maps integration already is — no new backend involvement).

## 28. Database impact

**None**, for Phase 1 as scoped. `riders.user_id` already supports linking to any `users` row regardless of role (§2) — no schema change needed to make Option B (§6) work. The only *future* schema consideration is §26 row D's rider-management endpoints, which would not require new tables either (they operate on the existing `riders` table) — only new routes/service/repository code, classified D because the *capability* doesn't exist, not because the *data model* is missing anything.

## 29. Testing strategy

**Auth**: valid operator (ADMIN) login succeeds and reaches every existing ADMIN-gated screen unchanged; a CUSTOMER/RIDER/PACKING_STAFF-role token is rejected by Operations' own client-side gate and, more importantly, still rejected server-side on every admin-only route exactly as today; after the RBAC widening (§6), confirm an ADMIN-role token **with** a linked, active `riders` row can now successfully call all 5 rider routes, and an ADMIN-role token **without** a linked rider row still gets `403 RIDER_PROFILE_NOT_FOUND` (proving the widening is opt-in per-identity, not a blanket hole).

**Operations (admin-side)**: reuse the same test shapes Admin/Dental's own test suites already use for orders/catalog/dental CRUD — Operations is calling the identical endpoints, so its own tests should assert the identical contracts (happy path + the same validation-error cases already proven this session for dental, e.g. `INVALID_CLINIC_HOURS`, duplicate-pairing rejection).

**Delivery**: own-delivery-only enforcement (an ADMIN+rider-linked identity can only see/act on deliveries where `rider_id` matches their own linked `riders.id`, never another rider's — this is inherited, not new, but must be explicitly re-tested from Operations' own test suite since it's a new caller of these routes); pickup/arrive/fail/COD/complete state-transition tests mirroring the Rider app's own existing coverage; a specific regression test proving a **plain RIDER-role user's own experience via the actual Rider app is completely unaffected** by the widened guard (the single most important regression to prove, given the "must not weaken existing behavior" constraint).

**Dental**: clinic/doctor CRUD, clinic-doctor relationship validation, availability/blocked-date CRUD, appointment visibility and admin-cancel — Operations-side tests can largely mirror the existing Admin dental test suite's shape (`apps/admin/src/test/dental.test.tsx` per the earlier investigation) since the backend contract is identical.

**Security** (the highest-priority test category given this app's combined-privilege nature): a CUSTOMER-role account cannot reach Operations at all (client gate + server-side 403 on every call); a plain RIDER-role account cannot reach any ADMIN-only Operations screen; an ADMIN-role Operations account cannot access another rider's delivery (404, not 403 — matching the existing IDOR contract exactly); malformed/non-existent IDs return clean 4xx everywhere, never 500; no capability-escalation path exists from Operations back into Admin/Rider/Inventory's own sessions (they remain fully independent token namespaces).

**Audit**: for every action type Operations can perform (admin catalog edit, dental doctor edit, dental availability change, rider pickup, rider COD collection, appointment cancel), assert the resulting `*_by_user_id`/`changed_by` column records the **operator's single `user_id`** — proving §20's requirement holds end-to-end, and specifically proving Option B's audit advantage over Option D (no fragmentation across two identities).

## 30. Open decisions

| ID | Decision | Status | Detail |
|---|---|---|---|
| OPS-01 | RBAC/capability model | **RECOMMENDED** | Option B (§6) — existing ADMIN role + linked rider profile + small additive route-guard widening. Not marked DECIDED because it's this plan's own recommendation, not yet confirmed by the user. |
| OPS-02 | How the operator links to a rider profile | **RECOMMENDED** | A normal `riders` row with `user_id` pointing at the operator's ADMIN-role `users` row — provisioned the same way any rider is provisioned today (currently: direct DB seeding, until §26/§29's rider-management endpoints exist) |
| OPS-03 | Can one Operations account have multiple rider profiles | **BLOCKED (by schema, not a business question)** | `riders.user_id UNIQUE` makes this structurally impossible today without a schema change. Open only if the business later needs one operator to be a rider at multiple dark stores simultaneously — not assumed needed |
| OPS-04 | Can Operations perform every ADMIN action, or only selected ones | **OPEN** | This plan assumes "every ADMIN action" (simplest, matches Option B cleanly) but the user has not confirmed this; if the answer is "only selected ones," Option A (a real `OPS` role) becomes more attractive despite its larger footprint, and §13 (Inventory) may also need reconsidering |
| OPS-05 | Can Operations cancel dental appointments | **DECIDED** | Yes — reuses the existing admin-cancel endpoint unchanged (§20), already ADMIN-gated with no ownership restriction |
| OPS-06 | Can Operations modify dental availability | **DECIDED** | Yes — reuses the existing admin availability endpoints unchanged (§18) |
| OPS-07 | Should Operations have customer management | **OPEN** | Not requested anywhere in the brief's §1-§32, and no existing "customer management" surface exists in Admin today either to reuse — flagged as explicitly out of scope unless raised |
| OPS-08 | What information should appear on Operations Home | **RECOMMENDED** | §9's list — all sourced from existing read endpoints; inventory alerts excluded pending OPS-04 |
| OPS-09 | Should Delivery Mode automatically start location tracking | **DECIDED** | No "automatic start on mode-entry" concept — tracking start/stop is tied to delivery lifecycle state exactly as it already is for the Rider app (§21), not to any Operations-specific UI toggle |
| OPS-10 | What audit information is required | **DECIDED** | The existing per-domain `*_by_user_id`/`changed_by` FK pattern, unchanged — no new generic audit log is built (the existing `audit_logs` table stays unused, consistent with the rest of the codebase) |
| OPS-11 | Mobile-only or responsive mobile/tablet/desktop | **RECOMMENDED** | Mobile-first primary, responsive-but-secondary tablet/desktop support (§24) |
| OPS-12 | Should the Operations app support multiple operators | **OPEN** | Nothing in the brief specifies this; Option B works identically for any number of ADMIN-role operators each with their own optional linked `riders` row — no architectural blocker either way, but the UI/UX assumption of "the lead's phone" (singular) throughout this plan should be revisited if multiple simultaneous operators is actually intended |
| OPS-13 | What happens when an operator is also logged into the existing Rider App | **DECIDED (no special handling needed)** | Independent token namespaces mean no technical conflict; both sessions resolve to the same underlying `riders`/`deliveries` rows if the operator is the same account in both places — this is no different from any user signing into two devices today, and is not a new problem Operations introduces (§7) |

## 31. Risks

- **RBAC widening is a security-sensitive backend change**, even though small — it must go through the same adversarial-review rigor this session's dental locking code did (an opus-tier review specifically checking that the widening cannot be exploited to let a non-linked ADMIN, or worse a non-ADMIN, gain rider capability). Recommend the same subagent-driven-development + adversarial-review process used for the dental feature's B3 task.
- **Rider management (§14/§26 row D) is a real gap-filling task**, not a reuse task — it needs its own careful design (validation rules, who can create a rider, dark-store assignment) rather than being assumed trivial because "it's just CRUD."
- **The dental clinic-location map (§21) is the one place Operations needs genuinely new frontend capability** (a web map integration) — scope it tightly (static single-pin image, no routing/geocoding) to avoid it growing into a second map architecture alongside the Flutter customer app's `MapProvider`.
- **No production deployment precedent exists for any of the three sibling apps** (§2) — Operations inherits this gap rather than solving it; don't let "how do we deploy this" block Phase 1 development, but don't assume it's solved either.
- **In-memory rate limiting is not distributed** (`InMemoryRateLimiter`, confirmed single-process) — irrelevant to Operations specifically, but worth noting since Operations adds another OTP-login surface hitting the same limiter.
- **`audit_logs` table exists but is unused everywhere** — if the business later wants a true cross-entity audit log (not just per-domain FK columns), that's a pre-existing gap Operations does not need to fix, but shouldn't be assumed to already provide either.

## 32. Acceptance criteria (for a future implementation pass, not this plan)

- `apps/admin`, `apps/rider`, `apps/inventory` test suites and manual smoke behavior are **100% unchanged** after the RBAC widening ships — this is the single most important acceptance gate.
- A RIDER-role user's experience via the actual Rider app is provably identical before and after.
- An ADMIN-role user with no linked `riders` row cannot perform any rider action (still `403 RIDER_PROFILE_NOT_FOUND`).
- An ADMIN-role user with a linked, active `riders` row can perform every rider action Operations exposes, with every existing ownership/404-not-403 guarantee intact.
- Every dental/catalog/order capability Operations exposes matches Admin's existing backend contract exactly (same validation errors, same status codes).
- No file under `apps/admin/`, `apps/rider/`, or `apps/inventory/` is modified.
- No new infrastructure (Redis/Kafka/microservices/WebSockets/new DB) is introduced.

## 33. Estimated complexity by phase

| Phase | Goal | Complexity | Blockers |
|---|---|---|---|
| O0 | RBAC widening decision + implementation (backend only) | **Medium** (small diff, high review bar) | OPS-01 confirmation |
| O1 | Operations app foundation (scaffold, own client/auth/layout, port + CORS entry) | Low | None |
| O2 | Auth/session (OTP login, session restore, client-side role gate) | Low | O1 |
| O3 | Operations Home | Low-Medium (multiple read sources, no new endpoints) | O1, O2 |
| O4 | Order management | Medium (ports Admin's rule-table logic) | O1, O2 |
| O5 | Delivery mode | Medium-High (ports Rider's state-machine + tracking-session logic; depends on O0) | O0, O1, O2 |
| O6 | Catalog | Low-Medium | O1, O2 |
| O7 | Dental management (clinics/doctors/pairings/availability/blocked-dates/appointments) | Medium (widest single domain, but zero backend change) | O1, O2 |
| O8 | Rider management (new backend endpoints + UI) | **High** (genuinely new backend capability, §26 row D) — deferred, only if OPS-04/business confirms it's wanted | O0, new backend design |
| O9 | Maps/dental clinic location | Low-Medium (small, scoped new frontend integration) | O7 |
| O10 | Security testing | High priority, not high complexity — mostly confirming inherited guarantees hold | O0, O4, O5, O7 |
| O11 | Device/responsive testing | Medium | O1-O9 |
| O12 | Release | Depends entirely on deployment decisions not yet made for any sibling app (§2, §31) | All above |

Ordering rationale: O0 gates O5 (delivery mode is useless without the RBAC widening) and, transitively, O10's security testing. O7 (dental) has no backend dependency at all and could ship in parallel with O4-O6 once O1-O2 exist. O8 (rider management) is deliberately last among the "real" phases because it's the one area requiring new backend design work, not reuse — it should not block a Phase-1 release that ships with read-only rider visibility only.

---

## Final rule

Planning only. No application code. No backend code. No migrations. No dependency installation. No modifications to Admin. No modifications to Rider. No modifications to Inventory. No commits. No pushes. The only repository change from this task is this document.
