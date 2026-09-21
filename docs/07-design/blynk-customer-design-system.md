# Blynk Customer design system

"Ink, paper, one signal." A grocery run is a chore done in seconds, one-handed, often outdoors. The
interface reads like a printed shelf label: quiet ink on paper, and a single yellow reserved for the
thing you tap to move forward.

Source of truth in code (customer app, `apps/customer/blinkit-clone-Flutter-ecommerce-/lib/`):

| Layer | File | Holds |
|---|---|---|
| Primitive | `design/primitives.dart` | Raw hex, spacing, radii, durations, icon sizes. The only file with `Color(0x...)` literals for brand colours. |
| Semantic | `design/tokens.dart` | `BlynkColors`, `BlynkSpace`, `BlynkRadius`, `BlynkElevation`, `BlynkIcons` (re-exports `BlynkText`, `BlynkMotion`). |
| Type / motion | `design/typography.dart`, `design/motion.dart` | `BlynkText` scale and Material `textTheme`; `BlynkMotion` durations, curves, reduced-motion resolver. |
| Check | `design/contrast.dart` | `contrastRatio(a, b)`, WCAG 2.x. Used by `test/design_tokens_test.dart`. |
| Component | `app_theme.dart` | `ThemeData` built only from the tokens above. |

`app_colors.dart` and `app_design.dart` are legacy shims that read their values from the tokens. They
are removed once every screen has migrated (task T25). New code uses `Blynk*` only.

## Palette

Ratios are computed with `contrastRatio` (WCAG 2.x), not copied.

| Token | Hex | Use | Measured |
|---|---|---|---|
| `signal` | `#FFE141` | Fill of the forward action. Label is `ink`. | ink on it 12.79; on paper 1.30 |
| `signalPressed` | `#E5C700` | Pressed fill of the same action. | ink on it 9.93; 1.29 vs `signal` |
| `ink` | `#1A1D2E` | Text, icons, structure, focus ring. | on paper 16.68; on well 15.68 |
| `ink2` | `#6B7280` | Secondary text, hints. | paper 4.83; well 4.54 |
| `ink3` | `#4B5563` | Stronger secondary text. | paper 7.56; well 7.10 |
| `paper` | `#FFFFFF` | The page. | - |
| `well` | `#F6F8FB` | Image wells, inputs, selected rows. | - |
| `line` | `#E5E9F0` | Decorative dividers only (1.22 on paper). | not for controls |
| `lineStrong` | `#7B8494` | Control boundaries. | paper 3.77; well 3.54 |
| `positive` | `#0C831F` | Fill for a true positive state. | paper on it 4.90 |
| `positiveInk` | `#0A741B` | Positive text. | paper 5.95; well 5.60; tint 5.30 |
| `positiveTint` | `#E8F5EA` | Positive badge fill. | - |
| `problem` | `#B42318` | Error text, destructive label. | paper 6.57; well 6.18; tint 5.75 |
| `problemTint` | `#FDECEA` | Error badge / banner fill. | - |
| `notice` / `noticeTint` | `#8A5A00` / `#FFF6BF` | Waiting or scheduled. | 5.42 |
| `scrim` | black at 50 % | Behind sheets and dialogs. | - |

Floors: text 4.5:1, large text and control boundaries 3:1, tap targets 48 dp, nothing below 12 px.

### Yellow and green

Do:
- Yellow as a fill for the one primary forward action per screen (Add, Proceed, Place order, Verify), with an `ink` label.
- Yellow as the 3 dp active indicator on navigation.
- Green for a true state: delivered, paid, live, in stock.

Don't:
- Yellow as text, a border, an icon on white, a background wash, a glow or a spinner colour.
- Green as a button, cart bar, link or decoration.
- Any new colour on a screen, or `Colors.*` / `Color(0x...)` outside the token files.
- State by colour alone: badges are always icon plus word.

`ColorScheme.primary` is `ink` and `secondary` is `signal`, so no Material default can turn yellow.

## Type

Catamaran only, weights 500 / 600 / 700 / 800. Size / line height:

| Style | Size / line | Weight | Material role |
|---|---|---|---|
| `display` | 28 / 34 | 800 | displayMedium |
| `title` | 20 / 26 | 800 | titleLarge |
| `heading` | 16 / 22 | 700 | titleMedium |
| `body` | 14 / 20 | 500 | bodyMedium, bodyLarge |
| `label` | 14 / 20 | 700 | labelLarge |
| `caption` | 12 / 16 | 600 | bodySmall, labelMedium, labelSmall |
| `price` | 16 / 22 | 800 | tabular-figures flag set |

Catamaran ships no `tnum` feature, so prices render with its default lining figures; the flag is
harmless and applies if the font is swapped. `fontSize:` literals are banned outside the theme.
Text is not clamped: components must grow at 2.0x scale.

## Spacing, radius, elevation, motion

- Spacing 4-pt: 4, 8, 12, 16, 24, 32, 48. Page gutter 16 under 600 px, 24 under 1024, 32 above (`BlynkSpace.gutterFor`).
- Radius: `sm` 8 (chips, thumbnails), `md` 12 (tiles, inputs, buttons, cart bar), `lg` 20 (sheets, dialogs), `full` only for stepper and badge pills.
- Elevation: none everywhere except `raised` (the floating cart bar) and `overlay` (sheets, dialogs). Cards are flat with a 1 dp `line` border.
- Motion: 120 / 200 / 280 ms, `easeOutCubic` in, `easeInCubic` out, exits faster than enters. Motion answers an action or a state change; nothing loops or auto-advances. Every duration goes through `BlynkMotion.resolve(context, d)`, which returns zero under `MediaQuery.disableAnimations`.

## Components (theme defaults)

- Primary button: `signal` fill, `ink` label, 48 dp minimum, radius `md`, no shadow, pressed `signalPressed`, disabled `well` fill with `ink2` label.
- Secondary: 1.5 dp `lineStrong` outline, `ink` label. Tertiary: `ink` text, w700, underlined on focus.
- Input: `well` fill, 1 dp `lineStrong` border, focus 2 dp `ink`, error 2 dp `problem`, hint `ink2`, visible label, 48 dp minimum.
- Chip: selected `ink` fill with `paper` label, unselected outlined, 48 dp hit area.
- Focus: a thicker `ink` outline (2 dp), never colour alone.
- Snackbar: `ink` fill, `paper` text, floating.

## Icons

One family: Material outlined, 24 dp (20 for small glyphs, 32 large). Filled only for the selected
navigation item and for state icons (check, warning). Orders, address book, packed, and the
home / work / other address labels each have a distinct glyph (`BlynkIcons`, guarded by a test).

## Voice

Sentence case. Active verbs. No exclamation marks and no apologies. Errors say what happened and what
to do next, and never show exception text. No all-caps eyebrow labels, no "Sorry!", no arrows in
button labels. Empty states: one title, one sentence, one action.

## Guarded by tests

- `test/design_tokens_test.dart`: every contrast pair above, scales, `gutterFor`, reduced motion, icon uniqueness.
- `test/app_theme_test.dart`: ink primary, button/input/chip/snackbar behaviour, no style under 12.
- `test/design_hygiene_ratchet_test.dart`: counts of raw `Color(0x`, `Colors.x` and `fontSize:` outside the token files can only go down.
