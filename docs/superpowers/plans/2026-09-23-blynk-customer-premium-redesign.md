# Blynk Customer — Premium Visual Redesign Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **PLAN ONLY.** No code was written for this document. See §33 for verification.

**Goal:** Make the Blynk customer app read as a premium, professionally designed consumer product — using the reference image's *design language*, not its branding — while keeping Blynk Yellow `#FFE141` and Blynk Green `#0C831F` as the identity and preserving every existing behaviour.

**Spec:** this document + the reference image + `docs/superpowers/plans/2026-09-21-blynk-customer-premium-distribution.md` (already approved; still binding).

---

## Global Constraints

- Blynk Yellow **`#FFE141`** = primary action / CTA / selected / promotional emphasis. Blynk Green **`#0C831F`** = success / available / delivered / confirmed. **No orange. No new palette.**
- **No fabricated data.** No invented products, prices, ratings, review counts, discounts, per-unit prices, ETAs, rider details or progress states. If the backend does not return it, it does not render.
- Currency is **LKR**, never `$`.
- Preserve: auth/OTP/session restore/logout cleanup, catalog, cart, checkout, COD, cancellation rules, addresses, orders, dental appointments, live tracking, `MapProvider` abstraction, backend-authoritative pricing and availability.
- No new map provider; do not remove the MapLibre rollback path (§18).
- No test deleted, skipped or weakened. Expected values may change when the design deliberately changes — each with written justification.
- No new dependencies without an explicit justification task.

---

## 1. Executive summary

The customer app is **functionally broad and visually average**. It has 31 screens, a real two-layer token system, a 1782-test suite and genuinely hard features already working (live tracking, dental booking, Google Maps abstraction, session hardening). What it lacks is *composition*: every screen is a vertical stack of similar containers, typography does almost no hierarchical work, and product imagery — the single most valuable visual asset in a grocery app — is small and boxed.

This plan does three things:

1. **Reconciles a live conflict.** An in-flight redesign pass (R1) changed `signal` from `#FFE141` to `#F7E95C`, added a cream canvas, a second green, and a lime→green **gradient** CTA. That contradicts this brief (§3, §4, §11, §17) *and* the already-approved 2026-09-21 plan, which specifies `signal #FFE141` and a flat fill. **T1 reverts the palette to Blynk's identity and keeps the structural wins.** Details in §24.
2. **Moves typography and spacing from decoration to structure.** 114 `fontSize:` literals currently live outside the type layer. Hierarchy is being done with boxes instead of type. This is the highest-leverage change in the plan and it is why §29's de-slop findings mostly resolve themselves.
3. **Makes the product image dominant.** The reference's entire premium feel comes from large, well-lit imagery on a soft tinted well with generous whitespace. Blynk's current cards are small thumbnails in bordered boxes.

**The single highest-leverage file is `lib/design/tokens.dart` — 64 of 141 lib files import it** (§32). Almost all of this redesign can be driven centrally from the token layer plus ~8 shared widgets, rather than by editing 31 screens.

---

## 2. Current Customer UI audit

Measured, not estimated (`lib/`, 141 Dart files, 31 screens):

| Signal | Count | Reading |
|---|---:|---|
| `fontSize:` literals outside `design/typography.dart` | **114** | Typography is not centralised. Hierarchy is ad-hoc per screen. **Worst finding.** |
| `SizedBox(height: <literal>)` | **23** (of 197 SizedBox) | Spacing rhythm partially bypasses `BlynkSpace`. |
| `Container(` | 101 | Layout by box, not by type or spacing. |
| `Border.all` | 31 | Over-bordered; borders doing work whitespace should do. |
| `BorderRadius.circular` | 32 | Ad-hoc radii competing with `BlynkRadius`. |
| `Card(` | **0** | Good — no raw Material cards. |
| `RadialGradient` | **0** | Good — guard is holding. |
| `LinearGradient` | 8 | Mostly R1-introduced + carousel scrims. To be reduced (§24). |
| `BoxShadow(` | 3 | Restrained. Keep it that way. |

**What is genuinely good and must be kept:** the `primitives → tokens` split with raw hex confined to `primitives.dart`; the ratchet test suite that enforces it; `AppStateView` / `failure_states` / `app_skeleton` as shared state surfaces (fan-in 17/14/13); the `MapProvider` abstraction; Catamaran as a single type family; 1782 passing tests.

---

## 3. Reference-image visual analysis

> **Re-confirmed by the user, 2026-09-23**, when the reference image was
> re-sent with "I need this exact UI". Two rulings, both upholding this plan:
> 1. **Layout copied exactly; palette stays Blynk.** Composition, hero,
>    category chips, image-dominant cards, sticky CTA and cart structure match
>    the mock. The CTA is flat `#FFE141` with `ink` text — **not** the mock's
>    lime→green gradient. T1's palette revert therefore stands.
> 2. **Every element with no backend source is omitted** — ratings, review
>    counts, `41% OFF`, struck original prices, `$0.21/oz`, the three trust
>    chips, and Add Promo Code. Prices render in **LKR**, never `$`.
>
> The premium feel must come from composition, imagery, typography and
> whitespace — not from badges the data cannot support.

What actually creates the premium feel (translatable), versus what is just that brand (not translatable):

| Translatable — adopt | Not translatable — reject |
|---|---|
| Product image is the hero: large, on a soft tinted well, generous padding | Its green/lime brand colour |
| One accent colour, used sparingly, with lots of neutral around it | Its logo and leaf mark |
| Strong type hierarchy — name, size, price at clearly different weights | Its product names and copy |
| Rounded image wells (≈16–20) with a *tint*, not a border | Its ratings and review counts (we have none) |
| A single dominant CTA per screen, full-width, high contrast | Its `$` prices and `/oz` unit pricing |
| Category chips as icon-tiles, selected state = filled tile | Its "41% OFF" discount pills (no real source) |
| Generous vertical rhythm; sections separated by space, not rules | Its "Organic / No Additives / Sustainably Sourced" trust chips |
| Sticky bottom CTA on detail and cart | Its promo-code row |

**Critical translation note:** in the reference the CTA is *green because green is its brand*. In Blynk the equivalent slot is **`#FFE141` yellow with `ink` text**. Do not carry over the reference's green CTA — that is the exact mistake R1 made.

---

## 4. Blynk visual direction

> **Premium through restraint, hierarchy and imagery — not through decoration.**

Five principles, each falsifiable in review:

1. **Image first.** In any product context the image is the largest element and sits on a `well` tint, never inside a border.
2. **Type carries hierarchy.** If a section needs a box to be legible, the type is wrong. Boxes are for grouping, not emphasis.
3. **One yellow moment per screen.** Yellow marks *the* action. A screen with three yellow things has none.
4. **Space, not lines.** Prefer 24/32 gaps over dividers. A divider must earn its place.
5. **Flat by default.** Elevation only where something genuinely floats: sticky cart bar, sheets, dialogs.

---

## 5. Colour strategy

Inherits the approved 2026-09-21 palette verbatim. **This is the authority; R1's values are superseded.**

| Role | Hex | Use | Never |
|---|---|---|---|
| `signal` | `#FFE141` | Primary CTA fill, selected nav/chip tile, promo emphasis | As text or border (1.30:1 on white); as a translucent wash |
| `signal-pressed` | `#E5C700` *(verify in T1)* | Pressed CTA | — |
| `ink` | `#1A1D2E` | Primary text; label on `signal` (12.79:1) | — |
| `ink-2` | `#6B7280` | Secondary text, unit/size line | Body copy at length |
| `paper` | `#FFFFFF` | Page and card surface | — |
| `well` | `#F6F8FB` | **Product image wells**, inputs, selected rows | As a card fill next to `paper` cards |
| `line` / `line-strong` | `#E5E9F0` / `#7B8494` | Decorative divider / control boundary | Around every container |
| `positive` / `positive-ink` | `#0C831F` / `#0A741B` | Available, delivered, confirmed, savings | As a primary CTA fill |
| `positive-tint` | `#E8F5EA` | Success badge fill | — |
| `problem` / `problem-tint` | `#B42318` / `#FDECEA` | Errors, cancellation | Discount pills (no real discount source) |
| `notice` | `#8A5A00` on `#FFF6BF` | Scheduled / waiting | — |

**Hard rules:** no gradients as decoration; the CTA is a **flat `signal` fill**. No third brand colour. No per-screen colours. Every new pairing must be contrast-measured in the test suite before use.

---

## 6. Typography

Catamaran only; weights 500/600/700/800. Scale from the approved plan: `display` 28/34 w800 · `title` 20/26 w800 · `heading` 16/22 w700 · `body` 14/20 w500 · `label` 14/20 w700 · `caption` 12/16 w600. **Minimum 12 px — no exceptions, including nav labels and badges.**

Three additions this redesign needs, as **component tokens** (§24), not new sizes:

- `price` — w800, tabular/lining figures, `ink`
- `priceStruck` — `ink-2` + line-through, only when a real original price exists
- `productName` — `heading` clamped to 2 lines with ellipsis

**The work in T2 is deletion:** drive the 114 stray `fontSize:` literals to 0 by routing every one through `Theme.textTheme`. That single change does more for perceived quality than any new component.

---

## 7. Spacing

4-pt scale: 4 · 8 · 12 · 16 · 24 · 32 · 48. Page gutter 16 compact / 24 medium / 32 expanded.

Rhythm rules: 32 between major sections · 16 inside a section · 12 within a card · 8 between a label and its value. Product grid gutter 12 compact / 16 medium+. **Retire the 23 literal `SizedBox` heights.**

---

## 8. Components

Extend, never fork. Fan-in measured in §32.

| Component | Action | Notes |
|---|---|---|
| `tokens.dart` (fan-in **64**) | **Refine** | The central lever. Add a component-token layer (§24). |
| `blynk_button.dart` (14) | **Refine** | Flat `signal` CTA, `ink` label, optional trailing arrow *icon* (never a `→` character). Revert R1's gradient. |
| `card_product.dart` (4) | **Redesign** | Image-dominant on `well`; name/size/price hierarchy; yellow add control. |
| `money_text.dart` (9) | **Refine** | Add `priceStruck` support — only with a real original price. LKR always. |
| `app_state_views.dart` (17) | **Refine** | Composed empty/loading/error; keep API, restyle. |
| `failure_states.dart` (14) | **Refine** | Restyle only; never hide a real error. |
| `app_skeleton.dart` (13) | **Refine** | Skeletons must match the new card geometry. |
| `quantity_stepper.dart` | **Refine** | Pill, `paper` fill, `line-strong` border, ≥48 dp per control. |
| `category_widget.dart` (2) | **Redesign** | Icon-tile + label; selected = filled `signal` tile. |
| `status_badge.dart` (4) | **Keep** | Tone system already correct. |
| `adaptive_scaffold.dart` | **Refine** | Nav: selected = `signal` rounded-square tile, filled icon. |
| `map_provider.dart` (7) | **Keep** | Abstraction untouched. Style the *container* only. |
| **New:** `section_header.dart` | **Add** | Title + optional "See all". Replaces ~12 ad-hoc header rows. |
| **New:** `product_rail.dart` | **Add** | Horizontal scroller of `card_product`. |
| **New:** `image_well.dart` | **Add** | The tinted rounded image container. The single most reused premium primitive. |

Rejected as unjustified: discount pill, trust chip, promo-code row, rating row — **no real data source** (§3 of the brief's no-fake rule).

---

## 9. Navigation

Keep the 4-tab shell (Home / Categories / Orders / Profile) and `customer_shell.dart` routing. Selected tab = filled icon on a `signal` rounded-square tile, label at 12 px minimum. Help must stay reachable. Dental is entered from a Home section, not a fifth tab.

---

## 10. Home redesign — the most important screen

Derived from real Blynk data, not the reference's section list:

```
App bar        blynk mark · location/greeting · search icon · cart w/ real count
Search         full-width tap-to-search field (navigates to search_screen)
Hero           promo — ONLY if the backend returns a real promotion; else omitted
Categories     horizontal icon-tile rail (real categories; 8 today)
Products       responsive grid of real products
Dental         one entry card into the dental flow
```

**Hard rules:** no "Recommended for You" unless a real recommendation endpoint exists — otherwise the section is titled for what it actually is. No "Popular"/"Frequently bought" without a real source. If the promo endpoint returns nothing, the hero is **absent**, not a placeholder. Carousel does not auto-advance (motion rule, §21).

---

## 11. Product listing / category redesign

`products_screen` + `categories_screen`: sticky category rail, responsive grid (2 / 3 / 4 / 5 columns by breakpoint §19), image-dominant cards, skeletons matching final geometry, real empty state ("No products in this category" — not an error). Sub-category list keeps its behaviour, restyled.

---

## 12. Product detail redesign

```
Image hero      large, on `well`, rounded; circular back/share overlay buttons
Identity        product name (title) → unit/pack size (ink-2)
Price           price w800; struck original ONLY if real
Availability    positive/problem chip from real is_available
Quantity        stepper
Details         expandable description — only sections with real content
Sticky CTA      full-width `signal` Add to Cart
```

**Omit entirely** (no real source): rating, review count, per-unit price, nutrition, certifications. If `description` is null, the section does not render — no placeholder text.

---

## 13. Cart redesign

Header (back · "Your Cart" · real item count · clear-cart **only if that capability exists**), line items with real image/name/size/price and stepper, summary from the **backend-calculated** subtotal/delivery/total, sticky full-width `signal` Checkout CTA.

Savings banner renders **only when a real discount > 0**, reads "You're saving Rs. X" — **no exclamation mark** (Blynk voice rule; the reference's "!" is not adopted). No promo code row, no loyalty points, no fake coupons.

---

## 14. Checkout redesign

Visual only — business logic untouched. Hierarchy: Address → Items → Delivery → Total → Confirm. Preserve backend pricing, delivery fee, order validation, COD, cancellation rules, address validation, idempotency. No new payment method. Confirm CTA `signal`, disabled state genuinely disabled when a guard fails.

---

## 15. Orders redesign

Order rows become identity blocks, not table rows: order number + status badge (real status model) + date + total + item thumbnails preview. No invented progress states, no ETA, no rider info unless the backend returns it. Order detail keeps the existing timeline and cancellation rules, restyled.

---

## 16. Dental redesign

Same tokens, same buttons, same spacing, same nav — **no separate dental design system**. Flow unchanged: Clinics → Clinic → Doctors → Doctor → Date → Time → Patient details → Review → Confirmation → My Appointments. Slot picker: available = `paper` + `line-strong`, selected = `signal` tile, unavailable = disabled with a real reason. Appointment status uses the same `status_badge` tones as orders. Booking-only; no payment.

---

## 17. Appointment redesign

Covered by §16. My Appointments keeps its Upcoming/Past toggle (and its ≥48 dp tap targets, which are already tested).

---

## 18. Live tracking redesign

**Architecture is frozen.** `TrackingMapView`, `MapProvider`, `TrackingMapBuilder`, SSE, live coordinate handling, stale handling and tracking lifecycle are not touched. Only the *container* is designed: rounded map surface, status header above, freshness indicator, destination and rider markers.

**Finding on brief §25:** MapLibre is already present in 6 files — but it is **not a reintroduction**. `map_provider_config.dart` defines Google as the default and MapLibre as a compile-time rollback via `--dart-define=MAP_PROVIDER=maplibre`. This is a deliberate safety lever from the approved plan. **Keep it.** No fake ETA, route, distance or navigation.

---

## 19. Responsive strategy

Breakpoints: compact <600 / medium 600–1024 / expanded >1024. Product grid 2 / 3 / 4–5. Nav: bottom bar → rail → rail+labels. Hero caps its height on expanded rather than scaling. Cart and checkout go two-column on expanded (summary sticky right). Map caps its height on expanded. Dental slot grid widens rather than stretching. **Not a scaled phone screen.**

---

## 20. Accessibility

Non-negotiable and already partly tested: ≥48 dp targets, measured contrast for every pairing actually used, semantic labels on icon-only controls, focus states on web, real screen-reader names, **12 px floor with no token-layer bypass**, and layouts that survive 1.3× / 2.0× text scale without overflow. Existing tap-target and contrast suites must stay green.

---

## 21. Motion

Durations 120/200/280 ms, `easeOutCubic` in / `easeInCubic` out. Permitted: ADD→stepper morph, cart bar slide, sheet transitions, status change, skeleton pulse, map marker glide. **Banned:** auto-advancing carousel, decorative section fade-ins, looping animations. `MediaQuery.disableAnimations` ⇒ 0 ms.

---

## 22. Loading / empty / error states

Through `AppStateView` / `failure_states` / `app_skeleton` — restyled, not replaced. Every state gets a real title, a real explanation and, where one exists, a real action. Skeletons must match final geometry or they cause layout shift. **Never hide a real error. Never fabricate content to fill an empty state.**

---

## 23. Performance

Watch: image loading and caching (the redesign makes images bigger — this is the main risk), grid rebuild cost, carousel, map render, initial web bundle. Rules: cache and right-size images; `const` constructors; selector-scoped rebuilds so a cart change doesn't rebuild a grid; **no new animation library**; no new dependency without justification. Measure web bundle before and after.

---

## 24. Design-system changes

**a. Add the missing third token layer.** Blynk has `primitives → tokens` (two layers). The 114 stray `fontSize:` literals exist because there is no *component* layer to name things like "product card price". Add component tokens (`cardProduct*`, `cta*`, `nav*`, `stepper*`) resolving to semantic tokens. This is the structural fix behind most of §29.

**b. Reconcile R1 (the live conflict).** R1's uncommitted work is kept in-tree and superseded here per your decision:

| R1 introduced | Disposition |
|---|---|
| `signal` = `#F7E95C` | **Revert to `#FFE141`** (brief §3; approved plan §2.2) |
| `ctaStart`/`ctaEnd` lime→green gradient CTA | **Remove.** CTA is a flat `signal` fill with `ink` label |
| `BlynkGradients.cta` / `.promo` | **Remove `cta`.** Keep `promo` only if a real promo surface needs a scrim |
| `canvas` `#FCFDF4` cream page | **Revert to `paper`/`well`** — no new neutral family |
| `accentGreen` `#1A7C36` (second green) | **Remove.** `positive #0C831F` is the only green |
| `discountInk`/`discountTint`/`strike` | **Remove `discount*`** (no real discount source). **Keep `strike`** for real struck prices |
| `tile`, `signalSoft` | **Evaluate in T1** — keep only if they survive the "one yellow moment" rule |
| `BlynkElevation.soft` | **Keep** — one soft elevation token is correct |
| Atoms: `circular_icon_button`, `expandable_row` | **Keep** — genuinely reusable, used by §12 |
| Atoms: `discount_pill`, `trust_chip` | **Remove** — no real data source |
| Re-pointed guard tests | **Re-point again** to the reverted rules; keep them failing-when-violated |

**c. Guards to add:** no `fontSize:` outside the type layer (extended to `lib/design/` so the token layer cannot bypass the 12 px floor); no ad-hoc `LinearGradient`/`BoxShadow` outside `lib/design`; no `$` in customer-facing copy; no hardcoded product/price/rating strings.

---

## 25. De-slop audit

| # | Current | Problem | Proposed direction |
|---|---|---|---|
| 1 | 114 `fontSize:` literals outside the type layer | Hierarchy is ad-hoc; no screen agrees with another | Route all through `Theme.textTheme`; guard at 0 |
| 2 | 101 `Container(`, 31 `Border.all` | Everything is a bordered box — the classic generic-Flutter look | Group with space; borders only on controls |
| 3 | 32 ad-hoc `BorderRadius.circular` | Competing radii read as sloppy | 4 tokens only: 8/12/20/full |
| 4 | 23 literal `SizedBox` heights | Inconsistent rhythm | `BlynkSpace` only |
| 5 | Uniform card grid, thumbnail-sized images | Product images are the asset and they're tiny | `image_well` + image-dominant card |
| 6 | R1's gradient CTA | Decorative gradient; off-brand; the reference's green is *its* brand | Flat `#FFE141` + `ink` |
| 7 | ~12 ad-hoc section header rows | Repetition without a component | `section_header` |
| 8 | Weak empty/error states | Reads unfinished | Composed `AppStateView` with real copy |
| 9 | Auto-advancing carousel | Distraction without purpose; accessibility problem | Manual only |
| 10 | Mixed icon families/weights | Visual noise | Material outlined 24; filled only for selected nav + state |

No functionality changes in any of these.

---

## 26. Implementation phases

**Order fixed by the user (2026-09-23).** It follows the fan-in evidence in §32: the token and component layer controls most of the app, so it is changed first to produce one consistent premium look rather than 15 individually redesigned screens.

> **Hard gate: no screen-by-screen redesign begins before T1–T3 are complete and reviewed.**

| Task | Objective | Key files | Depends on |
|---|---|---|---|
| **D7** | **Product imagery** — upload a representative set of real images via the Admin flow; define the branded no-image fallback | Admin `ProductForm`/`ImageUploader`; `adminMediaRouter` | — (blocked on source images, §26a) |
| **T1** | **Design tokens** — palette reconciliation (§24b), component-token layer (§24a), **and the app-wide typography sweep: 114 → 0 stray `fontSize:` literals** | `lib/design/*`, ratchet tests, all of `lib/UI` + `lib/Screens` | — |
| **T2** | **Shared components** — `blynk_button` (flat yellow CTA), `money_text`, `quantity_stepper`, `status_badge`, `category_widget`, **app shell + `adaptive_scaffold` nav**, **and the empty/loading/error surfaces** (`app_state_views` 17, `failure_states` 14, `app_skeleton` 13) | `lib/UI/Widgets/Atoms`, `Organisms/adaptive_scaffold.dart`, `customer_shell.dart` | T1 |
| **T3** | **Product image / card system** — `image_well`, the branded no-image fallback, `card_product` redesign, `product_rail`, `section_header` | `lib/UI/Widgets/Atoms` | T1, T2, D7 |
| **T4** | Home | `home_screen.dart`, home organisms | T3 |
| **T5** | Product listing + categories | `products_screen`, `categories_screen` | T3 |
| **T6** | Product detail | `product_details_screen.dart` | T3 |
| **T7** | Cart | `user_cart_screen.dart` + cart organisms | T3 |
| **T8** | Checkout | `checkout_screen.dart` | T7 |
| **T9** | Orders + order detail | `user_orders_screen`, `order_summary_screen` | T3 |
| **T10** | Dental (9 screens) | `dental_*.dart` | T3 |
| **T11** | Live tracking container (architecture frozen, §18) | `order_tracking_map.dart` | T3 |
| **T12** | Responsive + accessibility pass | all screens | T4–T11 |
| **T13** | Performance pass | images, grids, web bundle | T12 |
| **T14** | De-slop audit + design review (brief §32) **+ full regression verification** | — | T13 |

**Three tasks from the earlier draft were folded in rather than dropped** — flagging so nothing is lost:
- *Typography centralisation* → into **T1**. It is the type-token layer's job and it is the highest-leverage single change in the plan (§25 finding 1).
- *App shell / nav* and *empty-loading-error states* → into **T2**. Both are shared-component work; the three state surfaces have fan-in 17/14/13.
- *Regression verification* → into **T14** as its closing gate.

Each task must state: objective · exact files · components reused · new components (with justification) · dependencies · tests · acceptance criteria · **visual** acceptance criteria.

### 26a. D7 — Product imagery (decided)

**Decision (user, 2026-09-23):** real product images only, uploaded through the **existing Admin product-management flow**. Verified present and usable: `apps/admin/src/components/ImageUploader.tsx` → `apps/admin/src/pages/ProductForm.tsx` → `adminMediaRouter.post` → served from `backend/api/uploads/products/`. No backend redesign needed.

**Rules:**
- Do **not** generate product images. Do **not** use Unsplash/Pexels or any stock source. Do **not** hardcode external image URLs.
- Products without an image must still render a **polished Blynk-branded no-image state** — intentional, not a broken-image icon or a grey box.
- The UI must be built so that uploading a real image later **automatically** improves presentation, with no code change.

**Measured starting state — this is the blocker.** Of the 41 products currently in the catalogue, **exactly 1 has a real image** (`Farm Fresh Brown Eggs`); 40 do not. There is one file in `uploads/products/`.

Two consequences the implementation must absorb:

1. **The no-image fallback is not an edge case — it is the default state for 98% of the catalogue.** It must be designed first and to the same standard as the image-present card, and it must be what the T4–T6 screens are reviewed against. A premium design that only looks premium with images would currently look premium on one product.
2. **Seeding "a representative set of real images" needs source images that do not exist in this repo**, and the rules correctly forbid me from generating or downloading them. **This is an open input, not a task I can complete unilaterally** — see D8 in §30.

**Fallback design direction:** `image_well` tint (`well`) + centred Blynk mark at low opacity + the product's category glyph, with the product name carrying the identity. No "image not available" text. Same geometry and radius as a real image so the grid never shifts when images arrive.

---

## 27. Screen-by-screen classification

| Screen | Verdict | Why |
|---|---|---|
| `home_screen` | **REDESIGN** | Composition is the whole problem; highest visual impact |
| `product_details_screen` | **REDESIGN** | Needs image hero + sticky CTA hierarchy |
| `user_cart_screen` | **REDESIGN** | Premium cart is a core reference beat |
| `products_screen` / `categories_screen` | **REDESIGN** | Grid + card are the repeated unit |
| `customer_shell` / `adaptive_scaffold` | **REFINE** | Nav treatment only; routing correct |
| `checkout_screen` | **REFINE** | Hierarchy only — logic frozen |
| `user_orders_screen` / `order_summary_screen` | **REFINE** | Identity blocks instead of rows |
| `search_screen` | **REFINE** | Adopt new field + result card |
| `user_address_screen` / `add_edit_address_screen` | **REFINE** | Form restyle; validation frozen |
| `profile_screen` / `help_screen` / `app_about_screen` | **REFINE** | Token pass |
| `dental_*` (9 screens) | **REFINE** | Already structured; needs token + spacing consistency |
| `order_confirmation_screen` | **REFINE** | Elevate the success moment |
| `live_location_picker_screen` | **REFINE** | Container only — map frozen |
| `Auth/login` · `Auth/otp_verification` | **REFINE** | Restyle only; **security behaviour frozen** |
| `session_gate` · `config_problem_screen` · `not_found_screen` | **KEEP** | Correct; token pass only |

---

## 28. Test strategy

Baseline **1782 passing**, and it stays green. Per task: update expected values only where the design deliberately changed, each with written justification; no assertion weakened; no test deleted or skipped. Contrast, tap-target, ALL-CAPS, no-exclamation, 12-px-floor and raw-hex guards must all still pass. New guards from §24c. Every re-pointed guard must be proven to still fail when violated.

---

## 29. Acceptance criteria

**Functional:** full suite green; `flutter analyze` clean; no behaviour change in auth, cart, checkout, cancellation, tracking, dental booking; backend remains authoritative for all prices and availability.

**Visual:** yellow is the only CTA colour and appears once per screen; green appears only on success/availability; product images dominate every product surface; 0 stray `fontSize:` literals; no gradient CTA; no fabricated data anywhere; 12 px floor holds; layouts survive 2.0× text scale; desktop is not a stretched phone.

**Imagery (§26a):** a grid of products with **no** images still reads as deliberate and premium — this is the primary review condition today, not the exception; the fallback and a real image occupy identical geometry, so uploading an image causes **zero layout shift**; no product ever shows a broken-image icon, a grey box, or "image not available"; no generated, stock or externally-hosted image appears anywhere.

---

## 30. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Does a real promotions endpoint exist for the Home hero? | If not, **omit the hero** |
| D2 | Is there a real recommendations source? | If not, title the section honestly |
| D3 | Do any products carry a real original price? | If not, drop struck price and `strike` |
| D4 | Does clear-cart exist? | If not, omit the trash control |
| D5 | Keep `tile` / `signalSoft` from R1? | Decide in T1 against the one-yellow rule |
| D6 | Verify `signal-pressed` `#E5C700` contrast | Measure in T1; tune colour, never the floor |
| ~~D7~~ | ~~Product image source and sizing~~ | **RESOLVED 2026-09-23** — real images via the existing Admin upload flow + branded no-image fallback. See §26a |
| **D8** | **Who supplies the source product images?** The rules correctly forbid generating them or using stock, and only 1 of 41 products has one. Real photographs of the actual Sri Lankan SKUs must come from you (or the supplier). | **Blocks T3's visual verification, not T3 itself.** Recommendation: build T3 fallback-first, then upload a real set across the 8 categories to verify the image-present path. Until then the design is reviewed on the fallback |

---

## 31. Risks

| Risk | Mitigation |
|---|---|
| **Palette revert churns R1's work** | T1 is token-layer only; fan-in 64 means screens follow automatically |
| **Bigger images hurt performance** | T16 measures; cache and right-size |
| **An image-first design with almost no images** — 40 of 41 products have none (§26a) | Design and review the branded fallback **first**, to the same standard as the image card. Identical geometry so the grid never shifts when real images land. Escalated as **D8** |
| **Test churn tempts weakening assertions** | Explicit rule in §28; reviewer treats it as Critical |
| **"Premium" drifts into decoration** | §4's five principles are the falsifiable check |
| **Scope creep into backend** | Global constraints; backend is out of scope |

---

## 32. Graphify findings

Run scoped to `apps/customer/blinkit-clone-Flutter-ecommerce-/lib` per brief §6. **141 Dart files, 80,656 words → 3,801 AST nodes, 5,089 AST edges → merged graph of 9,830 nodes / 17,458 edges**, clustered into communities. Code-only corpus, so AST extraction only — no LLM semantic pass needed. Outputs in `graphify-out/`.

Edge mix: `imports` 3,741 · `defines` 3,361 · `references` 1,747 · `contains` 1,750 · `imports_from` 997 · `calls` 700 · `inherits` 285 · `navigates` 41.

**Central redesign levers — measured fan-in (files importing each):**

| Rank | File | Fan-in | Implication |
|---:|---|---:|---|
| 1 | `design/tokens.dart` | **64** | Change once, 64 files follow. **The lever.** |
| 2 | `Atoms/app_state_views.dart` | 17 | One change restyles every empty/loading/error surface |
| 3 | `Atoms/failure_states.dart` | 14 | Same for failures |
| 4 | `Atoms/blynk_button.dart` | 14 | One change fixes every CTA |
| 5 | `Atoms/app_skeleton.dart` | 13 | Every loading state |
| 6 | `Atoms/money_text.dart` | 9 | Every price in the app |
| 7 | `Organisms/map_provider.dart` | 7 | Frozen — but confirms the abstraction is real |
| 8 | `Atoms/status_badge.dart`, `card_product.dart` | 4 each | Order/appointment status; product surfaces |

**Conclusion:** ~8 files reach essentially the whole app. The redesign should be driven centrally through T1–T3 rather than screen-by-screen — which is why the task order in §26 is token layer → shared widgets → screens.

**Caveat, stated honestly:** Graphify's own import-edge resolution for Dart under-counted badly (it scored `BlynkButton` at fan-in 1). The fan-in table above was measured directly from the source with an import scan, not taken from the graph. The graph is reliable for structure and clustering, not for Dart dependency ranking.

---

## 33. Verification — plan only

- **No application code was written.** No file under `apps/`, `backend/`, `lib/` or `test/` was created or modified by this task.
- **The only file this task adds is this plan** (`docs/superpowers/plans/2026-09-23-blynk-customer-premium-redesign.md`), plus Graphify's read-only analysis output in `graphify-out/`.
- **No dependencies installed. No assets deleted. No backend, Admin, Rider, Inventory or Operations change.**
- **No commit. No push. Nothing staged** — `git diff --cached` is empty.
- An in-flight R1 implementation agent was **stopped** at the start of this task precisely so that no source file would change during planning.

**Git status at time of writing** — branch `main`, staged: **empty**. Pre-existing uncommitted work from earlier workstreams (not this task): `apps/customer` 68 files (the R1 redesign pass), `backend` 22, `apps/admin` 12, `docs` 10, plus untracked `apps/operations`, `brag-output*/`, `graphify-out/`.

**STOP. Do not begin implementation without approval.**
