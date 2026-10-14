# Design — StarLine (“star library”)

Source of truth for the visual identity. Tokens: `apps/web/src/styles.css` · backdrop:
`apps/web/src/Starfield.tsx` · icons: `scripts/generate-icons.mjs`.

## Identity

A **library among the stars**: deep-space canvas, starlight-gold highlights, nebula-violet
depth, one **✦ sparkle** as the brand glyph. Dark is the hero theme; light is the “day sky”
variant.

## Palette (WCAG ratios computed from the tokens)

| Token | Dark | Light | Notes |
|---|---|---|---|
| `canvas` | `#060714` | `#f4f5fb` | deep space / day sky |
| `surface` | `#0e1023` | `#ffffff` | cards, inputs |
| `text` (ink) | `#e9eaf6` | `#181a2b` | on canvas: **16.8:1** dark · **15.8:1** light |
| `muted` | `#9aa0c0` | `#5d6390` | **7.8:1** · **5.3:1** |
| `accent` (starlight gold) | `#f6c760` | `#f0b429` | **12.7:1** on dark (may carry text) · **1.7:1** on light → decoration only |
| `primary` | `#f6c760` | `#5b46d6` | interactive fills: on-primary `#211503` **11.3:1** · white **6.4:1** |
| `border` | `rgba(148,163,255,.16)` | `#dcdfF2` | hairline |
| `star` | `#cdd5ff` | `#a6aede` | starfield specks (**13.9:1** on dark) |

Rules (the CatBookTracker “accent is decoration” rule, adapted):

- In the **dark** sky the gold clears AA, so it is both decoration *and* the primary action colour.
- In the **light** sky the gold is decoration only; everything readable or selected uses the
  nebula violet `primary`.
- The starfield never competes with content: `z-0`, content `z-10`, `pointer-events: none`.

## The starfield (signature backdrop)

- **Seeded** (mulberry32, fixed `STAR` seed) and **static**: drawn once per resize or theme
  change, no animation, no battery cost — the same sky on every launch.
- Density ≈ one star per 3600 px²; radius 0.4–1.7 px; alpha 0.22–0.82; ~14 % of stars are gold.
- Three nebula washes (violet upper-left, blue lower-right, a faint gold haze; halved in light).
- Real northern constellations: the twelve iconic patterns (Big Dipper, Little Dipper,
  Cassiopeia, Orion, Cygnus, Lyra, Aquila, Taurus, Gemini, Leo, Bootes, Corona Borealis)
  with true shapes and relative magnitudes; 3–5 per screen, joined by faint lines
  (≤ 0.7 px) — decorative only.
- DPR capped at 2; the light theme draws at half alpha.

## Components

- `.sl-btn` — pill, **44 px minimum target**, hover/active states; `.sl-btn-primary` for the main
  action (gold-on-ink in dark, violet-on-white in light).
- `.sl-card` — surface + hairline + soft glow shadow; `.sl-input` 44 px; `.sl-chip` muted pills.
- `.sl-wordmark` — gold→star→gold gradient text; ✦ marks sections (`aria-hidden`).
- Safe areas: `.sl-shell` honours `env(safe-area-inset-*)`; `viewport-fit=cover` in `index.html`.

## Icons

`scripts/generate-icons.mjs` renders the ✦ sparkle (an astroid-family shape: |x|^0.45 + |y|^0.45 ≤ 1)
in gold with a soft glow over the deep-space gradient and seeded specks — **no image dependencies**,
deterministic bytes. Outputs: `icon-192/512`, `maskable-512` (sparkle inside the safe circle),
`apple-touch-icon` (180). `favicon.svg` is the hand-written twin. Regenerate after token changes.

## Reserved for M1+

Bottom tab bar (spec §4.0’s phone layout), constellation dividers, per-view motifs (star-sign
clusters per section), a starlit focus mode for the drafting editor.

## Language (slice 18, decision 22)

English and Ukrainian ship as equal citizens. Copy is never baked into components: every
string lives in `packages/core/src/i18n` (`en.ts`, `uk.ts`) and is read through the live
`messages` proxy, so a language switch re-reads the whole interface. First run follows the
system language (`uk` → Ukrainian, anything else → English); Settings → Language offers an
explicit choice and a "system language" option, remembered per device in
`starline.locale`. `<html lang>` follows the active locale (axe reads it), and
`Intl.NumberFormat` / `DateTimeFormat` / `PluralRules` are driven by the same locale —
Ukrainian counted phrases use the four real categories (one / few / many / other:
«1 сцена», «2 сцени», «5 сцен»), never a two-form approximation. PWA-manifest strings stay
English on purpose: the install sheet is drawn by the OS in the OS language.
