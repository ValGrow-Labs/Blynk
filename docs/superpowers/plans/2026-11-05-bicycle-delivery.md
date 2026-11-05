# Bicycle delivery (contract)

Source: team meeting 2026-11-04 (Gemini notes) + brother's WhatsApp 2026-11-05 ("Both can be done", "We assign") + owner 2026-11-05 ("give that option to Ops and Admin, they will decide in future").

Decided: a SEPARATE bicycle delivery option for short routes (2 to 3 km, flat roads); LOWER customer fee; LOWER rider pay (no petrol/maintenance); motorbike (priority) stays for urgent orders; Admin AND Ops decide the money and distance (nothing hardcoded); staff assign the rider ("we assign").
My reading, to be confirmed by the owner: the customer chooses Bicycle or Motorbike at checkout when both are possible; staff then assign the rider as today.
Placeholder amounts below are NOT business decisions; the switch is OFF by default and staff set the real numbers before switching it on.

## Setting `bicycle_delivery` (system_configurations JSON, read with defaults, never throws)
```
{ enabled: false,
  max_km: 3,                       // 0.5-10, 1 decimal; bicycle only when the road km (same measurement as the fee) <= max_km
  fee:   { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null },     // same rule shape as BASE_PER_KM (pricing/km-tiers.ts priceByBaseAndKm), LKR 0-1000
  rider_pay: { mode: 'FIXED' | 'PER_KM', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } }
```
Routes: GET and PUT, mounted like the existing rider-pay / delivery-fee settings (same roles ADMIN + OPERATIONS, same style, zod strict, audit action BICYCLE_DELIVERY_UPDATED with old/new). A PUT that switches `enabled` on needs fee and rider_pay valid. No migration needed for the setting.

## Orders
Migration 067 (066 is the latest) with `_down`, idempotent: `orders.delivery_method` text NOT NULL DEFAULT 'MOTORBIKE' CHECK in ('MOTORBIKE','BICYCLE'); update `database/types.ts`. Existing rows stay MOTORBIKE.
- `GET /orders/checkout-info` gains `bicycle: { available: boolean, reason?: string, fee_lkr, max_km, distance_km }` (also the quote preview / validate-coupon preview if it shows the fee). available = enabled AND address known AND distance_km <= max_km AND at least one approved, active rider with vehicle_type BICYCLE exists (not necessarily free). Motorbike fields unchanged.
- Order placement accepts optional `delivery_method` ('MOTORBIKE' default, 'BICYCLE'). BICYCLE is re-checked authoritatively at placement (400 with a plain message when not available). The charged fee uses the bicycle fee rule; `standard_delivery_fee` snapshots the bicycle fee; free-delivery rules / coupons apply exactly as for motorbike.
- Everything that shows an order carries `delivery_method` (customer order detail/list, Ops/Admin order list/detail, rider job, order push text where the order is described).

## Assignment ("we assign")
A BICYCLE order can only be assigned to a rider whose vehicle_type is BICYCLE: every assignment path (Ops/Admin assign, auto-assign if any, rider claim/accept if any, reassign) refuses others with a plain message; pickers/offers list only bicycle riders for it. MOTORBIKE orders: unchanged (any rider, as today).

## Switch to motorbike (staff)
`POST /orders/:id/delivery-method` body `{ method: 'MOTORBIKE' }`, roles ADMIN + OPERATIONS, only BICYCLE -> MOTORBIKE, only before the order is picked up / out for delivery, and only while no money has been taken that the new fee would change (refuse online/wallet-paid orders with a clear message; COD / unpaid ok - builder checks the real payment model). Recomputes the fee with quoteDeliveryFee (motorbike), updates fee/total/standard_delivery_fee consistently, releases a currently assigned bicycle rider back to unassigned, notifies the customer (same notification pattern as other order changes, en/si/ta), writes an audit row and an order event/history row if the module has one. Idempotent (already MOTORBIKE -> 409 plain message).

## Rider pay
At settlement (`computePaySnapshot`, rider.pay-rules.ts): for a BICYCLE order a COMMISSION rider's base pay comes from `bicycle_delivery.rider_pay` (FIXED -> fixed_lkr; PER_KM -> base_lkr + per_km_lkr x road km, same distance as today, with min_lkr floor). COMPANY riders stay salaried (base 0). Bonuses (peak, rain, daily target, long distance) unchanged. Snapshot inputs record `delivery_method: 'BICYCLE'` and the rule used; map FIXED -> rider_pay_model 'FIXED', PER_KM -> 'DISTANCE' so existing columns/exports keep working. Past deliveries never change.

## UI (after the backend exists)
- Admin Settings, Deliveries category: card "Bicycle delivery" (switch, max km, fee fields, rider pay fields, plain help text, a worked example line like "1.5 km: customer pays LKR 80, rider earns LKR 50"; warns when the bicycle fee is not lower than the motorbike fee). Ops More > Deliveries: the same card (mobile first, 360 dp, plain wording, en only for staff).
- Ops/Admin order detail: "Bicycle" / "Motorbike" badge; for a bicycle order a "Switch to motorbike" button with a confirm step that states the new fee; the rider picker shows only bicycle riders for a bicycle order.
- Customer app checkout: when `bicycle.available`, two choice cards "Bicycle - cheaper, a bit slower" (fee, ~max km) and "Motorbike - faster" (fee); default = Motorbike (my call, safe); the order summary and tracking show the method. Sinhala + Tamil + English strings like the rest of the app. No bicycle card when unavailable.
- Rider app: a "Bicycle delivery" label on the job.

## Rules
Follow existing patterns (read the delivery-fee, rider pay settings, order placement, assignment, settlement, notification code first). Real-Postgres tests like backend/api/tests: setting defaults/validation/roles/audit, checkout-info availability (disabled, too far, no bicycle rider, ok), placement fee + snapshot, free-delivery/coupon interaction, assignment refusal, switch-to-motorbike (fee, total, release rider, paid refusal, idempotent, roles), rider pay FIXED and PER_KM + COMPANY unchanged. Existing tests must keep passing (say which you edited). Builders do not commit or push. Owner runs migration 067 in Coolify.
