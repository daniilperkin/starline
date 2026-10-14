# Accessibility — WCAG 2.2 AA audit (slice 19)

**Status: audited 2026-10-11, slice 19 of M4 (decision 22).** Findings fixed in the same slice;
what remains open is listed honestly at the bottom. This checklist is the artifact for the owner's
sign-off.

**Signed off by the owner, 2026-10-13.** The five open items at the bottom are accepted as
documented; the timeline wide-zoom clustering is scheduled as slice 24 (M5).

Scope: the phone PWA (`apps/web`). The same DOM runs inside the Android WebView, so one audit
covers both targets. The offline storage layer, the interchange formats and the Rust CLI have no
user interface and are out of scope.

## How this was verified

Three layers, because no single tool covers AA:

| Layer | What it proves | Where |
| --- | --- | --- |
| **axe-core** scans (25 in the web journey, both locales) | structural rules: names, roles, labels, contrast, landmarks, headings | `scripts/verify-web.mjs` (step 7) |
| **`scripts/check-a11y.mjs`** — 55 scripted checks | the things axe cannot see: keyboard-only walks with a visible indicator at every stop, 24 px targets, reflow at 320 px, WCAG 1.4.12 text spacing, reduced motion, the starfield stop control, page titles, `html lang`, Escape closing a sheet, a live region for status messages | run it any time: `pnpm check:a11y` |
| **`scripts/check-contrast.mjs`** | the palette contract: every token pair meets its stated ratio in both themes | CI (budgets job) |

The keyboard walks are real: the script presses Tab up to 25 times per screen and asks the
browser what is focused and what focus indicator it computed — outline or box-shadow, not a
class name. Target sizes are measured with `getBoundingClientRect`, not read from CSS.

## Checklist

Legend: ✅ met · ⚠️ met with a documented limitation · ➖ not applicable.

### Perceivable

| Criterion | Level | Status | Evidence |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | ✅ | Decorative layers are `aria-hidden` (starfield canvas, glyphs beside labels); attachments carry their filename as `alt`; every icon-only control has `aria-label` |
| 1.2 Time-based Media | A/AA | ➖ | No audio or video in the product |
| 1.3.1 Info and Relationships | A | ✅ | One `h1` per screen, real lists, `fieldset`/`legend` for grouped controls (note sheet, segmented settings), `role="status"`/`role="alert"` for announcements — axe rules `heading-order`, `list`, `label` all clean |
| 1.3.2 Meaningful Sequence | A | ✅ | DOM order equals visual order on every audited screen |
| 1.3.4 Orientation | AA | ✅ | No orientation lock; the layout is fluid and was checked at 390×844 and 320×640 |
| 1.3.5 Identify Input Purpose | AA | ✅ | Inputs carry visible labels or `aria-label`; no free-text field collects personal data |
| 1.4.3 Contrast (Minimum) | AA | ✅ | `check-contrast.mjs` (contract) + axe `color-contrast` on 25 scans in both locales |
| 1.4.4 Resize Text | AA | ✅ | `rem`-based type, no `maximum-scale` in the viewport meta, no text locked into images |
| 1.4.10 Reflow | AA | ✅ | No horizontal overflow at a 320 px viewport (checked on every audited screen) |
| 1.4.11 Non-text Contrast | AA | ✅ | Control borders, focus rings and status colours come from tokens that meet 3:1 in both themes (palette contract) |
| 1.4.12 Text Spacing | AA | ✅ | With line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em and 2em paragraph spacing injected, nothing overflows (this found and fixed the app-bar and plan-header overflows) |
| 1.4.13 Content on Hover or Focus | AA | ✅ | No custom hover-only content; the few `title` attributes are native tooltips, dismissable by moving away |

### Operable

| Criterion | Level | Status | Evidence |
| --- | --- | --- | --- |
| 2.1.1 Keyboard | A | ✅ | Every audited screen is walkable with Tab alone; every pointer gesture has a non-drag path — scene reordering has the row menu's Move/Reassign, timeline placement has the scene sheet's story-time field, relationship pins are cosmetic (the list and matrix views are equivalent) |
| 2.1.2 No Keyboard Trap | A | ✅ | The walk reaches the end of each screen and wraps to the browser chrome; no trap in the sheets, the editor or the graph |
| 2.2.2 Pause, Stop, Hide | A | ✅ | The starfield is the only self-starting animation. It honours `prefers-reduced-motion` and has an explicit **Settings → Appearance → Animated starfield** switch (verified by the audit script); CSS transitions are switched off under reduced motion |
| 2.3.1 Three Flashes | A | ✅ | No flashing content |
| 2.4.1 Bypass Blocks | A | ✅ | No repeated block of links precedes the content: the app bar holds at most two controls before the screen's own heading (measured: 3 focus stops on the start screen, then content) |
| 2.4.2 Page Titles | A | ✅ | The document title is set and asserted on every audited screen |
| 2.4.3 Focus Order | A | ✅ | Tab order follows the visual order on every audited screen |
| 2.4.4 Link Purpose | A | ✅ | Links and buttons carry their text; icon-only controls carry `aria-label` |
| 2.4.6 Headings and Labels | AA | ✅ | Descriptive headings and labels; axe `heading-order`/`label` clean |
| 2.4.7 Focus Visible | AA | ✅ | A global `:focus-visible` ring (2 px in `--sl-primary`, offset 2 px) in both themes; the audit asserts an indicator at every focus stop on every screen |
| 2.5.1 Pointer Gestures | A | ✅ | No path-based or multipoint gestures; the drag interactions are optional extras |
| 2.5.2 Pointer Cancellation | A | ✅ | Actions fire on `click` (up-event); destructive actions are two-tap (arm, then confirm) |
| 2.5.3 Label in Name | A | ✅ | Visible labels match their accessible names (axe `label-content-name-mismatch` clean) |
| 2.5.7 Dragging Movements | AA | ✅ | Every drag has an equivalent non-drag control (row menus, form fields) |
| 2.5.8 Target Size (Minimum) | AA | ✅ | Every visible control measures at least 24 × 24 px — checkboxes and radios were raised from the 13 px default to 24 px in this slice |

### Understandable

| Criterion | Level | Status | Evidence |
| --- | --- | --- | --- |
| 3.1.1 Language of Page | A | ✅ | `<html lang>` follows the active locale (`en`/`uk`); asserted on every audited screen |
| 3.1.2 Language of Parts | AA | ✅ | No mixed-language passages inside a screen — a locale switch relabels the whole interface |
| 3.2.1 On Focus | A | ✅ | Focus never changes context |
| 3.2.2 On Input | A | ✅ | Typing never submits or navigates; destructive actions ask first |
| 3.2.3 Consistent Navigation | AA | ✅ | The app bar and tab bar are identical on every screen |
| 3.2.4 Consistent Identification | AA | ✅ | The same control keeps the same label everywhere (catalogue-driven, so drift is impossible) |
| 3.2.6 Consistent Help | A | ✅ | No help mechanism to be inconsistent about |
| 3.3.1 Error Identification | A | ✅ | Validation issues come from the step validators with their own messages, rendered beside the field |
| 3.3.2 Labels or Instructions | A | ✅ | Every input has a label; the wizard steps carry their own prompt text |
| 3.3.3 Error Suggestion | AA | ✅ | Validation issues carry a hint (`hint` fields in the issue catalogue), shown with the error |
| 3.3.4 Error Prevention | AA | ✅ | Destructive actions are confirmed or undoable: trash with 30-day retention, an 8-second undo toast, snapshot restore behind a confirm |
| 3.3.7 Redundant Entry | A | ✅ | Nothing asks twice for the same information in a flow |
| 3.3.8 Accessible Authentication | AA | ✅ | No authentication at all in the offline app; the optional cloud backup uses Google's own flow, and sign-in is never required to reach your data |

### Robust

| Criterion | Level | Status | Evidence |
| --- | --- | --- | --- |
| 4.1.2 Name, Role, Value | A | ✅ | Native elements everywhere it matters (buttons, inputs, fieldsets, dialogs via Radix); axe `aria-*` rules clean on 25 scans |
| 4.1.3 Status Messages | AA | ✅ | The undo toast is `role="status" aria-live="polite"`; the integrity banner is `role="alert"`; import results use `role="status"` — asserted by the audit script |

## What slice 19 found and fixed

The audit script failed on its first run with 10 findings. Every one was fixed rather than
argued away:

1. **Focus was invisible on text inputs and selects** (the CSS removed the outline and only
   shifted the border colour). Fixed with a global `:focus-visible` ring in both themes.
2. **Checkboxes and radios were 13 × 13 px** — below the 24 px minimum (2.5.8). Raised to 24 px.
3. **The plan header and app bar overflowed** by 8 px once WCAG 1.4.12 text spacing was applied
   at 320 px. Both now wrap instead of overflowing.
4. **The moving starfield had no stop control** (2.2.2). It now honours reduced motion *and*
   has a **Settings → Appearance → Animated starfield** switch, remembered per device
   (`starline.effects.starfield`).
5. **The whole start screen was still hardcoded English** — a slice-18 i18n gap the audit
   exposed (16 strings). It is catalogue-driven now, and the Ukrainian journey covers it
   (`axe [start-uk]`).

## Deliberate choices and honest limitations

- **The relationship graph is pointer-only for node dragging.** The graph is a *view*: every
  relationship is also readable and editable through the list and the matrix, so no function is
  keyboard-gated. Node pins are cosmetic layout state.
- **The canvas starfield has no text alternative** — it is decorative and `aria-hidden`; the
  same information (a dark sky) is in the theme.
- **The timeline packs close story-times at wide zoom** (a documented v1 limitation). This is a
  readability compromise, not an accessibility gate: every scene's story time is editable in its
  sheet, in seconds, with a plain number input.
- **Error text from the storage layer is English** (driver errors, integrity messages). These
  appear only on real failures; the validation catalogue — what a writer actually meets — is
  fully translated.
- **The PWA manifest strings stay English**: the install sheet is drawn by the OS in the OS
  language.

## Re-running the audit

```bash
pnpm check:a11y        # the scripted manual checks (starts its own dev server)
pnpm check:contrast    # the palette contract
pnpm verify-web        # includes 25 axe scans, both locales
```

`check:a11y` is part of `pnpm ci:gates` and runs in the CI `web E2E` job, so these checks cannot
silently regress.

## M5 re-audit (S38)

The harness (`scripts/check-a11y.mjs`) runs 61 scripted checks beyond axe: keyboard-only walks with a
visible focus indicator at every stop on 9 screens, 24 px targets, 320 px reflow, WCAG 1.4.12 text
spacing, reduced motion, the starfield stop control, page titles, `html lang`, Escape closing a sheet,
and a live region for status messages. All green at the M5 close; the owner's sign-off is recorded in
`DECISIONS.md`.
