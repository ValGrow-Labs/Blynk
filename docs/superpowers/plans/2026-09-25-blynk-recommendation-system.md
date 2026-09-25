# Blynk Recommendation System (V1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Blynk customer app server-computed, explainable product recommendation sections — Buy Again, Popular, Category Picks, Frequently Bought Together — built only from order data Blynk already owns, with no ML, no new infrastructure, and no invented signals.

**Architecture:** A new `recommendations` module inside the existing backend modular monolith, following the established `controller / service / repository / schema / index` shape. It is a **read-only composition layer**: candidate generators produce `(product_id, source, score)` tuples from SQL over `orders`/`order_items`, a merge step deduplicates them, an availability filter drops anything not orderable, a deterministic ranker orders what survives, and the surviving product ids are hydrated through the **existing** `v_product_catalog` read so prices and availability come from the one authoritative place. One new endpoint, `GET /api/v1/me/recommendations`, returns typed sections. No new tables in V1 beyond one optional materialised popularity table introduced only if measurement shows it is needed.

**Tech Stack:** Node.js, TypeScript, Express, Kysely, PostgreSQL 15+, Vitest + Supertest (integration tests run against a real database), Flutter 3.47 / Dart 3.13 on the customer side.

**Spec:** This document is both the spec and the plan. The investigation it argues from is in §2–§4; every design decision below cites the file and line it was derived from.

## Global Constraints

- **No new infrastructure.** No Kafka, Kubernetes, Redis, vector database, ML serving, separate microservice, or event-streaming platform. Anything that might help later is recorded in §25 (ML Evolution Path) as a future phase, never built in V1.
- **No new dependencies.** V1 uses Kysely and Zod, both already present.
- **Recommendations never compute price.** Every product returned is hydrated through `v_product_catalog.calculated_selling_price`, the same column `catalogService.listProducts` uses (`catalog.service.ts:169`). A recommendation-specific price is a defect.
- **Recommendations never override availability.** The orderability rule is `is_active AND is_available` (`order.service.ts:160`, confirmed by `docs/04-business/business-rules.md:63`). Recommendations filter to exactly that; they do not invent a stricter or looser rule and do not consult `inventory`.
- **Customer identity comes from the token only.** `req.user.id` (`middleware/auth.middleware.ts:45`). No endpoint accepts a `customer_id` parameter in any form.
- **No fabricated data.** A section with no real candidates is omitted from the response, never padded. No invented "Trending"/"Popular right now" label over a query that does not measure it. This mirrors the existing guard in `apps/customer/.../test/home_composition_test.dart`.
- **Currency is LKR (`Rs.`)**; the client formats it — the API returns numbers, as `CustomerProductDto` already does.
- **No test deleted, skipped or weakened.**
- **Do not commit. Do not push.**

## Review Focus

These are the input classes the design implies but which no single task's happy path exercises. Each has a test pinned to the task that owns the code.

1. **A customer whose entire order history was cancelled.** `PurchaseHistory` must treat them as a cold-start customer, not as a customer with signals — otherwise Buy Again offers products they never received. Pinned to Task 4.
2. **A product that was ordered and has since been deactivated or sold out.** It must disappear from every section including Buy Again, because `is_active AND is_available` is the orderability rule and a recommendation that cannot be added to cart is worse than no recommendation. Pinned to Task 8.
3. **Two products with identical scores.** `Array.prototype.sort` is not stable across engines for large arrays; without a deterministic final tie-break the same customer sees the grid reshuffle between refreshes. Pinned to Task 9.
4. **A co-occurrence pair supported by a single order.** With 41 products in the live catalogue, one shared basket is noise, not a pattern; below the support threshold the section must be omitted entirely rather than shown thin. Pinned to Task 7.
5. **An unauthenticated or rider-token request to the recommendations endpoint.** It must 401/403 before any query runs — the endpoint must not become a way to enumerate the catalogue or another customer's history. Pinned to Task 10.

---

## 1. Executive Summary

Blynk can ship a genuinely useful recommendation system today **without any machine learning and without collecting a single new event**, because the one signal that matters most in grocery — what this customer has actually bought — is already durably recorded in `orders` and `order_items`.

The investigation found:

- **The data for Buy Again and Popular already exists and is trustworthy.** `order_items` carries `product_id`, `quantity` and `item_status`; `orders` carries `customer_id`, `order_status` and `placed_at`.
- **There is no behavioural event data of any kind.** No product views, no searches, no add-to-cart events, no analytics table, no client-side tracking. §4 states this explicitly rather than assuming otherwise.
- **The catalogue is very small — 41 products across 8 flat categories.** This is the single most important constraint on the design. It makes Popular and Buy Again viable immediately, and makes Frequently Bought Together statistically meaningless until order volume grows. The plan builds FBT behind a support threshold that will correctly suppress it at launch.
- **`order_items` has no index on `order_id` or `product_id`** — only its primary key and foreign-key constraints. Every recommendation query joins through this table. This is the highest-value performance change in the plan and is Task 1.
- **A client-side ranking already shipped.** `apps/customer/.../lib/Services/product_ranking.dart` reorders "Browse all" against the customer's own orders. This plan **subsumes and then removes it** (Task 12) — it must not remain as a second, divergent ranking.

V1 is deterministic, explainable, and replaceable: the ranker is a pure function behind an interface, so an ML ranker can replace it later without the customer API contract changing.

## 2. Existing Architecture Findings

### 2.1 Backend module shape

Modules live at `backend/api/src/modules/<name>/` and consistently contain:

| File | Responsibility |
|---|---|
| `<name>.schema.ts` | Zod request/response schemas, exported input types |
| `<name>.repository.ts` | All SQL, via Kysely, against `db` from `database/connection.js` |
| `<name>.service.ts` | Business rules, DTO shaping, `AppError` throwing |
| `<name>.controller.ts` | Express handlers, `req`/`res`, `next(err)` |
| `index.ts` | Router(s), middleware wiring, re-exports |

Existing modules: `admin, audit, auth, catalog, configuration, deliveries, dental, inventory, map-tiles, media, notifications, orders, payments, pricing, promotions, realtime, riders, users`.

Routers are mounted in `src/app.ts:120-141` on an `apiRouter` under `env.API_PREFIX` (`/api/v1`). Note `apiRouter.use('/me', meRouter)` already exists — this is the natural home for a per-customer endpoint.

### 2.2 Auth, RBAC and isolation

- `requireAuth` (`middleware/auth.middleware.ts`) verifies the token and sets `req.user = { id, phone, role }` (line 45).
- `requireRoles('ADMIN')` (`middleware/role.middleware.ts`) gates admin routes.
- Roles are `user_role_enum`: `CUSTOMER, RIDER, PACKING_STAFF, ADMIN` (`001_initial_schema.sql:15`).
- **The established isolation pattern is to pass `req.user.id` into the service and filter in SQL**, never to accept an id from the client. `order.controller.ts:41` — `orderService.getCustomerOrders(req.user!.id, query)` — is the exact precedent to copy.

### 2.3 Validation, errors, responses

- Zod schemas + `middleware/validate.middleware.ts`.
- `AppError(message, httpStatus, code, details?)` from `middleware/error.middleware.ts`, rendered by `errorMiddleware`.
- Responses are `{ success: true, data: { ... } }` (`catalog.controller.ts:18-22`).

### 2.4 Rate limiting

There is **one** limiter: `InMemoryRateLimiter` in `src/modules/auth/auth.rate-limiter.ts`, a sliding-window counter with `checkLimit(key, maxRequests, windowMs, customMessage?)` throwing a 429 `TOO_MANY_REQUESTS`. It is process-local, which is acceptable for a single-instance deployment and is recorded as a limitation in §22.

### 2.5 Test conventions

`backend/api/tests/*.test.ts`, Vitest + Supertest against `createApp()` and a **real PostgreSQL database**. Tokens are minted directly with `generateAccessToken({ id, phone, role })` (`tests/catalog.test.ts:10-26`). Tests clean up after themselves in `afterAll`.

> **Known hazard, recorded because it will bite an implementer:** the backend suite mutates the dev database. At the time of writing, `tests/catalog.test.ts` has **3 pre-existing failures** in product pricing and focal-point validation, unrelated to this work (verified by reverting an unrelated change and re-running). Do not treat those 3 as regressions caused by this plan.

### 2.6 Worker/outbox precedent

`notifications` plus migration `002_outbox_worker_extensions.sql` implements a transactional outbox (`attempts`, `max_attempts`, `next_attempt_at`, `locked_at`, `locked_by`). If V2 ever needs asynchronous recompute, **this is the pattern to copy** — not a message broker.

### 2.7 Customer Flutter architecture

- `ProductProvider` (`lib/Services/Providers/product.provider.dart`) owns catalogue reads: `loadCategories`, `loadProducts`, `loadProductDetail`, search. It caches per category slug (`productsFor(slug)`), with `''` as the catalogue-wide key.
- `OrderProvider` owns `/orders`; `GET /orders` returns line items (`order.repository.ts:331-354`).
- `ProductModel` / `CategoryModel` are plain JSON-parsed models.
- `ProductCard` (`lib/UI/Widgets/Atoms/card_product.dart`) is the single product tile; `ProductRail` / `BlynkProductGrid` are the single grid/rail rules.
- **There are no analytics or event hooks in the Flutter app.** A repo-wide search for `analytics|trackEvent|logEvent` returns nothing.

### 2.8 Operations / Admin

Pages: `Catalog (Products, Categories, Promotions), Orders, OrderDetail, Delivery, Dental, Inventory, Riders, Home, More`. There is **no business analytics surface**. `/admin/operations/metrics` exposes `utils/metrics.ts` — process/HTTP metrics, not commerce metrics.

## 3. Existing Data Audit

### 3.1 Tables that exist

`appointment_status_history, appointments, audit_logs, categories, clinic_doctors, customer_addresses, dark_stores, deliveries, dental_clinics, doctor_availability, doctor_blocked_dates, doctors, inventory, inventory_adjustments, notifications, order_items, order_status_history, orders, otp_verifications, payments, products, promotions, refresh_tokens, riders, service_areas, sourcing_records, suppliers, system_configurations, users`

Plus one view: **`v_product_catalog`** (current definition in `009_image_focal_point.sql:71`).

### 3.2 The columns that matter

**`orders`** — `id, order_number, customer_id → users(id), dark_store_id, order_status (order_status_enum), payment_status, subtotal_amount, delivery_fee, total_amount, scheduled_for, cancelled_at, placed_at, packed_at, dispatched_at, delivered_at, created_at`

`order_status_enum` = `PLACED, PACKED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, FAILED, CUSTOMER_UNAVAILABLE, ITEM_UNAVAILABLE`

**`order_items`** — `id, order_id → orders(id) ON DELETE CASCADE, product_id → products(id) ON DELETE RESTRICT, product_name_snapshot, sku_snapshot, unit_snapshot, unit_selling_price, quantity, subtotal, item_status (item_fulfillment_status_enum), created_at`

`item_fulfillment_status_enum` = `PENDING, SOURCED, PACKED, UNAVAILABLE, SUBSTITUTED`

**`products`** — `id, category_id → categories(id), name, slug, description, sku, barcode, unit, pack_size, image_url, image_focal_x/y, purchase_cost, custom_markup_percent, is_available, is_active, created_at, updated_at`

**`categories`** — `id, name, slug, description, image_url, display_order, is_active`

**`v_product_catalog`** — every customer-safe product column **plus** `category_name`, `effective_markup_percent` and **`calculated_selling_price`**. This is the authoritative price.

### 3.3 Indexes that exist

```
idx_orders_customer_placed   ON orders (customer_id, placed_at DESC)
idx_orders_active_queue      ON orders (dark_store_id, order_status, placed_at ASC)  [partial]
idx_orders_scheduled         ON orders (dark_store_id, scheduled_for ASC)            [partial]
idx_products_category_active ON products (category_id, is_active, is_available)
idx_products_barcode         ON products (barcode) WHERE barcode IS NOT NULL
```

**`order_items` has no index at all** beyond its primary key and foreign keys. Every query in this plan joins it. Task 1 fixes this.

### 3.4 Audit classification

**A. Already available, usable as-is**

| Signal | Source |
|---|---|
| Purchase history per customer | `orders.customer_id` + `order_items` |
| Purchase recency | `orders.placed_at` / `orders.delivered_at` |
| Purchase frequency | count of distinct `orders` containing a product |
| Quantity purchased | `order_items.quantity` |
| Per-item fulfilment outcome | `order_items.item_status` |
| Order outcome | `orders.order_status` |
| Product → category | `products.category_id` |
| Orderability | `products.is_active`, `products.is_available` |
| Authoritative price | `v_product_catalog.calculated_selling_price` |
| Co-occurrence (raw) | two `order_items` rows sharing an `order_id` |

**B. Available but requires transformation**

| Signal | Transformation |
|---|---|
| Popularity | aggregate `order_items` over a time window, filtered to successful orders |
| Category affinity | aggregate the customer's purchases up to `products.category_id` |
| Item co-occurrence | self-join `order_items` on `order_id`, pair-wise, with a support threshold |
| "Successful purchase" | requires an explicit definition — see §11 |

**C. Not available at all**

| Signal | Status |
|---|---|
| Product views | **Does not exist.** No event table, no client hook. |
| Search events | **Does not exist.** Recent searches are stored **locally on the device** only. |
| Add-to-cart / remove-from-cart | **Does not exist.** `CartProvider` is entirely client-side; the server first learns of a product when an order is placed. |
| Session / dwell / impressions | **Does not exist.** |
| Product tags, attributes, brand | **Do not exist.** The only product metadata is `category_id`, `name`, `description`, `unit`, `pack_size`, `sku`. |
| Subcategories | **Do not exist.** `categories` is a flat list; there is no parent/child column. |
| Customer demographics | Not collected beyond phone number. |

**Consequence:** V1 has exactly one behavioural signal — **purchase**. Every section in this plan is derived from it. Any section that would need views or cart events is deferred to V2 with its event design specified in §8.

### 3.5 Current scale (measured, not assumed)

Queried against the running dev backend: **41 products, 8 categories.** Launch is a single dark store in Dharga Town.

This is small enough that:
- every recommendation query is a sub-100ms sequential scan even before indexing;
- co-occurrence will be extremely sparse and **must** be threshold-gated;
- no caching, materialisation or precomputation is justified in V1 (§22).

## 4. Recommendation Goals

1. A returning customer sees what they actually buy, without hunting for it.
2. A brand-new customer sees a sensible, real shelf rather than an empty screen.
3. Every recommendation is **orderable right now** — tapping it and adding to cart always works.
4. Every section can be explained in one sentence to a customer and to an operator.
5. Swapping the ranker for an ML model later changes no client code.

## 5. Scope (V1)

- `GET /api/v1/me/recommendations` returning typed sections.
- Four candidate sources: **Buy Again**, **Popular**, **Category Picks**, **Frequently Bought Together**.
- One deterministic ranker with named, configurable weights.
- Availability filtering via the existing orderability rule.
- Product hydration via the existing `v_product_catalog` read path.
- Flutter integration on **Home only**.
- Removal of the interim client-side ranking.

## 6. Non-Goals (V1)

- Machine learning of any kind, including "simple" collaborative filtering.
- Product view / search / cart event collection (designed in §8, **not built**).
- A recommendations admin dashboard.
- Caching, materialised views, or a recompute worker.
- Recommendations on product detail, category pages, or cart.
- Cross-dark-store or geographic personalisation.
- A/B testing infrastructure.

## 7. Cold-Start Strategy

The decision tree runs on two measured numbers: `successfulOrderCount` and `distinctProductsPurchased`, both from the customer's own successful orders (§11 defines "successful").

```
successfulOrderCount == 0
    → NEW CUSTOMER
      sections: [ POPULAR, CATEGORY_SPOTLIGHT ]
      No personalised claim is made anywhere in the payload.

successfulOrderCount BETWEEN 1 AND 2
    → LIMITED HISTORY
      sections: [ BUY_AGAIN, FREQUENTLY_BOUGHT_TOGETHER?, CATEGORY_PICKS, POPULAR ]
      BUY_AGAIN is real but short. POPULAR backfills the screen.

successfulOrderCount >= 3
    → ESTABLISHED
      sections: [ BUY_AGAIN, CATEGORY_PICKS, FREQUENTLY_BOUGHT_TOGETHER?, POPULAR ]
```

Rules that apply at every tier:

- A section whose candidate list is **empty after availability filtering is omitted from the response entirely.** The client renders what it is given; it never renders an empty titled rail.
- `POPULAR` is always computed and always last. It is the floor that guarantees a new customer sees a real shelf.
- `FREQUENTLY_BOUGHT_TOGETHER` is marked `?` because it is additionally gated on the support threshold (§14) and will almost certainly be absent at launch.
- The tier boundary of 3 is an **Open Decision** (§28, D3), not a fact.

## 8. Event / Data Strategy

**V1 collects no new events.** This is a deliberate decision, not an omission:

- The only section that purchase data cannot power is "recently viewed", which is out of scope.
- Purchase history is already recorded transactionally and is more reliable than any event stream.
- Collecting view/search events means storing per-customer browsing behaviour, which is a privacy cost with no V1 benefit (§20).

**When V2 needs events**, this is the minimum design — recorded now so it is not improvised later:

```sql
CREATE TABLE customer_product_events (
    id           BIGSERIAL PRIMARY KEY,
    customer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id   UUID REFERENCES products(id) ON DELETE CASCADE,
    event_type   customer_event_type_enum NOT NULL,   -- PRODUCT_VIEWED | ADDED_TO_CART | REMOVED_FROM_CART
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cpe_customer_recent ON customer_product_events (customer_id, occurred_at DESC);
CREATE INDEX idx_cpe_product_recent  ON customer_product_events (product_id, occurred_at DESC);
```

Deliberately absent from that design: IP address, user agent, session id, dwell time, referrer, search text. `ON DELETE CASCADE` on `customer_id` means deleting a customer erases their behavioural history, which the Play Store account-deletion requirement will need. Retention: 180 days, enforced by a scheduled `DELETE`. **`PRODUCT_PURCHASED` is deliberately not an event type** — `order_items` already is that record, and duplicating it would create two disagreeing sources of truth.

## 9. Candidate Generation

Four independent generators, each a pure repository function returning `RecommendationCandidate[]`. None of them ranks, filters for availability, or knows about the others.

```ts
export interface RecommendationCandidate {
  product_id: string;
  source: CandidateSource;          // 'BUY_AGAIN' | 'POPULAR' | 'CATEGORY_AFFINITY' | 'CO_PURCHASE'
  /** Source-local, NOT comparable across sources. The ranker normalises. */
  raw_score: number;
  /** Everything the ranker needs, so it never issues its own query. */
  signals: {
    orders_containing?: number;     // how many of THIS customer's orders held it
    last_purchased_at?: Date;
    total_quantity?: number;
    category_id?: string;
    co_occurrence_count?: number;
    global_order_count?: number;
  };
}
```

The pipeline is five discrete stages, each independently testable:

```
req.user.id
   │
   ├─► buyAgainCandidates(customerId)         ─┐
   ├─► popularCandidates(window)               │
   ├─► categoryAffinityCandidates(customerId)  ├─► merge()        (concat, keep every source tag)
   └─► coPurchaseCandidates(customerId)       ─┘
                                                   │
                                                   ▼
                                              dedupe()            (one row per product_id;
                                                                   union the source tags,
                                                                   keep max raw_score per source)
                                                   │
                                                   ▼
                                        filterOrderable()         (is_active AND is_available,
                                                                   via v_product_catalog)
                                                   │
                                                   ▼
                                                 rank()           (pure, deterministic)
                                                   │
                                                   ▼
                                              takeTopN()
                                                   │
                                                   ▼
                                              hydrate()           (v_product_catalog → CustomerProductDto)
```

**Why the layers are separate:** each has one reason to change. Adding a fifth source touches only `merge`'s input list. Changing the business definition of "orderable" touches only `filterOrderable`. Replacing the ranker with an ML model touches only `rank`. Mixing them into one SQL statement — the tempting shortcut — would make every one of those a rewrite, and would make the ML migration in §25 impossible without an API change.

## 10. Ranking

`rank()` is a **pure function**: `(candidates: DedupedCandidate[], weights: RankingWeights, now: Date, context: RankContext) => RankedCandidate[]`. It issues no queries and reads no clock of its own — `now` and `context` are both injected, so tests are deterministic and the ranker never reaches for the database.

### 10.1 Signal normalisation

Each signal is normalised to `[0, 1]` before weighting, so weights are comparable:

| Signal | Normalisation | Justification |
|---|---|---|
| `purchaseAffinity` | `min(orders_containing / 5, 1)` | Buying something in 5 separate orders is a settled habit; more adds no information. |
| `purchaseRecency` | `exp(-daysSince / halfLifeDays)` | Grocery need decays continuously, not in steps. Exponential decay with a configurable half-life is the standard model and has one parameter. |
| `categoryAffinity` | `categoryPurchases / totalPurchases` | Already a proportion. |
| `coOccurrence` | `min(co_occurrence_count / supportCeiling, 1)` | Same saturation argument as affinity. |
| `popularity` | `global_order_count / maxGlobalOrderCount` | Relative to the current top seller, so it is scale-free as the shop grows. |

### 10.2 Weights

```ts
/**
 * Everything rank() needs that is a property of the CUSTOMER or the SHOP
 * rather than of one candidate. Passed in so rank() stays pure and issues
 * no query of its own.
 */
export interface RankContext {
  /** category_id -> how many of this customer's delivered orders touched it. */
  categoryPurchases: Map<string, number>;
  /** Denominator for categoryPurchases. 0 for a cold-start customer. */
  totalPurchases: number;
  /** The current top seller's order count, so popularity is scale-free. */
  maxGlobalOrderCount: number;
}

export interface RankedCandidate extends DedupedCandidate {
  /** Weighted sum in [0, 1]. Internal only - never serialised to a client. */
  score: number;
}

export interface RankingWeights {
  purchaseAffinity: number;
  purchaseRecency: number;
  categoryAffinity: number;
  coOccurrence: number;
  popularity: number;
  halfLifeDays: number;
  affinityCeiling: number;
  supportCeiling: number;
}

/**
 * V1 defaults. These are STARTING POINTS chosen from grocery domain
 * reasoning, not measured optima — Blynk has no interaction data to
 * calibrate against yet. §24.1 defines the metrics that will calibrate them.
 */
export const DEFAULT_WEIGHTS: RankingWeights = {
  purchaseAffinity: 0.35,   // strongest: what you buy repeatedly
  purchaseRecency:  0.30,   // nearly as strong: groceries are cyclical
  categoryAffinity: 0.15,   // useful for discovery within known tastes
  coOccurrence:     0.10,   // weakest signal at Blynk's current volume
  popularity:       0.10,   // the floor, and the only cold-start signal
  halfLifeDays:     14,     // a fortnight: one typical grocery cycle
  affinityCeiling:   5,
  supportCeiling:   10,
};
```

Every number above is **justified, configurable, and documented as uncalibrated.** They live in one exported constant so a change is one edit and one diff, and so a future ML ranker can be swapped in without hunting for magic numbers. `halfLifeDays: 14` is the one worth stating plainly: it means a product bought 14 days ago scores half what it would have scored yesterday.

### 10.3 Determinism

The comparator ends with a total-order tie-break:

```
score DESC → orders_containing DESC → last_purchased_at DESC → product_id ASC
```

`product_id ASC` is arbitrary but **total**, which is the point: it guarantees the same inputs always produce the same order. Without it, two equally-scored products can swap places between requests and the customer watches the rail reshuffle. (This exact bug was already found and fixed once in the interim client-side ranker — see `product_ranking.dart`.)

## 11. Buy Again

### 11.1 What counts as a purchase

This is the decision everything else rests on, so it is explicit:

> A product counts as purchased by a customer when it appears in an `order_items` row whose parent order's `order_status` is **`DELIVERED`**, and whose own `item_status` is **not** `UNAVAILABLE`.

Rationale, point by point:

- **`DELIVERED` only.** `CANCELLED`, `FAILED`, `CUSTOMER_UNAVAILABLE` and `ITEM_UNAVAILABLE` all mean the customer did not receive the goods. Recommending "buy again" for something that never arrived is worse than saying nothing.
- **In-flight orders excluded.** `PLACED`, `PACKED`, `OUT_FOR_DELIVERY` are not yet outcomes. Including them would make Buy Again flicker as an order progresses.
- **`item_status = 'UNAVAILABLE'` excluded** even inside a delivered order: an order can be delivered with one line unfulfilled (`item_fulfillment_status_enum` exists precisely for this). That line is not a purchase.
- **`SUBSTITUTED` counts as a purchase of the original line's `product_id`.** It is the closest available truth, and the alternative — dropping it — loses a real signal. Flagged as Open Decision D5 because it is arguable.

### 11.2 Query

```sql
SELECT
    oi.product_id,
    COUNT(DISTINCT o.id)          AS orders_containing,
    SUM(oi.quantity)              AS total_quantity,
    MAX(o.delivered_at)           AS last_purchased_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.customer_id = $1
  AND o.order_status = 'DELIVERED'
  AND oi.item_status <> 'UNAVAILABLE'
GROUP BY oi.product_id
ORDER BY last_purchased_at DESC, orders_containing DESC
LIMIT $2;
```

`raw_score` = `orders_containing`. Cost: index scan on `idx_orders_customer_placed` for the customer's orders, then the new `idx_order_items_order` (Task 1) to reach their lines. Bounded by one customer's order count.

**Fallback:** empty result → section omitted, tier falls through to Popular.

**Limitation:** a customer who buys a product once and never again still sees it, ranked low by recency decay. This is correct for groceries (staples recur) and wrong for one-off purchases; with no product-type metadata (§16) V1 cannot distinguish them.

## 12. Popular Products

### 12.1 Definition

> Global, time-windowed count of **distinct delivered orders** containing each product within the last `popularityWindowDays` days.

- **Distinct orders, not summed quantity.** Ten customers buying one loaf each is a more meaningful popularity signal than one customer buying ten. Summing quantity lets a single bulk order dominate a 41-product catalogue.
- **Global, not per-category, in V1.** Per-category popularity is what `CATEGORY_SPOTLIGHT` uses; a second per-category variant adds a query for no distinct benefit at this scale.
- **Time-windowed, not all-time.** All-time popularity ossifies: early products accumulate an unbeatable lead. Window default 30 days (Open Decision D2).

### 12.2 Query

```sql
SELECT
    oi.product_id,
    COUNT(DISTINCT o.id) AS global_order_count
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.order_status = 'DELIVERED'
  AND o.delivered_at >= NOW() - ($1::int * INTERVAL '1 day')
  AND oi.item_status <> 'UNAVAILABLE'
GROUP BY oi.product_id
ORDER BY global_order_count DESC
LIMIT $2;
```

**Fallback chain** — this is the true cold-start floor and must never return empty on a stocked shop:

1. Delivered orders in the window.
2. If fewer than `minPopularResults` rows, widen to **all-time** delivered orders.
3. If still short, fall back to **newest orderable products** (`products.created_at DESC`) — labelled `NEW_ARRIVALS`, not `POPULAR`, because calling an unbought product popular would be a fabricated claim.

**Cost:** aggregate over the window. At 41 products this is trivial; §22 sets the threshold at which it should be materialised.

## 13. Product Similarity / Category Picks

### 13.1 The honest limitation

The only product metadata Blynk has is `category_id`, `name`, `description`, `unit`, `pack_size`, `sku`. There are **no tags, no attributes, no brand field, and no subcategories** — `categories` is a flat table with no parent column.

**Therefore V1 has no real product-similarity capability.** "Products in the same category" is the entire extent of what can be computed, and this plan calls that section `CATEGORY_PICKS` rather than "You May Also Like" or "Similar Products", because those titles would claim a similarity model that does not exist.

Name-token matching (e.g. two products sharing the token "milk") was considered and **rejected for V1**: with 41 products it is as likely to match "Milk Toffee" to "Fresh Milk" as to anything useful, and a wrong similarity claim is worse than an honest category one. Embeddings are explicitly deferred to §25 V4.

### 13.2 Category affinity query

```sql
WITH customer_categories AS (
    SELECT p.category_id, COUNT(DISTINCT o.id) AS purchases
    FROM order_items oi
    JOIN orders   o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.customer_id = $1
      AND o.order_status = 'DELIVERED'
      AND oi.item_status <> 'UNAVAILABLE'
    GROUP BY p.category_id
)
SELECT
    v.id AS product_id,
    v.category_id,
    cc.purchases,
    (SELECT SUM(purchases) FROM customer_categories) AS total_purchases
FROM v_product_catalog v
JOIN customer_categories cc ON cc.category_id = v.category_id
WHERE v.is_active = TRUE
  AND v.is_available = TRUE
  AND v.id NOT IN (
      SELECT oi2.product_id FROM order_items oi2
      JOIN orders o2 ON o2.id = oi2.order_id
      WHERE o2.customer_id = $1 AND o2.order_status = 'DELIVERED'
  )
ORDER BY cc.purchases DESC
LIMIT $2;
```

The `NOT IN` is the point of this source: it recommends things in categories you buy from that **you have not bought**, which is the only discovery V1 offers. Without it the section would duplicate Buy Again.

## 14. Frequently Bought Together

### 14.1 Design

Item-to-item co-occurrence over delivered orders, seeded from the customer's most recent purchases.

- **Valid basket:** a `DELIVERED` order with **2 or more distinct** non-`UNAVAILABLE` product lines. Single-line orders carry no co-occurrence information.
- **Repeated products within one order are normalised to one** (`DISTINCT product_id` per order) — quantity is irrelevant to whether two things go together.
- **A product never recommends itself** (`a.product_id <> b.product_id`).
- **Minimum support threshold `minCoOccurrence`, default 3.** Below it, a "pair" is one or two coincidental baskets.

### 14.2 Query

```sql
WITH baskets AS (
    SELECT DISTINCT o.id AS order_id, oi.product_id
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.order_status = 'DELIVERED'
      AND oi.item_status <> 'UNAVAILABLE'
),
seeds AS (
    SELECT DISTINCT oi.product_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.customer_id = $1
      AND o.order_status = 'DELIVERED'
    ORDER BY oi.product_id
    LIMIT $2
)
SELECT b.product_id AS product_id, COUNT(*) AS co_occurrence_count
FROM baskets a
JOIN baskets b ON b.order_id = a.order_id AND b.product_id <> a.product_id
JOIN seeds  s ON s.product_id = a.product_id
WHERE b.product_id NOT IN (SELECT product_id FROM seeds)
GROUP BY b.product_id
HAVING COUNT(*) >= $3
ORDER BY co_occurrence_count DESC
LIMIT $4;
```

### 14.3 Expected behaviour at launch — stated plainly

**This section will return nothing for a long time.** With 41 products, a single dark store, and a new customer base, reaching 3 shared baskets for any pair takes real volume. That is the threshold working correctly, not a bug. The section is built now because it is cheap and because building it later means re-opening the same code; it is gated so it cannot embarrass the shop with noise.

**Low-volume products** are handled by the same threshold — they simply never reach it and never appear.

**Cost:** the self-join on `baskets` is the most expensive query in the plan, O(sum of basket_size²). At current volume it is negligible. §22 defines the order count at which it must be materialised.

## 15. Availability Integration

**The rule is not re-derived. It is reused.**

Orderability in Blynk is `is_active AND is_available` — established at `order.service.ts:160`, which rejects an order with `PRODUCT_UNAVAILABLE` if either is false, and confirmed by `docs/04-business/business-rules.md:63`: *"No reservation, no checkout stock check. Availability to customers is Admin's `is_available`."*

Therefore:

- `filterOrderable()` filters on exactly `is_active = TRUE AND is_available = TRUE`, read from `v_product_catalog`.
- It **does not consult `inventory`.** Blynk is a sourcing model: `quantity_on_hand` is not checked at order time, so using it here would hide products the customer can legitimately order and would invent a stricter rule than the business has.
- It runs **after** candidate generation and **before** ranking, so an unavailable product cannot consume a slot.
- Buy Again is filtered by the same rule as everything else: a previously-bought product that is now deactivated disappears (Review Focus #2).

The filter is a **single shared function** used by every source. Duplicating `is_active AND is_available` into four generator queries would guarantee they drift.

## 16. Pricing Integration

**Recommendations never compute, cache, store, or adjust a price.**

The pipeline carries `product_id` only. At the last stage, `hydrate()` reads the surviving ids from `v_product_catalog` and shapes exactly the existing `CustomerProductDto`:

```ts
{ id, category_id, category_name, name, slug, description, sku, barcode,
  unit, pack_size, image_url, image_focal_x, image_focal_y,
  selling_price, is_available }
```

`selling_price` comes from `v_product_catalog.calculated_selling_price`, the same column `catalogService.listProducts` uses (`catalog.service.ts:169`). This guarantees a product shows the same price in a recommendation rail as in the category grid, because it is literally the same expression in the same view.

`purchase_cost`, `custom_markup_percent` and `effective_markup_percent` are **never** selected into a customer response. Task 10 has a test asserting their absence.

**Implementation note:** hydration must be a **single** `WHERE id = ANY($1)` query, not one per product. §22 names this as the N+1 risk.

## 17. API Design

### 17.1 Endpoint

```
GET /api/v1/me/recommendations
```

**Why `/me` and not `/customer/recommendations`:** `apiRouter.use('/me', meRouter)` already exists in `src/app.ts:123` and is the established prefix for "the authenticated caller's own resources". `/customer/...` would invent a second convention for the same idea. The path also makes the security property visible: there is no id in the URL, so there is nothing to tamper with.

### 17.2 Request

| | |
|---|---|
| Auth | `requireAuth` + `requireRoles('CUSTOMER')` |
| Customer identity | `req.user.id` only — **no `customer_id` parameter exists** |
| `sections` | optional CSV of section types; default = all applicable to the tier |
| `limit` | optional, per-section product count, `1..20`, default 10 |
| Pagination | **none.** Sections are short, fixed shelves; a paginated recommendation rail is not a product requirement and would invite enumeration. |

### 17.3 Response

```json
{
  "success": true,
  "data": {
    "sections": [
      {
        "type": "BUY_AGAIN",
        "title": "Buy it again",
        "products": [ { "id": "...", "name": "...", "selling_price": 540, "...": "..." } ]
      },
      {
        "type": "POPULAR",
        "title": "Popular in Dharga Town",
        "products": [ ]
      }
    ]
  }
}
```

Section types: `BUY_AGAIN | CATEGORY_PICKS | FREQUENTLY_BOUGHT_TOGETHER | POPULAR | NEW_ARRIVALS`.

**Contract rules:**

- `products` uses the **existing** `CustomerProductDto` shape, unchanged, so the Flutter `ProductModel` parses it with no new code.
- **No internal signals are exposed.** No score, no source tag, no `orders_containing`, no `co_occurrence_count`. These are a competitor's view of Blynk's order book and a customer's view of Blynk's ranking logic; neither belongs on the wire (§19 threat 5).
- **Empty sections are omitted, not returned empty.** A section present in the array always has at least one product.
- **Zero applicable sections returns `{"sections": []}` with HTTP 200**, not 404. "Nothing to recommend" is a valid state, not an error.
- Errors use the existing `AppError` envelope.

### 17.4 Titles

Titles are **server-supplied** so wording changes do not require an app release, and are deliberately factual:

| Type | Title | Why this wording |
|---|---|---|
| `BUY_AGAIN` | "Buy it again" | States the fact. |
| `CATEGORY_PICKS` | "More in {category}" | Names the real basis. Not "You may also like" — no similarity model exists. |
| `FREQUENTLY_BOUGHT_TOGETHER` | "Often bought together" | Literally what the query measures. |
| `POPULAR` | "Popular right now" | Only ever shown over a **real** windowed order count. |
| `NEW_ARRIVALS` | "New in store" | Used when popularity has no data — never mislabelled as popular. |

## 18. Database Changes

### 18.1 Existing tables reused — no duplication

`orders`, `order_items`, `products`, `categories`, `users`, and the `v_product_catalog` view. **No recommendation-owned copy of product, order, or customer data is created.**

### 18.2 New in V1: indexes only

```sql
-- Migration 010_recommendation_indexes.sql
-- Every recommendation query joins order_items, which today has no index
-- beyond its primary key and FK constraints.

-- Buy Again / Category affinity: given a customer's orders, reach their lines.
CREATE INDEX IF NOT EXISTS idx_order_items_order
    ON order_items (order_id);

-- Popularity / co-occurrence: aggregate by product.
CREATE INDEX IF NOT EXISTS idx_order_items_product
    ON order_items (product_id);

-- Popularity window: delivered orders by delivery date.
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at
    ON orders (delivered_at DESC)
    WHERE order_status = 'DELIVERED';
```

These are justified by queries in this plan, are additive, and carry no data. The down-migration drops exactly these three.

### 18.3 New tables: none

No `recommendation_*` table is created in V1. A materialised `product_popularity` table is designed in §22 as the first thing to add **when measurement shows it is needed** — not before.

## 19. Security / Threat Model

| # | Threat | Control | Test |
|---|---|---|---|
| 1 | Customer A reads Customer B's recommendations | Identity comes solely from `req.user.id`; no id is accepted from the client, so there is no parameter to change. | Task 10: two customers with different histories get different, correct payloads. |
| 2 | Customer supplies another customer id | Zod schema has **no** `customer_id` / `user_id` field; unknown query params are ignored. | Task 10: `?customer_id=<B>` and `?user_id=<B>` both return **A's** recommendations unchanged. |
| 3 | Unauthenticated request | `requireAuth` runs before the handler. | Task 10: no token → 401, and no database query is issued. |
| 4 | Product data leakage | Response is the existing `CustomerProductDto`; cost/markup columns are never selected. | Task 10: assert `purchase_cost`, `custom_markup_percent`, `effective_markup_percent` absent from every product. |
| 5 | Internal signals leaking | Scores, source tags and counts are stripped in the service before the controller sees them. | Task 10: assert no `score`, `source`, `raw_score`, `orders_containing`, `co_occurrence_count` key anywhere in the payload. |
| 6 | Excessive requests | `InMemoryRateLimiter.checkLimit('recs:' + userId, 30, 60_000)`. Keyed by **user id**, not IP, so one abusive account cannot lock out a shared NAT. | Task 10: 31st request within the window → 429. |
| 7 | Endpoint used to enumerate customers or the catalogue | No id in the path or query; no pagination; per-section `limit` capped at 20; only orderable products are ever returned — the same set `GET /products` already exposes publicly. Co-occurrence output is an **aggregate over a threshold**, never a list of orders. | Task 10: `limit=1000` is rejected by Zod, not silently honoured. |

**A note on threat 7 that the implementer must not lose:** Frequently Bought Together is derived from *other customers'* baskets. The threshold in §14 is not only a quality control — it is a **privacy control**. With `minCoOccurrence = 1`, a customer who ordered an unusual pair could see that pair reflected back, which leaks a single stranger's basket. The threshold must never be configured to 1 in production, and Task 7's test asserts the floor.

## 20. Privacy Considerations

- **No new personal data is collected in V1.** Recommendations are computed from order records the customer can already read in full on their Orders screen.
- **Nothing is stored per customer.** Recommendations are computed per request and never persisted, so there is no recommendation profile to leak, export, or delete.
- **Account deletion needs no extra work in V1** — deleting a user cascades their orders, and nothing else holds their data. (This matters for the outstanding Play Store account-deletion requirement.)
- **Cross-customer data is only ever exposed as thresholded aggregates** (§19).
- If V2 adds view/search events (§8), a privacy review is required **before** it ships: that is the point at which Blynk starts recording browsing behaviour rather than transactions.

## 21. Flutter Integration

### 21.1 Where

**Home only.** Product detail, category pages and cart are explicitly out of scope — each would need its own justification and its own empty/error behaviour, and none has a demonstrated need.

### 21.2 Replacing the interim client-side ranking

A client-side ranking shipped earlier: `lib/Services/product_ranking.dart` reorders "Browse all" from `OrderProvider.orders` and retitles the section "Based on your orders".

**This plan removes it** (Task 12). Two rankings — one on the client from partial data, one on the server from complete data — would disagree visibly, and the client version cannot see Popular, Category Picks or co-occurrence. Its tests are replaced by the new section tests, not deleted, and the honesty guard in `home_composition_test.dart` ("never claims a signal the backend does not have") **must continue to pass unchanged**.

### 21.3 Home composition

Order on Home, top to bottom:

```
AppBar / search / promo carousel / categories          (unchanged)
  ↓
Recommendation sections, in server order                (new)
  ↓
Browse all                                              (unchanged, catalogue order restored)
```

The server decides section order; the client renders the array as given. This keeps ordering a business decision, changeable without an app release.

### 21.4 States

| State | Behaviour |
|---|---|
| Loading | Existing `ProductRail` skeleton, one per expected section. Home's other content renders immediately — recommendations never block the shop. |
| Empty (`sections: []`) | Render nothing at all. No placeholder, no "no recommendations yet" message. Home falls back to promo + categories + Browse all, which is a complete shop. |
| Error | Render nothing, log locally. **A failed recommendation call must never surface an error to the customer or block Home** — it is an enhancement, not the shop. |
| Offline | Same as error. The existing `ConnectivityBanner` remains the screen's single voice about being offline. |
| Refresh | Pull-to-refresh refetches recommendations alongside the catalogue. |
| Product tap | Existing `/product` route with the `ProductModel`. |
| Add to cart | Existing `AddToCartButton` and `CartProvider`. No recommendation-specific cart path. |

### 21.5 Reuse

`ProductModel` parses the response unchanged (it is `CustomerProductDto`). `ProductCard`, `ProductRail`, `BlynkProductGrid` and `BlynkSectionHeader` are all reused as-is. **No new product tile is created.**

## 22. Performance

### 22.1 Current scale

41 products, 8 categories, single dark store. Every query here is sub-10ms after Task 1's indexes.

### 22.2 Design rules

- **Bounded candidates.** Each generator has a `LIMIT`; the merge input is capped at `4 × maxCandidatesPerSource` (default 50 each, so ≤200 rows reach the ranker).
- **No N+1.** Hydration is one `WHERE id = ANY($1)` query. The availability filter is part of that same read. Task 11 asserts the query count.
- **Top-N only.** Ranking sorts ≤200 in-process rows — microseconds.
- **One round trip per generator**, four generators, executed with `Promise.all`.
- **Latency budget: p95 < 200ms** for the whole endpoint at current scale.

### 22.3 When to add caching — thresholds, not vibes

**No caching in V1.** Introduce it only when a measured threshold is crossed:

| Trigger | Action |
|---|---|
| Popularity query p95 > 50ms, or > 50k delivered orders | Materialise `product_popularity (product_id, window_days, order_count, computed_at)`, refreshed by a worker using the **existing** `notifications` outbox pattern — not Redis. |
| Co-occurrence query p95 > 100ms | Materialise `product_co_occurrence (product_a, product_b, count, computed_at)` nightly. This is the first query that will hurt; its cost is O(Σ basket_size²). |
| Endpoint p95 > 200ms with both materialised | Only then consider a cache layer, and revisit whether Redis is justified. |

## 23. Testing Strategy

### 23.1 Unit (pure functions, no database)

`merge`, `dedupe`, `rank`, tier selection, weight normalisation, determinism, empty inputs, single-candidate inputs, all-unavailable inputs.

### 23.2 Integration (real database, Vitest + Supertest)

Following `tests/catalog.test.ts` conventions: seed customers and delivered orders, mint tokens with `generateAccessToken`, assert the payload, clean up in `afterAll`.

### 23.3 Security

Every row of §19's table has a named test in Task 10.

### 23.4 End-to-end

> Customer places an order containing Milk → order is marked `DELIVERED` → customer requests recommendations → **Milk appears in `BUY_AGAIN`**.

and

> Customer A and Customer B have disjoint delivered orders → each requests recommendations with their own token → **neither sees the other's products in `BUY_AGAIN`**.

and

> A product in a customer's delivered order is set `is_available = false` → **it disappears from `BUY_AGAIN`** while the rest of the section is intact.

### 23.5 Reusable existing tests

`tests/helpers/` and `tests/setup/` provide database setup. `tests/catalog.test.ts` provides the token/seed pattern. `tests/security.test.ts` provides the auth-failure assertions to copy.

## 24. Analytics and Observability

### 24.1 Measuring whether recommendations actually work

The honest position for V1: **Blynk cannot currently measure recommendation quality, because it has no impression or click log.** That is a consequence of §8 (no event collection), and it is stated here rather than papered over.

What V1 *can* measure, from data it already has:

| Metric | Computable in V1? | From |
|---|---|---|
| **Coverage** — share of the orderable catalogue that appears in at least one customer's recommendations | **Yes** | Run the pipeline over all customers offline; count distinct products. |
| **Diversity** — distinct categories per section | **Yes** | The section payload itself. |
| **Section fill rate** — how often each section is non-empty | **Yes** | The `recommendations.sections.returned` metric (§24.2). |
| **Buy-Again precision proxy** — share of a customer's next order already present in their previous Buy Again | **Yes, offline** | Replay: compute recommendations as of order N−1, intersect with order N. This is the single most useful V1 quality number and needs no new data. |
| Recommendation CTR | **No** | Needs `RECOMMENDATION_SHOWN` + `RECOMMENDATION_CLICKED`. |
| Add-to-cart rate from a rail | **No** | Needs cart events (§8). |
| Purchase conversion attributable to a rail | **No** | Needs impression→order attribution. |

**V1 does not build recommendation interaction events.** Four event types (`RECOMMENDATION_SHOWN`, `_CLICKED`, `_ADDED_TO_CART`, `_PURCHASED`) would be needed for CTR and conversion, and each one means storing per-customer browsing behaviour. The Buy-Again replay above gives a real quality signal for free; that is enough to decide whether V1 is worth keeping. Interaction events belong to V2, alongside §8's `customer_product_events`, and require the same privacy review.

**Weight calibration** (§10.2) therefore proceeds from the replay metric, not from CTR: adjust `DEFAULT_WEIGHTS`, re-run the replay over historical orders, keep the weights that predict the next order best. This is offline, reproducible, and needs no production traffic.

### 24.2 Operational metrics

Using the existing `src/utils/metrics.ts`, no new system:

| Metric | Why |
|---|---|
| `recommendations.request.duration_ms` | The §22 latency budget is meaningless unmeasured. |
| `recommendations.candidates.{source}` | Shows which sources actually contribute; a source at zero for weeks is dead weight. |
| `recommendations.sections.returned` | Detects a silent collapse to zero sections. |
| `recommendations.filtered_unavailable` | A spike means the catalogue is going out of stock. |
| `recommendations.errors` | Count by error code. |

**Never logged:** customer id alongside product ids, the candidate list, or any per-customer signal. Latency and counts only; the `requestId` already in every log line is sufficient to correlate.

## 25. ML Evolution Path

The API contract in §17 does not change at any step below. Only `rank()` and the generator list change.

| Phase | Change | Prerequisite |
|---|---|---|
| **V1** *(this plan)* | Rules + SQL over orders. Deterministic ranker. | None. |
| **V2** | Add behavioural signals: `customer_product_events` (§8), a `RECENTLY_VIEWED` generator, view-informed recency. | A privacy review, and a real need. |
| **V3** | Collaborative filtering (item-item cosine over the customer×product matrix), computed nightly into a materialised table. | Roughly 10k delivered orders — below that the matrix is too sparse to beat popularity. |
| **V4** | Product embeddings for genuine similarity, replacing `CATEGORY_PICKS` with a real "similar products" section. | Either richer product metadata or a text model over names/descriptions. |
| **V5** | Learning-to-rank: `rank()` becomes a model call, trained on the §24.1 interaction metrics V1 deliberately does not collect. | A working impression/click log — which V1 deliberately does not build. |

**What makes this possible:** `rank()` is a pure function behind `RankingWeights`, and generators are independent. V5 replaces one function. The customer app never knows.

## 26. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Too little data makes every section thin or absent at launch** | High — near-certain | Popular's fallback chain (§12.2) guarantees a real shelf. FBT is gated off. Expectations set here, not discovered in review. |
| Co-occurrence self-join degrades as orders grow | Medium | Threshold + `LIMIT` now; materialisation threshold named in §22. |
| Uncalibrated weights produce mediocre ordering | Medium | Weights are one exported constant; §18 metrics calibrate them. Being wrong is cheap and reversible. |
| Recommendation failure breaks Home | High if it happens | §21.4: failures render nothing and never block Home. Asserted in Task 12. |
| Two rankings disagree (client + server) | Medium | Task 12 deletes the client ranker in the same task that adds the server sections. |
| Backend test suite mutates the dev database | Medium | Pre-existing (§2.5). Tests clean up in `afterAll`; the 3 known failures are documented so they are not misread as regressions. |
| In-memory rate limiter is per-process | Low now | Single instance today. Revisit with horizontal scaling. |

## 27. Conflicts With Ongoing Work

Discovered during investigation, and live right now:

1. **The customer premium redesign is mid-flight.** `HomeProductSections`, `home_screen.dart`, `card_product.dart`, `category_widget.dart` and `cart_bar.dart` have all changed in the last two days and are **uncommitted**. Task 12 touches `HomeProductSections` and `home_screen.dart` directly. **Rebase on the redesign, do not run in parallel with it.**
2. **`product_ranking.dart` is the interim implementation this plan replaces.** It and its 14 tests were added on 2026-09-24.
3. **`home_composition_test.dart` contains the honesty guard** forbidding unearned personalisation claims. It must keep passing; the new section titles are earned, so it will.
4. **The working tree has substantial uncommitted backend changes** across `catalog`, `promotions`, `notifications` and `orders`. Confirm what is intentional before adding migration `010`.
5. **Category images were just wired into Operations** (`categories.image_url`). Unrelated but adjacent to `v_product_catalog`.

## 28. Open Decisions

These materially affect architecture or product. **Do not implement Tasks 4–9 before D1, D2, D3 and D5 are answered.**

---

**D1 — Does "purchased" mean `DELIVERED` only?**

- *Options:* (a) `DELIVERED` only; (b) `DELIVERED` + `OUT_FOR_DELIVERY`; (c) any non-cancelled order.
- *Recommendation:* **(a)**. It is the only status meaning the customer received the goods.
- *Consequence:* (a) Buy Again lags by the delivery window — a product bought this morning appears this evening. (b) Flickers as orders progress. (c) Recommends things that were never received.

---

**D2 — Popularity window length?**

- *Options:* 7 / 30 / 90 days / all-time.
- *Recommendation:* **30 days**, with the all-time fallback in §12.2.
- *Consequence:* 7 is too sparse at launch to produce a list. 90 dampens seasonality. All-time ossifies and permanently favours early products.

---

**D3 — Where is the "established customer" boundary?**

- *Options:* 2 / 3 / 5 successful orders.
- *Recommendation:* **3**.
- *Consequence:* Too low and Category Picks fires on one accidental purchase. Too high and regular customers stay on a generic shelf. Cheap to change — it is one constant.

---

**D4 — Minimum co-occurrence support?**

- *Options:* 2 / 3 / 5.
- *Recommendation:* **3**, and **never 1** (§19 — it is a privacy control, not only quality).
- *Consequence:* Lower shows noise and risks reflecting one stranger's basket. Higher means the section stays empty longer.

---

**D5 — Does a `SUBSTITUTED` line count as a purchase of the original product?**

- *Options:* (a) yes; (b) no; (c) count it for the substitute instead — **not currently possible, the substitute product id is not recorded**.
- *Recommendation:* **(a)**, with a note that (c) becomes available if substitution ever records what was supplied.
- *Consequence:* (a) may recommend something the customer did not actually receive. (b) loses a real signal. This is the weakest-evidence decision in the plan.

---

**D6 — Products per section?**

- *Options:* 6 / 10 / 20.
- *Recommendation:* **10**, client-overridable up to 20.
- *Consequence:* At 41 products, 20 per section across 4 sections would show most of the catalogue twice.

---

**D7 — Section order: server-decided or client-decided?**

- *Options:* (a) server; (b) client.
- *Recommendation:* **(a)**. Ordering is a business decision; (b) needs an app release to change it.

---

**D8 — Are recommendations recomputed per request or held for a session?**

- *Options:* (a) per request; (b) cached per session.
- *Recommendation:* **(a)** in V1. It is fast enough (§22) and always fresh.
- *Consequence:* (b) is an optimisation with no current justification and adds an invalidation problem.

---

**D9 — Does Operations need any recommendation controls in V1?**

- *Options:* (a) none; (b) read-only preview; (c) pin/exclude products.
- *Recommendation:* **(a)**. No operator has asked; (c) is a merchandising feature needing its own design.

---

**D10 — Does `POPULAR` show for established customers too?**

- *Options:* (a) always, last; (b) only for cold-start customers.
- *Recommendation:* **(a)**. It is the backfill that keeps Home full when personalised sections are short.

## 29. Acceptance Criteria

1. `GET /api/v1/me/recommendations` returns 401 unauthenticated, 403 for a `RIDER` token, 200 for a `CUSTOMER`.
2. A customer with a `DELIVERED` order containing product X sees X in `BUY_AGAIN`.
3. A customer with **zero** successful orders receives no `BUY_AGAIN` section and a non-empty `POPULAR` section on a stocked shop.
4. Setting a purchased product `is_available = false` removes it from every section within one request.
5. No response contains `purchase_cost`, `custom_markup_percent`, `effective_markup_percent`, `score`, `source`, or any candidate count.
6. Passing `?customer_id=<other>` returns the **caller's own** recommendations, unchanged.
7. Two customers with disjoint histories receive disjoint `BUY_AGAIN` sections.
8. `selling_price` for a product in a recommendation equals `selling_price` for the same product from `GET /api/v1/catalog/products`.
9. Identical inputs produce an identical product order across 20 consecutive requests.
10. `FREQUENTLY_BOUGHT_TOGETHER` is absent when no pair reaches `minCoOccurrence`.
11. Home renders fully when the recommendations call fails; no error is shown.
12. `flutter analyze` clean; the full Flutter suite passes; `home_composition_test.dart`'s honesty guard still passes.
13. The backend suite shows **no new failures** beyond the 3 documented pre-existing ones (§2.5).
14. `product_ranking.dart` is deleted and nothing imports it.

## 30. Exact File / Module Impact

### New files

```
backend/api/src/database/migrations/010_recommendation_indexes.sql
backend/api/src/database/migrations/010_recommendation_indexes_down.sql
backend/api/src/modules/recommendations/index.ts
backend/api/src/modules/recommendations/recommendations.schema.ts
backend/api/src/modules/recommendations/recommendations.repository.ts
backend/api/src/modules/recommendations/recommendations.ranker.ts
backend/api/src/modules/recommendations/recommendations.service.ts
backend/api/src/modules/recommendations/recommendations.controller.ts
backend/api/tests/recommendations.test.ts
backend/api/tests/recommendations-security.test.ts
backend/api/tests/recommendations-ranker.test.ts

apps/customer/blinkit-clone-Flutter-ecommerce-/lib/Models/recommendation_section.dart
apps/customer/blinkit-clone-Flutter-ecommerce-/lib/Services/Providers/recommendation.provider.dart
apps/customer/blinkit-clone-Flutter-ecommerce-/lib/UI/Widgets/Organisms/home_recommendations.dart
apps/customer/blinkit-clone-Flutter-ecommerce-/test/recommendation_provider_test.dart
apps/customer/blinkit-clone-Flutter-ecommerce-/test/home_recommendations_test.dart
```

### Modified files

```
backend/api/src/app.ts                     — mount recommendationsRouter on meRouter
apps/customer/.../lib/main.dart            — provide RecommendationProvider
apps/customer/.../lib/Screens/home_screen.dart
apps/customer/.../lib/UI/Widgets/Organisms/home_product_sections.dart
apps/customer/.../test/home_composition_test.dart
```

### Deleted files

```
apps/customer/.../lib/Services/product_ranking.dart
apps/customer/.../test/product_ranking_test.dart      (coverage moves to the ranker + section tests)
```

### Untouched — stated so nobody widens scope

`catalog.*`, `order.*`, `pricing.*`, `inventory.*`, `promotions.*`, `auth.*`, every Operations file, every Rider file, `card_product.dart`, `category_widget.dart`, `cart_bar.dart`.

---

# Implementation Phases

Sixteen tasks. Tasks 1–3 are safe to start before the Open Decisions are answered; **Tasks 4–9 are blocked on D1, D2, D3 and D5.**

### Task 1: Recommendation indexes

**Files:**
- Create: `backend/api/src/database/migrations/010_recommendation_indexes.sql`
- Create: `backend/api/src/database/migrations/010_recommendation_indexes_down.sql`
- Test: `backend/api/tests/recommendations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `idx_order_items_order`, `idx_order_items_product`, `idx_orders_delivered_at`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { pool } from '../src/database/connection.js';

describe('recommendation indexes', () => {
  it('order_items is indexed on order_id and product_id', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'order_items'`
    );
    const names = rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain('idx_order_items_order');
    expect(names).toContain('idx_order_items_product');
  });

  it('delivered orders are indexed by delivery date', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'orders'`
    );
    expect(rows.map((r: { indexname: string }) => r.indexname))
      .toContain('idx_orders_delivered_at');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend/api && npx vitest run tests/recommendations.test.ts`
Expected: FAIL — `idx_order_items_order` not found.

- [ ] **Step 3: Write the migration**

```sql
-- 010_recommendation_indexes.sql
CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders (delivered_at DESC)
    WHERE order_status = 'DELIVERED';
```

```sql
-- 010_recommendation_indexes_down.sql
DROP INDEX IF EXISTS idx_orders_delivered_at;
DROP INDEX IF EXISTS idx_order_items_product;
DROP INDEX IF EXISTS idx_order_items_order;
```

- [ ] **Step 4: Apply and re-run**

Run: `cd backend/api && npm run migrate && npx vitest run tests/recommendations.test.ts`
Expected: PASS.

- [ ] **Step 5: Do not commit** (per Global Constraints).

---

### Task 2: Module skeleton and types

**Files:**
- Create: `backend/api/src/modules/recommendations/recommendations.schema.ts`
- Create: `backend/api/src/modules/recommendations/index.ts`
- Modify: `backend/api/src/app.ts`

**Interfaces:**
- Produces: `CandidateSource`, `SectionType`, `RecommendationCandidate`, `DedupedCandidate`, `RankingWeights`, `DEFAULT_WEIGHTS`, `recommendationQuerySchema`, `recommendationsRouter`.

- [ ] **Step 1: Write the failing test**

```ts
it('GET /api/v1/me/recommendations exists and requires auth', async () => {
  const res = await request(app).get('/api/v1/me/recommendations');
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run it** — Expected: FAIL with 404 (route not mounted).

- [ ] **Step 3: Write the schema and router**

```ts
// recommendations.schema.ts
import { z } from 'zod';

export const SECTION_TYPES = [
  'BUY_AGAIN', 'CATEGORY_PICKS', 'FREQUENTLY_BOUGHT_TOGETHER', 'POPULAR', 'NEW_ARRIVALS',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const CANDIDATE_SOURCES = [
  'BUY_AGAIN', 'POPULAR', 'CATEGORY_AFFINITY', 'CO_PURCHASE',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export interface RecommendationCandidate {
  product_id: string;
  source: CandidateSource;
  raw_score: number;
  signals: {
    orders_containing?: number;
    last_purchased_at?: Date | null;
    total_quantity?: number;
    category_id?: string;
    co_occurrence_count?: number;
    global_order_count?: number;
  };
}

export interface DedupedCandidate {
  product_id: string;
  sources: CandidateSource[];
  signals: RecommendationCandidate['signals'];
}

/**
 * Everything rank() needs that is a property of the CUSTOMER or the SHOP
 * rather than of one candidate. Passed in so rank() stays pure.
 */
export interface RankContext {
  categoryPurchases: Map<string, number>;
  totalPurchases: number;
  maxGlobalOrderCount: number;
}

export interface RankedCandidate extends DedupedCandidate {
  /** Weighted sum in [0, 1]. Internal only - never serialised to a client. */
  score: number;
}


export interface RankingWeights {
  purchaseAffinity: number;
  purchaseRecency: number;
  categoryAffinity: number;
  coOccurrence: number;
  popularity: number;
  halfLifeDays: number;
  affinityCeiling: number;
  supportCeiling: number;
}

/** Starting points from grocery reasoning, NOT measured optima. See plan §10.2. */
export const DEFAULT_WEIGHTS: RankingWeights = {
  purchaseAffinity: 0.35,
  purchaseRecency: 0.30,
  categoryAffinity: 0.15,
  coOccurrence: 0.10,
  popularity: 0.10,
  halfLifeDays: 14,
  affinityCeiling: 5,
  supportCeiling: 10,
};

/** No customer_id field exists here, and that is the security control. */
export const recommendationQuerySchema = z.object({
  sections: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type RecommendationQueryInput = z.infer<typeof recommendationQuerySchema>;
```

```ts
// index.ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { recommendationsController } from './recommendations.controller.js';

export const recommendationsRouter = Router();
recommendationsRouter.get(
  '/recommendations',
  requireAuth,
  requireRoles('CUSTOMER'),
  recommendationsController.getRecommendations.bind(recommendationsController)
);

export * from './recommendations.schema.js';
```

Mount in `src/app.ts` beside the existing `/me` router:

```ts
apiRouter.use('/me', recommendationsRouter);
```

- [ ] **Step 4: Run it** — Expected: PASS (401).

- [ ] **Step 5: Do not commit.**

---

### Task 3: Availability filter and hydration

**Files:**
- Create: `backend/api/src/modules/recommendations/recommendations.repository.ts`
- Test: `backend/api/tests/recommendations.test.ts`

**Interfaces:**
- Produces: `filterOrderable(ids: string[]): Promise<string[]>`, `hydrateProducts(ids: string[]): Promise<CustomerProductDto[]>`.

- [ ] **Step 1: Write the failing test**

```ts
it('filterOrderable drops inactive and unavailable products', async () => {
  const ids = [ACTIVE_AVAILABLE_ID, INACTIVE_ID, UNAVAILABLE_ID];
  expect(await recommendationsRepository.filterOrderable(ids)).toEqual([ACTIVE_AVAILABLE_ID]);
});

it('hydrateProducts returns the SAME price as the catalogue endpoint', async () => {
  const [hydrated] = await recommendationsRepository.hydrateProducts([ACTIVE_AVAILABLE_ID]);
  const res = await request(app).get(`/api/v1/catalog/products/${ACTIVE_AVAILABLE_ID}`);
  expect(hydrated.selling_price).toBe(res.body.data.product.selling_price);
});

it('hydrateProducts never leaks cost or markup', async () => {
  const [hydrated] = await recommendationsRepository.hydrateProducts([ACTIVE_AVAILABLE_ID]);
  expect(hydrated).not.toHaveProperty('purchase_cost');
  expect(hydrated).not.toHaveProperty('custom_markup_percent');
  expect(hydrated).not.toHaveProperty('effective_markup_percent');
});

it('hydrateProducts preserves the order it was given', async () => {
  const ordered = [ID_B, ID_A, ID_C];
  const out = await recommendationsRepository.hydrateProducts(ordered);
  expect(out.map((p) => p.id)).toEqual(ordered);
});
```

- [ ] **Step 2: Run it** — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { db } from '../../database/connection.js';

const CUSTOMER_COLUMNS = [
  'id', 'category_id', 'category_name', 'name', 'slug', 'description', 'sku',
  'barcode', 'unit', 'pack_size', 'image_url', 'image_focal_x', 'image_focal_y',
  'calculated_selling_price', 'is_available',
] as const;

export const recommendationsRepository = {
  /**
   * The ONE orderability rule, reused from order.service.ts:160 and
   * business-rules.md:63 — is_active AND is_available. Inventory is
   * deliberately not consulted: Blynk does not check stock at order time.
   */
  async filterOrderable(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('v_product_catalog')
      .select('id')
      .where('id', 'in', ids)
      .where('is_active', '=', true)
      .where('is_available', '=', true)
      .execute();
    const ok = new Set(rows.map((r) => r.id));
    return ids.filter((id) => ok.has(id));   // caller's order is the ranked order
  },

  /** ONE query, never one per product. */
  async hydrateProducts(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('v_product_catalog')
      .select(CUSTOMER_COLUMNS as unknown as string[])
      .where('id', 'in', ids)
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((p) => ({
        id: p.id,
        category_id: p.category_id,
        category_name: p.category_name,
        name: p.name,
        slug: p.slug,
        description: p.description,
        sku: p.sku,
        barcode: p.barcode,
        unit: p.unit,
        pack_size: p.pack_size,
        image_url: p.image_url,
        image_focal_x: p.image_focal_x,
        image_focal_y: p.image_focal_y,
        selling_price: Number(Number(p.calculated_selling_price).toFixed(2)),
        is_available: p.is_available,
      }));
  },
};
```

- [ ] **Step 4: Run it** — Expected: PASS.

- [ ] **Step 5: Do not commit.**

---

### Task 4: Buy Again generator — *blocked on D1, D5*

**Files:** Modify `recommendations.repository.ts`; test in `tests/recommendations.test.ts`.

**Interfaces:** Produces `buyAgainCandidates(customerId: string, limit: number): Promise<RecommendationCandidate[]>`.

- [ ] **Step 1: Write the failing tests** — including Review Focus #1.

```ts
it('returns products from DELIVERED orders, most recent first', async () => {
  const out = await recommendationsRepository.buyAgainCandidates(CUSTOMER_A, 10);
  expect(out.map((c) => c.product_id)).toEqual([RECENT_PRODUCT, OLDER_PRODUCT]);
  expect(out[0].source).toBe('BUY_AGAIN');
});

it('counts distinct orders, not units', async () => {
  // CUSTOMER_A bought MILK x3 in one delivered order.
  const milk = (await recommendationsRepository.buyAgainCandidates(CUSTOMER_A, 10))
    .find((c) => c.product_id === MILK)!;
  expect(milk.signals.orders_containing).toBe(1);
});

it('ignores CANCELLED and FAILED orders entirely', async () => {
  const out = await recommendationsRepository.buyAgainCandidates(CUSTOMER_CANCELLED_ONLY, 10);
  expect(out).toEqual([]);
});

it('a customer whose every order was cancelled is a cold-start customer', async () => {
  // Review Focus #1: they must look identical to a brand-new customer,
  // or Buy Again offers goods they never received.
  const out = await recommendationsRepository.buyAgainCandidates(CUSTOMER_CANCELLED_ONLY, 10);
  expect(out).toHaveLength(0);
});

it('ignores an UNAVAILABLE line inside a DELIVERED order', async () => {
  const out = await recommendationsRepository.buyAgainCandidates(CUSTOMER_PARTIAL, 10);
  expect(out.map((c) => c.product_id)).not.toContain(UNFULFILLED_PRODUCT);
});
```

- [ ] **Step 2: Run** — Expected: FAIL, `buyAgainCandidates` is not a function.

- [ ] **Step 3: Implement** the §11.2 query, mapping rows to `RecommendationCandidate` with `source: 'BUY_AGAIN'`, `raw_score: orders_containing`.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Do not commit.**

---

### Task 5: Popular generator — *blocked on D2*

**Files:** Modify `recommendations.repository.ts`; test in `tests/recommendations.test.ts`.

**Interfaces:** Produces `popularCandidates(windowDays: number, limit: number): Promise<RecommendationCandidate[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
it('ranks by distinct delivered orders, not summed quantity', async () => {
  // BREAD: 3 orders x 1 unit. RICE: 1 order x 10 units.
  const out = await recommendationsRepository.popularCandidates(30, 10);
  expect(out[0].product_id).toBe(BREAD);
});

it('excludes orders outside the window', async () => {
  const out = await recommendationsRepository.popularCandidates(7, 10);
  expect(out.map((c) => c.product_id)).not.toContain(BOUGHT_40_DAYS_AGO);
});

it('falls back to all-time when the window is empty', async () => {
  const out = await recommendationsRepository.popularCandidates(1, 10);
  expect(out.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the §12.2 query plus the two-step fallback.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 6: Category affinity generator — *blocked on D3*

**Files:** Modify `recommendations.repository.ts`.

**Interfaces:** Produces `categoryAffinityCandidates(customerId: string, limit: number): Promise<RecommendationCandidate[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
it('suggests unbought products from categories the customer buys from', async () => {
  const out = await recommendationsRepository.categoryAffinityCandidates(CUSTOMER_A, 10);
  expect(out.map((c) => c.product_id)).toContain(UNBOUGHT_DAIRY_PRODUCT);
});

it('never suggests something already bought - that is Buy Again job', async () => {
  const out = await recommendationsRepository.categoryAffinityCandidates(CUSTOMER_A, 10);
  expect(out.map((c) => c.product_id)).not.toContain(ALREADY_BOUGHT_PRODUCT);
});

it('is empty for a customer with no delivered orders', async () => {
  expect(await recommendationsRepository.categoryAffinityCandidates(NEW_CUSTOMER, 10)).toEqual([]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the §13.2 query.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 7: Co-purchase generator — *blocked on D4*

**Files:** Modify `recommendations.repository.ts`.

**Interfaces:** Produces `coPurchaseCandidates(customerId: string, minSupport: number, seedLimit: number, limit: number): Promise<RecommendationCandidate[]>`.

- [ ] **Step 1: Write the failing tests** — including Review Focus #4.

```ts
it('returns a pair once it reaches the support threshold', async () => {
  // MILK+EGGS share 3 delivered baskets.
  const out = await recommendationsRepository.coPurchaseCandidates(CUSTOMER_MILK, 3, 5, 10);
  expect(out.map((c) => c.product_id)).toContain(EGGS);
});

it('a pair supported by ONE basket is suppressed', async () => {
  // Review Focus #4: one shared basket is noise, and echoing it back can
  // reflect a single stranger's order. See plan section 19, threat 7.
  const out = await recommendationsRepository.coPurchaseCandidates(CUSTOMER_ODD, 3, 5, 10);
  expect(out.map((c) => c.product_id)).not.toContain(ODD_PAIR_PRODUCT);
});

it('never recommends the seed product back to itself', async () => {
  const out = await recommendationsRepository.coPurchaseCandidates(CUSTOMER_MILK, 1, 5, 10);
  expect(out.map((c) => c.product_id)).not.toContain(MILK);
});

it('normalises a product repeated within one order', async () => {
  const out = await recommendationsRepository.coPurchaseCandidates(CUSTOMER_BULK, 1, 5, 10);
  const eggs = out.find((c) => c.product_id === EGGS);
  expect(eggs?.signals.co_occurrence_count).toBe(1);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the §14.2 query.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 8: Merge, dedupe and orderability filter

**Files:** Create `recommendations.service.ts` (merge/dedupe portion); test in `tests/recommendations.test.ts`.

**Interfaces:** Produces `mergeCandidates(lists: RecommendationCandidate[][]): RecommendationCandidate[]`, `dedupeCandidates(all: RecommendationCandidate[]): DedupedCandidate[]`.

- [ ] **Step 1: Write the failing tests** — including Review Focus #2.

```ts
it('dedupe keeps one row per product and unions its sources', () => {
  const out = dedupeCandidates([
    { product_id: 'p1', source: 'BUY_AGAIN', raw_score: 2, signals: { orders_containing: 2 } },
    { product_id: 'p1', source: 'POPULAR',   raw_score: 9, signals: { global_order_count: 9 } },
  ]);
  expect(out).toHaveLength(1);
  expect(out[0].sources.sort()).toEqual(['BUY_AGAIN', 'POPULAR']);
  expect(out[0].signals.orders_containing).toBe(2);
  expect(out[0].signals.global_order_count).toBe(9);
});

it('a purchased product that is now unavailable is dropped from every section', async () => {
  // Review Focus #2: a recommendation you cannot add to cart is worse
  // than no recommendation.
  await setAvailability(PREVIOUSLY_BOUGHT, false);
  const res = await request(app)
    .get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${customerToken}`);
  const all = res.body.data.sections.flatMap((s: { products: { id: string }[] }) => s.products);
  expect(all.map((p: { id: string }) => p.id)).not.toContain(PREVIOUSLY_BOUGHT);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** merge (concat) and dedupe (Map keyed by `product_id`, union `sources`, shallow-merge `signals`), then call `filterOrderable` from Task 3.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 9: Deterministic ranker

**Files:** Create `recommendations.ranker.ts`; create `tests/recommendations-ranker.test.ts`.

**Interfaces:**
- Consumes: `DedupedCandidate`, `RankingWeights`, `DEFAULT_WEIGHTS`, `RankContext`, `RankedCandidate` from Task 2.
- Produces: `rank(candidates: DedupedCandidate[], weights: RankingWeights, now: Date, context: RankContext): RankedCandidate[]`.

- [ ] **Step 1: Write the failing tests** — including Review Focus #3.

```ts
it('ranks a recently bought product above an old one with equal frequency', () => {
  const out = rank([old, recent], DEFAULT_WEIGHTS, NOW, CTX);
  expect(out[0].product_id).toBe(recent.product_id);
});

it('a product from two sources outranks an equal product from one', () => {
  const out = rank([oneSource, twoSources], DEFAULT_WEIGHTS, NOW, CTX);
  expect(out[0].product_id).toBe(twoSources.product_id);
});

it('is a pure function: the same inputs always give the same order', () => {
  // Review Focus #3: Array.sort is not stable for large arrays, so without
  // a TOTAL tie-break the rail reshuffles between refreshes.
  const first = rank(TIED_CANDIDATES, DEFAULT_WEIGHTS, NOW, CTX).map((c) => c.product_id);
  for (let i = 0; i < 20; i++) {
    expect(rank(TIED_CANDIDATES, DEFAULT_WEIGHTS, NOW, CTX).map((c) => c.product_id)).toEqual(first);
  }
});

it('does not mutate its input', () => {
  const input = [...TIED_CANDIDATES];
  rank(input, DEFAULT_WEIGHTS, NOW, CTX);
  expect(input).toEqual(TIED_CANDIDATES);
});

it('recency uses the injected clock, never the real one', () => {
  const far = new Date(NOW.getTime() + 365 * 24 * 3600 * 1000);
  expect(rank([recent], DEFAULT_WEIGHTS, far, CTX)[0].score)
    .toBeLessThan(rank([recent], DEFAULT_WEIGHTS, NOW, CTX)[0].score);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export function rank(
  candidates: DedupedCandidate[],
  w: RankingWeights,
  now: Date,
  ctx: RankContext
): RankedCandidate[] {
  const scored = candidates.map((c) => {
    const affinity = Math.min((c.signals.orders_containing ?? 0) / w.affinityCeiling, 1);
    const days = c.signals.last_purchased_at
      ? (now.getTime() - c.signals.last_purchased_at.getTime()) / 86_400_000
      : Infinity;
    const recency = Number.isFinite(days) ? Math.exp(-days / w.halfLifeDays) : 0;
    const category = ctx.totalPurchases > 0
      ? (ctx.categoryPurchases.get(c.signals.category_id ?? '') ?? 0) / ctx.totalPurchases
      : 0;
    const co = Math.min((c.signals.co_occurrence_count ?? 0) / w.supportCeiling, 1);
    const pop = ctx.maxGlobalOrderCount > 0
      ? (c.signals.global_order_count ?? 0) / ctx.maxGlobalOrderCount
      : 0;

    const score =
      w.purchaseAffinity * affinity +
      w.purchaseRecency  * recency +
      w.categoryAffinity * category +
      w.coOccurrence     * co +
      w.popularity       * pop;

    return { ...c, score };
  });

  // The final comparison is on product_id: arbitrary, but TOTAL. Without it
  // two equal candidates can swap between requests. See plan section 10.3.
  return scored.sort((a, b) =>
    b.score - a.score ||
    (b.signals.orders_containing ?? 0) - (a.signals.orders_containing ?? 0) ||
    (b.signals.last_purchased_at?.getTime() ?? 0) - (a.signals.last_purchased_at?.getTime() ?? 0) ||
    a.product_id.localeCompare(b.product_id)
  );
}
```

- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 10: Service, controller and the full security suite

**Files:** Complete `recommendations.service.ts`, create `recommendations.controller.ts`, create `tests/recommendations-security.test.ts`.

**Interfaces:** Produces `recommendationsService.getRecommendations(customerId, input)` and the HTTP handler.

- [ ] **Step 1: Write the failing security tests** — one per §19 row, including Review Focus #5.

```ts
it('401 without a token', async () => {
  expect((await request(app).get('/api/v1/me/recommendations')).status).toBe(401);
});

it('403 for a RIDER token', async () => {
  const res = await request(app).get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${riderToken}`);
  expect(res.status).toBe(403);
});

it('a supplied customer_id is ignored - the caller gets their OWN data', async () => {
  const spoofed = await request(app)
    .get(`/api/v1/me/recommendations?customer_id=${CUSTOMER_B}&user_id=${CUSTOMER_B}`)
    .set('Authorization', `Bearer ${customerAToken}`);
  const honest = await request(app).get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${customerAToken}`);
  expect(spoofed.body.data).toEqual(honest.body.data);
});

it('customers cannot see each other in BUY_AGAIN', async () => {
  const a = await recsFor(customerAToken);
  const b = await recsFor(customerBToken);
  expect(buyAgainIds(a)).not.toEqual(expect.arrayContaining(buyAgainIds(b)));
});

it('leaks no cost, markup, score or source', async () => {
  const res = await request(app).get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${customerAToken}`);
  const body = JSON.stringify(res.body);
  for (const leak of ['purchase_cost', 'custom_markup_percent', 'effective_markup_percent',
                      'raw_score', 'co_occurrence_count', 'orders_containing']) {
    expect(body).not.toContain(leak);
  }
});

it('rejects an oversized limit rather than honouring it', async () => {
  const res = await request(app).get('/api/v1/me/recommendations?limit=1000')
    .set('Authorization', `Bearer ${customerAToken}`);
  expect(res.status).toBe(400);
});

it('rate limits a flood of requests', async () => {
  let last = 200;
  for (let i = 0; i < 40; i++) {
    last = (await request(app).get('/api/v1/me/recommendations')
      .set('Authorization', `Bearer ${customerAToken}`)).status;
  }
  expect(last).toBe(429);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** the service — tier selection (§7), `Promise.all` over the generators, merge → dedupe → filter → rank → take → hydrate, section assembly with §17.4 titles, omission of empty sections, and `rateLimiter.checkLimit('recs:' + customerId, 30, 60_000)` in the controller.

- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 11: Backend end-to-end and performance assertions

**Files:** `tests/recommendations.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('buy Milk, get it delivered, see Milk in Buy Again', async () => {
  await placeAndDeliverOrder(CUSTOMER_E2E, [MILK]);
  const res = await request(app).get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${e2eToken}`);
  const buyAgain = res.body.data.sections.find((s: { type: string }) => s.type === 'BUY_AGAIN');
  expect(buyAgain.products.map((p: { id: string }) => p.id)).toContain(MILK);
});

it('a brand-new customer still gets a real shelf', async () => {
  const res = await request(app).get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${brandNewToken}`);
  const types = res.body.data.sections.map((s: { type: string }) => s.type);
  expect(types).not.toContain('BUY_AGAIN');
  expect(res.body.data.sections.length).toBeGreaterThan(0);
});

it('never returns an empty section', async () => {
  const res = await request(app).get('/api/v1/me/recommendations')
    .set('Authorization', `Bearer ${customerAToken}`);
  for (const s of res.body.data.sections) expect(s.products.length).toBeGreaterThan(0);
});

it('hydration is one query, not one per product (no N+1)', async () => {
  // pg exposes every statement it runs; counting them is the only way to
  // catch an N+1 that is fast enough to pass a latency assertion.
  let statements = 0;
  const listener = () => { statements += 1; };
  pool.on('acquire', listener);
  try {
    await request(app).get('/api/v1/me/recommendations')
      .set('Authorization', `Bearer ${customerAToken}`);
  } finally {
    pool.off('acquire', listener);
  }
  // 4 generators + 1 affinity context + 1 orderability filter + 1 hydration,
  // plus one spare. A per-product hydration would be 10+ on its own.
  expect(statements).toBeLessThanOrEqual(8);
});
```

- [ ] **Step 2: Run, fix, re-run** until PASS.
- [ ] **Step 3: Do not commit.**

---

### Task 12: Flutter — provider, sections, and removal of the client ranker

**Files:**
- Create: `lib/Models/recommendation_section.dart`, `lib/Services/Providers/recommendation.provider.dart`, `lib/UI/Widgets/Organisms/home_recommendations.dart`
- Modify: `lib/main.dart`, `lib/Screens/home_screen.dart`, `lib/UI/Widgets/Organisms/home_product_sections.dart`, `test/home_composition_test.dart`
- Delete: `lib/Services/product_ranking.dart`, `test/product_ranking_test.dart`

- [ ] **Step 1: Write the failing tests**

```dart
testWidgets('renders each server section with its own title and products', (tester) async {
  await pumpHomeWithRecommendations(tester, sections: [
    {'type': 'BUY_AGAIN', 'title': 'Buy it again', 'products': [milkJson]},
  ]);
  expect(find.text('Buy it again'), findsOneWidget);
  expect(find.text('Kotmale Fresh Milk 1L'), findsOneWidget);
});

testWidgets('renders nothing at all when the server returns no sections', (tester) async {
  await pumpHomeWithRecommendations(tester, sections: []);
  expect(find.byType(HomeRecommendations), findsNothing);
});

testWidgets('a failed recommendations call never blocks or breaks Home', (tester) async {
  await pumpHomeWithRecommendations(tester, fail: true);
  expect(tester.takeException(), isNull);
  expect(find.text(HomeProductSections.allTitle), findsOneWidget);
  expect(find.textContaining('error', findRichText: true), findsNothing);
});

testWidgets('Browse all is back in plain catalogue order', (tester) async {
  // The client-side ranker is gone; the server owns personalisation now.
  await pumpHomeWithRecommendations(tester, sections: []);
  final names = tester.widgetList<ProductCard>(find.byType(ProductCard))
      .map((c) => c.product.name).toList();
  expect(names.first, 'Kotmale Fresh Milk 1L');
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the model, provider (`GET /me/recommendations`, failure swallowed to an empty list), and `HomeRecommendations` rendering one `ProductRail` per section under a `BlynkSectionHeader`. Delete `product_ranking.dart` and its test; restore `HomeProductSections` to plain catalogue order and remove `personalisedTitle`.
- [ ] **Step 4: Run** `flutter analyze` and `flutter test` — Expected: clean, all pass, honesty guard still green.
- [ ] **Step 5: Do not commit.**

---

### Task 13: Observability

**Files:** Modify `recommendations.service.ts`, `recommendations.controller.ts`; test in `tests/observability.test.ts`.

- [ ] **Step 1: Write the failing test** asserting the five §24 metrics are recorded and that **no customer id appears beside product ids** in any log line.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** using the existing `metrics` util.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Do not commit.**

---

### Task 14: Acceptance-criteria sweep

- [ ] **Step 1:** Walk §29's fourteen criteria and confirm each has a passing test; add any that is only asserted informally.
- [ ] **Step 2:** Run the whole backend suite. Expected: no new failures beyond the 3 documented in §2.5.
- [ ] **Step 3:** Run `flutter analyze` and the whole Flutter suite. Expected: clean, all pass.
- [ ] **Step 4: Do not commit.**

---

### Task 15: Performance verification

- [ ] **Step 1:** Seed ~500 delivered orders in a scratch database.
- [ ] **Step 2:** `EXPLAIN ANALYZE` each of the four generator queries; confirm the Task 1 indexes are used and no sequential scan on `order_items` remains.
- [ ] **Step 3:** Measure endpoint p95; confirm < 200ms (§22.2).
- [ ] **Step 4:** Record the measurements in this plan under §22 for the caching thresholds to be judged against later.
- [ ] **Step 5: Do not commit.**

---

### Task 16: ML-readiness verification

- [ ] **Step 1:** Confirm `rank()` is pure — no database, no clock, no `Math.random`.
- [ ] **Step 2:** Write a throwaway alternative ranker (reverse order will do), swap it in, and confirm **no file outside `recommendations.ranker.ts` needs to change** and the API contract tests still pass.
- [ ] **Step 3:** Revert the throwaway ranker.
- [ ] **Step 4:** Confirm generators are independent — removing one from the `Promise.all` list degrades gracefully rather than throwing.
- [ ] **Step 5: Do not commit.**
