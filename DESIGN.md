---
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
---

# StarLine — DESIGN.md

This file is the machine-readable companion to `docs/DESIGN.md` (the narrative
identity: why the app looks like a star library). Read this one before writing
any UI; read that one before changing the palette's intent.

Everything here mirrors `apps/web/src/styles.css` and is enforced by
`scripts/check-contrast.mjs` — if a value disagrees with the code, the code wins
and this file is the bug.

## Overview

StarLine is a novel-planning and writing workstation, **phone-first**: a PWA
that also ships as a sideloaded Android APK (Capacitor). The identity is a
*star library* — a deep night sky, faint constellations, and a single warm
starlight gold for anything actionable. The interface should feel like reading
by starlight: calm, dark, generous with space, never loud.

Two themes ship. **Dark is the default** and the canonical palette below; light
is a day-sky variant that swaps the same token names (see Colors). Every token
lives in CSS custom properties under `--sl-*`, exposed to Tailwind through
`@theme inline` as `--color-*`. Components use Tailwind utilities and semantic
classnames (`sl-btn`, `sl-card`), never raw hex.

## Colors

Dark (canonical):

- **canvas `#060714`** — the night sky everything sits on.
- **surface `#0e1023`** — cards, inputs, sheets: one step above the sky.
- **surface-2 `#171a33`** — raised rows inside a surface.
- **on-surface `#e9eaf6`** — body and headline text.
- **on-surface-muted `#9aa0c0`** — metadata, hints, secondary labels.
- **border `rgba(148,163,255,0.16)`** — hairline separation; there are no shadows.
  Components draw it, but the token schema has no border sub-token, so no component
  can reference it — the lint warning is accepted, exactly like the motion note.
- **primary / accent `#f6c760`** — starlight gold. In the dark sky it *is* the
  action colour: buttons, active segments, focus rings, links.
- **on-primary `#211503`** — text on gold.
- **star `#cdd5ff`** — the pale blue of stars and constellation lines.
- **accent `#f6c760`** — in the dark sky identical to `primary`; in the day sky
  it is the decoration gold only. No component fills with it, and that is
  deliberate — the lint warning about this token is accepted, not overlooked.
- **danger `#f87171`** — destructive actions only.

Light (day sky) overrides the same names: canvas `#f4f5fb`, surface `#ffffff`,
on-surface `#181a2b`, on-surface-muted `#5d6390`, border `#dcdff2`,
**primary `#5b46d6`** (nebula violet — the gold cannot carry text here),
accent `#f0b429`, danger `#b3261e`.

**The contrast contract is a rule, not a preference** (`scripts/check-contrast.mjs`):

- body-text pairs clear WCAG AA (≥ 4.5);
- the dark-sky gold clears AA on the canvas because it is the action colour;
- the **day-sky gold must NOT clear AA as text** — if that ever passes, someone
  promoted a decoration colour to text and the design intent changed;
- wordmark gradient stops are large text (≥ 3.0).

## Typography

Inter carries the interface; Literata carries prose. Both are bundled
(`@fontsource`, latin + cyrillic subsets) and never fetched from a CDN.

- **headline-lg / headline-md / title** — screen and card headings, weight 600,
  slightly tightened tracking. One `h1` per screen.
- **body-md / body-sm** — interface copy at 0.95rem / 0.85rem.
- **label-sm** — chips, segment labels, table headers.
- **prose (Literata)** — writing mode and long-form reading. The writer chooses
  14–24 px and serif/sans in writing mode; those choices live in device
  preferences, not in the library file.
- **mono** — story-time values, ids, code-like input only.

Never set type in the starfield's gold in the day sky, and never below 0.78rem
for interactive labels.

## Layout

- Phone-first frame: `max-w-xl` centred, `px-4` gutters, `pt-6`, `pb-28` to
  clear the bottom tab bar. It must reflow at **320 px** with no horizontal
  overflow — the accessibility harness asserts this, text spacing included.
- Chrome is two bars: an app bar (wordmark, search) and a five-item tab bar
  (Plan · Scenes · People · World · Notes). Writing mode hides both.
- Spacing uses Tailwind's scale; the tokens above name the common steps. Prefer
  `gap` over margins between siblings.
- Sheets are full-height panels over a backdrop, closed by Escape or the
  backdrop; focus moves into the sheet and returns on close.

## Elevation & Depth

There are **no shadows**. Depth comes from three things only:

1. surface steps (`canvas → surface → surface-2`),
2. hairline borders,
3. the starfield canvas behind everything — decorative, `aria-hidden`, never
   interactive, and frozen to a single frame under `prefers-reduced-motion` or
   when the writer switches it off in Settings → Appearance.

## Shapes

Soft, rounded, never sharp: inputs and buttons `0.8rem`, cards and sheets
`1rem`, chips and segmented controls pill-shaped. The segmented control
**wraps** rather than clipping — a switch that scrolls out of view is a switch
the writer cannot find.

## Components

- **button / button-primary** — `sl-btn`, `sl-btn-primary`; small variant
  `sl-btn-small` for row actions. Primary is gold on dark, violet on light.
- **input** — `sl-input`, `sl-textarea`, `sl-select`: surface fill, hairline
  border, gold focus ring via the global `:focus-visible` rule.
- **card** — `sl-card`: surface fill, `1rem` radius, `p-4`/`p-5`.
- **sheet** — `sl-sheet` over `sl-sheet-backdrop`, used for scene, character,
  lore, note and edge editors.
- **segmented** — `sl-segmented` / `sl-segment`, wraps, one segment pressed at
  a time (`aria-pressed`).
- **row** — list rows (`sl-backup-row`, `sl-note-row`): name, muted metadata,
  actions right-aligned, `flex-wrap` so long names never push buttons off
  screen.
- **chip** — `sl-chip` for tags and statuses; colour comes from the tag palette,
  text stays readable.

Interactive controls are at least 24 × 24 px (WCAG 2.5.8) — 44 px preferred —
and every state change that matters is announced (`role="status"` for the undo
toast, `role="alert"` for the integrity banner).

**Motion** (prose, not tokens — the schema has no motion group and would drop it
silently): transitions are CSS only, 120 ms for borders and 160 ms for shadows and
colour, easing `ease`. Nothing else animates. Under `prefers-reduced-motion:
reduce` every transition is disabled and the starfield renders a single frame, so
the interface is fully usable without motion.

## Do's and Don'ts

**Do**

- Use the tokens; if a value is missing, add it to `styles.css` and here.
- Keep the starfield decorative and behind everything.
- Honour `prefers-reduced-motion` in any new animation.
- Route every user-facing string through the catalogue (English + Ukrainian).
- Check the CSS budget (`pnpm check:bundle`) after touching `styles.css` — it is
  a gate at 10 KiB gzip, not a suggestion.

**Don't**

- Don't use the day-sky gold for text, and don't "fix" the contrast script when
  it fails on that rule — it is asserting the design.
- Don't add drop shadows, glows on text, or gradients except the wordmark.
- Don't hardcode strings, hex colours, or px values that a token already names.
- Don't add a network request: the default build is offline-complete, and the
  only cloud code lives behind the `STARLINE_CLOUD=1` flavour.
- Don't put a control behind a dead end — if a screen needs a story to exist
  before a switch works, the switch is in the wrong place.
