# Blynk Customer — Premium Experience + Distribution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This document is a plan only. No application code was written, no file outside `docs/superpowers/plans/` was changed, nothing was committed or pushed.**

**Goal:** Turn the working Blynk Customer app into a premium quick-commerce product with one distinct visual language, and make it distributable: a Play-Store-ready Android AAB and a browser/iOS Home-Screen experience.

**Architecture:** Keep the Flutter app, Provider state, Dio API layer, Google Maps + SSE live tracking (the map SDK is swapped behind the existing `TrackingMapView`/`LocationPickerMapView` contracts, §11), and the existing tests. Add a real token layer (colour, type, space, radius, motion) and a small component library, re-skin every screen from it, fix the session/data-integrity defects the audit found, then harden the Android build for Play. The iOS PWA is a **decision gate (D1)** because the audit shows Flutter web is not a safe drop-in (§9).

**Tech Stack:** Flutter 3.47.2 / Dart 3.13.2, provider, dio, google_maps_flutter 2.18.1 (replaces maplibre_gl 0.25.0), geolocator 14.0.2, flutter_secure_storage; Android AGP 9.1.0 / Gradle 9.3.1 / compileSdk+targetSdk 36; backend Express + Kysely (unchanged unless D4 is approved).

**Revision 2 (2026-09-21):** by user instruction the map provider changes from MapLibre + self-hosted PMTiles to **Google Maps Platform** (Android + Web/PWA), preserving `MapProvider`/`TrackingMapView`; the earlier "no Google Maps / no API key" prohibition is withdrawn and no new PMTiles work is planned; the existing PMTiles pieces stay **dormant as a rollback path until the Google map is runtime-verified (D13, gate in G4)** (§11, tasks G0–G4).

**Revision 3 (2026-09-21):** the user recorded **D1** (architecture diagram: Android = Flutter, iOS PWA = React + Vite), **D11** (Blynk/company-controlled Google Cloud project + billing account, web quota 1,000 loads/day initially, separate restricted Android and web keys, billing alerts, project transferable/business-owned before the Play launch), **D12** (no Map ID initially, standard Google appearance) and **D13** (keep PMTiles until Google Maps is physically verified, then archive/remove). Two wording corrections were also applied: the Android "unlimited-free" status is a **current pricing/configuration finding to re-verify immediately before production launch**, not an architectural guarantee, and the web cost figures are **estimates**, not a guaranteed bill.

**Spec:** the phase brief "Customer App Experience + Distribution" (2026-09-21). Inherits the binding rules of the live-location phase (`docs/superpowers/plans/2026-09-19-blynk-live-location-tracking.md`) and the order-experience plan (`2026-09-19-blynk-customer-order-experience.md`).

## Global Constraints

- **Preserve** the architecture, all working functionality, and the 547 passing Flutter tests. Keep the test keys `order-status-header`, `order-timeline`, `view-order`, `order-retry`, `orders-retry`, `cancel-order-button`, `confirmation-amount` (referenced in source/tests) unless a task renames them together with their tests.
- **No fake data.** Every displayed business value comes from the backend or is clearly static product content held in one file. No coupons, rewards, ratings, "N mins", recommendations, "free delivery", stock counts, MRP/discounts (the API has none).
- **Live tracking:** backend → SSE → real rider coordinates → Google Maps markers. Never simulate movement. No ETA (the backend has none), no routing, no navigation, no geocoding, no Places (those Google APIs are not enabled on the keys). Only `google_map_view.dart` may import `google_maps_flutter`; only `geolocator_location_source.dart` may import `geolocator`. `map_provider.dart` (`GeoPoint`, `MapMarkerSpec`, `TrackingMapView`, `LocationPickerMapView`, the builder seams) stays provider-neutral.
- **The backend has zero Google Maps dependency:** it sends only coordinates and tracking state over SSE; no Google key, SDK or API call exists in `backend/`. All Google Maps code lives in the Customer app's single adapter file (and, for the PWA, one adapter module).
- **Not to be touched by this phase without a new explicit user decision:** rider app, tracking lifecycle, `TrackingPlugin`, order lifecycle engine, delivery assignment, DB schema. Open decisions from the live-location phase stay open (I3 last GPS point retention, H2 hub-coordinate address default, I4 SSE cap, rider token storage).
- **Do not add:** Redis, Kafka, PostGIS, location history, gamification, analytics/ads SDKs. **Google Maps Platform is allowed for the map only:** enable only *Maps SDK for Android* and *Maps JavaScript API*; separate restricted keys per platform (Android: package + SHA-1 incl. the Play app-signing key; web: origin referrers); keys never committed; no Places/Directions/Routes/Distance Matrix/Geocoding; Google logo/attribution always visible; no caching of Google map content; no non-Google basemap anywhere (Google Terms); per-day quota caps and a budget alert set before launch.
- **Do not upload anything to Google Play.** No commits/pushes unless the user says so. The five uncommitted `android/*.gradle` files are the user's; edit them only by appending/patching, never by overwrite (see Risk R1).
- **Accessibility is a hard floor:** text ≥ 4.5:1, control boundaries ≥ 3:1, tap targets ≥ 48 dp, layouts survive 200 % text, reduced-motion honoured. Design never overrides it.
- No new dependencies unless §19 lists them with a reason.
- Skills: `ui-ux-pro-max` rules are used as a checklist; its generated palette/fonts/landing pattern were **rejected** (see §1.6).

---

## 1. Current-state audit

Five read-only audits (source only; nothing ran on a device or in a browser) produced the evidence below. Full reports: `<session scratchpad>/audit_screens.md`, `audit_design_a11y_perf.md`, `audit_android_release.md`, `audit_web_pwa.md`, `audit_data_honesty.md`. Line references are from `main` at 2026-09-21.

### 1.1 What exists and should be kept

99 Dart files in `lib/`; 4-tab shell (`customer_shell.dart`); Provider (Auth, Product, Cart, Address, Order, Location); Dio client with 401→refresh interceptor; backend-driven promotions, categories, products, orders; order timeline from `history[]`; `can_cancel` from the backend; SSE location stream with generation counter, jittered backoff, foreground-only lifecycle (`location.provider.dart`); the map SDK isolated in one adapter file behind `map_provider.dart` (MapLibre today, Google Maps after G1–G4); address picker with 8 purpose-written states; `AppStateView`, skeletons, `EmptyCartView`, `ProductCard`, `HomeScreenCarousel`, order-detail widgets (all reusable — inventory in §5). 37 test files incl. design-audit regressions and 4 integration tests.

### 1.2 Top findings by impact (ranked)

| # | Finding | Evidence |
|---|---|---|
| 1 | **No auth architecture.** Initial route is always `LoginScreen`; `restoreSession()` never drives routing; a returning user sees onboarding every cold start; guests can reach login only via "Log out"; Orders/Checkout/Address just 401; Home "Log in to set your delivery address" has `onTap` null. | `main.dart:81`, `route_generator.dart:28`, `home_screen_app_bar.dart:60` |
| 2 | **Logout clears only `AuthProvider`.** Cached addresses/orders/cart remain for the next user (privacy, from code reading). | `cupertino_logout_dialog.dart:47-56`, `home_screen_app_bar.dart:33` |
| 3 | **Checkout is thin.** Body = price summary + a 10 px note; address and payment are two fixed 70 dp bars; no item review; backend-supported `customer_notes` never sent; no `idempotency_key` sent (a retried POST after timeout can duplicate an order). | `checkout_screen.dart`, `cart_screen_*_container.dart`, `order.provider.dart:216-230` |
| 4 | **Developer copy reaches customers:** "Please verify the server is running", OTP "Dev Code" chip, raw server messages; only 3 screens use `AppStateView`; Products and Home category errors have no retry. | `requesting_methods.dart:163`, `otp_verification_screen.dart:229`, `products_screen.dart:112` |
| 5 | **Primary-action colour is inconsistent**: yellow (ADD, Add to Cart, Proceed) vs green (cart bar, Place Order, Continue, Verify, text buttons). Three page backgrounds; off-palette orange/deep-orange/blue/red; shadow-cards mixed with border-cards. | `bottom_cart_container.dart:55`, `cart_screen_payment_container.dart:90`, `app_colors.dart:8`, `app_design.dart:81-85` |
| 6 | **Browse density and target sizes.** Products = 1:4 two-pane (~68 dp sidebar + ~130 dp cards on a 360 dp phone); ADD ≈ 30 dp, compact stepper ≈ 27 dp tall (estimates, not measured). | `products_screen.dart:95-127`, `add_to_cart_button.dart:93-96,236-240` |
| 7 | **Foreign / fake content shipped:** Blinkit "About" paragraph + "v15.30.2"; 9 dummy coupons (unreachable route); Profile Wallet/Support/Payments tiles (no action, icons8 remote images); "10-Minute Delivery" web meta; launcher label "ecom"; gift/invoice dead screens (2.3 MB `gift.jpg`). | `constants.dart:50-137`, `profile_screen.dart:68-71`, `web/index.html:21` |
| 8 | **Hard-coded business facts that can drift**: "Delivering 8 AM–9 PM", Rs. 70 fee (`kDeliveryFeeEstimate`), 4 km, COD, "Dharga Town". No API exposes store hours/fee/radius/contact (`dark_stores`, `system_configurations` exist in DB but have no route). Help says "contact us on the number below" — there is no number. | `home_screen_app_bar.dart:82`, `constants.dart:9`, `help_screen.dart:52` |
| 9 | **No offline/persistence**: cart is memory-only (lost on kill); cold start offline → near-blank Home; no connectivity handling. | `cart.provider.dart:15-22`, `home_screen_category_builder.dart:60-76` |
| 10 | **Navigation gaps**: no `PopScope` (back exits app from any tab); Orders/Profile exist as tabs *and* pushed routes; 3 dead routes; unknown route = the word "Error"; deep links lose arguments (`/product` without args → endless skeleton); `leadingWidth: 25` clips back buttons. | `route_generator.dart`, `products_screen.dart:68` |
| 11 | **Responsive is ad-hoc**: bottom bar at every width; ≈9 private breakpoints (360/420/520/560/720/900/1024/1120/1160); Orders/Profile/Address list uncapped; `Responsive.horizontalPadding` unused. | `app_responsive.dart`, §6 audit |
| 12 | **Post-order journey missing**: no delivered moment, reorder, receipt; confirmation is the onboarding packing Lottie + "Gotcha!". Backend already returns `items[]`, `delivered_at`, `payment.paid_at` — unused. | `order_confirmation_screen.dart:46` |

### 1.3 Design-system facts

- **Contrast (computed):** Yellow `#FFE141` on white **1.30:1** (dark ink on yellow 12.79 ✔); Green `#0C831F` on white 4.90 ✔, on page grey `#EDF2F8` **4.36 ✘**; muted `#9CA3AF` **2.54** (used for real text: hints, disabled "N/A"); hairline `#E5E9F0` **1.22** (fine as a divider, not as a control boundary); legacy `Colors.grey` login input border 2.68 with identical focus/error borders (no visible focus/error state).
- `ColorScheme.primary` = yellow, so un-coloured `CircularProgressIndicator`s (6) and `RefreshIndicator`s (5) and text cursors are yellow-on-white (derived from Flutter defaults; not visually verified).
- 176 hard-coded `fontSize:` across **19 distinct sizes** (10, 10.5, 11, 12 … 26); the 7-role `textTheme` is read only by a dead route; `FontWeight.w900/w200` used but not declared; 8.5 px tagline; 10–11 px badges/labels.
- Spacing tokens exist (362 refs) but 59 raw `EdgeInsets` + 86 raw `SizedBox` + 21 `token±N` arithmetic. Radius: 5 tokens + 10 raw values. 125 `Colors.*` + 18 `Color(0x…)` outside token files. Token adoption is **bimodal**: the first-run flow (login, OTP), Profile, address cards and both checkout containers are the untokenised legacy layer.
- Icons: 100 % Material (61 distinct, filled/outlined/rounded mixed, semantic reuse: `inventory_2_outlined` = Orders *and* Address Book *and* "Packed"); `flutter_svg` has 0 imports; 3 remote icons8 PNGs on Profile.
- No dark theme, no `cardTheme`/`dialogTheme`/nav theme, no `useMaterial3` flag, 21 local button-style overrides.

### 1.4 Accessibility facts (evidence + "not verified")

26 `Semantics(` in 16 of 68 UI files; 1 `liveRegion`; 0 `disableAnimations`, `FocusTraversalGroup`, `Shortcuts`; no `meetsGuideline` tests. ADD/stepper/Skip/dots/"Change" targets under 48 dp; 3 `GestureDetector`s with no semantics or keyboard access; an inert `IconButton(onPressed: (){})` repeated 5× on Profile; fixed-height rows that clip at large text (70 dp checkout bars, 52 dp buttons/chips); carousel auto-advances every 6 s with no pause; the map has 0 Semantics and its caption is not a live region; `EagerGestureRecognizer` makes the 220 dp map swallow page scrolling. Not verified: real pixel sizes, TalkBack order, overflow at 200 %.

### 1.5 Performance facts

Startup awaits only `dotenv.load` (then always shows Login). Assets 6.73 MB; **3.09 MB (48 files) never referenced**; `gift.jpg` 2.33 MB used only by a dead screen. No `cacheWidth/Height`, no disk image cache, 0 `RepaintBoundary`. Each Home rail requests `limit: 100` (≤ 400 records at start); `OrdersScreen` fetches at shell mount inside the `IndexedStack` (a 401 for guests) and on every resume; `CategoriesScreen` force-reloads on every open; `AddToCartButton` wraps a `Consumer<CartProvider>` per product; one `ProductCardSkeleton` = 5 animation controllers (≈ 80 concurrent on a loading Home — upper bound). SSE lifecycle is solid (generation counter, backoff 1–30 s ±20 %, stops in background) but device-unverified. Seeded products have **no `image_url`**, so real image performance is untested. Not measured: cold start, frame times, release APK size.

### 1.6 Skills used and how

| Skill | Use | Notes |
|---|---|---|
| `ui-ux-pro-max` | UX rule priorities 1–10, Flutter stack rules, pre-delivery checklist | Its `--design-system` output (blue `#2563EB`, orange CTA, "App Store landing" pattern, Exaggerated Minimalism) is a generic web result that contradicts the brand — **rejected**; only checklists and stack rules kept. |
| `design-system` | 3-layer token architecture (primitive → semantic → component) | Applied to Dart tokens (§3). Its CSS/Tailwind generators are not used. |
| `frontend-design` | Distinct point of view; catalogue of "AI-generated" tells (all-caps eyebrows, one-word headline accent, uniform rounded cards, gradient washes, `→` on buttons) | Not registered as a callable skill in this environment; the plugin's `SKILL.md` was read directly. |
| `brand` | Brand-consistency framing | No `docs/brand-guidelines.md` exists; §3.1 proposes one. Sync scripts not run (no such file). |
| `design` (router) | Routing only | Logo/CIP/banner/slides sub-skills judged irrelevant (no Gemini key; raster logo redraw is a human task, D6). |
| `superpowers:writing-plans` | Plan format | |
| Not used | `ui-styling` (shadcn/Tailwind), `slides`, `banner-design`, Stitch MCP screen generators | Not Flutter-relevant / would send product info to an external service and produce generic output. Stitch can be offered later for mock review if the user wants. |

---

## 2. Design direction

**Name: "Ink, paper, one signal."** A grocery run is a chore done in seconds, one-handed, often outdoors. The interface should read like a well-printed shelf label: quiet ink on paper, and a single loud yellow reserved for *the thing you tap to move forward*.

Why this is distinct from the audited state and from Blinkit:
- Blinkit-clone tells to remove: green cart bar, yellow-tinted washes/glows, shadow card on every product, promo carousel as the dominant Home block, "Gotcha!".
- **The cart bar becomes ink (near-black) with a yellow "View cart" pill** — unmistakably not a green-bar clone and the highest-contrast element on screen (12.79:1).
- **Product tiles lose their card**: image sits on a tinted well; text hangs beneath on the page; the only chromed element is the 48 dp add control.

### 2.1 Principles

1. **One page surface.** White page (`paper`), one tint tier (`well` `#F6F8FB`) for image wells/inputs/selected rows. Retire `#EDF2F8` as a page colour (green text on it fails: 4.36).
2. **Yellow = the forward action** (ADD, Add to cart, Proceed, Place order, Verify, Continue, active-nav indicator, one primary CTA per screen). Never a background wash, never text, never on white without ink. Retire the login glows and the yellow progress spinners.
3. **Green = a true state** (delivered, paid, live, in-stock/available, success). Never a button, cart bar, link or decoration. Text green on tinted surfaces uses `#0A741B` (5.60 on `well`).
4. **Ink for text and structure** (`#1A1D2E`); secondary `#6B7280` (4.54 on `well`); `muted` `#9CA3AF` only for non-text glyphs/disabled.
5. **Flat by default.** Hairlines separate; controls get a 3:1 boundary (`line-strong #7B8494`: 3.77 on white, 3.54 on `well`). Shadow is allowed on exactly two things: the floating cart bar and modal sheets.
6. **Spend boldness in one place**: the ink cart bar and the live-tracking screen are the memorable moments; everything else stays quiet.
7. **Plain voice.** Sentence case, active verbs, no exclamation marks, no apologies in errors, errors say what happened and what to do. No all-caps eyebrow labels (removes `CONTACT / DELIVERY ADDRESS / YOUR INFORMATION`, the 8.5 px caps tagline, the hand-drawn headline underline, the `Next →` arrow).
8. **Density is a decision:** phone grid 2 columns at ≥ 48 dp targets; information per tile = price, name, unit, availability — nothing else, because nothing else exists in the API.

### 2.2 Palette (semantic roles, measured contrast)

| Role | Hex | Contrast / rule |
|---|---|---|
| `signal` (action fill) | `#FFE141` | fill only; label `ink` on it 12.79:1; never on white alone (1.30) |
| `signal-pressed` | `#E5C700` (derived; verify in T1) | fill; ink on it ≥ 9:1 (to be measured) |
| `ink` | `#1A1D2E` | on white 16.68 |
| `ink-2` (secondary text) | `#6B7280` | white 4.83, `well` 4.54 |
| `ink-3` (strong secondary) | `#4B5563` | `well` 7.10 |
| `paper` | `#FFFFFF` | page |
| `well` | `#F6F8FB` | image wells, inputs, selected rows |
| `line` | `#E5E9F0` | decorative dividers only |
| `line-strong` | `#7B8494` | control boundaries 3.77 / 3.54 |
| `positive` (fill) / `positive-ink` (text) | `#0C831F` / `#0A741B` | white-on-green 4.90; `positive-ink` on `well` 5.60 |
| `positive-tint` | `#E8F5EA` | badge fill; `#0A741B` on it 5.30 |
| `problem` / `problem-tint` | `#B42318` / `#FDECEA` | 6.57 on white; 5.75 on tint |
| `notice` (waiting/scheduled) | `#8A5A00` on `#FFF6BF` | 5.42 |

Rules: no new colours per screen; no raw `Colors.*`; semantic tokens only (lint check in T1).

### 2.3 Typography (Catamaran only)

Weights kept: 500, 600, 700, 800 (declare only these; drop Thin/Light/ExtraLight/Black files — ≈ 200 KB). Scale (size/line-height): `display` 28/34 w800 · `title` 20/26 w800 · `heading` 16/22 w700 · `body` 14/20 w500 · `label` 14/20 w700 · `caption` 12/16 w600 · minimum text size **12** (nav labels and badges included). Prices: w800, tabular figures if Catamaran ships the feature (verify in T1; else lining figures). All type via `Theme.textTheme`; `fontSize:` literals banned outside the theme (lint/grep test). Text scale is not clamped globally; components are built to grow (§13).

### 2.4 Spacing, radius, elevation, motion

- **Spacing 4-pt:** 4 · 8 · 12 · 16 · 24 · 32 · 48. `AppSpacing.xl (20)` and the `token±N` arithmetic are retired. Page gutter 16 (compact) / 24 (medium) / 32 (expanded).
- **Radius:** `sm 8` (chips, thumbs) · `md 12` (tiles, inputs, buttons, cart bar) · `lg 20` (sheets, dialogs) · `full` (stepper/badge pills only). 10 raw radii removed.
- **Elevation:** `0` everywhere except `raised` (cart bar) and `overlay` (sheets/dialogs). `appCardDecoration()` shadow retired.
- **Motion:** durations 120 / 200 / 280 ms, `easeOutCubic` in, `easeInCubic` out, exits faster than enters. Motion only answers an action or communicates state change: ADD→stepper morph, cart bar slide, sheet, status change, map marker glide. Removed: auto-advancing carousel (or pause + manual only), looping onboarding Lottie, fade-slide-up on every section. One shared skeleton animation controller. `MediaQuery.disableAnimations` ⇒ durations 0 and Lottie static.

### 2.5 Iconography

One family: Material **outlined** at 24 dp (nav and small glyphs 20), filled only for the *selected* nav item and for state icons (check, warning). No mixed rounded/filled at the same hierarchy level. Sizes as tokens `icon-sm 20 / icon-md 24 / icon-lg 32`. Semantic uniqueness: distinct icons for Orders, Address book, Packed, Home/Work/Other labels. Remove icons8 images. `flutter_svg` stays only if T3 adds ≥ 1 custom glyph set; otherwise removed (§19).

---

## 3. Blynk design system

### 3.1 Documentation and token layers

New: `docs/07-design/blynk-customer-design-system.md` (brand-guidelines equivalent; the `brand` skill found none) with palette, type, spacing, radius, motion, voice rules, and the de-slop checklist (§22). Code layers (three-layer architecture from the `design-system` skill):

1. **Primitive** — `lib/design/primitives.dart`: raw colours, sizes, durations.
2. **Semantic** — `lib/design/tokens.dart`: `BlynkColors` (signal, ink, ink2, paper, well, line, lineStrong, positive, positiveInk, problem, notice…), `BlynkSpace`, `BlynkRadius`, `BlynkMotion`, `BlynkIcons`. Existing `app_colors.dart` / `app_design.dart` re-export these so current imports keep compiling during migration; old names deprecated, then deleted at the end (T25).
3. **Component** — themes in `lib/app_theme.dart` (ThemeData component themes for buttons, input, chip, sheet, dialog, card, nav bar/rail, list tile, progress, snackbar, tooltip, text selection, focus/hover) and the widgets in §5.

`useMaterial3: true` is set explicitly; `ColorScheme` built from tokens with `primary: ink`, `secondary: signal`, `tertiary: positive`, so **no widget can silently default to yellow**. Progress indicators and refresh indicators set to ink. Text-selection/cursor: ink.

### 3.2 Component rules

| Component | Rule |
|---|---|
| **Primary button** | Fill `signal`, label `ink` `label` style, min height 48 (grows with text scale via existing `AppButtonPair` logic), radius `md`, no shadow, pressed = `signal-pressed`, disabled = `well` fill + `ink-2` label + reason text nearby. One per screen. |
| **Secondary button** | 1.5 dp `line-strong` outline, `ink` label, 48 dp. **Tertiary** = text `ink` w700 underlined on focus (no green text buttons). |
| **Destructive** | `problem` label on outline; confirmation in a dialog with the action named ("Cancel order", not "Yes"). |
| **Input** | 48 dp min, `well` fill, `line-strong` 1 dp border, focus 2 dp `ink` border (not colour alone: also thicker), error 2 dp `problem` + icon + text below (`liveRegion`), visible label above field (no placeholder-only), `autofillHints` set (phone, one-time-code, name, address). |
| **Chip** | Selected = `ink` fill + white label (not yellow), unselected = outline; 48 dp hit area. |
| **Badge / status** | Icon + word always (never colour only): positive/problem/notice/neutral tints from §2.2; 12 px min. |
| **Product tile** | See §4 (Home/Products). No border, no shadow. |
| **Stepper / add control** | 48 × 48 dp hit target (visual 40); morphs `+` → `− n +` (200 ms); haptic `selectionClick` on Android; semantic label "Add {name}", "Remove one {name}", "{n} {name} in cart". |
| **Cart bar** | `ink` fill, radius `md`, 56 dp, overlaps nav by margin 12, `raised` shadow; left "N items · Rs. X" (items total only — no fee claim), right yellow "View cart" 44 dp pill; on every tab (fixes the audit's "only on some screens"). |
| **Bottom nav (compact)** | 4 destinations (D3), 64 dp + safe area, labels 12 px w700, selected = filled `ink` icon + 3 dp `signal` indicator bar above the label (replaces the yellow pill), badge only on Orders for an active order. |
| **App bar** | White, 0 elevation, 1 dp `line` divider on scroll, back button 48 dp (no `leadingWidth: 25`), title `heading`. |
| **Sheet / dialog** | Compact: bottom sheet radius `lg` top, scrim 50 % black, drag handle 4×32 `line-strong`. ≥ 600 px: centred dialog max 480 (adaptive helper `showAdaptiveSheet`). Focus trapped; Esc/back closes. |
| **Skeleton** | One shared `AnimationController` (`SkeletonScope`), `well` blocks radius `sm`, respects reduced motion (static). Shapes match final layout (no layout shift). |
| **Empty state** | Brand mark or single outline glyph, one title (`heading`), one sentence, one primary or secondary action. No "Sorry!". Copy examples §4. |
| **Error state** | Same widget (`AppStateView`, extended): what happened, what to do, retry button; connectivity vs server vs not-found variants; never shows exception text; `liveRegion`. |
| **Toast/snackbar** | In-app `SnackBar` (ink, white text, 4 s, action optional) on all platforms; replaces `fluttertoast` (removes a plugin and the native-Toast a11y unknown). |
| **Form section header** | Sentence-case `heading`, no caps. |

---

## 4. Screen-by-screen redesign plan

Legend: **Now** (audit) → **Target** → **Data** (source of every value) → **States**. All screens: tokens only, ≥ 48 dp targets, 200 % text, `disableAnimations`.

### 4.1 Launch + auth gate (new behaviour)
- **Now:** always Login; skip affordances ×4; onboarding carousel every cold start; raw errors; dev-OTP chip.
- **Target:** `SessionGate` at `/`: native splash → read session (`restoreSession`) → **signed-in ⇒ Home; first-ever launch ⇒ 2-slide intro (persist `seen_intro`); signed-out returning ⇒ Home as guest**. Login is a bottom sheet/dialog opened from *actions that need it* (checkout, orders, address) with the reason as its title ("Log in to place your order"). Intro slides: static illustration or the brand mark, one line each, no Lottie loop, "Get started" single button. Phone entry: "+94" prefix chip, `tel` keyboard, one-time-code autofill, labelled field, terms/privacy **as tappable links** (needs D5). OTP: 6 segmented cells (single `AutofillGroup` field underneath for a11y/paste), resend timer as text, error live region. `dev_otp` prefill only when `kDebugMode` (client gate, even though the backend omits it in production).
- **Data:** `/auth/*` unchanged. **States:** sending / invalid / expired / too many attempts (backend codes mapped to plain copy) / offline.

### 4.2 Home
- **Now:** header (service window, label, address) + search + promo hero 190–300 dp + category grid + 4 rails; same-weight blocks; no dominant task.
- **Target (compact):** (1) **Location row**: "Deliver to {address label}" + chevron opens address picker; guest: "Add delivery address" (actionable → login sheet then address flow). (2) **Search field** full width, 48 dp, first tap target under the row. (3) **Promo strip** only when `/promotions` returns items: 140–176 dp, swipe only (auto-advance off, or 6 s → 8 s with visible pause and off under reduced motion), text on a scrim that guarantees 4.5:1, no decorative gradient shadow. (4) **Categories**: horizontal 2-row grid preview (4 columns compact) with typographic tiles (see §4.4) + "All categories". (5) **Rails** for the first N backend categories, cards 152 dp wide, **first page (limit 12) with "See all"**, not 100. (6) Persistent cart bar. Removed: header person icon (Account is a tab), "Delivering 8 AM–9 PM" green line — replaced by a single quiet caption under the location row sourced from `StoreInfo` (see below).
- **`StoreInfo` (single static-content file until B1):** hours 08:00–21:00 Asia/Colombo, radius 4 km, flat fee Rs. 70, support contact (D5). Every hard-coded copy of these (Help, cart estimate, header) reads from it; **B1** (public `GET /store`) would replace it with API data.
- **States:** categories/rails skeletons; error = `AppStateView` with retry per section (not silent hide); offline cold start = last cached catalog (T6b) + "You're offline" banner.

### 4.3 Search
- **Now:** good base (debounce, recents, infinite scroll, `AppStateView`).
- **Target:** search field as the route hero (autofocus retained), recents as text rows (device-local), "Browse categories" as typographic chips (not the same grocery icon), results in the standard product tile, "In stock only" toggle wired to the existing `is_available` query param, result count from `pagination.total`. No fake suggestions, no "popular". Empty: "No results for “{q}”. Check the spelling or browse categories." + button.

### 4.4 Categories and Products (browse)
- **Now:** 2-pane Products (1:4), bare spinner/grey error without retry; identical placeholder for every category (backend `image_url` null).
- **Target:** category chips row (sticky, horizontal, selected = ink) replaces the sidebar on compact; medium/expanded keeps a **fixed 200 dp side list** (not flex 1:4). Grid `SliverGrid` 2 / 3 / 4 columns by container width; **paged** (limit 24, load-more) instead of `limit=100` truncation. Category tile without image = **typographic tile** (name in `heading` on `well`, tinted by index from the 3 neutral tints — not random brand colours); with image = image fill. Product tile: image well 1:1 (`well`, radius `md`, `contain`), 48 dp add control overlapping the well's bottom-right, then price (`heading` w800), name (`body` w600, 2 lines), unit (`caption` `ink-2`); unavailable = 60 % image + "Unavailable" text label and no add control; no-photo products = well with brand-mark watermark (designed placeholder). Height from text scale (`mainAxisExtent`, as in search). 
- **Data:** `/catalog/*` unchanged (no MRP/discount/brand — none shown).

### 4.5 Product details
- **Now:** good structure; two CTA bars stack on phones; single image; no share/favourites (explicitly removed).
- **Target:** image well (max 45 % height, pinch-zoom optional later), name `title`, unit + pack size, price `display`, description (if any), key/value details, one bottom bar: **quantity stepper + "Add to cart · Rs. X"** (yellow) — the global cart bar is hidden on this route to avoid two bars. Not-found and failure states already right; keep. Cart line uses the price at add time and is re-verified at checkout (T6).

### 4.6 Cart
- **Target:** lines with 72 dp thumb, name, unit, line total, stepper (48 dp), remove as swipe *and* a labelled 48 dp button; **undo snackbar** on remove; summary: Items subtotal (backend-computed at order time; show "Delivery fee: Rs. 70 — confirmed when you place the order" from `StoreInfo` until B1); minimum-order/free-delivery lines are **not shown** (no backend rule). Persisted cart (T6b). Unavailable/changed lines flagged on entry from a fresh product lookup ("Price changed", "No longer available").

### 4.7 Checkout (rebuilt as one surface)
Top→bottom: **Delivery address** (row: label, line, recipient; "Change"; a small non-interactive map thumbnail is *not* added — keep it text; guest ⇒ login sheet) → **Items** (collapsed summary "N items", expand to lines) → **Note for the rider** (optional; sends existing `customer_notes`; max length per `order.schema.ts`, read in T12) → **Payment**: one static row "Pay cash on delivery" (COD is the only backend method; not a selectable list) → **Bill** (subtotal, delivery fee estimate label, total) → cancellation sentence (12 px, matches `can_cancel` rules). Sticky bottom bar: total + **Place order** (yellow). Order placement sends an **idempotency key** (generated per checkout attempt, reused on retry; backend already supports it), disables double-tap, and on timeout shows "We couldn't confirm your order. Check Orders before trying again" and refreshes `/orders` (recovery path). Removes: 70 dp fixed bars, orange icons, raw toast text.

### 4.8 Confirmation
- **Target:** static check mark (no reused packing Lottie loop), "Order placed", order number (`caption`), amount + "Pay cash on delivery", scheduled line from backend `scheduled_for` when set, address recap, "View order" (primary) and "Continue shopping". Back button goes to Home (stack cleared), not back into an empty checkout. Removes "Gotcha!".

### 4.9 Orders (tab) and Order detail
- **Target (list):** login prompt for guests (no 401 error); active order pinned at top with status badge and a "Track" affordance when trackable; rows: badge, total, first two item names, date; **Reorder** (uses `items[]` snapshot → cart with current prices/availability; no new endpoint) on closed orders; skeleton rows; empty state with "Start shopping". Not width-capped bug fixed by the adaptive shell.
- **Target (detail):** keep the strongest current screen; add delivered time (`delivered_at`), payment line, "Need help with this order?" → Help with the order number prefilled in copy; status refresh while the screen is visible and the order is active (see D9: lightweight polling); the raw-message error path replaced with `AppStateView`. Duplicated private `_CenteredState/_ErrorState/_RefreshFailedNotice` merged into shared widgets.

### 4.10 Live delivery experience — see §12.

### 4.11 Address book, form, picker
- **Now:** raw latitude/longitude inputs exposed to customers, prefilled with hub coordinates (H2, open decision); card tap does nothing; every card `Icons.home`.
- **Target:** list with selection mode (tap = choose for this order and return), default badge, edit/delete in a row menu (48 dp), labels with distinct icons. Form: labelled fields, sections in sentence case, **no lat/long fields** — coordinates come only from the picker or "use current location" (blocked on decision H2: if the user keeps hub-default coordinates, an address saved without picking a point would place the pin on the hub; the plan therefore *requires* the pin to be confirmed before saving, or shows a persistent "Location not set" state — H2 decision needed). Picker: keep the 8 states and copy (the map underneath becomes the Google adapter; the fixed centre pin stays a Flutter overlay and the picked coordinate is read from `onCameraMove`/`onCameraIdle`); add a11y label to the centre pin, throttle the coordinate live region (announce on camera idle, not on every move).

### 4.12 Account (was Profile), Help, About, Legal
- **Target Account:** name/phone (+ edit name/email via the existing `PATCH /me`, no new endpoint), Orders, Address book, Help & support, Privacy policy, Terms, About, Share the app (real store link once published), **Delete account** (D4/B2), Log out (Material dialog; clears *all* providers). Removed: Wallet/Support/Payments tiles, hidden chevron buttons, Cupertino dialog.
- **Help:** FAQ from `StoreInfo` facts, order-specific entry, real contact channel once D5 supplies one (tap-to-call/WhatsApp `url_launcher`? only if a contact number is provided — otherwise the line "contact us on the number below" is deleted; **no invented number**).
- **About:** short Blynk text (no Blinkit copy, no fake version; version from `package_info_plus` — transitive today; declare it, §19).
- **Legal:** privacy policy and terms open the hosted URLs (D5).

### 4.13 Errors, offline, unknown route
- Global: `FlutterError.onError` + `PlatformDispatcher.onError` → friendly full-screen fallback, console-only logging in release (no PII, no SDK); unknown/invalid route → "This page isn't available" with "Go to Home"; missing args on `/product`, `/order` → not-found state (no endless skeleton).
- Offline: classify Dio connection errors as `offline`; a slim banner "You're offline. Showing saved items" on Home/Search/Cart; actions that need the network say so; checkout disabled offline with reason text. No new connectivity package (§19).

---

## 5. Component architecture

**Principle:** extend, don't rewrite. Reuse strongest existing pieces; delete duplicates and dead code.

| Existing | Verdict |
|---|---|
| `ProductCard`/`ProductImage` (5 users) | Reuse; restyle to §4.4 tile; remove card shadow; keep text-scale height logic |
| `AddToCartButton` (3) | Refactor: 48 dp targets, morph animation, haptic; keep its semantic labels (already good) |
| `AppStateView`, `AppSectionHeader` | Extend to THE state widget (variants); adopt on Products, Orders, Addresses, Home, unknown route |
| `AppSkeleton`, `ProductCardSkeleton`, `CategoryTileSkeleton`, `ListRowSkeleton` (0 users) | Reuse + single `SkeletonScope` controller; use `ListRowSkeleton` for orders/addresses |
| `EmptyCartView` | Merge into `AppStateView` empty variant |
| `HomeScreenCarousel` | Keep (best-built, tested ×2); reduce height, remove auto-advance/shadow/gradient sheen |
| `BottomStickyContainer` | Restyle to ink cart bar; lift into the shell so it appears on all tabs |
| `CartPriceDetailWidget`, `OrderBillCard` | Merge price-line helpers (`_price/_rs` ×4) into one `Money` formatter (`formatLkr`) — fixes the `toStringAsFixed(0)` vs decimals inconsistency |
| `OrderStatusHeader/Timeline/CancelSection/BillCard/SummaryProducts` | Keep (tested); restyle tokens |
| `map_provider.dart` (contracts) + `map_marker_logic.dart` + `OrderTrackingMap` | Keep unchanged in shape; the adapter behind them changes: **new `google_map_view.dart`** replaces `maplibre_map_view.dart`; `map_tile_config.dart` is deleted (§11.1) |
| `customTextButton`, `customTextField`, `customListTile` (with inert IconButton) | Replace with themed buttons/inputs/`ListTile` variants |
| `CupertinoLogoutDialog` | Replace with adaptive Material dialog + "clear all providers" |
| `showAppToast` (fluttertoast) | Replace with in-app SnackBar helper |
| Dead: `HomeScreenFloatingNavigationBar`, `FloatingActionButtonWidget`, `SliverAppBarDelegate`, `ScalePageRoute`, `CartGiftScreen`, `CouponsSelectionScreen`, `PdfViewScreen`/invoice route, `kDummyProducts`, `kCategoriesTitles`, `kDummyCoupons` | Delete (T3) |

**New components** (`lib/UI/Widgets/…`): `BlynkButton` (primary/secondary/tertiary/destructive), `BlynkTextField` (label, helper, error, autofill), `MoneyText`, `StatusBadge`, `SectionHeader`, `AdaptiveScaffold` (bottom nav ↔ rail), `AdaptiveSheet` (sheet ↔ dialog), `CartBar`, `OfflineBanner`, `SkeletonScope`, `CategoryTile`, `ProductTile`, `Stepper`, `OtpField`, `TrackingSheet`, `FreshnessChip`. **New services:** `SessionGate`/`AuthGate` (routing), `StoreInfo` (static now, API later), `CartStorage` (persist via existing secure storage), `AppErrors` (Dio error → customer copy taxonomy), `AppConfig` (API/tile URLs from compile-time defines).

**Navigation:** keep named routes (`onGenerateRoute`) but (a) parse arguments defensively, (b) `PopScope` on shell (back on a non-Home tab → Home; on Home → exit), (c) remove duplicate `/orders`/`/profile` routes (tabs only), (d) set URL strategy only if Flutter web survives D1.

---

## 6. Responsive strategy

**One ladder**, measured on the *available width* (`LayoutBuilder`), replacing the 9 private breakpoints:

| Class | Width | Navigation | Layout |
|---|---|---|---|
| compact | < 600 | bottom nav + cart bar | single column, 2-col grid, gutter 16 |
| medium | 600–1023 | `NavigationRail` (icons+labels, 80 dp) + cart bar floats over content | 3-col grid, side category list, content max 840, gutter 24 |
| expanded | ≥ 1024 | extended rail (240 dp) | 4–5 col grid, content max 1200 centred, **cart as right-hand panel (360 dp)** in Cart/Checkout, gutter 32 |

Rules: `AppBreakpoints` (600/1024) is the only source; `Responsive.of(context)` reads container width; grid columns from tile min-width (152 dp) not fixed counts. Sheets → dialogs ≥ 600 (`AdaptiveSheet`). Maps: tracking map fills its container (height = 40 % of viewport compact; 480 dp in expanded side-by-side layout); picker map fills. Product details two-column ≥ 720 container width. Orders/Profile/Address lists capped at 720 and centred. Landscape phone: no bottom cart bar overlap (insets), map not fixed 220 dp. Touch targets stay 48 dp on desktop; **pointer/keyboard**: hover/focus states themed, tooltips on icon buttons, `Shortcuts`/`Actions` for Enter/Space on tappable tiles, visible focus ring (2 dp `ink`).

---

## 7. Android production strategy

**Facts (verified, `audit_android_release.md`, including a real release build):** `applicationId`/`namespace` = `dev.sarthakag.blinkit.ecom` (upstream template author's id, TODO still in place); label "ecom"; version `0.1.0` ⇒ versionCode 1; minSdk 24 / targetSdk 36 / compileSdk 36; release signed with the **debug key** (`app/build.gradle:36`; `keytool` on the AAB shows `CN=Android Debug`); no keystore / `key.properties` (both git-ignored); R8 shrink + obfuscate on via Flutter defaults, no missing-rules errors, no custom keep rules; INTERNET in the main manifest, FINE+COARSE location, **no** background-location, no notifications permission; geolocator adds a `foregroundServiceType="location"` service; no `allowBackup` attribute (defaults to true); no cleartext/network-security config; `.env` bundled in the AAB with `API_BASE_URL=http://localhost…` (cleartext blocked at target 36 ⇒ a phone build reaches no server); launcher icons legacy square (no adaptive); no 512 px store icon; no deep-link filter; no crash hooks.

**Release build probe:** `flutter build appbundle --release` **produced** `app-release.aab` (85.18 MB; arm64-v8a, armeabi-v7a, x86_64) but Flutter exited 1 with "failed to strip debug symbols from native libraries" — a **false negative**: the Android SDK has no `cmdline-tools` so Flutter cannot run `apkanalyzer` (`.sym` files are in the AAB for all ABIs). Fix is environmental: `sdkmanager "cmdline-tools;latest"`. 16 KB page-size alignment: measured ELF `p_align` on arm64-v8a/x86_64 libs is ≥ 0x4000 (libmaplibre, pdfium, dartjni) / 0x10000 (libapp, libflutter). *Not verified:* runtime of the release build on a device (R8 + maplibre/geolocator), bundle-level alignment via bundletool.

**Decisions and changes (all implemented in Phase 4, T17–T20):**

| Item | Approach |
|---|---|
| Application ID | **D2 — user must choose** (permanent once published; needs a reverse-DNS the user controls, e.g. from their domain). Do not invent. Change `namespace`, `applicationId`, `MainActivity` package path together. Keep the Dart package name `ecom` (renaming would touch every import for no store benefit). |
| App name | `android:label` → "Blynk" via `@string/app_name`. |
| Versioning | `pubspec.yaml` `version: 1.0.0+1`; rule: `+N` monotonic per upload; version shown in About from `package_info_plus`. |
| Signing | User generates an **upload keystore** (never in repo); `key.properties` (already git-ignored) read by `signingConfigs.release`; `release` build type uses it; build **fails loudly** if `key.properties` is absent for `--release` (no silent debug fallback); enrol in Play App Signing. Implemented as a *patch to the user's uncommitted `app/build.gradle`* (R1). |
| API config | Replace the bundled `.env` with **compile-time defines**: `flutter build appbundle --release --dart-define-from-file=env/production.json` (`API_BASE_URL`, optional `MAP_TILES_URL`). `AppConfig` reads `String.fromEnvironment`, falls back to `.env` only in debug; **release refuses a non-`https` URL or the `localhost` fallback** (config-error screen, not silent). `flutter_dotenv` removed (§19). `env/production.json` is a template (`env/production.example.json`) — the real file is git-ignored. |
| Google Maps key (Android) | New (G2). Maps SDK for Android key restricted to package name + SHA-1 of **Play app-signing key**, upload key and (dev key) debug cert; API restriction *Maps SDK for Android* only. Injected via git-ignored `android/secrets.properties` → `manifestPlaceholders` → `<meta-data android:name="com.google.android.geo.API_KEY" android:value="${MAPS_API_KEY}"/>`; **no Map ID (D12)** so native loads stay in the SKU that Google's price list (2026-09-17) currently lists as unlimited-free — a pricing finding to **re-verify immediately before production launch**, not an architectural guarantee (§11.4). Full detail §11.3. |
| R8/ProGuard | Ship default rules; add `proguard-rules.pro` only if the device smoke test finds a stripped class (google_maps_flutter/geolocator/dio/secure_storage); upload `mapping.txt` and native debug symbols (`build/app/outputs/mapping/release`, symbols zip) to Play for de-obfuscated crash traces. |
| Manifest hardening | `android:allowBackup="false"` + `dataExtractionRules`/`fullBackupContent` (tokens live in EncryptedSharedPreferences; the Rider app got the same fix in `952e3f5`); remove geolocator's unused `GeolocatorLocationService` with `tools:node="remove"` **iff** one-shot `getCurrentPosition` still works (verify) — avoids a foreground-service declaration question; explicit `usesCleartextTraffic="false"`; keep FINE+COARSE only. |
| Icons/splash | Adaptive icon (foreground/background/monochrome) + round; Android 12 splash icon; 512×512 32-bit PNG store icon exported from the master logo; **D6**: master logo is a 1024 px raster JPEG whose orange/purple/blue palette is not the UI's yellow/green — a vector redraw is a design task for the user/designer; the plan uses the existing raster on a white plate until then. |
| Permissions | Location foreground only; the existing explain-before-prompt copy stays. **No** `ACCESS_BACKGROUND_LOCATION`, no notifications (the app has no push). `google_maps_flutter_android` merges `ACCESS_NETWORK_STATE`, an OpenGL ES 2.0 `uses-feature`, a `<queries>` entry for `com.google.android.apps.maps`, `GoogleApiActivity` and the key meta-data (measured in a scratch build) — no new dangerous permission. Release AAB measured **66.93 MB** with the Google plugin vs 85.18 MB with MapLibre. |
| Crash/logging | No third-party SDK. `FlutterError.onError` + `PlatformDispatcher.onError` → friendly fallback + `debugPrint` (stripped of PII); rely on **Play Console Android vitals** for crash/ANR data. 0 `print` calls today; keep it that way (grep test). |
| Deep links | **Not required for launch.** App Links need an owned domain and a served `assetlinks.json`; decide with D1 (the PWA domain). Documented as a follow-up, not built. |
| Store assets | Feature graphic 1024×500, ≥ 2 phone screenshots (real app, real data), short/long description, contact email — content tasks for the user; screenshots produced during T20 on a device. |

## 8. Google Play Store build requirements

Confirmed from Google's own pages during the audit (WebFetch, 2026-09-21) — re-verify at submission:

| Requirement | Source | Status in repo |
|---|---|---|
| New apps/updates must target **API 36** from 2026-08-31 (extension possible to 2026-11-01) | support.google.com/googleplay/android-developer/answer/11926878 | ✔ targetSdk 36 |
| **Account deletion** path required for apps that create accounts: in-app **and** a web link | …/answer/13327111 | ✘ none (backend has no deletion endpoint; only address DELETE) — D4/B2 |
| **Privacy policy** URL on the listing and reachable in-app when handling personal/sensitive data | …/answer/9859455 | ✘ none (the login sheet's text is not a link) — D5 |
| **Data safety** form complete | Play Console | draft inventory below; owner completes/verifies |
| Personal developer accounts created after 2023-11-13: **closed test with ≥ 12 testers for 14 days** before production | …/answer/14151465 | depends on D8 (account type unknown) |
| 64-bit libs, 16 KB alignment | Android docs | ✔ measured on the debug-symbol AAB (bundle-level not verified) |
| AAB required for new apps | long-standing rule | *not re-fetched*; the build produces an AAB regardless |
| Signed with upload key; Play App Signing | Play Console | ✘ debug-signed today |

**Draft Data-safety inventory (owner to verify; from code reading):** collected — phone number (account, required), name (optional), email (optional), precise location (one-time, to pin the delivery address; stored as address lat/long), delivery addresses and instructions, order history, device/IP/user-agent stored with refresh tokens (`auth.controller`), rider GPS *not collected from the customer*. Not collected — contacts, photos, financial data (COD only), analytics/ads IDs (no SDK). Shared with third parties — **Google (Maps SDK / Maps JavaScript API: IP address, device metadata, crash data, pseudonymous ID per Google's Maps data-safety guidance — owner declares it)**; the icons8 images are removed. In transit — encrypted only if `API_BASE_URL` is HTTPS (release enforces it). Deletion — must be offered (B2). Retention — last rider GPS point currently kept indefinitely (**I3 open**); order/address PII retention undocumented. These facts feed the privacy policy the owner must publish (D5). **Google Maps obligations for the policy/terms:** state that Google Maps is subject to the Google Maps End User Additional Terms and the Google Privacy Policy (with links); the JS API also requires a public privacy policy.

Release build command (target): `flutter build appbundle --release --dart-define-from-file=env/production.json` → `build/app/outputs/bundle/release/app-release.aab`, exit 0 (requires cmdline-tools), signed with the upload key.

---

## 9. iOS PWA strategy

**Requirement:** Safari → Blynk web app → Add to Home Screen → standalone. **Finding (from a real `flutter build web --release` and package inspection, not a browser/iPhone run):** the project *builds* for web (dart2js + CanvasKit, 428 s; no `dart:io` in `lib/`) but is **viable-with-changes and not recommended as the Day-1 iOS experience**:

| # | Problem (evidence) | Effect |
|---|---|---|
| 1 | **SSE cannot stream on web as written.** `location.provider.dart:58-114` uses Dio `ResponseType.stream`; Dio's web adapter uses XHR (`responseType='arraybuffer'`) and resolves only on `onLoad`, with a 15 s + 45 s XHR timeout ⇒ never delivers a chunk, reconnect loop. Auth is a Bearer header (`EventSource` can't send it). | Live tracking would not work. Needs a fetch-stream client. |
| 2 | **Map (re-evaluated for Google Maps, §11.8):** the earlier MapLibre/PMTiles web setup and tile-CORS problems **disappear**; what remains is one Maps JS `<script>` with a **referrer-restricted public key**, billing (10k free JS loads/month), a wider CSP, and no offline map. Flutter web build with the Google adapter is size-neutral (3.78 MB / 1.12 MB gz). | Map works once a key is wired; runtime NOT VERIFIED. |
| 3 | **Tokens are weak on web.** `flutter_secure_storage_web` stores the AES key in `localStorage` beside the ciphertext. | Access + refresh JWTs only obfuscated; XSS = account takeover. |
| 4 | `flutter_cached_pdfview` has no web support (invoice screen; dead route). | Removed anyway (T3). |
| 5 | **No offline**: `flutter_service_worker.js` is an 815-byte self-unregistering stub; no `--pwa-strategy` in 3.47. | "PWA" = installable manifest only. |
| 6 | **First load**: `main.dart.js` 3.83 MB (1.13 MB gz) + `canvaskit.wasm` 7.28 MB (2.92 MB gz), fetched from **gstatic CDN** by default (`--no-web-resources-cdn` bundles it; fallback fonts may still hit gstatic). | Slow on mobile data; third-party call. |
| 7 | **wasm build impossible** (`flutter_secure_storage_web`, `share_plus` use `dart:html`/`dart:ffi`). | JS renderer only. |
| 8 | Canvas rendering: Flutter web accessibility is **off by default** (needs `ensureSemantics()`/hidden button); iOS text-input/keyboard issues are open upstream (flutter#111896, #135800, #42211) — the OTP login depends on text fields; SMS one-time-code autofill on a canvas is unverified. | Login/a11y risk on the primary path. |
| 9 | API URL baked into public `/assets/.env` (HTTPS needed: mixed content); prod `CORS_ORIGINS` must list the origin (or same-origin proxy). No static hosting/TLS documented in `docs/06-deployment`. | Hosting work either way. |

**Options:**

| Option | For | Against |
|---|---|---|
| **A. Flutter web** (single codebase) | Redesign is built once; all widgets reused | Fixes 1, 3–9 above (fetch-stream client, Google JS key in `index.html`, secure-storage weakness, API CORS, hosting, semantics) + 4 MB gz first load + unverified iOS text-input; still no offline |
| **B. Dedicated React + Vite customer PWA** (recommended) | The three other apps (rider, admin, inventory) are already React 18 + Vite in this repo; native inputs (OTP autofill, IME), native `fetch`/`EventSource` alternative for SSE, `@vis.gl/react-google-maps` (MIT, open source; Google-announced but not Google-supported) or `@googlemaps/js-api-loader` v2 for the Maps JavaScript API (a DOM map: no canvas platform view, ≈ 16 KB gz over React, Google's JS loads at runtime), a real service worker (`vite-plugin-pwa`), first load in the low hundreds of KB, `env(safe-area-inset-*)` control, tokens shared as CSS variables generated from §2 | A second UI implementation of ~15 screens; must be kept in step; duplicated validation/formatting (mitigate: shared token JSON + contract tests against the same API) |
| C. Both | — | Highest cost; no |

**Recommendation: B, gated by D1 — unchanged by the switch to Google Maps (§11.8: the map got simpler on both options; the deciding problems are SSE streaming, token storage, offline shell, first load and iOS text input, none of which is a map problem).** Note the docs (`blynk_architecture.md:15,32`, `blynk_prd.md:33,110`) already name a "Next.js Web/PWA" as the iOS fallback — the repo has *no* such app, and its other web apps are Vite, so **Vite** is the consistent choice; the user should confirm rather than have this assumed. Because B is a second product surface, the plan makes it **Phase 5, independent of Android Phase 1–4**, and adds a **time-boxed spike (T21)** that could still validate Option A on a real iPhone (OTP typing, SSE, map, install) before B is committed to. No iPhone is available in this environment ⇒ everything iOS is **PENDING/BLOCKED until tested on a device** (same rule as the Android GPS gate).

## 10. PWA limitations (Android native vs iOS Home-Screen PWA — not hidden)

| Capability | Android native app | iOS Home-Screen PWA |
|---|---|---|
| Install | Play Store | Manual: Share → Add to Home Screen (no install prompt on iOS Safari; must show an instruction UI); no Store presence/reviews |
| Push notifications | *None today* (no push code in the app) | Web Push exists on iOS 16.4+ **only for Home-Screen apps** (WebKit blog) — the backend has no push either ⇒ parity is "none"; adding push is a separate feature |
| Location (address picker) | One-shot geolocator, OS permission persists | `navigator.geolocation`; whether standalone mode **re-prompts** each launch is *unverified* (only old Apple-forum reports) — the manual-entry path must always work |
| Background behaviour | Foreground-only SSE already | iOS suspends backgrounded PWAs; an open stream can die silently ⇒ reconnect on `visibilitychange` + refetch order (mandatory) |
| Storage/session | Keystore-backed secure storage | `localStorage`/IndexedDB; **Home-Screen apps are exempt from ITP's 7-day cap** (WebKit blog) but a Safari *tab* session can be wiped ⇒ re-login (OTP); tokens readable by XSS ⇒ short access token, strict CSP, no third-party scripts |
| Offline | Catalog cache (T6b) | Service worker possible (Option B) — cache shell + last catalog only; **never cache authenticated order data as offline truth** |
| Map | Google Maps SDK for Android (native; currently listed as unlimited-free without a Map ID — re-verify before launch; needs Google Play services) | Google Maps JavaScript API (raster, no Map ID ⇒ no WebGL dependency); **referrer-restricted public key — the `Referer` of a Home-Screen web app is NOT VERIFIED**; billed as Dynamic Maps (10k free/month); **no offline map and no caching of Google content** (Terms §3.2.3); one map per route, destroyed on leave; static text-status fallback |
| Deep links | App Links (optional, needs domain) | Links opened from SMS/other apps open in Safari, not the installed PWA (commonly reported; *not verified here*) |
| Haptics | `HapticFeedback` | Not available in Safari (Vibration API unsupported — *not verified*) ⇒ never rely on it |
| Share | `share_plus` | Web Share API on user gesture only |
| Accessibility | TalkBack/Switch Access via Semantics | Native DOM (Option B) works with VoiceOver; Flutter web needs `ensureSemantics()` |
| Payments | COD only | COD only (parity) |
| Store review/update speed | Play review | Instant deploys |

## 11. Google Maps Platform (replaces MapLibre + PMTiles): web compatibility, keys, billing, quotas

**Instruction (user, 2026-09-21):** replace MapLibre + PMTiles with Google Maps Platform throughout, keep the `MapProvider`/`TrackingMapView` seam, remove PMTiles-specific work and the old "no Google Maps / no API key" prohibition. Evidence below comes from three investigations: Google's own pages (read 2026-09-21; price list dated 2026-09-17), a scratch-copy Android build, and a scratch-copy web build (`research_google_maps_platform.md`, `research_gm_flutter_android.md`, `research_gm_web_pwa.md` in the session scratchpad). **Nothing has been rendered on a device or a browser with a real key** — every "works" below means *builds and loads*, not *looks right*.

### 11.0 Architecture (as decided by the user, 2026-09-21)

```
                 BLYNK CUSTOMER
                       │
             ┌─────────┴─────────┐
             │                   │
        Android App          iOS PWA
        Flutter/native       React + Vite
             │                   │
             └─────────┬─────────┘
                       │
                  Blynk Backend        (no Google Maps dependency)
                       │
                SSE live location      (coordinates + tracking state only)
                       │
                 Google Maps           (each client's own adapter, own key)

TrackingMapView → MapProvider (map_provider.dart) → Google Maps adapter
```

### 11.1 What is preserved and what changes

- **Preserved:** the provider-neutral contracts in `lib/UI/Widgets/Organisms/map_provider.dart` — `GeoPoint`, `MapMarkerSpec` (id + position + tone `destination | riderLive | riderStale`), `TrackingMapView` (read-only markers map), `LocationPickerMapView` (interactive map + fixed centre pin + `onPositionChanged`), the `TrackingMapBuilder`/`LocationPickerMapBuilder` test seams, `PickerMapUnavailableNotification`, and `map_marker_logic.dart`. `OrderTrackingMap`, the picker screen and their widget tests stay as they are except where §12 changes presentation.
- **Changes (one adapter + two lines):** new `lib/UI/Widgets/Organisms/google_map_view.dart` defines `GoogleTrackingMapView` and `GoogleLocationPickerView`; the two `factory … = MapLibre…` redirects in `map_provider.dart` are re-pointed. Only `google_map_view.dart` may import `google_maps_flutter` and only `maplibre_map_view.dart` may import `maplibre_gl` (the isolation test checks both until G4, then only the former). **The MapLibre classes stay in the tree, unmounted, so rolling back is a two-line redirect change (D13).**
- **Removed (task G4 — only after the runtime-verification gate passes, D13):** `maplibre_map_view.dart`, `map_tile_config.dart` (+ `map_tile_config_test.dart`), `Assets/map/blynk_map_style.json`, the `maplibre_gl` dependency and its ≈ 18 MB of native libraries, the MapLibre mentions in `design_audit_fixes_test.dart` and two integration tests, and — only after that gate — the backend `map-tiles` module, archive, Docker/env/config lines and hosting doc (§18). No new PMTiles work is planned; the existing pieces stay as a dormant rollback path until the gate passes (G4).

### 11.2 Platform matrix

| Target | Package / API | Verified how | Status |
|---|---|---|---|
| Android (Play AAB) | `google_maps_flutter` 2.18.1 → `google_maps_flutter_android` 2.19.13 → Maps SDK for Android (play-services-maps 20.0.0) | Scratch copy with the adapter stubbed: `flutter pub get` ✔, `flutter build apk --debug` ✔ (744 s cold), `flutter build appbundle --release` produced the AAB (known cmdline-tools false-negative exit 1) | Builds; **renders: NOT VERIFIED** (no device) |
| Flutter web (option A) | `google_maps_flutter_web` 0.6.3+1 → Maps JavaScript API | Scratch web build ✔ with a real adapter (AdvancedMarker/pin/bounds/camera events/gestures/mapId all compile) | Builds; runtime with a real key **NOT VERIFIED** |
| React + Vite PWA (option B) | `@vis.gl/react-google-maps` 1.10.0 (MIT; announced jointly by Google and vis.gl, **open source, not Google-supported**) or `@googlemaps/js-api-loader` 2.1.1 (not deprecated; v2 = `setOptions` + `importLibrary`) | npm metadata + esbuild size probe (+≈ 16 KB gz over React) | Feasible; not built |
| iOS native | `google_maps_flutter_ios` 2.18.6 | out of scope (no App Store app) | — |
| Windows/Linux desktop | not supported by `google_maps_flutter` | plugin platform list | **`flutter run -d windows` can only show the "Map unavailable" fallback**; map work needs an Android device/emulator or a web target |

### 11.3 API keys and restrictions

- **Two production keys, never one** (an application restriction binds a key to one platform kind).
  - **Android key:** application restriction "Android apps" = package name (D2 applicationId) **+ SHA-1**; API restriction = **Maps SDK for Android** only. Register the **Play app-signing key** SHA-1 (Play Console → Protected with Play → Play app signing): Google re-signs the APK, so registering only the upload key leaves the production map blank. Also register the **upload key** (sideloaded/closed-test APKs, bundletool installs); Google's help page says to register three fingerprints when hybrid (quantum-ready) signing applies. A separate **dev key** is restricted to the debug certificate.
  - **Web key:** application restriction "Websites" with **origin-level** referrers (`https://app.example.com/*`, `https://*.example.com/*`; a port is optional; wildcards only for a subdomain or a path; path-level referrers get stripped by the browser's referrer policy); API restriction = **Maps JavaScript API** only. The web key is public in page source by design, so protection = referrer + API restriction + quota cap + budget alert. A separate dev web key restricted to `http://localhost:*`.
  - Enable **only** Maps SDK for Android and Maps JavaScript API. **Do not enable** Places (it also enables the JS API), Directions/Routes, Distance Matrix or Geocoding: they are separate SKUs, and an API restriction on the key blocks them — this is how the standing "no ETA, routing, geocoding" rule is enforced technically.
- **Where keys live (never committed):** Android — `android/secrets.properties` / `local.properties` (git-ignored) read by Gradle into `manifestPlaceholders`, with the manifest holding `<meta-data android:name="com.google.android.geo.API_KEY" android:value="${MAPS_API_KEY}"/>`; CI supplies it from a secret store. Web — the `<script src="https://maps.googleapis.com/maps/api/js?key=…">` tag cannot read `.env` at build time, so the key is **templated into `index.html` at deploy time** (option A) or injected via a Vite env variable at build (option B). `.example` files are committed; real values are not. A test asserts that no key-shaped string (`AIza…`) exists in tracked files.
- **Rotation/abuse:** create a new restricted key → ship → delete the old; Cloud Console Metrics per key + budget alert detect abuse.

### 11.4 Billing, free usage, quotas

(Global price list — Sri Lanka is not on the India pricing table. Price list dated 2026-09-17; **re-verify before launch**.)

| Item | Fact (Google Maps Platform pricing/billing pages) |
|---|---|
| Billing account | Must be enabled for production; without billing a project is limited to a token number of requests; beyond the free cap a valid payment method is required or the API stops. Payment methods/tax treatment for a Sri Lanka billing account: **NOT VERIFIED** |
| Free model | The old $200 monthly credit is gone (since March 2025); each SKU has its own free monthly cap |
| **Dynamic Maps** (Maps JavaScript API always; Android/iOS **only when a Map ID is used**) | **10,000 free loads/month**, then $7.00 / 1,000 (to 100k), then $5.60, $4.20, $2.10, $0.53 at higher tiers |
| **Native Android/iOS map without a Map ID** (SKU "Maps SDK") | **Unlimited free** as listed on 2026-09-17 — **re-verify immediately before production launch** |
| Static Maps | 10,000 free, then $2.00 / 1,000 (not used) |
| Advanced Markers / Map IDs / data-driven styling | No separate SKU; **but on Android a Map ID (even `DEMO_MAP_ID`) or cloud styling turns each load into a billable Dynamic Maps load** |
| What is one billable load | One map instance displayed; panning/zooming/adding markers add nothing; **every screen open is a new load** |
| Quotas | JS map loads: 30,000/min per project, 300/min per IP; no documented daily cap. Android "unlimited" (as currently listed). **Budgets only alert; only quota caps stop usage.** Whether a hard cap can be set on Android loads that use a Map ID: **NOT VERIFIED** |

**Rulings that follow:** (1) **Android: no Map ID (D12)** → free and unlimited **per the current price list — a finding to re-verify immediately before launch, not a permanent guarantee** (standard Google appearance; a custom style is a later option only if a concrete design requirement appears; legacy `Marker` + `BitmapDescriptor`; **Advanced Markers are not used on Android** because they require a Map ID). (2) **Web: the JS API is billed as Dynamic Maps regardless**; use the legacy `google.maps.Marker` (no Map ID, raster rendering, no WebGL dependency) and count loads. (3) Set the JS API **quota cap at 1,000 map loads/day initially (D11)** plus a **budget alert** and billing alerts (a continuously saturated cap would be ≈ 30,000 loads/month ≈ $140 — an estimate: the cap is an abuse ceiling and the budget alert is the cost control; tune the cap after real traffic); when a cap trips the app shows the existing "Map unavailable" state and the text status (tracking stays useful without the map).

**Estimate only — not a guaranteed bill** (based on the 2026-09-17 price list and the assumptions stated here; recompute from the live price list before launch). Worked estimate for the **web/PWA** (Android native is currently listed as unlimited-free): 1 tracking-map load + 0.3 picker loads per order = 1.3 loads/order, worst case all billed:

| Orders/month | Loads | Cost |
|---|---|---|
| 100 | 130 | $0 |
| 500 | 650 | $0 |
| 2,000 | 2,600 | $0 |
| 10,000 | 13,000 | ≈ $21 |

The free cap runs out at ≈ 7,700 orders/month; if customers reopen the tracking screen 3× per order, 10,000 orders/month ≈ $161. Only the web share of orders counts. Every screen open is a load, so the design creates no map on Home and one instance per tracking/picker route. These figures are estimates from the plan's current pricing assumptions.

### 11.5 Terms and policy constraints (Google Maps Platform Terms and Service Specific Terms)

| Constraint | Consequence for Blynk |
|---|---|
| Do not use Google Maps "with or near a non-Google Map" | **All map surfaces are Google-only.** A MapLibre/OSM/PMTiles view shown on the same screen as a Google map would violate this, so the dormant MapLibre adapter (rollback path, D13) is **never mounted** with a Google view; G4 deletes it after the gate; no OSM attribution overlay on the Google map |
| No caching / pre-fetching / storing of Google map content (Terms §3.2.3) | The service worker must not cache Google tiles/JS; **no offline map**; no saved map bitmaps |
| Logo and copyright must remain visible and unobscured | Layout keeps the Google logo/© clear of sheets, chips and expand/fit buttons (`GoogleMap.padding` on Android; web ignores padding — flutter#142586 — so reserve space) |
| End-user terms must state that Google Maps is subject to the Google Maps End User Additional Terms and the Google Privacy Policy; the JS API requires a public privacy policy | Blynk terms and privacy policy (D5) carry these statements with links |
| End-user location needs express, prior, revocable consent | The existing explain-before-prompt flow stays. Whether the *rider's* position counts as "End User location": **NOT VERIFIED** — treat conservatively |
| Real-time courier position on a consumer map | **No clause found that prohibits it.** Mobility Services (Fleet Engine / Last Mile) are separate contract products for large fleets — optional, not required. The only related restriction: do not build real-time navigation like the Google Maps app from Directions/Geolocation/Maps SDK (Blynk builds none). The signed Mobility contract terms are not public — **NOT VERIFIED** |
| Play Data safety: the Maps SDK collects IP address, device metadata, crash data and a pseudonymous ID | Declared in the Data-safety form (§8) |
| Region | Sri Lanka is not a prohibited territory; base-map coverage there is good |
| Devices need Google Play services | **Phones without GMS (e.g. some Huawei) cannot show the map** → the existing "Map unavailable" state and the text status are the designed fallback; ordering is unaffected |

### 11.6 Android integration facts (scratch build + package source)

- **Toolchain compatibility:** `google_maps_flutter_android` 2.19.13 needs Dart ^3.12 / Flutter ≥ 3.44 (ours: 3.47.2 / 3.13.2) and minSdk 24 (ours 24); its compileSdk is `flutter.compileSdkVersion` (not hard-coded old, so the root compileSdk override is not needed for it). Its own Gradle file declares AGP 8.13.1 / Kotlin 2.3.20 yet builds under our AGP 9.1.0 with `android.builtInKotlin=false`. Warnings: only the generic ones already present.
- **Size:** release AAB **66.93 MB vs 85.18 MB with MapLibre** (−18.25 MB, −21.4 %). The stub has no map UI, but the real adapter adds only Dart code. `libmaplibre.so` disappears; the plugin adds **no native library** (rendering comes from Google Play services). Existing arm64 libs keep ≥ 16 KB `p_align`; armeabi-v7a/x86_64 alignment **NOT VERIFIED**.
- **Merged-manifest additions (measured):** `ACCESS_NETWORK_STATE`, `uses-feature` OpenGL ES 2.0, `<queries>` for `com.google.android.apps.maps`, `uses-library org.apache.http.legacy` (not required), `gms.version` meta-data, `GoogleApiActivity`, an androidx-startup attribution initializer, the key meta-data. No new dangerous permission.
- **Capability check against our contracts** (file:line evidence in the research file):

| Need | On Android | Note |
|---|---|---|
| Custom rider/destination marker images | `BitmapDescriptor.asset/.bytes` with size + pixel ratio | Look built from our assets (ink disc + glyph), rendered once and cached |
| Move a marker by id; anchor, zIndex, flat | `markerId` + `copyWith(position)`, diffed by the widget | No built-in tween (same as today); the 300 ms glide is app-side between two real points only |
| Fit rider + destination | `CameraUpdate.newLatLngBounds(bounds, padding)`; `animateCamera`/`moveCamera` | Call after layout (before-layout behaviour **NOT VERIFIED**) |
| Non-interactive map | All gesture/zoom-control/toolbar/compass/my-location flags default **on** → turn every one off (+ `IgnorePointer`) | |
| Picker centre read | `onCameraMove(CameraPosition.target)` + no-argument `onCameraIdle` | Keep the last move target; the pin stays a Flutter overlay |
| Styling | `mapId`/`cloudMapId` (**billable on Android**, §11.4) or legacy JSON `GoogleMap.style` | Default style is acceptable; JSON style without a Map ID: **NOT VERIFIED** |
| Tests | The package's `FakeGoogleMapsFlutterPlatform` is not importable | Our builder seams already avoid native views in widget tests |

- **Rendering mode and scrolling:** default = Texture Layer Hybrid Composition (`AndroidView`); `useAndroidViewSurface` = full hybrid composition (slower). Virtual Display is gone; `AndroidMapRenderer.legacy` is deprecated. With the default empty `gestureRecognizers` a map inside a `ListView` handles only gestures the list did not claim — the **opposite** of today's `EagerGestureRecognizer`, which is exactly what §12 wants (non-interactive inline; interactive on an expanded route with an eager recognizer). `liteModeEnabled` (Android only, fixed at creation) moves the camera instantly, has flat markers and no gestures, and tapping launches the Google Maps app unless clicks are disabled: **plausible for the inline tracking map, unusable for the picker**, and would mean two widgets. Default plan = full `GoogleMap` with gestures off inline; lite mode is judged in the G1 device spike. TLHC jank in a `ListView` (flutter#69189) **NOT reproduced**. Optional `warmup()`/`initializeWithRenderer` at first use avoids first-map jank.

### 11.7 Web / PWA integration facts

- **Flutter web (option A):** build ✔ with a real adapter: `main.dart.js` **3,781,105 B / 1,118,344 B gz** vs MapLibre's 3,828,101 B / 1.13 MB gz → **size-neutral** (a `SizedBox` stub shows 3,426,123 B only because the plugin is tree-shaken out when unused — ignore that number). Key wiring: `<script src="https://maps.googleapis.com/maps/api/js?key=KEY"></script>` in `web/index.html` `<head>` per the pub README (`&libraries=marker` only if Advanced Markers were used — we use legacy `Marker`, so not needed). Google's own `importLibrary` bootstrap snippet breaks the web plugin (flutter#156295) → use the README tag. Google's JS is fetched at runtime only (0 references to `maps.googleapis.com` in `main.dart.js`; core modules ≈ 290 KB gz; bootstrap cached 30 min, versioned modules 1 year). Known web limitations (not reproduced): no rotate/tilt/compass/My Location; marker anchor/rotation ignored (#80578); padding ignored (#142586); the map is an `HtmlElementView` so Flutter widgets stacked on it need `pointer_interceptor` (#73830); non-Chrome browsers have a platform-view limit (#97774); Safari grey-map reports (#116969, #120367).
- **React + Vite (option B):** `@vis.gl/react-google-maps`/`js-api-loader` load Google's JS at runtime (not in our bundle); markers are DOM/SVG content (Advanced Markers need a Map ID; legacy `Marker` does not); `fitBounds`, `gestureHandling: 'none'|'cooperative'`, and `center_changed`/`idle` for the centre pin. Equivalent seam = a TypeScript `TrackingMap`/`LocationPickerMap` interface with the same props, one adapter file allowed to import Google, plus an import-isolation test.
- **CSP (both):** allow `googleapis.com`, `gstatic.com`, `google.com`, `googleusercontent.com`, `ggpht.com`, `fonts.googleapis.com`/`fonts.gstatic.com`, `blob:` workers and `'unsafe-eval'` in `script-src` (Google's CSP guide). This weakens the strict-CSP mitigation for token storage (§10) and must be weighed in D1.

### 11.8 iOS PWA — map re-evaluation (MapLibre + PMTiles → Google Maps)

| Concern | Before (MapLibre + PMTiles) | Now (Google Maps) |
|---|---|---|
| Extra JS/protocol setup | maplibre-gl-js + `pmtiles` protocol registered | One `<script>`/loader call with a key |
| Tile hosting and CORS | Backend served the archive with Range; CORS lacked `Range`/`If-Match`/`ETag`/`Content-Range` (old B3) | **Gone** — Google serves tiles; no backend map work |
| WebGL | Hard requirement; iOS context-limit/worker-suspension reports (two contexts under Flutter CanvasKit) | **Raster (no Map ID) needs no WebGL**; vector maps are "still experimental" on mobile web and fall back to raster; the WebKit context-loss bugs (261331, 262628) affect vector only |
| Key handling | none | **Public key, referrer-restricted**; the `Referer` a Home-Screen web app sends is **NOT VERIFIED** — a real iPhone must prove the key is authorised in standalone mode; origin-level referrer required |
| Billing | none | JS loads billed as Dynamic Maps (10k free/month); quota cap + budget alert |
| CDN / CSP | none (own origin) | Google CDN dependency; CSP widened (§11.7) |
| Offline | n/a | **No offline map** (Terms §3.2.3); the service worker excludes Google content |
| Supported browsers | — | Google supports Mobile Safari on the current and previous major iOS; **nothing documented for Home-Screen/standalone mode** |
| Not map-related — unchanged | SSE via Dio XHR broken on Flutter web; weak `flutter_secure_storage_web`; no service worker; ≈ 4 MB gz first load; iOS text-input issues | **Unchanged** |

**Verdict:** the swap makes the map simpler on **both** web options and slightly favours B (DOM map, no canvas platform view, none of the `pointer_interceptor`/Safari grey-map platform-view issues; Flutter's CanvasKit + `HtmlElementView` stack is where reported iOS problems concentrate). It does **not** change D1: the deciding problems (SSE streaming, token storage, offline shell, first load, iOS keyboard on the OTP path) are not map problems. **Recommendation stays B, gated by D1 and the real-iPhone spike (T21)**, which must now also prove: (a) the referrer-restricted web key authorises a Home-Screen web app; (b) the map renders and scrolls in standalone mode; (c) raster (no Map ID) is what iOS actually uses.

### 11.9 Standing rules on the map (replaces the MapLibre rules)

Backend → SSE → real rider coordinates → Google map markers. Never simulate movement. **No ETA, no routes, no navigation, no geocoding, no Places** (those APIs are not enabled on the keys). The Google logo/attribution stays visible. Google Maps content is never cached. All map code stays inside the adapter file(s) behind the neutral contracts.

### 11.10 Not verified (needs a device or a real key)

Rendering of any Google map here; marker look; `newLatLngBounds` before layout; lite-mode refresh latency; TLHC jank in a `ListView`; whether a Map ID and a JSON style are mutually exclusive; whether Android Map-ID loads can be hard-capped; the `Referer` sent by a Home-Screen web app; iOS raster/vector choice; armeabi-v7a/x86_64 16 KB alignment; release R8 behaviour with a real key; payment/tax handling for a Sri Lanka billing account; the Mobility contract terms.

---

## 12. Live tracking UX (preserves backend → SSE → Google Maps markers)

**Eligibility unchanged:** `OUT_FOR_DELIVERY` **and** `delivery.assignment_status == PICKED_UP` (mirrors the backend stream gate). Everything below is presentation + a11y.

Compact wireframe (tracking active):
```
┌──────────────────────────────┐
│ ←  Order ORD-…            ⓘ │  app bar
├──────────────────────────────┤
│                              │
│         MAP (≈40 % height)   │  rider marker + destination marker
│      [rider]      [home]     │  [⤢ expand]  [◎ fit both]
│  Google            © map     │
├──────────────────────────────┤
│ Out for delivery   ● Live    │  status (heading) + FreshnessChip
│ Your order is on its way.    │  sentence from status/delivery
│ Updated 8 s ago              │  caption (live region)
├──────────────────────────────┤
│ timeline · items · bill …    │  existing sections (scroll)
└──────────────────────────────┘
```
- **Order status:** unchanged copy/tone system; adds the status change as an animated badge transition (200 ms) and a `liveRegion` announcement.
- **Rider location:** distinct rider marker (ink disc with bike glyph, white ring) and destination marker (home glyph, `positive`-free: ink pin) built as `BitmapDescriptor` images (legacy `Marker`, **no Map ID** so Android stays free, §11.4) inside `google_map_view.dart` only; marker motion = camera-neutral position update; a subtle 300 ms glide between updates is drawn client-side *between two real points only* (no extrapolation/no simulated path — if no new point arrives the marker stays).
- **Destination:** customer's saved address coordinates (backend `delivery_latitude/longitude` as today).
- **Latest update / freshness:** `FreshnessChip`: **Live** (positive tint) when fresh; **Last seen N s/min ago** (notice tint) when stale; **Connection lost — retrying** (problem tint) when the stream is down; always icon + text. Thresholds and reconnect logic **reuse the existing provider behaviour** (`location.provider.dart`); the plan changes presentation only. The 5 s freshness tick continues to rebuild only the chip/caption (not the map).
- **Connection state:** "Reconnecting…" while backoff runs; a permanent 4xx shows "Live location isn't available for this order" with the status timeline as the fallback; `server_shutdown` stays non-terminal.
- **Map controls:** expand (opens a full-screen map route/dialog with the same controller), "Fit both" (only rider + destination; the existing fit-once behaviour becomes an explicit button), each with tooltip/Semantics; the **Google logo and © stay visible and unobscured** (Terms; leave clear space via `GoogleMap.padding` on Android and reserved layout space on web); no OSM attribution overlay any more. **Inline vs expanded:** inline = full `GoogleMap` with every gesture/control flag off + `IgnorePointer`; expanded route = interactive with an eager gesture recognizer; `liteModeEnabled` is evaluated in the G1 device spike (§11.6). **Scroll trap fixed:** inline map is non-interactive (drop `EagerGestureRecognizer` there); interactive only in the expanded view.
- **Closed-order behaviour:** on `DELIVERED/CANCELLED/FAILED/CUSTOMER_UNAVAILABLE` or stream `closed` (`delivery_closed`/`not_trackable`) the map is **removed** and replaced by a summary card (delivered time from `delivered_at`; for failed/unavailable the existing plain-language copy). No stale rider pin remains.
- **Completion:** delivered state gets the one positive-green moment (check + "Delivered at 4:12 PM"), then Reorder / Need help.
- **Status refresh while viewing:** SSE is location-only, so PLACED→PACKED→OUT_FOR_DELIVERY still needs a refresh; proposal **D9**: poll `GET /orders/:id` every 15–20 s while the screen is foreground and the order is non-terminal (no backend change), pausing on background. Without D9 the current pull-to-refresh/resume behaviour remains.
- **A11y:** map wrapped in `Semantics(label: "Map showing the rider and your address")` with `liveRegion` off; the chip/caption is the live region (announced on state change only, not every tick); text alternative always present; controls ≥ 48 dp; reduced motion ⇒ no glide.
- **Not added:** ETA, distance, route line, navigation, rider identity, chat/call, notifications (none backed by the API).
- **Device gate:** Google Maps rendering is *not* verified anywhere (nothing has ever rendered here; no device/AVD; the Windows desktop build cannot show `google_maps_flutter` and can only exercise the "Map unavailable" fallback). Every tracking-visual change ships with widget tests against the `_FakeMap` seam, and the physical-device runbook (`docs/06-deployment/rider-background-tracking-device-verification.md` + a new customer section) stays PENDING.

---

## 13. Accessibility

Targets (WCAG 2.2 AA + platform): every item below becomes a test or a checklist row in T23.

| Area | Requirement | How |
|---|---|---|
| Contrast | Text ≥ 4.5:1; large ≥ 3:1; control boundary/icon ≥ 3:1; state not colour-only | Token unit test computes ratios for every semantic text/background pair (fails the build on regression); `line-strong`, `positive-ink` |
| Touch | ≥ 48 dp (Android) / 44 pt; 8 dp spacing | `androidTapTargetGuideline` + `iOSTapTargetGuideline` in widget tests for ProductTile, Stepper, nav, chips, cart lines; hit-slop for smaller visuals |
| Text scaling | Usable at 200 % | Component tests at 1.0 / 1.3 / 2.0: no overflow (`tester.takeException == null`), buttons grow (extend `AppButtonPair`), no fixed-height text boxes (remove 70 dp/52 dp) |
| Semantics | Every control named; images/icons labelled or excluded; headers marked | Add labels to product card ADD (currently unlabeled), dots (removed or made real controls), map, Change/Add address (real button); `labeledTapTargetGuideline` |
| Screen reader | Logical order; state changes announced | `liveRegion` on inline errors, offline banner, cart count changes, status/freshness; `SemanticsService.announce` for order placed; verify on TalkBack (device — BLOCKED) |
| Focus/keyboard (web/desktop) | Tab order, visible focus, Enter/Space activation, Esc closes | Themed focus ring; `FocusTraversalGroup` per region; `Shortcuts`/`Actions` on tiles; no `GestureDetector`-only controls |
| Reduced motion | Honour system setting; no auto-moving content > 5 s without control | `MediaQuery.disableAnimations` ⇒ zero-duration + static Lottie; carousel manual/pausable |
| Forms | Visible labels, helper text, inline errors near field, autofill hints, correct keyboard type | `BlynkTextField`; `AutofillGroup`; `errorText` announced |
| Errors | Say what happened + what to do; announced | `AppErrors` taxonomy; `liveRegion` |
| Map | Labelled, non-trapping, text alternative | §12 |
| Dark mode | Not in scope for this phase (no dark theme exists; all tokens are semantic so it can be added) | Listed under Risks |

---

## 14. Performance

Budget (targets, to be measured on a **low-end Android device — BLOCKED until a device exists**; until then measured in profile mode on the Windows build / DevTools where valid, clearly labelled):

| Area | Change |
|---|---|
| Startup | Non-blocking: read session + intro flag; no awaited `dotenv`; render the shell from cached catalog while refreshing; native splash → first Dart frame without an intermediate onboarding page for returning users |
| Assets | Delete 3.09 MB unreferenced (`Categories`, `SubCategories`, `Products`, `cimgs`, `auth.json`, `onboarding_cart.png`, `SvgIcons`, `gift.jpg`, sample PDF); keep splash sources out of runtime assets (move to `tool/assets/`); drop unused Catamaran files; brand mark decoded at display size (`cacheWidth`) or a 96 px asset |
| Images | `cacheWidth`/`cacheHeight` from the tile size × device pixel ratio; keep Flutter's in-memory cache; **do not add `cached_network_image`** (adds sqflite/other deps and the audit found seeded products have no images ⇒ profile with real images first; revisit as a separate decision) |
| Lists | Paged product fetch (24) instead of `limit=100`; Home rails first page 12; `SliverGrid` builders kept; remove nested `shrinkWrap` list in sidebar |
| Rebuilds | `context.select`/`Selector` for cart count/qty and per-field product state; `AddToCartButton` selects `quantityOf(productId)` only; `RepaintBoundary` around the map, carousel, product tiles in grids; split `product_details_screen` watcher |
| Skeletons | One `SkeletonScope` controller (was ≈ 80 controllers on a loading Home) |
| Network | De-duplicate fetches: shell-level catalog store; `CategoriesScreen` no force reload; `OrdersScreen` loads on first tab visit and only when signed in; resume refresh only for the visible tab; idempotent order placement |
| Map | Create only while tracking/picking (no map on Home; **each screen open is a billable web load**, §11.4); dispose on leave; keep marker-diff logic; no per-tick allocations of marker sets (memoise on coordinate change); build marker `BitmapDescriptor`s once and cache; optional `warmup()` at first use |
| SSE | Keep lifecycle; add total-retry ceiling **only if D-I4 (SSE cap) decides** — not in this phase's scope |
| Web (Option B) | Route-level code splitting, load the Google Maps JS only on the tracking/picker views, service-worker precache of the shell; Option A: `--no-web-resources-cdn`, `-O4`, measured budgets |
| Bundle size | Track AAB/APK size (release APK size *not yet measured*) before/after; expect −3 MB assets, −200 KB fonts |

Measurement plan (T24): `flutter build apk --analyze-size`, DevTools timeline in profile mode for Home scroll + tracking, cold-start via `flutter run --profile --trace-startup` (`timeToFirstFrameMicros`), widget-rebuild counts in a test (`debugPrintRebuildDirtyWidgets`) for cart-change rebuilds.

---

## 15. Testing strategy

Baseline to protect: 547 Flutter tests, backend 779/34, rider 126 (unchanged by this phase unless B-tasks are approved). TDD per task (write failing test first).

| Layer | What |
|---|---|
| Token/contract tests | Contrast ratios for every semantic pair (§13); no raw `Color(0x`/`Colors.` outside token files and no `fontSize:` outside theme (grep-style tests over `lib/`); allowed radii/spacing; `print(` ban |
| Component widget tests | Each new/changed component: states (default/pressed/disabled/error/loading), 1.0/1.3/2.0 text scale, RTL-neutral, guideline matchers (tap target, labeled tap target, text contrast), reduced-motion |
| Screen widget tests | Every screen with fake providers: loading/empty/error/offline/guest/signed-in; keep existing keys; golden-free (no golden files: font/platform flake) — use structural assertions |
| Provider/unit | `SessionGate`, `CartStorage` round-trip + repricing + unavailable detection, idempotency-key reuse on retry, logout clears Address/Order/Cart/Location, `AppErrors` taxonomy, `StoreInfo`, `AppConfig` (https-only in release), paged product loading |
| Map seam / Google | `map_isolation_test`: only `google_map_view.dart` imports `google_maps_flutter` and no `maplibre_gl`/`pmtiles` reference remains; contract tests for `GoogleTrackingMapView`/`GoogleLocationPickerView` through the existing builder seams (marker diff by id, tone → icon, unavailable fallback, `PickerMapUnavailableNotification`); manifest test (key via `${MAPS_API_KEY}` placeholder, no key literal, no Map ID); repo test that no `AIza…`-shaped string is tracked; `map_tile_config_test` deleted |
| Routing | Unknown route, missing arguments, `PopScope` tab-back, no dead routes (a test enumerates routes and asserts each has a caller) |
| Integration (existing 4 + new) | Extend `live_customer_flow_test`, `order_lifecycle_flow_test`, `live_location_tracking_flow_test`, `admin_to_customer_flow_test` to the new UI keys; add `guest_to_order_flow_test` (guest browse → add → login sheet → address → checkout → confirmation) against the real backend |
| Build tests (CI/local scripts) | `flutter analyze`, `flutter test`, `flutter build apk --debug`, `flutter build appbundle --release --dart-define-from-file=…` exit 0, AAB inspected with `bundletool`/`apkanalyzer`: applicationId, versionCode, permissions (no background location), signing cert ≠ debug, `.env` absent, `https` API URL |
| Physical device (BLOCKED/PENDING) | Release AAB smoke on a real Android phone; TalkBack pass; GPS/map render; low-end frame timing; iOS Home-Screen PWA pass on a real iPhone |

## 16. E2E flows (each must pass on the real backend; device flows marked)

1. **Cold start returning user:** signed-in ⇒ Home directly (no onboarding), cart restored.
2. **First launch:** intro (2 slides, once) → Home as guest.
3. **Guest purchase:** browse → search → add → cart → checkout → login sheet (OTP) → address (picker/manual) → place order → confirmation → Orders shows it.
4. **Cancel:** place → cancel while PLACED/PACKED (`can_cancel`); not offered after `OUT_FOR_DELIVERY`.
5. **Live delivery:** admin packs → rider picks up → customer sees map + Live chip → rider location updates move the marker (real coordinates) → stale/lost/reconnect states → delivered ⇒ map removed, delivered time shown. *(Device gate for real map rendering — PENDING.)*
6. **Failed delivery/customer unavailable/re-stage** copy and no map.
7. **Offline:** cold start offline shows cached catalog + banner; checkout disabled with reason; retry works on reconnect; timeout on Place order ⇒ recovery copy and no duplicate order (idempotency).
8. **Logout/switch account:** no previous user's addresses/orders/cart visible.
9. **Account deletion (if D4):** in-app request → confirmation → session cleared; web deletion URL reachable.
10. **PWA (if D1=B):** install to Home Screen, standalone launch, OTP login, order, tracking, background/foreground resume — *iPhone required; PENDING*.

## 17. Release verification

**Gate order (all must be recorded with evidence; anything not run is stated BLOCKED/PENDING — never "passed"):**
1. `flutter analyze` clean; `flutter test` all pass (≥ 547 + new); backend/rider suites unchanged and green.
2. Token/hygiene tests green (no raw colours/sizes/prints; contrast ratios).
3. `flutter build apk --debug` succeeds (user's Gradle files preserved).
4. `flutter build appbundle --release --dart-define-from-file=env/production.json` exits **0** (needs cmdline-tools); AAB inspected: applicationId, versionCode/Name, targetSdk 36, permissions, upload-key signature, no `.env`, HTTPS URL, native libs ABIs, 16 KB alignment, size.
5. Contrast/tap-target/text-scale suites pass.
6. **Physical Android device:** install AAB-derived APK (bundletool) → runbook: cold start, guest→order, tracking render, TalkBack, low-end frame timing, R8 runtime check. **BLOCKED until a device is available.**
7. Privacy policy + deletion URL live and linked; Data-safety draft reviewed by owner; **Google Maps Platform**: only *Maps SDK for Android* and *Maps JavaScript API* enabled, keys restricted as §11.3, budget alert + per-day quota cap set, billing account active and owned by the business (transferable), no key value in git or in the AAB/`index.html` source of the repo; **the pricing/free-usage page is re-read immediately before launch and the cost estimate recomputed** (the estimate is not a guaranteed bill).
8. iOS PWA verified on a real iPhone (Option-B checklist §24). **PENDING.**
9. The feature phases are **not** called production-ready until the live-location device runbook (S1–S21) *and* the steps above pass.

---

## 18. Files/modules expected to change

(Customer app root = `apps/customer/blinkit-clone-Flutter-ecommerce-/`.)

- **New:** `lib/design/{primitives,tokens,typography,motion}.dart`; `lib/Services/{session_gate,store_info,cart_storage,app_errors,app_config}.dart`; new atoms/organisms listed in §5; `env/production.example.json`; `docs/07-design/blynk-customer-design-system.md`; tests under `test/` (token/hygiene, components, gate, cart storage, guest flow).
- **Modified (design system):** `lib/app_colors.dart`, `app_design.dart`, `app_theme.dart`, `app_responsive.dart`, `main.dart`, `route_generator.dart`, `constants.dart` (delete dummy data), `pubspec.yaml` (fonts, assets, deps, version).
- **Modified (screens, all in `lib/Screens/`):** login, otp, home, search, categories, products, product_details, user_cart, checkout, order_confirmation, user_orders, order_summary, user_address, add_edit_address, live_location_picker, profile→account, help, about, error; plus `customer_shell.dart`.
- **Modified (widgets):** the product/cart/order/address atoms and organisms in §5; **new `google_map_view.dart`** (`GoogleTrackingMapView`, `GoogleLocationPickerView`), the two factory redirects in `map_provider.dart`, `order_tracking_map.dart` (chip, controls, semantics), `android/app/src/main/AndroidManifest.xml` + `android/app/build.gradle` (key placeholder — patched, R1).
- **Modified (providers/infra):** `auth.provider.dart` (logout clears), `cart.provider.dart` (persist, select), `order.provider.dart` (idempotency, notes, polling, recovery), `product.provider.dart` (paging, per-category error), `requesting_methods.dart` (config, error copy), `location.provider.dart` (presentation-only hooks; lifecycle untouched).
- **Deleted:** coupons/gift/invoice screens and routes, dummy data, `HomeScreenFloatingNavigationBar`, `FloatingActionButtonWidget`, `SliverAppBarDelegate`, `ScalePageRoute`, `CupertinoLogoutDialog`, legacy button/field helpers, ~3 MB unused assets, unused fonts; **MapLibre/PMTiles pieces (G4):** `maplibre_map_view.dart`, `map_tile_config.dart`, `Assets/map/blynk_map_style.json`, `test/map_tile_config_test.dart`, MapLibre references in `test/design_audit_fixes_test.dart` and two integration tests, the `maplibre_gl` dependency; and, **if D4/B3 is approved**, the backend `src/modules/map-tiles/`, `tests/map-tiles.test.ts`, `backend/api/map-tiles/` (README + the PMTiles archive), the Dockerfile `ENV MAP_TILES_DIR`/`COPY map-tiles/` lines, the `.env.example` block, `MAP_TILES_DIR` in `src/config/env.ts`, the `/map-tiles` mount in `src/app.ts`, `QUIET_PREFIXES` in `src/utils/request-log.ts` (+ `tests/request-log.test.ts` cases), the map-tiles assertions in `tests/deployment.test.ts`, and `docs/06-deployment/map-tile-hosting-setup.md` (replaced by `docs/06-deployment/google-maps-platform-setup.md`).
- **Android (Phase 4):** `android/app/build.gradle` (patch: id, signing, versioning — the user's uncommitted file), `android/app/src/main/AndroidManifest.xml` (label, backup, cleartext, node removal), `res/mipmap-*`/`mipmap-anydpi-v26/*` adaptive icons, `res/values/strings.xml`, `MainActivity` package move, `android/key.properties` (user-supplied, git-ignored), optional `proguard-rules.pro`, `README.md`/`docs/06-deployment/customer-android-build-status.md` (currently stale: says the build is blocked), new `docs/06-deployment/customer-play-release-checklist.md`.
- **Web (Phase 5, if D1=A):** `web/index.html`, `manifest.json`, `icons/`, fetch-stream client; **(if D1=B):** new `apps/customer-web/` (Vite React) — separate plan.
- **Backend (only if approved, separate tasks):** B1 `GET /store`; B2 account deletion/anonymisation; B3 (**deferred by D13**) retire the PMTiles route/archive/Docker/env pieces listed above only after the Google runtime-verification gate; until then they stay untouched (no tile-CORS work is needed any more); docs.
- **Docs:** this plan, design-system doc, implementation report, privacy/deletion drafts, `implementation-status.md` update.

## 19. Dependencies to add / remove

| Action | Package | Why |
|---|---|---|
| Remove | `flutter_svg` | 0 imports in `lib/` and `test/` (keep only if T3 adds real SVG glyphs) |
| Remove | `flutter_cached_pdfview` (+ transitive `flutter_pdfview`, `sqflite`, `path_provider` chain if otherwise unused) | Only importer is an unrouted screen; no web support |
| Remove | `fluttertoast` | Replaced by in-app SnackBar; removes native Toast (a11y unknown) and a web gate |
| Remove | `flutter_dotenv` (+ `.env` asset) | Replaced by compile-time defines; stops shipping localhost config; verify `test/` usage first (1 import) |
| **Add** | `google_maps_flutter` (resolved in a scratch build: 2.18.1 → `google_maps_flutter_android` 2.19.13, `_web` 0.6.3+1, `_platform_interface` 2.17.0; needs Dart ^3.12, minSdk 24) | Google Maps adapter behind the existing contracts (G1) |
| **Remove** | `maplibre_gl` (+ `libmaplibre.so`; release AAB 85.18 → 66.93 MB) | Replaced by Google Maps (G4) |
| Declare | `package_info_plus` | Version in About/support (transitive today; make explicit) |
| Keep | `provider`, `dio`, `geolocator`, `flutter_secure_storage`, `share_plus`, `lottie` (only if a Lottie survives the de-slop pass; else remove) | Core |
| **Do not add** | `cached_network_image`, `connectivity_plus`, `shared_preferences`, state-management libs, analytics/crash SDKs, `go_router` | Covered by existing code/secure storage/Dio error classification; each needs evidence first |
| Web A only | `fetch_client` (or `package:web`) | Streaming fetch for SSE |
| Web B only | new app: `react`, `vite`, `vite-plugin-pwa`, `@vis.gl/react-google-maps` (or `@googlemaps/js-api-loader`) (same as rider/admin stack + this one) | Separate plan |

## 20. Risks / blockers

| # | Risk / blocker | Mitigation |
|---|---|---|
| **R1** | The user's **five uncommitted `android/*.gradle` files** (Flutter-template migration + my compileSdk override in `android/build.gradle`) would not exist in a fresh git worktree ⇒ Android builds fail there. Phase 4 must patch them. | Work on a branch **in place** (or ask the user to commit those five files first); never overwrite; backup existing at scratchpad noted earlier. |
| R2 | **No physical Android device, no iPhone, no emulator/system images** ⇒ map rendering, GPS, TalkBack, low-end performance, release/R8 runtime, iOS PWA are all unverifiable here. | Mark PENDING/BLOCKED; automated substitutes only; do not claim verified/production-ready. |
| R3 | Unresolved live-location decisions (I3 last GPS point retention, H2 hub default coordinates, I4 SSE cap, rider token storage, customer polling). H2 blocks removing lat/long fields cleanly; I3 feeds the privacy policy. | Ask the user; plan branches on the answer (§4.11). |
| R4 | Play requirements not met: account deletion (no endpoint), privacy policy (none), Data safety (undrafted), upload keystore (user must create), support contact (none). | D4/D5; deliverables listed in T19. |
| R5 | Backend gaps that make static copy drift (hours, fee, radius, contact): no `GET /store`. | `StoreInfo` single source now; B1 to close. |
| R6 | Logo is a raster JPEG with a colour palette unrelated to the UI's yellow/green; store icon/feature graphic quality limited. | D6 (designer/vector); plan uses a white plate. |
| R7 | Flutter web fails for tracking/map/login as-is (§9); Option B is a second UI surface. | D1 + T21 spike; keep Android independent. |
| R8 | Redesign touches ~40 files and many test keys ⇒ regression risk. | Token layer first with compatibility re-exports; migrate screen by screen; tests before/after each; keep keys. |
| R9 | Placeholder-heavy catalog (no product/category images seeded) ⇒ the "premium" look depends on content the admin must upload; performance with real images unmeasured. | Designed no-photo tiles; content checklist to the user; profile once images exist. |
| R10 | Geolocator's foreground-service manifest entry may raise a Play declaration question. | Remove the service node if one-shot location still works (verify) or answer the declaration. |
| R11 | Dark mode absent; tokens are semantic so it is possible later. | Out of scope; documented. |
| R12 | Flutter's Windows/desktop targets exist but are not a shipping target; the responsive work benefits them but they are not verified as products. | Not in the distribution scope. |
| R13 | `android/.kotlin/` (empty session/error directories) appeared during audits; git shows no untracked files. | Ignore; confirm `.gitignore` covers `.kotlin/`. |
| **R14** | **Google Maps billing and key exposure.** Billing must be enabled; the web key is public in page source; an unrestricted or uncapped key can be abused; budgets only alert. | Separate restricted keys (§11.3); per-day quota caps + budget alert (G0); `map unavailable` fallback when a cap trips; no Map ID on Android. |
| **R15** | **Play-signing SHA-1 pitfall:** registering only the upload key leaves the production Android map blank. | Register the Play app-signing key SHA-1 from Play Console (G0/G2); checklist item §23. |
| **R16** | **Google Terms:** no non-Google basemap "with or near" Google Maps; no caching of Google content; logo/© visible; user-facing terms must cite Google's End User terms + Privacy Policy. | the dormant MapLibre adapter is never mounted with Google and G4 deletes it after the gate; service worker excludes Google; legal copy in D5; layout tests keep the logo clear. |
| **R17** | **Devices without Google Play services** (some Huawei) and **desktop targets** (Windows/Linux unsupported by `google_maps_flutter`) cannot show the map. | Designed fallback ("Map unavailable" + text status) already exists; dev on an Android device/emulator or web. |
| **R18** | **Real-time courier tracking on a Google map:** no prohibiting clause was found, but the signed Mobility Services terms are not public and "rider location as End User location" is unverified. | Owner confirms with Google/legal if concerned; the plan does not use Fleet Engine or Directions. |
| **R19** | The already-implemented live-location work (adapter, tile config, PMTiles route, docs, tests) was built against MapLibre and never rendered on a device; replacing it costs test/doc churn and re-opens the map device gate. | G1 keeps the contracts and builder seams so widget tests survive; the old pieces stay as a dormant rollback path and G4 removes them only after the runtime-verification gate (D13) passes; docs/report updated in G3. |

**Decisions (D-list) — D1, D11, D12 and D13 are RECORDED (2026-09-21); the others remain open:**
- **D1** iOS PWA: A (Flutter web) vs **B (React+Vite PWA, recommended)** vs spike-first (T21). **RECORDED:** the user's architecture diagram specifies **B (React + Vite iOS PWA)**; T21 becomes a real-iPhone verification of that choice (including the Google map in Home-Screen mode), not a choice between A and B.
- **D2** Android applicationId (permanent).
- **D3** Bottom-nav IA: **Home · Categories · Orders · Account** (Help moves into Account/order detail) vs keep Shop · Orders · Help · Profile.
- **D4** Approve backend additions: B1 public `GET /store`; B2 account deletion (+ anonymisation policy for `orders ON DELETE RESTRICT`); B3 (**deferred by D13**) retire the PMTiles route/archive/Docker/env pieces after the Google runtime gate.
- **D5** Privacy policy + terms (authorship, hosting URL) and a real customer support channel (phone/WhatsApp/email).
- **D6** Logo vector/palette reconciliation.
- **D7** Guest browsing with a login sheet at checkout (**recommended**) vs mandatory login.
- **D8** Play developer account type (personal ⇒ 12 testers × 14 days).
- **D9** Poll order status while viewing (15–20 s) vs current pull-to-refresh only.
- **D10** The open live-location decisions (I3, H2, I4, token storage).
- **D11 — DECIDED:** use a **Blynk/company-controlled Google Cloud project and billing account, not a developer's personal project**; the project must be **transferable and business-owned before the Play Store launch**. Initial **web quota 1,000 map loads/day**; **separate Android and web API keys**, each restricted to only the API it needs; **billing alerts enabled**. (Still to be filled in by the owner: the billing payment method, the alert amounts, and who registers the Play app-signing SHA-1.)
- **D12 — DECIDED:** **no Map ID initially**; standard Google map appearance. This keeps the Android native map on the plan's stated unlimited-free path (a current pricing finding to re-verify before launch) and avoids Dynamic Maps billing through a Map ID. A custom Google style is considered later only if a concrete design requirement appears.
- **D13 — DECIDED:** **do not delete the PMTiles backend pieces yet.** Sequence: (1) implement the Google adapter; (2) get the Android build working; (3) test the map on a real Android device; (4) verify rider marker movement using the existing SSE location; (5) verify customer address/location behaviour; (6) verify the Google logo/required attribution; (7) verify production API-key restrictions; (8) test the web/PWA map separately. **Only after all of these pass**, archive/remove the PMTiles route (clean rollback path until then).

---

## 21. Implementation task breakdown

Order matters; each task = one branch-in-place commit set with its own tests (commit only when the user asks). Complexity: S/M/L.

**Phase 0 — Decisions & prerequisites (no app code)**
- **T0** Resolve D1–D10; install Android `cmdline-tools`; user generates upload keystore; confirm branch strategy (R1). *Deliverable: decisions recorded in this plan's ledger.*

**Phase 1 — Foundations**
- **T1 (L) Design tokens + theme.** New `lib/design/*`; re-export shims in `app_colors/app_design`; `ThemeData` component themes; contrast/hygiene tests. *Acceptance:* token tests green; app compiles unchanged; no widget defaults to yellow.
- **T2 (L) Component library.** `BlynkButton`, `BlynkTextField`, `StatusBadge`, `AppStateView` variants, `SkeletonScope`, `SnackBar` helper, `AdaptiveSheet`, `Stepper`, `MoneyText`, `OfflineBanner`; component tests at 3 text scales + guideline matchers.
- **T3 (M) Cleanup & de-branding.** Delete dead screens/routes/data/assets/fonts, Blinkit About, icons8, "ecom" strings in Dart; About rewritten; remove deps (§19). *Acceptance:* analyzer clean, asset size −3 MB, route-caller test.
- **T4 (M) Adaptive shell.** `AdaptiveScaffold` (nav bar ↔ rail), cart bar lifted into shell, `PopScope`, single breakpoint ladder, content caps.

**Phase 2 — Session & data integrity**
- **T5 (M) Session gate + auth flows.** `SessionGate`, intro flag, login as contextual sheet, OTP field, logout clears all providers, guest prompts, `dev_otp` gated by `kDebugMode`.
- **T6 (M) Cart + checkout integrity.** Persist cart (secure storage), reprice/availability refresh on cart open, idempotency key, order-placement recovery, notes field wiring (schema max length read from `order.schema.ts`).
- **T6b (S) Catalog cache.** Last catalog persisted for offline cold start (categories + first page), staleness label.
- **T7 (M) Errors & offline.** `AppErrors` taxonomy, global error hooks, offline banner, unknown-route and missing-arg handling; replace developer copy.
- **T8 (S) Config.** `AppConfig`, dart-define, release HTTPS/localhost guard, remove dotenv.

**Phase 2b — Map migration to Google Maps (no PMTiles work)**
- **G0 (S, owner + me) Google Cloud setup.** Use a **Blynk/company-controlled Google Cloud organisation/project and billing account (never a developer's personal project; at least two business owners; transferable — business-owned before the Play launch, D11)**; enable billing and billing alerts; enable *only* Maps SDK for Android and Maps JavaScript API; create the Android key (package + SHA-1s) and the web key (origin referrers) plus dev keys; set the **web quota to 1,000 map loads/day** initially and a budget alert (each key restricted to only the API it needs; production keys never on developer machines; dev keys separate); write `docs/06-deployment/google-maps-platform-setup.md` (steps, key inventory without values, rotation, cost estimate §11.4). *Acceptance:* keys exist and are restricted; Places/Directions/Geocoding are not enabled; no key value in git; the project and billing account are owned by the business. Needs D2 (package name) and the owner's billing details (D11).
- **G1 (L) Google adapter.** Add `google_maps_flutter`; new `google_map_view.dart` with `GoogleTrackingMapView` and `GoogleLocationPickerView` implementing the unchanged contracts (legacy markers from cached `BitmapDescriptor`s per tone, marker diff by id, fit-both, all gesture flags off + `IgnorePointer` inline, expanded interactive variant, centre-pin picker via `onCameraMove`/`onCameraIdle`, `PickerMapUnavailableNotification` on failure/no Play services); re-point the two factory redirects (the MapLibre classes stay in the tree, unmounted, as the rollback path, D13); update `map_isolation_test` to allow each SDK only in its own adapter file. *Tests first* via the existing builder seams. *Acceptance:* analyzer clean, all existing map widget tests green, isolation test green; device spike (lite mode, marker look, `newLatLngBounds`) is **BLOCKED until a device exists**.
- **G2 (M) Key injection + manifest.** Android: `secrets.properties`/`local.properties` → `manifestPlaceholders`, meta-data, no Map ID; web (if option A): `index.html` script tag templated at deploy; `.example` files; no-key-in-git test. *Acceptance:* debug + release builds compile with a placeholder; a real key run is BLOCKED (no device).
- **G3 (S) Docs.** Update `blynk-live-location-tracking-report.md`, `implementation-status.md`, `customer-android-build-status.md`, the live-location plan's map sections (mark superseded by this plan §11) and the device-verification runbook's map steps.
- **G4 (M) Verification gate, then archive/remove MapLibre + PMTiles (D13).** **Nothing MapLibre/PMTiles-related is deleted until ALL of the following pass and are recorded with evidence** (any item not run is BLOCKED/PENDING, never "passed"): (1) Google adapter implemented (G1); (2) Android build works (debug APK + release AAB, exit 0); (3) the map is tested on a **real Android device**; (4) **rider marker movement verified from the existing SSE location stream**; (5) customer address/location behaviour verified (picker centre pin, use-my-location, save); (6) **Google logo/required attribution visible** and unobscured; (7) **production API-key restrictions verified** (Android key works only with the Play-signed build and its app-signing SHA-1 and is rejected elsewhere; web key works only from the PWA origin; unused APIs are blocked); (8) the **web/PWA map tested separately** (real iPhone, Home-Screen mode, for the React + Vite PWA). Rollback until then = flip the two factory redirects in `map_provider.dart` back (the MapLibre adapter, `map_tile_config.dart`, style asset, dependency and the backend `/map-tiles` route/archive all stay in place; the MapLibre adapter is never mounted alongside Google). **Only after the gate:** archive first (local tag/branch `archive/maplibre-pmtiles`; keep the PMTiles archive file and `map-tile-hosting-setup.md` in the archive), then remove — Customer: `maplibre_map_view.dart`, `map_tile_config.dart`, style asset, tests, the `maplibre_gl` dependency; Backend: the `map-tiles` module, tests, archive, Docker/env/config lines, `request-log` quiet prefix and hosting doc, with the backend suite (779/34) green after the matching test edits. *Acceptance:* the gate record exists; `grep -ri "maplibre\|pmtiles\|map-tiles"` finds only historical/archived docs.

**Phase 3 — Screens** (each: tests first, then implement, keep keys)
- **T9 (L)** Home + `StoreInfo`. **T10 (L)** Search + Categories + Products (paging, tiles). **T11 (M)** Product details. **T12 (L)** Cart + Checkout + Confirmation. **T13 (M)** Address book + form + picker (H2-dependent; picker uses the G1 adapter). **T14 (M)** Orders list + detail (reorder, delivered time, D9 polling). **T15 (L)** Live tracking UX (§12; needs G1). **T16 (M)** Account/Help/Legal/Delete-account UI.

**Phase 4 — Android distribution**
- **T17 (M)** Identity: applicationId (D2), label, adaptive icons, splash, store icon, `pubspec` version.
- **T18 (M)** Signing + manifest hardening (patch, R1), release guard for `key.properties`; verify the Google Maps Android key restriction matches the **Play app-signing** SHA-1 (G0/G2).
- **T19 (M)** Compliance: privacy/terms pages content (owner-approved), in-app links, deletion flow (B2), Data-safety draft, `docs/06-deployment/customer-play-release-checklist.md`.
- **T20 (M)** Release verification: AAB build exit 0, bundle inspection, size, R8 runtime notes; **device smoke BLOCKED** until a device exists.

**Phase 5 — iOS PWA (per D1)**
- **T21 (M) Real-iPhone verification of the chosen PWA (D1 = React + Vite).** On a real iPhone in Safari and Home-Screen mode: minimal Vite page with login (OTP autofill), tracking map (Google JS, raster, no Map ID), fetch/SSE resume after backgrounding, install flow. Must prove the referrer-restricted web key is authorised in standalone mode and record the `Referer`. Feeds the G4 gate (item 8). Flutter web is not the chosen route; if the iPhone test fails on a fundamental point, D1 is reopened.
- **T22a (not selected, D1)** Flutter-web option changes (§9 list) — kept only as a fallback. **T22b (L)** Option B: separate plan `docs/superpowers/plans/…-customer-web-pwa.md`.
- **T22c (S)** Web hosting/TLS/CORS/same-origin doc in `docs/06-deployment/`.

**Phase 6 — Audit & release**
- **T23 (M)** Accessibility pass (§13 matrix) — fixes + evidence.
- **T24 (M)** Performance pass (§14 measurements, real-image profile if content exists).
- **T25 (M)** **Design/de-slop audit** (§22) + remove deprecated token shims.
- **T26 (S)** Final verification per §17; update `implementation-status.md`, Graphify refresh (`--update`), report; **no production-ready claim** while R2 gates remain.

Dependencies: T1→T2→(T3,T4)→T5..T8; G0→G1→G2→G3, then the **G4 verification gate** (needs a real device, real keys and the PWA — none available yet; G4 removal happens only after it passes, D13); T9..T16 (T13 and T15 need G1); T17..T20 need D2/D5 + T8; T21 independent after T1 (design tokens as CSS variables); T23–T26 last.

## 22. Design / de-slop audit task (T25)

Run after Phase 3 with screenshots of every screen at 360×800, 412×915, 768×1024, 1280×800, 1.0× and 2.0× text. Use `frontend-design`'s tell list plus `ui-ux-pro-max` §Visual Quality. Each row is pass/fail with a fix.

| Tell | Test | Current finding (fixed by) |
|---|---|---|
| Uniform rounded cards + identical soft shadow on everything | Count `appCardDecoration`/shadow uses; only cart bar + sheets may have shadow | 8 users + login + promo (T1/T9–T12) |
| Gradient washes as decoration | grep `LinearGradient/RadialGradient` outside promo image scrims | login glows, promo sheen (T5/T9) |
| More than one radius family / random radii | radii ∈ {8,12,20,full} | 10 raw radii (T1) |
| Too many colours | colours ∈ tokens; orange/blue/deep-orange gone | 125 `Colors.*` (T1) |
| Yellow used as wash/text; green used decoratively | Manual: yellow only on action fills; green only on state | cart bar/Place Order/text buttons (T1/T2/T12) |
| Pills everywhere | pills only for stepper/badge | chips/nav pill (T2/T4) |
| All-caps eyebrow labels, `WORD — fragment`, one-word headline accent, `→` on buttons, 8.5 px tagline | grep for `toUpperCase`, `TextCapitalization.characters`, arrows | caps section labels, tagline, underline painter, "Next →" (T5/T13) |
| Numbered/step markers on non-sequences | manual | none found; guard |
| Hero sections / oversized promo | promo ≤ 176 dp compact and only when data exists | 190–300 dp (T9) |
| Excess whitespace / repetitive identical blocks | Home block hierarchy review | five same-weight blocks (T9) |
| Fake glassmorphism, meaningless animation | reduced-motion + purpose test per animation | looping Lottie, auto-carousel, fade-slide entrances (T2/T9) |
| Inconsistent type (19 sizes) | sizes ∈ scale | 176 literals (T1) |
| Excess icons / mixed families / repeated glyph meanings | icon-sheet review | 61 distinct, duplicated meanings (T2) |
| Generic ecommerce patterns (coupons, wallet, "Gotcha!", green bar) | content review | removed (T3/T8) |
| Fake/foreign content | grep Blinkit, dummy, icons8, "10-Minute" | (T3/T5) |
| Does it look intentionally Blynk? | 5-second test on Home, product tile, cart bar, tracking: is the ink/yellow signal system recognisable without the logo? | to be run |
Output: `docs/05-implementation/customer-de-slop-audit.md` with before/after screenshots (Windows/desktop capture and, when available, device).

## 23. Android release checklist

- [ ] D2 applicationId chosen; `namespace`, `applicationId`, `MainActivity` package updated together; app builds
- [ ] `android:label` = Blynk; pubspec `version: 1.0.0+N` (N increments every upload)
- [ ] Upload keystore created by the owner, stored safely (offline backup); `android/key.properties` present locally, **git-ignored** (verified); release build fails if missing; Play App Signing enrolled
- [ ] `--dart-define-from-file=env/production.json` with **https** `API_BASE_URL`; release refuses `localhost`/http; no `.env` in the AAB
- [ ] `flutter build appbundle --release …` exits 0 (cmdline-tools installed); AAB signature ≠ debug (`keytool -printcert`)
- [ ] Merged manifest: INTERNET, FINE+COARSE only; **no** background location, no notifications; `allowBackup=false`; `usesCleartextTraffic=false`
- [ ] targetSdk 36 (≥ Play's 2026-08-31 rule); 64-bit libs; 16 KB alignment checked (bundletool)
- [ ] R8 mapping + native symbols archived and uploaded; device smoke confirms no stripped-class crash (**BLOCKED without device**)
- [ ] **Google Maps:** billing active; Android key restricted to package + SHA-1 of the **Play app-signing key**, upload key (and dev key separate); API restriction *Maps SDK for Android* only; no Map ID; quota/budget alerts set (web quota 1,000 loads/day initially); pricing/free-usage page re-verified immediately before launch (the Android "unlimited-free" status is a current pricing finding, not a guarantee); project and billing account owned by the business and transferable; key injected from git-ignored `secrets.properties`/CI secret and absent from git; map verified on a real device with the release-signed build (**BLOCKED without device**); "Map unavailable" fallback verified with a bad key
- [ ] Adaptive + round + monochrome icons; 512 px store icon; feature graphic 1024×500; ≥ 2 real screenshots
- [ ] Privacy policy URL live, linked in-app (login, Account) and on the listing; Terms linked
- [ ] Account deletion works in-app and via a public web URL; the Play Console declaration filled
- [ ] Data-safety form completed from the §8 inventory (owner-verified)
- [ ] Support contact real; content rating questionnaire; app category; contact email
- [ ] Closed testing: 12 testers × 14 days if the account is personal (D8)
- [ ] Release notes; versioned changelog; nothing uploaded by this plan

## 24. iOS PWA deployment checklist (per D1; Option B shown, Option A additions in brackets)

- [ ] Decision D1 recorded; T21 spike passed on a **real iPhone** (Safari and Home Screen mode)
- [ ] HTTPS origin with valid TLS; API and PWA same origin via reverse proxy **or** `CORS_ORIGINS` contains the exact PWA origin (prod forbids `*`)
- [ ] `manifest.webmanifest`: name/short_name Blynk, `display: standalone`, `start_url`/`scope`, `theme_color`/`background_color` (paper/ink, not the template yellow unless intended), 192/512 + maskable icons, 180×180 `apple-touch-icon`
- [ ] `<meta viewport … viewport-fit=cover>`, `apple-mobile-web-app-capable`, status-bar style chosen and tested; `env(safe-area-inset-*)` on header, cart bar, bottom nav [Flutter: engine overwrites viewport — verify]
- [ ] Service worker: precache shell + fonts; runtime cache for catalog images; **never** cache Google Maps content (Terms §3.2.3) and **never** cache authenticated `/orders*` as offline truth; update flow ("New version — reload")
- [ ] Add-to-Home-Screen instruction UI for iOS Safari (no install prompt)
- [ ] Auth: OTP field uses `autocomplete="one-time-code"`, `inputmode="numeric"`; tokens storage decision (short-lived access token; refresh token risk documented; CSP without third-party scripts)
- [ ] SSE: `fetch` streaming with Bearer header [Flutter: `fetch_client`], reconnect on `visibilitychange`/`pageshow`, refetch order on resume, backoff identical to native
- [ ] Map: Google Maps JavaScript API with a **web key restricted to the PWA's exact origin(s)** and to the Maps JavaScript API only; billing + per-day quota cap (initially 1,000 loads/day) + budget alert set; legacy `Marker`, no Map ID (raster, no WebGL dependency); single map instance per route, destroyed on leave; Google logo/© visible; failure/quota-tripped fallback to the text status; **on a real iPhone: key authorised in Home-Screen mode, map renders and scrolls**
- [ ] CSP allows `googleapis.com`, `gstatic.com`, `google.com`, `googleusercontent.com`, `ggpht.com`, `fonts.googleapis.com`/`fonts.gstatic.com`, `blob:` workers and `'unsafe-eval'` for the map, with the token-safety trade-off (§10, §11.7) accepted by the owner
- [ ] Location: one-shot geolocation with manual-entry fallback; standalone-mode permission behaviour tested on device
- [ ] Deep links/refresh: URL routing (path URLs) so refresh on `/order/:id` reloads correctly; a static-host SPA fallback rule
- [ ] Accessibility: VoiceOver pass (native DOM); [Flutter: `ensureSemantics()`]; focus order; text zoom
- [ ] Hosting: static host + cache headers (immutable hashed assets, no-cache `index.html` and service worker), compression (br/gzip), CanvasKit self-hosted [Flutter: `--no-web-resources-cdn`, font fallback URL]
- [ ] Performance budget recorded (first load KB, time-to-interactive on a mid iPhone/3G-class throttle)
- [ ] Limitations page/section reviewed against §10 with the owner (no push, manual install, background suspension, storage eviction outside Home-Screen mode)
- [ ] Privacy policy / deletion URL are the same public pages as for Android

---

## Ledger seed (for the execution session)

`Task N: complete` lines go here as tasks finish. Rulings must be recorded as `Ruling: <decision> — <why> — <cost if wrong>`. Provisional rulings made while writing this plan:
- Ruling: cart bar is ink, not green — distinguishes from the Blinkit pattern, gives the highest contrast, frees green for true state — costs one re-skin if the owner prefers green.
- Ruling: Option B (React + Vite PWA) recommended for iOS — evidence in §9; not decided without D1 and a real-iPhone spike.
- Ruling: no new packages for offline/caching/connectivity — existing Dio error classification + secure storage suffice; revisit with profiling evidence.
- Ruling: Dart package name `ecom` unchanged — pure churn with no store benefit.
- Ruling (2026-09-21, user instruction): map provider = Google Maps Platform, contracts in `map_provider.dart` preserved; existing MapLibre/PMTiles pieces kept dormant until the runtime gate passes (D13) — the user withdrew the old prohibition — cost: re-opens the map device gate and touches the already-built adapter, tests, docs and (if D13) the backend tile route.
- Ruling: **no Map ID on Android** and legacy markers — keeps native map loads in the SKU currently listed as unlimited-free (Map ID/cloud styling would bill each load as Dynamic Maps; re-verify before launch) — cost: standard Google styling and no Advanced Markers until a concrete design requirement appears (D12 decided).
- Ruling: web uses the legacy `google.maps.Marker` and raster rendering — no Map ID, no WebGL dependency on iOS — cost: the deprecated marker class (Google promised ≥ 12 months' notice before removal).
- Ruling (user decision D1, 2026-09-21): iOS PWA = React + Vite (per the user's architecture diagram); Flutter web is not built — cost: a second UI implementation (separate plan), offset by DOM map/native inputs.
- Ruling (user decision D11, 2026-09-21): Blynk/company-controlled Google Cloud project and billing account, business-owned and transferable before the Play launch; web quota 1,000 loads/day; separate Android and web keys restricted to only the APIs they need; billing alerts — cost: owner must create the org project/billing before G0 can finish.
- Ruling (user decision D12, 2026-09-21): no Map ID, standard Google appearance — cost: no custom map styling or Advanced Markers for now.
- Ruling (user decision D13, 2026-09-21): PMTiles backend pieces and the MapLibre adapter are kept as a dormant rollback path until the 8-step Google runtime gate passes (G4) — cost: both code paths coexist in the repo and app for a while (never mounted together; release build size stays higher until removal).
