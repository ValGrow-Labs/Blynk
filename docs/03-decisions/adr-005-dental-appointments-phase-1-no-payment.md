# ADR-005: Dental Clinic Appointments — Phase 1 Ships Without Payment

## Status
Accepted

## Context
The original brief for the dental clinic appointments feature asked for booking **and** online payment together. Mid-session the user gave an explicit follow-up instruction: *"don't add payment features now, we can do it later."* Investigation of the existing backend confirmed there was nothing to extend cheaply — the `payments` module is an 8-line stub (one `GET /status` route), a repo-wide grep for `stripe|razorpay|payhere|paypal|webhook` returns zero matches, and `PaymentMethod.ONLINE` exists in the grocery schema but is never set by any code path (`docs/02-architecture/blynk_database_design.md` already calls online payment gateways "Phase 3"). Building a payment surface for dental now would have been materially new engineering, not reuse of an existing pattern — exactly the kind of work that deserves its own scoped effort once a provider is chosen, not a rushed addition bolted onto a booking feature.

At the same time, the feature could not simply ignore money entirely: clinics charge a consultation fee, and customers reasonably expect to see an indicative price before booking.

## Decision
1. **Phase 1 ships as a reservation/booking product with no money changing hands in the app.** A customer books an appointment the same way they would call a clinic directly; payment happens at the clinic (COD-equivalent, off-platform). No payment gateway, payment provider code, payment UI, payment webhook, payment dependency, refund flow, or clinic settlement/payout exists anywhere in this feature.
2. **The only payment-adjacent artifact is a schema seam**: `appointments.consultation_fee_snapshot NUMERIC(10,2)`, populated from the clinic-doctor's admin-set `consultation_fee` at hold time and displayed to the customer as an indicative figure, "payable at the clinic." It is never validated, charged, or reconciled by any code path.
3. **The appointment state machine deliberately has no `PAYMENT_PENDING` state.** The five stored states (`HELD`, `EXPIRED`, `CONFIRMED`, `CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_CLINIC`) are exactly what a payment-free booking flow needs. A future payment step is designed to slot in as `HELD → PAYMENT_PENDING → CONFIRMED` without changing what `CONFIRMED` or any terminal state means to notifications, cancellation, or appointment history — but that state does not exist today, and no code branches on it.
4. **Payment-gateway research (PayHere/Stripe/etc. comparison), money-flow model (who receives payment, commission), and refund policy were not performed and are not decided.** These are explicitly deferred, not silently assumed.

**Online payment is intentionally deferred to a future phase.**

## Consequences
- The feature ships materially smaller and faster: one backend module, five Flutter screens plus supporting screens, one Admin section — with zero new infrastructure and zero payment-surface attack area (amount tampering, callback forgery, replayed webhooks are all not-applicable today, not mitigated).
- No refund logic, no settlement logic, and no reconciliation-between-payment-and-appointment-state logic needed to be designed or built, because there is nothing to reconcile yet.
- The consultation fee shown to customers is informational only; nothing in the system enforces that the clinic actually charges that amount, and Blynk has no visibility into whether payment ever occurred.
- When payment is introduced, it requires **its own follow-up ADR and implementation plan** once a payment provider is chosen (Sri Lanka gateway comparison, webhook/signature verification, PCI scope, and the commercial money-flow model — who receives payment, whether Blynk takes a commission — must all be decided then, not retrofitted). That follow-up plan should reuse the existing `payments` table shape (`transaction_reference`, `gateway_response JSONB`, `payment_status` enum) and the same lock-then-settle transactional pattern already proven for COD settlement, extended for the dental domain, and should introduce the `PAYMENT_PENDING` state at that time.
- Until that follow-up work happens, "appointment confirmed" and "payment received" remain two unrelated facts as far as the system is concerned.
