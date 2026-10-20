# Design — StarLine ("star library")

Source of truth for the visual identity. Tokens: `apps/web/src/styles.css` · backdrop:
`apps/web/src/Starfield.tsx` · icons: `scripts/generate-icons.mjs`. Everything here mirrors
`styles.css` and is enforced by `scripts/check-contrast.mjs` — if a value disagrees with the
code, the code wins and this file is the bug.

## Identity

A **library among the stars**: deep-space canvas, starlight-gold highlights, nebula-violet
depth, one **✦ sparkle** as the brand glyph. Dark is the hero theme; light is the "day sky"
variant. StarLine is a novel-planning and writing workstation, **phone-first**: a PWA that
also ships as a sideloaded Android APK (Capacitor). The interface should feel like reading
by starlight: calm, dark, generous with space, never loud.

Two themes ship. **Dark is the default** and the canonical palette below; light is a day-sky
variant that swaps the same token names. Every token lives in CSS custom properties under
`--sl-*`, exposed to Tailwind through `@theme inline` as `--color-*`. Components use Tailwind
utilities and semantic classnames (`sl-btn`, `sl-card`), never raw hex.

## Palette (WCAG ratios computed from the tokens)

| Token | Dark | Light | Notes |
|---|---|---|---|
| `canvas` | `#060714` | `#f4f5fb` | deep space / day sky |
| `surface` | `#0e1023` | `#ffffff` | cards, inputs |
| `surface-2` | `#171a33` | — | raised rows inside a surface |
| `text` (ink) | `#e9eaf6` | `#181a2b` | on canvas: **16.8:1** dark · **15.8:1** light |
| `muted` | `#9aa0c0` | `#5d6390` | **7.8:1** · **5.3:1** |
| `accent` (starlight gold) | `#f6c760` | `#f0b429` | **12.7:1** on dark (may carry text) · **1.7:1** on light → decoration only |
| `primary` | `#f6c760` | `#5b46d6` | interactive fills: on-primary `#211503` **11.3:1** · white **6.4:1** |
| `border` | `rgba(148,163,255,.16)` | `#dcdff2` | hairline; there are no shadows |
| `star` | `#cdd5ff` | `#a6aede` | starfield specks (**13.9:1** on dark) |
| `danger` | `#f87171` | `#b3261e` | destructive actions only |

Rules (the CatBookTracker "accent is decoration" rule, adapted):

- In the **dark** sky the gold clears AA, so it is both decoration *and* the primary action
  colour.
- In the **light** sky the gold is decoration only; everything readable or selected uses the
  nebula violet `primary`.
- The starfield never competes with content: `z-0`, content `z-10`, `pointer-events: none`.

**The contrast contract is a rule, not a preference** (`scripts/check-contrast.mjs`):

- body-text pairs clear WCAG AA (≥ 4.5);
- the dark-sky gold clears AA on the canvas because it is the action colour;
- the **day-sky gold must NOT clear AA as text** — if that ever passes, someone promoted a
  decoration colour to text and the design intent changed;
- wordmark gradient stops are large text (≥ 3.0).

## Token schema (machine-readable)

The original front-matter of this document, kept for tooling that wants the raw values:

```yaml
name: StarLine
description: Star-library cosmic identity for the StarLine novel planner — phone-first PWA and Android APK
colors:
  canvas: "#060714"
  surface: "#0e1023"
  surface-2: "#171a33"
  on-surface: "#e9eaf6"
  on-surface-muted: "#9aa0c0"
  border: "rgba(148, 163, 255, 0.16)"
  primary: "#f6c760"
  on-primary: "#211503"
  accent: "#f6c760"
  star: "#cdd5ff"
  danger: "#f87171"
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 600
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: 600
  title:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 600
  body-md:
    fontFamily: Inter
    fontSize: 0.95rem
    lineHeight: 1.55
  body-sm:
    fontFamily: Inter
    fontSize: 0.85rem
  label-sm:
    fontFamily: Inter
    fontSize: 0.78rem
    fontWeight: 500
  prose:
    fontFamily: Literata
    fontSize: 1.125rem
    lineHeight: 1.7
  mono:
    fontFamily: ui-monospace, "Cascadia Mono", Consolas, monospace
    fontSize: 0.85rem
rounded:
  sm: 0.5rem
  md: 0.8rem
  lg: 1rem
  pill: 999px
spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.25rem
  screen: 1rem
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 0.6rem 0.85rem
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: 0.6rem 0.85rem
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  screen:
    backgroundColor: "{colors.canvas}"
  row:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.sm}"
  metadata:
    textColor: "{colors.on-surface-muted}"
  starfield:
    backgroundColor: "{colors.star}"
  button-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
```

## Typography

Inter carries the interface; Literata carries prose. Both are bundled
(`@fontsource`, latin + cyrillic subsets) and never fetched from a CDN.

- **headline-lg / headline-md / title** — screen and card headings, weight 600, slightly
  tightened tracking. One `h1` per screen.
- **body-md / body-sm** — interface copy at 0.95rem / 0.85rem.
- **label-sm** — chips, segment labels, table headers.
- **prose (Literata)** — writing mode and long-form reading. The writer chooses 14–24 px and
  serif/sans in writing mode; those choices live in device preferences, not in the library
  file.
- **mono** — story-time values, ids, code-like input only.

Never set type in the starfield's gold in the day sky, and never below 0.78rem for
interactive labels.

## Layout

- Phone-first frame: `max-w-xl` centred, `px-4` gutters, `pt-6`, `pb-28` to clear the bottom
  tab bar. It must reflow at **320 px** with no horizontal overflow — the accessibility
  harness asserts this, text spacing included.
- Chrome is two bars: an app bar (wordmark, search) and a five-item tab bar
  (Plan · Scenes · People · World · Notes). Writing mode hides both.
- Spacing uses Tailwind's scale; the tokens above name the common steps. Prefer `gap` over
  margins between siblings.
- Sheets are full-height panels over a backdrop, closed by Escape or the backdrop; focus
  moves into the sheet and returns on close.

## Elevation & Depth

There are **no shadows**. Depth comes from three things only:

1. surface steps (`canvas → surface → surface-2`),
2. hairline borders,
3. the starfield canvas behind everything — decorative, `aria-hidden`, never interactive,
   and frozen to a single frame under `prefers-reduced-motion` or when the writer switches it
   off in Settings → Appearance.

## Shapes

Soft, rounded, never sharp: inputs and buttons `0.8rem`, cards and sheets `1rem`, chips and
segmented controls pill-shaped. The segmented control **wraps** rather than clipping — a
switch that scrolls out of view is a switch the writer cannot find.

## Components

- **button / button-primary** — `sl-btn`, `sl-btn-primary`; small variant `sl-btn-small` for
  row actions. Primary is gold on dark, violet on light. Pill, **44 px minimum target**.
- **input** — `sl-input`, `sl-textarea`, `sl-select`: surface fill, hairline border, gold
  focus ring via the global `:focus-visible` rule; 44 px tall.
- **card** — `sl-card`: surface fill, `1rem` radius, `p-4`/`p-5`, hairline, soft glow.
- **sheet** — `sl-sheet` over `sl-sheet-backdrop`, used for scene, character, lore, note and
  edge editors.
- **segmented** — `sl-segmented` / `sl-segment`, wraps, one segment pressed at a time
  (`aria-pressed`).
- **row** — list rows (`sl-backup-row`, `sl-note-row`): name, muted metadata, actions
  right-aligned, `flex-wrap` so long names never push buttons off screen.
- **chip** — `sl-chip` for tags and statuses; colour comes from the tag palette, text stays
  readable.
- **wordmark** — `.sl-wordmark`, gold→star→gold gradient text; ✦ marks sections
  (`aria-hidden`).
- **safe areas** — `.sl-shell` honours `env(safe-area-inset-*)`; `viewport-fit=cover` in
  `index.html`.

Interactive controls are at least 24 × 24 px (WCAG 2.5.8) — 44 px preferred — and every state
change that matters is announced (`role="status"` for the undo toast, `role="alert"` for the
integrity banner).

## The starfield (signature backdrop)

- **Seeded** (mulberry32, fixed `STAR` seed) and **static**: drawn once per resize or theme
  change, no animation, no battery cost — the same sky on every launch.
- Density ≈ one star per 3600 px²; radius 0.4–1.7 px; alpha 0.22–0.82; ~14 % of stars are
  gold.
- Three nebula washes (violet upper-left, blue lower-right, a faint gold haze; halved in
  light).
- Real northern constellations: the twelve iconic patterns (Big Dipper, Little Dipper,
  Cassiopeia, Orion, Cygnus, Lyra, Aquila, Taurus, Gemini, Leo, Bootes, Corona Borealis)
  with true shapes and relative magnitudes; 3–5 per screen, joined by faint lines
  (≤ 0.7 px) — decorative only. Data: `apps/web/src/constellations.ts` (decision 30).
- DPR capped at 2; the light theme draws at half alpha.

## Icons

`scripts/generate-icons.mjs` renders the ✦ sparkle (an astroid-family shape: |x|^0.45 +
|y|^0.45 ≤ 1) in gold with a soft glow over the deep-space gradient and seeded specks — **no
image dependencies**, deterministic bytes. Outputs: `icon-192/512`, `maskable-512` (sparkle
inside the safe circle), `apple-touch-icon` (180). `favicon.svg` is the hand-written twin.
Regenerate after token changes.

## Motion

Transitions are CSS only, 120 ms for borders and 160 ms for shadows and colour, easing
`ease`. Nothing else animates. Under `prefers-reduced-motion: reduce` every transition is
disabled and the starfield renders a single frame, so the interface is fully usable without
motion.

## Do's and Don'ts

**Do**

- Use the tokens; if a value is missing, add it to `styles.css` and here.
- Keep the starfield decorative and behind everything.
- Honour `prefers-reduced-motion` in any new animation.
- Route every user-facing string through the catalogue (English + Ukrainian + German).
- Check the CSS budget (`pnpm check:bundle`) after touching `styles.css` — it is a gate at
  11 KiB gzip (decision 27), not a suggestion.

**Don't**

- Don't use the day-sky gold for text, and don't "fix" the contrast script when it fails on
  that rule — it is asserting the design.
- Don't add drop shadows, glows on text, or gradients except the wordmark.
- Don't hardcode strings, hex colours, or px values that a token already names.
- Don't add a network request: the default build is offline-complete, and the only cloud
  code lives behind the `STARLINE_CLOUD=1` flavour.
- Don't put a control behind a dead end — if a screen needs a story to exist before a switch
  works, the switch is in the wrong place.

## Language (slice 18, decisions 20/26)

English, Ukrainian and German ship as equal citizens. Copy is never baked into components:
every string lives in `packages/core/src/i18n` (`en.ts`, `uk.ts`, `de.ts`) and is read
through the live `messages` proxy, so a language switch re-reads the whole interface. First
run follows the system language (uk → Ukrainian, de → German, anything else → English);
Settings → Language offers an explicit choice and a "system language" option, remembered per
device in `starline.locale`. `<html lang>` follows the active locale (axe reads it), and
`Intl.NumberFormat` / `DateTimeFormat` / `PluralRules` are driven by the same locale —
Ukrainian counted phrases use the four real categories (one / few / many / other:
«1 сцена», «2 сцени», «5 сцен»), never a two-form approximation. PWA-manifest strings stay
English on purpose: the install sheet is drawn by the OS in the OS language.
