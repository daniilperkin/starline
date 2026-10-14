# StarLine — Deep Plan (phone-first)

**The M5 shipped revisions (slices 21-38)** — one row per slice; the M0-M4 record lives in section 10.

| Slice | Revision | CI | What shipped |
| --- | --- | --- | --- |
| S38 M5 close | `802182f` | 38561096927 | The docs trued up: the README counts (351 tests, CSS 11 KiB, 61 a11y checks, 53 emulator passes), the verify-web list covering slices 21-37, a Milestones section; PLAN's S38 row and an M5-status line; the ACCESSIBILITY re-audit note. The release APK rebuilt from the M5 code (9,902,062 bytes, cloud flavour, signed). The owner's a11y sign-off is recorded (decision 28); the deployed PWA's sign-in repaired (decision 29). |
| S37 onboarding + module visibility | `9ed0208` | 38559887592 | The four-slide first-run wizard (skippable, once per device) whose module picks seed the new project via `createProject`'s `enabledModules`; the Settings Modules section writes `enabledModules` (the TabBar already filters on it). Every E2E script learns the wizard - the journey walks it and toggles the World module off/on, perf/a11y/PWA/chaos skip it. |
| S36 Tier-3 polish | `2eea0e3` | 38556264970 | The dashboard gains form/genre chips, the deadline countdown and the words progress; the creation flow takes the whole brief (30 genre chips, six forms, word presets, deadline, idea seed into step 1); the character list gains scene counts, pins, sorts and a role filter; the 200-entry trait list autocompletes the Psychology tab; the Scenes tab gains the stacked statistics strip; the scene sheet gains the location picker and the rich-text synopsis. Follow-up `a1a96d7` staged the BookSwitcher's missed call site. |
| S35 migration property tests | `c441b25` | 38550258248 | fast-check finally imports: a runner generates random valid row sets and asserts, per case, that a fresh file migrates to the latest version, `PRAGMA foreign_key_check` stays empty, the inserted rows survive, and a re-run applies nothing. The harness is injected like the contract suite's, so the properties run against every driver. 351 tests (was 350). |
| S34 import/export depth | `31f9465` | 38548684515 | Opening `.starline` directly (SQLite-magic sniff, pool import, ordinary open); per-entity import issues listed on the start screen; the published `schema/export-v1.schema.json`; Markdown bodies with `[[wiki-links]]`; HTML attachments as data URIs (hand-rolled base64); the read-only downgrade for newer files with a banner; the scene-separator picker and a split-wizard file input (`.txt/.md/.docx`, mammoth lazy-loaded). |
| S33 mention depth | `8b4cc96` | 38544490516 | Scene and note targets join the mention mirror, so their chips appear in backlinks; the panel widens to four types and mounts in the scene sheet and note sheet. Chips re-resolve their label from the live mentionable list on every render (rename-safe), with a hover preview; a deleted entity reads as deleted. The @-picker scores fuzzily (prefix > substring > subsequence) with recency tiebreaks (`updated_at` flows through `listMentionables`). |
| S32 outliner depth | `f6f0a83` | 38540647748 | Multi-select with a checkbox per row (shift-click ranges), a sticky bulk bar (status, chapter, delete with a two-tap confirm, clear), status/POV filters that dim rather than hide, named saved-filter chips, a POV/words column chooser and a read-only group-by. The core gains `scene.bulkUpdate`/`scene.bulkDelete` — one transaction per batch, tags additive, per-scene change events, single-step undo. |
| S31 lore depth | `8a182e8` | (run at push) | The World tab's kind/tag/untagged filters, the Tree/Cards/Map view switcher, and the map's coordinate pins saved to `meta.lore_positions` (the graph's slice-8 pattern — device-independent, travels in the file). The core gains `lore/positions.ts`; the tags come from one batched `listTagsForEntities` call. |
| S29 merge + dossier tabs | `706fe72` | (run at push) | The character merge (relationships, scene presence, mentions with count folding, gallery, fields, POV, timeline, plotlines; aliases appended; the source trashed) and its real inverse `unmergeCharacters`, replayed from the command's moved-row ledger so Undo is honest. The dossier's nine tabs with the draft widened to the schema's long-carried columns. A silent autosave failure found by probing: `values` is reserved and the whitelist emitted it unquoted. |
| S28 palette + export options | `eddada6` | (run at push) | The command palette (hand-rolled list semantics — cmdk rendered nothing; the real bug was the render line sitting in AppLayout's immersive return, a branch only /write/* renders) and the export dialog's four declared options (chapter scope, include-notes, a two-page preview, a stage-driven progress bar). A perf regression found by the gate: a window-level keydown listener for Ctrl+K cost +8 ms keystroke-to-paint (24.0 vs 16.0, bisected) — moved onto React's delegated handler. `ci:gates` now measures perf before chaos. Eight lint items cleared; cmdk dropped. |
| S30 settings depth | `35112ac` | (run at push) | The four missing spec §4.6 sections: Editor (smart quotes via TipTap's typography, a hand-rolled auto-pair input rule — TipTap ships none — and the device's spellchecker via the DOM attribute), Statuses (per-project rename + recolour of the six statuses, `settings.statusLabels` with catalogue fallback), Keyboard (the §4.7 map as a reference) and Privacy (the offline statement with its verifiable line). The schema gains `editor` and `statusLabels`; `writeProjectSettings` joins the read as the write path. |

> **Status: DRAFT for owner review.** Owner decisions 9–16 (`DECISIONS.md`) supersede the
> spec's desktop-first framing wherever they differ. This document is the deep design pass
> required by decision 13: it turns `SPECIFICATION.md` §3–§4 into a phone product, slice by
> slice, **before** feature build-out begins. Numbered open items for the owner are in §8.

---

## 1. Product shape on a phone

### 1.1 The four loops

The phone app is optimized around four recurring loops, in expected order of frequency:

1. **Capture** — a thought arrives: one-field quick capture, saved in under 10 seconds, no
   navigation. (Notes tab)
2. **Plan** — continue the Snowflake flow in small sessions: one step, one character card,
   one chunk of the scene list. (Plan tab)
3. **Look up** — while thinking or drafting: who is X, what is Y, when does Z happen.
   (People / World tabs)
4. **Write** — draft a scene with characters and lore at hand. (Scenes tab)

Every screen below serves one of these loops; anything that serves none is cut from v1.

### 1.2 Navigation model

- **Bottom tab bar, 5 tabs** (spec §4.0: the desktop rail becomes a bottom bar below 1024 px):
  - **Plan** — dashboard + Snowflake wizard (steps 1–9).
  - **Scenes** — outliner (list default on phone; corkboard and plotline grid as alternate
    modes) + scene editor + writing mode.
  - **People** — character list, dossiers, relationships (matrix-first on phone; graph as
    pan/zoom secondary view).
  - **World** — lore tree + entries + timeline.
  - **Notes** — inbox + incubating board.
- **Top bar** (per screen): library name (switcher sheet), search icon (global search sheet;
  command palette arrives with search), overflow menu (settings, export, backups, about).
- **FAB**: context-aware "+" — Plan: continue/next step · Scenes: new scene · People: new
  character · World: new lore entry · Notes: quick capture.
- **Sheets, not inspectors**: everything the desktop puts in the right inspector (scene
  editor, backlinks, details) becomes a bottom sheet or a full-screen page on phone.
- **Android back button**: wired to in-app navigation (Capacitor `backButton` → router
  back; at a tab root → minimize app). Implemented in Slice 1.
- **Reachability & targets**: primary actions in the lower third where possible (FAB, tab
  bar, sheet actions); every target ≥ 44 px; destructive actions always confirm.
- **Module visibility** (`ProjectSettings.enabledModules`) hides tabs (e.g. Notes can be
  hidden until used).

Alternative considered: merging World into People (4 tabs). Kept separate — lookup speed
matters and the two domains are used differently. Open item #1.

### 1.3 Cross-cutting conventions

- **i18n (decision 14)**: `en` first; every string goes through a typed strings module
  (`t("plan.step1.title")`) from the first slice; ICU-style placeholders; no literal copy in
  components; de/uk/ru slot in later without touching screens. UI language ≠ project
  language (novels stay in whatever the writer writes).
- **Theming**: the shipped star-library tokens; light "day sky" variant kept; motion stays
  battery-aware (decision 11).
- **A11y (spec §4.6, touch-adapted)**: WCAG 2.2 AA; visible focus; drag-and-drop always has
  a non-drag alternative; the graph has a list twin; `prefers-reduced-motion` honored.
- **Autosave (spec §2.3.3)**: debounced 400 ms + on blur/navigate/app-background
  (Capacitor `appStateChange`); "Saved · 14:02" bound to the last committed transaction. No
  save button anywhere.
- **Undo**: structural edits = in-memory inverse-command stack with an Undo toast; text =
  editor history; every delete goes to Trash (soft delete, 30 days).
- **Validation UX (spec §3.4.1–3.4.2)**: issues render under the step/field as a tappable
  list (tap → focus field); `error` blocks completion, `warning` overridable (persisted in
  `overrides`), `info` never blocks. Soft gating: any step reachable; a "steps 1–N
  incomplete — continue anyway?" confirmation appears once per session.

---

## 2. M1 — Planning core ("idea → 40-scene outline" on a phone)

M1 reaches the spec's exit criterion on the phone. Slices are reviewable builds: each ends
with all gates green, a rebuilt APK, and a short "what you can do now" note.

### Slice 1 — Wizard skeleton + Steps 1–2 (**shipped 2026-10-08**)

**Screens**: Plan tab (progress ring, 9-step list, continue-where-you-left-off); Step 1
(sentence + alternatives as swipeable draft cards + word counter + prompts sheet); Step 2
(setup, three disasters, ending — one-sentence fields each).

**Build**: command layer (debounced `saveStepContent`, `markStepComplete` gated by
validators, overrides), TanStack Query + ChangeBus wiring, stepper glyphs (○ ◐ ● ⚠ ↻),
prompts panel (static bundled content: rule + 3 public-domain examples + 5–8 reflective
questions per step), strings module bootstrap, Android back-button wiring, app-background
autosave flush.

**Validators live**: all `S1_*` / `S2_*` rules with unit tests.

**Exit**: on the phone — create a project, write the sentence, refine via alternatives,
fill step 2 with live warnings, complete both steps; kill the app → everything persists;
APK rebuilt.

### Slice 2 — Step 3 + People tab v1 (**shipped 2026-10-08**; `reviewedCharacterIds` stub deferred to Slice 3 — it has no meaning before the step-5 screen)

**Screens**: Step 3 (major-character cards: the Snowflake quartet — motivation, goal,
conflict, epiphany — plus one-line and one-paragraph; adding a card creates the `Character`
row immediately); People tab (list with role badges and colours, quick add, search);
Dossier v1 (Overview tab: quartet, one-line/paragraph, role, arc type; inline edit).

**Build**: "Find characters in this text" extraction from steps 1/2 (tokenize, propose
≤ 20 names, confirm each; creates `role='supporting'` rows); `S3_*` validators; role/colour
pickers; step-5 `reviewedCharacterIds` bookkeeping stub.

**Exit**: steps 1–3 complete; extraction proposes names from the step-2 text; dossiers
editable; People list live. (Merge-duplicates deferred to M2 — needs the mention system.)

### Slice 3 — Steps 4–6 (expansion) (**shipped 2026-10-08**)

**Screens**: Step 4 (five paragraph editors; source sentence pinned in a sticky header;
"Break step 2 into step 4" seeds all five); Step 5 (per-character storyline from the
character's POV; progress = `reviewedCharacterIds`); Step 6 (four sections expanding
step 4; source paragraph pinned while typing).

**Build**: rich-text editor v1 (TipTap on phone: bold/italic/heading/undo only; Android IME
behaviour is a dedicated QA item), staleness badges (step 4 stale vs step 2, step 6 vs 4 —
computed, never stored), `S4_*`/`S5_*`/`S6_*` validators.

**Exit**: full one-page → four-page expansion on the phone; staleness badges appear when
upstream text changes afterwards.

### Slice 4 — Step 8 + Scenes tab (the outline) (**shipped 2026-10-08**; long-press drag deferred to Slice 5 — the row-menu move/reassign alternative ships and satisfies the exit criterion)

**Screens**: Step 8 scene list (phone: rows — #, POV chip, one-line, est. words; add/edit
inline; paste-from-clipboard import (TSV/CSV/lines) → "Create scenes from list" with a
"12 created, 2 skipped" report; running estimate vs target); Scenes tab (list view default:
parts → chapters → scene rows with inline status/POV; Unassigned pool pinned at the end;
reorder via long-press drag **and** a row-menu "move up/down" alternative; corkboard and
plotline grid arrive later); Scene editor sheet (spec §4.3.4 field order minus draft body:
title, status, POV, location, present characters, objective, obstacle, outcome + note,
emotions, plotlines, lore touched, story time, tags, synopsis — autosave per field).

**Build**: Part/Chapter/Scene commands (fractional `order_key`; a move writes one row),
`S8_*` validators, scene editor sheet, list virtualization (TanStack Virtual), minimal
plotline joins, merge-on-reimport by `snowflakeSource.line` (no duplicates on re-run).

**Exit**: paste 40 lines → 40 scenes; reorder and reassign chapters; scene editor
round-trips; the "40-scene outline" milestone is reachable end-to-end.

### Slice 5 — Step 9 + dashboard + M1 hardening (**shipped 2026-10-09**, `61008be`; emulator 15/15)

**Screens**: Step 9 (accordion over the scene list; synopsis expansion per scene; "Copy to
scene synopsis" trigger); Plan dashboard (progress ring, entity counts, words vs target,
continue-where-you-left-off, backup status).

**Build**: Trash (soft delete + Trash screen + restore, 30 days), undo toasts for structural
ops, snapshots (on open if > 1 h old, every 15 min of activity, manual; `VACUUM INTO` into
the OPFS/sidecar snapshot store; retention per §4.5.3, basic), integrity check on open +
crash-recovery banner, a11y sweep (slices 1–4 screens), performance pass, **web chaos
harness** (random commands + worker kill mid-transaction + reopen asserts — the native chaos
harness's web twin).

**Exit (M1 gate)**: the spec's journey on the phone — idea → 40-scene outline; kill-test
round with zero data loss; all gates green; PWA + APK rebuilt.

---

## 3. M2 — Connected world

### Slice 6 — Lore wiki v1 (**shipped 2026-10-09**, `9540c90`; emulator 18/18; category drag-nest deferred — the row menu move up/down ships as the non-drag path, same precedent as Slice 4)

**Screens**: World tab (category tree with the seeded default taxonomy — Geography,
Factions & Organizations, Magic & Technology, History, Cultures & Religions, Politics &
Economy, Species, Items, Languages; drag to reorder/nest, cycle-safe; entry list or cards);
lore entry editor (kind templates from §3.7 rendered as custom fields — e.g. location:
Region / Climate / Population / Ruler / Notable sites; summary ≤ 280 chars; rich-text body;
aliases; image; pin; child entries; breadcrumbs).

**Build**: lore category/entry commands, kind-template seeding via `custom_field_def`,
`@`-mention autocomplete v1 inside rich text (chip nodes; mention table mirrored on save —
this is the backbone for backlinks), cycle prevention (recursive CTE before write).

**Shipped**: `packages/core/src/fields/` (defs + values, 10 types, per-type validation,
`ensureFieldDefs`) and `lore/` (16 kinds + templates, 9-category taxonomy, category/entry CRUD,
`chainContains` recursive-CTE cycle guard for both trees, delete rules — categories refuse a
non-empty delete without `cascade`, entries re-parent their children), `mention` mirroring on
every body save, `listMentionables` for the picker, trash extended to `lore_entry`.
Web: WorldScreen (tree + counts + search + move up/down + cascade confirm), LoreSheet (kind
template fields commit-on-blur, category/inside pickers, pin, delete → undo), RichTextEditor
`@`-mentions (id-based chips + keyboard-driven popup), `UndoToast` busy-keyed fix.
Not shipped: image attachments (deferred to M3 exports/imports) and category drag-nest.

**Exit**: build a world with 20+ entries across kinds; mentions resolve live; rename an
entity → chips re-render everywhere (ID-based).

### Slice 7 — Backlinks & global search (**shipped 2026-10-09**, `f518716`; emulator 21/21)

**Screens**: backlinks sheet on every entity ("Mentioned in N places", grouped by source,
with snippets; tap → navigate); "Possible mentions" (unlinked occurrences → one-tap Link);
global search sheet (FTS5 across characters/lore/scenes/notes, grouped results, recents);
consistency checks list (empty summaries, unused locations, factions without members,
near-duplicate names).

**Build**: backlinks queries over `mention` (+ typed `entity_link` later in Slice 8),
unlinked-mention rewrite (text range → mention node, one undoable transaction), FTS wiring
(`§3.10` tables already exist), search budget test.

**Built**: `packages/core/src/search/` — `types` (hit/backlink/possible-mention/check shapes +
the two budget constants), `text` (FTS query building that strips syntax, trigram queries,
label matching, snippet windows, Levenshtein near-duplicates), `search` (two indexed passes as
one round trip each — token UNION ALL over the five entity types, then trigram — plus one
context query), `possible` (unlinked-occurrence scan over the `*_text` columns minus the
mirror, `rewriteDocWithMention` / `removeMentionNodes`), `backlinks` (three queries whatever the
source count, capped at `BACKLINK_MAX_SOURCES = 40` with a `truncated` flag), `commands`
(`linkMention` / `unlinkMention` — one transaction, one undo step), `checks` (six advisory
checks, never auto-fixed). `updateScene` (synopsis) and `updateCharacter` (storyline) now mirror
mentions, so backlinks cover step-5/step-8 prose too.
Web: app-bar search sheet (grouped hits, fuzzy chips, localStorage recents), `BacklinksPanel`
("Mentioned in N places" + possible mentions with Link/Link all + undo toast running the exact
inverse), `ChecksScreen` at `/checks` (reachable from the dashboard), `openEntity` navigation
helper + `navigation` store for sheet targets, eight axe-clean screens.
Perf: the storage CLI gained a `bench` op (times statements in-process) and the perf suite
asserts the §5.1 budgets against a generated reference project. It caught a real bug — the lock
heartbeat rewrote the `.lock` file on **every** query (~4 ms per operation); it is now throttled
to a quarter of the stale window. Result: backlinks 0.06 ms, search 3.94 ms in-process;
wasm path in-browser p95 search 3.2 ms / backlinks 1.4 ms.
Also: routes are code-split per screen (`lazyRouteComponent`) — the bundle gate had flagged the
single chunk as TIGHT (335.8/330 KiB); the app chunk is now 247.9 KiB.

**Exit**: backlink ≤ 10 ms and search ≤ 30 ms on the reference dataset (phone target: open
item #5); "Possible mentions" links without breaking text. — **met** (perf suite + wasm
measurements in both E2E scripts).

### Slice 8 — Relationships (**shipped 2026-10-09**, `fbc4b7f`; emulator 25/25)

**Screens**: Dossier → Relationships tab (edge table + "Add relationship" sheet: character
picker, kind, sentiment slider, directed, secret, notes); People → Web mode: **matrix
first** (virtualized N×N; cell shows kind glyph + sentiment colour; tap a cell → edge sheet
for create/edit; CSV export), graph view second (@xyflow + touch pan/zoom/pinch; sentiment
colours, dashed secret edges, arrowheads on directed; filters by kind/group/min-sentiment;
"as of scene" slider once scene data exists); Relationship groups (hulls in graph, column
grouping in matrix); list twin for accessibility.

**Build**: relationship commands (undirected edges normalized source<target; unique edge
index respected), group management, graph layout in a worker (300 nodes settle < 800 ms),
manual pin via `meta.graph_positions`.

**Exit**: add/edit edges from matrix and graph; secret/directed/sentiment render correctly;
matrix smooth on the emulator; a11y list twin complete.

### Slice 9 — Tags, custom fields, plotline grid (**shipped 2026-10-09**, `02fff29`; emulator QA OK, web 12 axe scans)

**Screens**: tag manager (create/rename/recolour/merge); tag chips + pickers everywhere;
Fields screen (settings → custom fields: target character/lore/scene/location, kind-scoped,
sections, reorder, usage-count on delete); plotline grid (phone: plotline rows × scene
columns, pinch-zoom, tap cell to attach/detach; balance stats "appears in 6 of 41 scenes,
longest gap 14" with the > 25 % warning).

**Build**: entity_tag commands, custom field def/value commands + validation per type,
plotline grid queries, balance statistics via SQL (no stored aggregates).

**Exit**: a custom field appears on every existing entity immediately; plotline grid
read/write; stats correct on the reference project.

### Slice 10 — Timeline v1 (**shipped 2026-10-09**, `d99f3e0`; emulator QA OK, web 13 axe scans; M2 gate met)

**Screens**: World → Timeline: horizontal swimlanes (World / per-character / per-plotline),
zoom from hours to millennia (project calendar), scene blocks placed by `storyTime` +
`TimelineEvent` items, drag to change storyTime, "scenes with no time" tray, conflict
warning (character in two places at once — warning only), event editor sheet.

**Build**: timeline queries, drag → one-row update, zoom levels + label formatting,
conflict detection query.

**Exit (M2 gate)**: on the reference project — backlinks, search, graph/matrix and timeline
budgets met; all gates green; APK rebuilt.

**M2 gate record (2026-10-09).** Measured, not estimated:

| Gate | Budget | Measured | Where |
| --- | --- | --- | --- |
| Search p95 | ≤ 30 ms | 21.4 ms | wasm path, `verify-web` |
| Backlinks p95 | ≤ 10 ms | 4.7 ms | wasm path, `verify-web` |
| Backlink statement p95 | ≤ 10 ms | 3.94 ms (0.06 ms p50) | native harness, `slice7-perf` |
| Timeline read (190 items, 60+ lanes) | ≤ 100 ms view switch | 9.0 ms median | native harness, `slice10-timeline` |
| Timeline drag commit | ≤ 30 ms | 1.5 ms median | native harness, `slice10-timeline` |
| Relationship matrix ready | ≤ 100 ms view switch | 851 ms cold | emulator, `verify-android` |
| Character web ready | ≤ 100 ms view switch | 753 ms cold | emulator, `verify-android` |
| App bundle (gzip) | ≤ 330 KiB | 247.2 KiB | `check:bundle` |
| Styles (gzip) | ≤ 8 KiB | 7.3 KiB | `check:bundle` |
| Storage worker (gzip) | ≤ 72 KiB | 63.6 KiB | `check:bundle` |
| Install payload | ≤ 4 MiB | 2.91 MiB | `check:bundle` |
| Per-route lazy chunk | ≤ 150 KiB | 61.8 KiB (worst) | `check:bundle` |
| Tests | — | 228/228 | `pnpm test` |
| Durability | no acked loss | 1002/1002, 3 kills | `pnpm chaos` + `chaos:web` |
| Emulator journey | all steps pass | 30 PASS, APK 9.82 MB | `verify-android` |

Notes on the two slow rows: the matrix/web numbers are the *whole* view switch on a cold
emulator — wasm compile, query, layout worker and first paint on a software renderer. The
in-process query itself is 2–5 ms (`slice7-perf`); the emulator's wasm driver is what costs.
That is also why both views are lazy-loaded inside the People route rather than shipped in it.
The emulator's own wasm reads run against smoke ceilings (search 120 ms / backlinks 60 ms),
never the shipping budgets — a phone-path budget asserted through an emulator's software
renderer would measure the emulator, not the app.

---

## 4. M3 — Safety, output, writing

### Slice 11 — Snapshots & restore UI (**shipped 2026-10-10**, `15db8b8`; emulator QA OK, web 15 axe scans)


**Screens**: Backups screen (snapshot list: reason, time, counts; Preview = read-only open +
diff summary "+3 scenes, −1 character, 2,140 words changed"; Restore = snapshot current
first, then replace; "Restore single entity" from a snapshot); mirror-folder setting
(Android: the app-scoped Documents folder via `@capacitor/filesystem` — decision 20; web:
File System Access API where available, else an export-reminder — open item #6).

**Build**: snapshot browser, preview/diff, restore transactions, retention thinning per
§4.5.3, `snapshot_record` index maintenance.

**Exit**: restore drill: make 3 destructive changes, restore from the pre-change snapshot,
verify counts; single-entity restore verified.

**Slice 11 record (2026-10-10).** Measured, not estimated:

| Gate | Result | Where |
| --- | --- | --- |
| Restore drill | 43 → 40 scenes restored; guard snapshot kept | `verify-web` 4v |
| Single-entity restore | "Regret two" copied back, 40 → 41 | `verify-web` 4v |
| Preview diff | "+3 scenes", per-table before → after | `verify-web` 4v |
| On-device restore | 5 → 3 scenes; single entity 3 → 4 | `verify-android` 2q |
| Native drill (rusqlite) | 3 destructive changes → counts restored; integrity ok | `slice11-snapshots.test.ts` |
| Retention | pinned + newest always kept; byte cap oldest-first | `snapshots.test.ts` |
| Tests | 242/242 | `pnpm test` |
| axe scans | 15/15 clean (backups + backups-entity added) | `verify-web` |
| Emulator journey | 36 PASS, APK 12.65 MB | `verify-android` |
| Bundle | app 253.8/330 KiB, css 7.8/8, worker 63.8/72, payload 3.29/4 MiB, worst chunk 61.8/150 | `check:bundle` |

Two real bugs found by the gates and fixed here:

1. **The sahpool keys files by percent-encoded name** (`/My%20Novel.starline`) while the app's
   session name is the decoded one. The restore's `unlink` therefore missed and `importDb`
   created a *second* file with the same logical name; the reopen then resolved to the old one,
   so the restore silently did nothing (3 → 3 scenes) and leaked a pool slot. Fixed in the
   worker: one `resolvePoolName`/`canonicalPoolName` pair now serves `open`, `unlink`,
   `export_file`, `import_file` and the new atomic `replace_file` op, so both name forms
   resolve to the same file.
2. **The snapshot file prefix depended on how the library was opened** (typed name on create vs
   encoded name from the start screen), so snapshots would vanish from the list after a reload.
   Fixed with one decoded `libraryKey()` for every snapshot file name.

A third, smaller one: the dashboard's backup card put the new Backups button in the same flex
row as the "Last backup …" line, squeezing the line to zero width on a phone (Playwright
reported it as "resolved to hidden"); the card's footer is now stacked with a wrapping button
row.


### Slice 12 — Export & import (**shipped 2026-10-10**, `8dfb251`; emulator QA OK 38 PASS, web 17 axe scans)

**Screens**: Export & import screen (`/export`, reached from the dashboard): format presets
(JSON / Markdown folder / DOCX manuscript / DOCX planning / HTML / Markdown / plain text / CSV
tables), scope filter (all scenes / drafted or later / only done), include-synopsis and
include-body toggles, progress + cancel, and a result line saying where the file went;
import flows: StarLine JSON / Markdown folder as a **new library** (start screen), CSV
column-mapping with dry-run "N to create, M skipped", and a manuscript split wizard
(heading level → chapters, scene breaks → scenes).

**Build**: MD zip (Obsidian-compatible layout per §4.5.1), JSON (versioned + upgraders),
HTML single-file, CSV tables, plain-text manuscript, DOCX in a worker; the **round-trip
gate**: `export → import → export` byte-identical.

**Exit**: round-trip gate green in CI; a real export opens cleanly in Obsidian.

**Slice 12 record (2026-10-10).** Measured, not estimated:

| Gate | Result | Where |
| --- | --- | --- |
| Round trip (native) | `export → import → export` byte-identical, 26-table document | `slice12-interchange.test.ts` |
| Round trip (web UI) | export JSON (4 characters · 43 scenes) → import as a new library → **43 scenes · 4 characters** | `verify-web` 4w + 7 |
| JSON export | flat versioned document, 86 KB for 2 ch · 41 scenes, 92 KB after the imports | `verify-web` 4w |
| Markdown folder | 68 files: `starline.json` + 45 `outline/**` + `characters/**` + CSV sidecars | `verify-web` 4w |
| DOCX | 6 OOXML parts; manuscript 4.7 kB XML (chapters + written scenes), planning 7.2 kB (plan lines) | `verify-web` 4w |
| CSV tables | 6 tables; 42 scene rows, `characters.csv` carries the cast | `verify-web` 4w |
| CSV import | dry run "2 to create" → "2 created", roles/tags/aliases written through commands | `verify-web` 4w |
| Manuscript split | "# Chapter nine" + `***` → "2 chapters · 2 scenes · 10 words" | `verify-web` 4w |
| On-device export | 25.7 KB JSON in the app-scoped files folder (`Android/data/app.starline/files/StarLine Exports`), share sheet opened | `verify-android` 2r |
| On-device QA | **38 PASS**, EMULATOR-QA OK | `verify-android` |
| Tests | 251/251 | `pnpm test` |
| Bundle | app 261.4/330 KiB, css 7.8/8, storage worker 63.8/72, **export worker 12.8/40**, payload 3.41/4 MiB | `check:bundle` |

Five real bugs the gates found and this slice fixed:

1. **The character whitelist blocked the importer.** `updateCharacter` only whitelisted
   `CharacterDraft` keys, so a CSV import that carried pronouns, age, occupation or aliases
   produced `no such column: undefined` (the column name came out of the map as `undefined`).
   The whitelist now covers the three dossier basics and the alias list, which the command
   stringifies — the importer writes through commands instead of reaching around them.
2. **The export read a cached project.** The screen held the project rows in a query cache, so
   an export right after an import exported the pre-import project (0 characters in a project
   with three). Every export now reads the rows fresh, and the importer's refresh also
   invalidates the export key.
3. **A manuscript printed a chapter heading per scene** whenever the outline numbered scenes
   per chapter (which the step-8 paste does): the manuscript walk sorted scenes by their bare
   `order_key` and so interleaved chapters. It now sorts part → chapter → scene, the same
   reading order the outliner shows.
4. **The phone's save path wrote where Android refuses.** The export (and, it turned out, slice
   11's snapshot mirror) wrote to `Directory.Documents` — the *shared* `/sdcard/Documents` — which
   fails with `EACCES` on Android 11+ without `MANAGE_EXTERNAL_STORAGE`. Both now go through one
   `deviceStorage.ts` into the app-scoped files folder, and the FileProvider gained the matching
   `external-files-path` entry without which the share sheet could never open. The on-device gate
   asserts the file on disk *and* the share sheet.
5. **The backlink p95 gate was measuring the maximum.** 15 samples put the p95 index on the last
   value, so one GC pause or a background snapshot failed the budget; it now takes 40 samples and
   reads 2.6 ms p50 / 3.1 ms p95 (budget 10 ms).

### Slice 13 — Writing mode (**shipped 2026-10-10**, `fc6e0f1`; emulator QA OK 40 PASS, web 19 axe scans)

**Screens**: scene "Write" — full-screen editor (TipTap; scene switcher; word count vs
target; quick sheet for the scene's characters/lore/backlinks); distraction-free mode
(hides chrome; serif option; 14–24 px size; measure 62–72 ch per §4.0); manuscript
navigation (chapters → scenes) with "continue writing" on the dashboard.

**Build**: body rich text with per-field autosave + app-background flush, word count via
`Intl.Segmenter`, cursor/last-scene persistence, IME hardening round 2.

**Exit**: write a full scene on the phone start-to-finish; kill app mid-scene → zero loss;
word counts flow into dashboard and stats.

**Slice 13 record (2026-10-10).** Measured, not estimated:

| Gate | Result | Where |
| --- | --- | --- |
| Writing journey (web) | continue card → "The Ferry" at 0 words → 14 words typed → saved → switcher (43 scenes) → back → prose intact | `verify-web` 4x |
| Typography + focus | 18 → 20 px, serif applied; focus mode hides the app bar, the tab bar and every control | `verify-web` 4x |
| Zero loss (web) | reload → reopen → the resume card says "pick up where you left off" → the prose is back | `verify-web` 4x |
| Zero loss (phone) | write → HOME (appStateChange flush) → force-stop → cold relaunch → prose intact | `verify-android` 2s |
| Body semantics (native) | count + FTS + mention mirror in one command: 13-word body indexed, chip becomes a backlink labelled "draft" | `slice13-writing.test.ts` |
| Resume pointer | last scene → deleted → next not-done in book order (chaptered first) → nothing when all done | `slice13-writing.test.ts` |
| Dashboard words | `writtenWords` = 10 (draft bodies only), next to the step-8 estimate | `slice13-writing.test.ts` |
| Tests | 257/257 | `pnpm test` |
| Bundle | app 262.1/330 KiB, css 8.2/9, storage worker 63.8/72, export worker 12.8/40, payload 3.43/4 MiB | `check:bundle` |
| Perf | search p50 3.3 / p95 5.5 ms · backlinks p50 1.3 / p95 2.1 ms (budgets 30 / 10) | `verify-web` |

One real bug the gates forced out of the wasm driver:

- **The start-screen import could hang forever.** `ensureInit()` in `packages/driver-wasm` had no
  in-flight guard, so the ops the app fires at once on boot each started their own
  `installOpfsSAHPoolVfs`. Two installs racing in one worker produces "Access Handles cannot be
  created if there is another open Access Handle"; sqlite-wasm's recovery cannot fix it
  (`removeVfs()` fails the same way) and the pool never finishes installing — every later op
  waits forever instead of failing, which is why the import sat on "Reading the file…" with no
  error. The install is now single-flight, which also retires the "second library loses the pool
  handle race" flake slice 12 documented and worked around with retries.

Design notes worth keeping:

- **Draft bodies joined the mention system.** `setSceneBody` mirrors chips into `mention` in the
  same transaction and `scene.body_text` joined the FTS trigger long ago, so prose is searchable
  the moment it is written. Backlink rows distinguish a synopsis from a draft (`… · draft`).
- **Two homes for state, chosen deliberately.** Where the writer stopped (`meta.editor_state`) is
  library state: it travels with the `.starline` file, so "continue writing" works on a new phone.
  Type size, serif and the caret per scene are device state and live in `localStorage` — they must
  not travel, and they must not cost a write per keystroke.
- **The body query cache is kept truthful.** Coming back to a scene seeds from the saved body; the
  editor invalidates its own query after each save, or the second visit would show the text as it
  was when the scene was first opened.
- **The stylesheet budget moved 8 → 9 KiB** (`check-bundle.mjs`). Writing mode is a whole screen of
  rules and the sheet cannot be code-split; the raise is documented in the script and the next
  UI-heavy slice should trim before raising again.

### Slice 14 — Notes incubator (full) + attachments (**shipped 2026-10-10**, `64cc1aa`; emulator QA OK 43 PASS, web 23 axe scans; **M3 gate met**)

**Screens**: Notes board (Inbox → Incubating → Used → Archived; phone: segmented columns,
swipe between; drag or swipe actions to move); quick capture (FAB long-press or shortcut);
promote-to (scene / character / lore / plotline — leaves a backlink chip, undoable);
"Revisit these ideas" card (incubating > 30 days — no notifications, no network);
attachments (paste/drop images + PDF, ≤ 20 MB, SHA-256 dedupe, gallery per character/lore).

**Build**: note commands, promote transactions, attachment pipeline (thumbnail 256 px,
blob split), sourceUrl opens in the system browser (the app never fetches it).

**Exit (M3 gate)**: export → import → export identical; restore drill passed; a scene
written end-to-end; all gates green; PWA + APK rebuilt.

**Slice 14 record (2026-10-10).** Measured, not estimated:

| Gate | Result | Where |
| --- | --- | --- |
| Quick capture (web) | one line → Enter → the note lands in the inbox; the board's counts follow | `verify-web` 4y |
| Incubator flow | row menu moves Inbox → Incubating (status verified in SQL); the note opens as a sheet | `verify-web` 4y |
| Promote to scene | note body autosaved (rich text) → promoted: `status=used`, `promoted_to_type=scene`, the new scene carries the note's title and body as its synopsis, the chip renders | `verify-web` 4y |
| Revisit nudge | a second note backdated 40 days shows the dashboard card after a reload | `verify-web` 4y |
| Attachments (web) | a real PNG through the file input: row + blob sizes agree, `sl-attachment-<id>` renders | `verify-web` 4z |
| Attachments in export | the folder export carries `attachments/<sha256>.png` — the picture rides the archive as a file | `verify-web` 4z |
| Notes + gallery (phone) | capture → promote to a character → PNG pushed to `/sdcard/Download` → gallery tile; force-stop → cold relaunch → note count and gallery tile intact | `verify-android` 2t |
| Round trip with attachments | export → import → export identical, attachment bytes and gallery rows included | `slice14-notes.test.ts` |
| Notes semantics (native) | CRUD, status moves, promotion inverses (incl. `deletePlotline`), stale-idea query, trash round-trip | `slice14-notes.test.ts` |
| Attachment semantics (native) | SHA-256 dedupe, gallery attach/detach, single-image slots (project/character/lore), delete clears slots, thumbnail bytes | `slice14-notes.test.ts` |
| Tests | 270/270 | `pnpm test` |
| Bundle | app 262.8/330 KiB, css **9.0/9 (TIGHT)**, storage worker 63.9/72, export worker 13.1/40, payload 3.48/4 MiB | `check:bundle` |
| Perf | search p50 3.2 / p95 5.6 ms · backlinks p50 1.3 / p95 2 ms (budgets 30 / 10) | `verify-web` |

**M3 gate (2026-10-10) — met.** Every exit line, with the evidence:

| Gate line | Evidence |
| --- | --- |
| export → import → export identical | `slice12-interchange.test.ts` + `slice14-notes.test.ts` (with attachments); `verify-web` step 7 imports the JSON it just exported: 44 scenes · 4 characters |
| restore drill passed | `verify-web` 4v (snapshot → edit → preview → restore → the edit is gone, the plan intact); `verify-android` 2q on-device restore |
| a scene written end-to-end | `verify-web` 4x (0 → 14 words → saved → switcher → reload → resume card → prose intact); `verify-android` 2s (write → HOME → force-stop → cold relaunch, prose intact) |
| all gates green | typecheck, biome, 270/270 tests, 23 axe scans, chaos 1002/1002, web chaos 5 batches, no-network 201 files, contrast, PWA, bundle budgets, perf budgets |
| PWA + APK rebuilt | Pages deploy of the slice-14 build; `artifacts/starline-debug.apk` rebuilt from the same tree |

One ordering lesson the bundle gate taught (recorded so it is not re-learned):

- **`pnpm typecheck` (`tsc -b`) writes build output into `apps/web/dist`**, so a
  `check:bundle` run *after* a typecheck reports a bloated install payload (~4.96 MiB —
  the tsbuildinfo, emitted `capacitor.config.js` and `src/` copies get precached). Always
  run the bundle gate immediately after a clean `vite build`, or rebuild first.

---

## 5. M4 — Polish (slices 17–20)

**Milestone exit (spec §5.7, amended by decisions 20–22):** §5.1 budgets enforced by CI;
WCAG 2.2 AA checklist signed off; i18n shipping English + Ukrainian; installers in place
(release-signed APK + PWA install path); docs complete, repo `AGENTS.md` included.

**M4 gate met (2026-10-11).** CI enforces the budgets and the full gate suite on every push
(runs 38151337067, 38154978882, 38159286618 green; a deliberately broken branch proved the gates
turn red). i18n ships English + Ukrainian with real plural forms. The WCAG 2.2 AA audit is
written down criterion by criterion in `docs/ACCESSIBILITY.md`, with its ten findings fixed and
the limitations stated. The release-signed APK exists and verifies. Docs are complete, `AGENTS.md`
included.

Four slices, CI first so every later slice is checked by the machine rather than by whoever
remembers to run the gates.

### Slice 17 — CI gates (one workflow, the whole suite)

**Build**: `.github/workflows/ci.yml` on push to `main` + pull requests, one job graph that
mirrors the local gates exactly: `static` (typecheck, biome, node tests incl. the Rust
storage CLI via `scripts/cargo.mjs`, browser tests), `durability` (`chaos`, `chaos:web`),
`budgets` (clean web build → `check:bundle`, `check-no-network`, `check-contrast`), `e2e`
(`verify-web`, `verify-pwa` on Playwright chromium). Toolchain: pnpm from `packageManager`,
Node 22, the runner's Rust, `playwright install --with-deps chromium`. Emulator QA stays
local by decision 22 — GitHub runners get no Android emulator.

**Exit**: workflow green on a real push; a deliberately broken budget and a failing test each
turn the run red (verified once, then reverted); a local `pnpm ci:gates` script runs the same
sequence so CI and the laptop cannot drift.

### Slice 18 — Ukrainian (i18n: en + uk) (**shipped 2026-10-11**, `9e53590`; CI run 38154978882 green, web 24 axe scans)

**Build**: a tiny core i18n runtime — `setLocale`/`getLocale`, `messages` as a live proxy over
the active catalogue (649 call sites keep working), `Intl.PluralRules`-backed plural entries
(the ~20 `{n}` strings become `PluralForms` so "1 сцена / 2 сцени / 5 сцен" is correct, and
TypeScript forces every call site to move), locale-aware `Intl.DateTimeFormat`/`Segmenter`
usage, `uk.ts` catalogue typed as `Messages` (the compiler proves completeness). Web side:
first run follows the system language (`uk*` → Ukrainian, else English), Settings gets a
Language control, the choice persists per device (`starline.locale`), `<html lang>` follows
the active locale (the PWA manifest stays English on purpose — the install sheet is drawn by
the OS in the OS language), and the route tree remounts on switch.

**Exit**: uk journey in `verify-web` (switch → headings/messages in Ukrainian → switch back),
plural spot-checks in tests, both locales axe-clean, css stays within budget.

**Slice 18 record (2026-10-11).** Measured, not estimated:

| Gate | Result | Where |
| --- | --- | --- |
| Locale runtime | `messages` is a live proxy over the active catalogue; ~650 call sites unchanged; no module captures strings | `i18n.test.ts` |
| Catalogue parity | uk mirrors en key for key (compiler + shape test); every leaf non-empty in both | `i18n.test.ts` |
| Plurals | ~25 counted phrases on `PluralForms` + `Intl.PluralRules`; «1 сцена / 2 сцени / 5 сцен / 21 сцена / 22 сцени»; the old `*One` two-form variants deleted | `i18n.test.ts` |
| Ukrainian journey (web) | Settings → Language → Українська: `html lang=uk`, Scenes header «44 сцени · ≈ 48 200 слів», axe clean in Ukrainian; switch back stores `starline.locale = en` | `verify-web` 4aa |
| First-run behaviour | system language wins when `starline.locale` is absent; explicit choice persists; "system language" clears it | `locale.ts` + journey |
| Formatting | numbers/dates/clocks follow the app locale, not the OS (`formatNumber`/`formatDateTime`/`formatClock`); the hardcoded "just now / 2 min ago / today" strings now run through `messages.time` | `verify-web`, code |
| Tests | 275/275 | `pnpm test` |
| Bundle | app 263.1/330 KiB · css **9.0/9 TIGHT** · payload 3.52/4 MiB | `check:bundle` |
| Durability + invariants | chaos 1002/1002 · web chaos 5 batches · no-network 203 files · contrast · PWA | gates |
| CI | run 38154978882 green on `9e53590` (static · durability · budgets · web E2E) | GitHub Actions |

Note on scope: the PWA manifest stays English on purpose — the install sheet is drawn by the
OS in the OS language, so a per-locale manifest would add bytes and change nothing a user sees.

### Slice 19 — Accessibility audit (WCAG 2.2 AA) (**shipped 2026-10-11**) — see `docs/ACCESSIBILITY.md`

**Build**: `scripts/check-a11y.mjs` — scripted manual checks axe cannot do: keyboard-only
journey (Tab/Shift-Tab/Enter/Escape through the main loops), visible focus on every stop,
focus order sanity, target sizes ≥ 24×24 CSS px, `prefers-reduced-motion` honoured, 200 %
zoom + text-spacing without clipping, non-text contrast of UI boundaries, page titles, `lang`
correctness, live-region status messages. Fix everything it finds.
`docs/ACCESSIBILITY.md` — the WCAG 2.2 AA checklist with per-criterion evidence, known
exceptions called out, owner sign-off line.

**Exit**: script green, checklist written, owner signs off.

**Slice 19 record (2026-10-11, `67d7962`, CI run 38159286618 green — `check:a11y` now runs in CI).**
The audit found ten things; all ten are fixed, none argued away.

| Layer | Result |
| --- | --- |
| `check:a11y` (new) | 55 checks green — keyboard walks with a visible indicator at every stop on 9 screens, 24 px targets, reflow at 320 px, WCAG 1.4.12 text spacing, reduced motion, the starfield stop control, titles, `html lang`, Escape, live region |
| axe-core | 25 scans, both locales, clean (incl. `scenes-uk`, `start-uk`) |
| Palette contract | `check:contrast` green in both themes |

Fixed: invisible focus on inputs/selects (global `:focus-visible` ring) · 13 px checkboxes/radios → 24 px
(2.5.8) · the plan header and app bar overflowed 8 px under text spacing (both now wrap) · the moving
starfield had no stop control (2.2.2 → Settings → Appearance, remembered per device) · **the entire
start screen was still hardcoded English** — a slice-18 gap the audit exposed (16 strings, now in the
catalogue and covered by the Ukrainian journey).

Also: `pnpm check:a11y` joins `ci:gates` and the CI `web E2E` job; `docs/ACCESSIBILITY.md` carries the
criterion-by-criterion checklist with honest limitations (pointer-only graph pins, English storage
errors, the timeline's wide-zoom packing).

### Slice 20 — Installers, release signing, docs + the M4 gate (**shipped 2026-10-11**)

**Build**: release keystore generated outside the repo
(`%USERPROFILE%\.starline\starline-release.keystore`, credentials in untracked android
`keystore.properties`), gradle `signingConfigs.release` wired, `assembleRelease` → a signed
release APK without DEV hooks; `docs/ANDROID-RELEASE.md` (keystore rules, build recipe,
upgrade constraints, why the debug APK stays for QA). PWA polish: manifest `lang`, install
path documented. Docs: repo `AGENTS.md`, README refresh, M4 gate table recorded.

**Exit**: release APK installs and runs on the emulator (smoke), signature verified with
`apksigner`, M4 gate table filled in this file.

---
**Slice 20 record (2026-10-11, `f86a378`, CI run 38160471583 green + Pages deploy green).**
Shipped: the release-signed APK, the release runbook, and the
repo guide agents (and future contributors) actually need.

| Artifact | Result |
| --- | --- |
| Release keystore | `%USERPROFILE%\.starline\starline-release.keystore` (outside the repo); credentials in untracked `apps/web/android/keystore.properties`; `.gitignore` covers both patterns |
| Gradle signing | `signingConfigs.release` loaded from that file; a clean checkout still builds (unsigned release APK) instead of failing |
| Release APK | `artifacts/starline-release.apk` — 9,178,297 bytes, `app.starline` v1.0, signed `CN=StarLine, OU=Daniil Perkin, O=StarLine, C=DE`, SHA-256 `24700cef…3afc4fd`; production web bundle, **no DEV hook** (grep-verified inside the APK) |
| Debug APK | `artifacts/starline-debug.apk` rebuilt from the slice-19 tree — still the QA artifact, still carries the DEV hook |
| Runbook | `docs/ANDROID-RELEASE.md` — key custody and backup warning, exact build commands, `apksigner`/`aapt` verification, install-over-debug caveat, version-bump rules, why CI does not build it |
| Repo guide | `AGENTS.md` — truth order (spec → decisions → plan), layout, commands, conventions (offline invariant, catalogue rule, budgets, staging), the gotchas that have cost real time, the ship-a-slice checklist |
| On-device QA | `verify-android` against the rebuilt debug APK — **43 PASS, EMULATOR-QA OK**; the slice-18/19 changes (Ukrainian through the WebView, focus rings, 24 px targets, reduced motion) exercised on a real Android runtime |

## 5b. Slice 15 — Cloud backup (optional, off by default)

Decision 18 designed it, decision 23 fixed its shape: immutable snapshot mirroring to the owner's
own Google Drive `appDataFolder`, no record sync, no encryption passphrase, both the APK and the
PWA, and a separate `STARLINE_CLOUD=1` flavour so the default build keeps zero cloud code.

**Shipped 2026-10-11:**

| Piece | Revision | What it is |
| --- | --- | --- |
| S15a | `22d7ae2` · `9433210` · `0eee91f` · `918027e` | config plumbing (one untracked `cloud.properties` → defines, only with the flag) · manifest (tolerant parse, decision-23c thinning) · Drive client (resumable uploads, `appDataFolder`, injected token) · orchestration (idempotent uploads, thin, rewrite in place) — 36 tests |
| S15b | `47b87fd` · `a87b430` · `8667cb7` · `0b6fc41` | Settings → Cloud backup (off by default, Google sign-in via Identity Services, honest status line) · uploads on every snapshot plus "Back up now" · Backups → Cloud card (list, download-into-local-snapshots, delete-from-cloud) · lazy cloud module, flavour-aware no-network check |
| S15c | `d4ce37b` | the deployed PWA and CI build the cloud flavour; the budgets job checks both flavours' invariants |
| S15d | `8e40f11` · `90e1316` · `4d56aa9` · `2277485` | Android sign-in (native `StarlineGoogleAuthPlugin`: email + `drive.appdata` in ONE consent, no Firebase anywhere) · the two on-device bugs below · the enable button freed from the library gate · Settings segments wrap + the a11y check that asserts it · repository variables feed the CI build |

**Shipped 2026-10-12 — S15 is complete.** Two bugs were found on the device, and both are the kind
that never show up in a browser: (1) Capacitor's plugin proxy is thenable, so returning it from an
`async` function made JavaScript call `StarlineGoogleAuth.then()` on Android and the promise never
settled — the panel sat at "Talking to Google Drive…" forever with no error; (2) `getToken` throws
`UserRecoverableAuthException` (`NeedRemoteConsent`) the first time `drive.appdata` is requested,
which is Google *asking* for the grant, not failing — the plugin now launches that screen and
retries. Both are recorded in the skill so the next Capacitor plugin does not repeat them.

**Verified (measured on the emulator, read from inside the running app rather than from a message):**

- sign-in as a real account → `starline.cloud.enabled = on`
- upload → **2 snapshots in Drive**, panel: "On — daniilperkin2004@gmail.com, N snapshot(s)"
- list → the Backups → Cloud card shows both with name, date, size
- download → "Downloaded — it is in the list above"; the snapshot joins the local list
- preview → the diff sheet opens ("Nothing changed since this snapshot." for an identical one)
- restore → completes with no error, returns to the plan, and the guard snapshot fires
- 323/323 tests · both flavours' `check-no-network` green (217 files) · a CI-style build with the
  properties file hidden still carries the client values (repository variables), file restored
  byte-identical · the full local gate suite green on the shipped tree: chaos (native + web),
  bundle budgets (app 263.3/330 KiB, install 3.54/4 MiB), contrast, web + PWA verify, a11y (60 checks)

**Shipped revision:** `2277485`, validated by CI run `38234539341` (static gates, durability, budgets
and web E2E — all four green) and Pages run `38234539356` (build + deploy, deployed bundle checked
against the live site). For the record: the first CI run on the S15 commit (`38234252909`) was
**cancelled**, not failed — a follow-up push superseded it under `cancel-in-progress`, and every
step that ran in it had passed. The earlier run on `4d56aa9` did fail, at `pnpm lint`, because the
segment-reachability check added to `scripts/check-a11y.mjs` had never been through biome; `2277485`
fixes it and the run above is the first that proves it.

**Left for the owner:** add `https://daniilperkin.github.io` (and `http://localhost:5187` for local
dev) as an authorized JavaScript origin on the web OAuth client — the APK signs in without it, the
PWA cannot. Console: APIs & Services → Credentials → the web client.

**Manual QA drill (the cloud flow needs a real account, so it cannot be scripted):** install the
cloud-flavour APK → Settings → Cloud backup → Turn on (Google's sheet; on a fresh account a second
grant screen appears, which is expected and now handled) → open a library → Back up now → confirm
"N snapshots in your Drive" → Backups → Cloud → Download → Preview → Restore. To reset: Turn off,
which never touches the local `.starline` files.

## 5c. The final push (decision 24) — work list

**Phase 1 — finish slice 15.** Android sign-in: a Kotlin Capacitor plugin doing Google Sign-In +
`drive.appdata` in one consent (idToken + access token), gradle wiring, the web adapter, then the
on-device test (emulator first, phone after). Rebuild the release APK **with `STARLINE_CLOUD=1`** —
the current one predates the whole slice. Then S15d: the manual QA drill written down (the cloud
flow cannot be scripted without an account) and this file's slice-15 record completed.

**Phase 2 — slice 16 — shipped 2026-10-12 (decision 25).**

| Piece | What it is |
| --- | --- |
| Structure templates | three-act · Hero's Journey · Save the Cat · story circle, each beat one scene through the existing `createScenesFromList`; append-only into the unassigned pool, always behind a preview. The parser gained an opt-in `titleColumn` and the command `withTitles` so template scenes arrive **titled**, while the paste flow still writes no titles at all |
| Daily question | one reflective question from the bundled library, deterministic from the local calendar date, hidden per day (`starline.daily.dismissed`); the first thing the dashboard shows that is about writing rather than about the plan |
| Ukrainian prompts | all nine steps translated (rule, three worked examples, five-plus questions each); `stepPrompt(locale, step)`; the prompts sheet now reads the writer's language |

**Shipped revision:** `8205911`, validated by CI run `38309665668` (static gates, durability, budgets
and web E2E — all four green) and Pages run `38309665687`, with the deployed bundle checked against the
live site (the daily card and the template markers are in the served chunk).

**Verified:** 333 tests (10 new: templates parse back as one scene per beat with no POV and no
chapter; the two locales match beat for beat; the daily pick is deterministic across a year and
draws from all nine steps) · WEB-VERIFY OK with both new journeys — the card stable across a reload
and hidden for the day, three-act previewed, reported and applied (44 → 53 scenes, all titled),
then re-applied (53 → 62) proving beats never merge into an earlier paste · bundle app 275.3/330 KiB,
CSS 9.2/10 KiB — the Ukrainian library and the templates add ~12 KiB gz to the main bundle, which is
the deliberate trade for offline content the dashboard needs.

**Found while verifying, all fixed:** (1) the paste flow writes `title = ''` — a scene's one-liner
*is* its identity in the method — so titles needed an opt-in flag rather than a behaviour change;
(2) templates were merging into an earlier paste because the line-merge is keyed by line number —
template beats are new scenes, so they are now excluded from that merge and carry no
`snowflake_source`; (3) `verify-web` was the only gate in the repo with **zero** perf tolerance where
spec §5.1 allows 5 %, so a 10.2 ms p95 failed a 10 ms budget on a loaded machine — it now uses the
same allowance `check-bundle` already applies.

**Phase 3 — carry-overs — now scheduled as M5 below** (section 10). The CSS budget item shipped
with decision 24; the `reviewedCharacterIds` line was stale (it is implemented in Step5Editor).

## 6. AI seams (decision 15) — ship none, keep the attach points clean

- v1 ships the **static prompt library** only (bundled, offline): wizard steps (Slice 1),
  scene editor prompts, lore/worldbuilding question sets. Content is part of the repo, no
  network.
- **Seam**: every prompt surface renders through one `PromptProvider` interface (bundled
  implementation only). A future opt-in AI provider would implement the same interface
  behind a settings gate that is off by default; the app remains fully functional without
  it. No network code, no keys, no stubs in v1.
- **Invariant tests**: built bundle contains no `fetch(`/`XMLHttpRequest` to non-local
  origins (CI grep + a runtime assertion in dev builds).

---

## 7. Engineering conventions for the build phase

- **Slice discipline**: every slice lands on `main` as a small commit series with detailed
  rationale; each slice is only "done" when all gates are green and the APK has been
  rebuilt and smoke-tested. Each slice closes with a three-line "what you can do now" note.
- **Gates**: the existing (`typecheck`, `biome`, `test`, `chaos`, `verify-web`,
  `verify-pwa`, `check-contrast`, `check-no-network`) plus:
  - ✅ `scripts/verify-android.mjs` — scripted emulator flow, shipped with Slice 1: fresh
    install → wizard step 1 → hardware back/minimise → cold relaunch (drives the WebView
    over CDP; needs a booted emulator and `artifacts/starline-debug.apk`).
  - ✅ export round-trip gate — shipped with Slice 12: `slice12-interchange.test.ts` runs
    `export → import → export` on the real rusqlite driver and asserts the bytes are identical;
    `verify-web` 4w + 7 drives the same loop through the real UI.
  - no-network invariant check — shipped with Slice 1 (`scripts/check-no-network.mjs`, source grep).
- **Strings**: `packages/core/src/i18n/` with typed keys and `en` as the base catalogue; a
  test fails the build on missing keys or unused keys. No literal UI copy in components.
- **Performance budgets (phone adaptation of spec §5.1)**: list scroll 60 fps on the
  `medium_phone` emulator; typing latency < 16 ms on a 40-scene project; cold open of a
  library < 1.5 s including the wasm boot (open item #7).
- **Data safety default**: snapshot before every destructive batch operation (bulk delete,
  merge, import, migration) — carried over from §2.3.3 into the web/Android storage path.
- **Reference dataset**: grow a scripted fixture ("reference project": 60 characters,
  150 scenes, 400 lore entries, 300 notes, 2 000 mentions) used by budgets and tests.

## 8. Explicitly out of v1

- Series container (schema-ready; v1.1), collaboration/social/ads (decision 10), AI
  generation (decision 15), Fabula import (no export exists on their side), live sync of
  the database file through cloud folders (snapshot mirroring only, §4.5.3), Tauri desktop
  shell beyond internal test duty.
- Optional **cloud backup** — no longer out of scope: the owner gave the go-ahead (decisions
  18/23) and it is being built as slice 15 (see §5b). The invariant wording it required is in
  force: the default build ships and makes no network requests; cloud backup is an explicitly
  enabled module.

## 9. Open items — resolved 2026-10-08 (all nine accepted as recommended, decision 17)

*Provenance only — every recommendation below is now the shipped default.*

1. **Tab set**: Plan / Scenes / People / World / Notes — or merge World into People?
   (recommendation: keep five)
2. **Scenes default view on phone**: list (recommendation) or corkboard cards?
3. **Step 8 on phone**: row list with inline edit (recommendation) or a full spreadsheet
   grid?
4. **Relationships on phone**: matrix-first (recommendation) or graph-first?
5. **Search budget**: phone target ≤ 50 ms p95 (the spec's 30 ms assumes desktop reference
   hardware) — accept?
6. **Mirror backups on Android**: SAF folder picker (recommendation); web keeps the
   export-reminder fallback — accept?
7. **Cold-open budget**: ≤ 1.5 s including wasm boot (recommendation) — or stricter?
8. **Static prompt content**: I write the full set (rule + 3 examples + 5–8 questions × 9
   steps + scene/world sets) during Slice 1 — review it then, or draft it for review first?
9. **Wizard layout**: each step a separate full page (recommendation — one small unit of
   work at a time) or one continuous scroll?

## 10. M5 — spec completion (slices 21-38)

**Owner decisions (2026-10-13), all binding:**

- **German ships as a third language**, informal *du* register. Full parity — UI catalogue, the
  nine-step prompt library and the four structure templates — because the catalogue shape test
  makes a partial translation impossible by construction.
- **A guided tour ships**: a button on the start screen and in Settings, plus a one-time
  dismissible offer card on first run. Twelve to fifteen stops covering every tab, the wizard and
  the key sheets — richer than the five coach-marks the spec sketched.
- **The audit's findings are all in scope** (`docs/SPEC-GAP-AUDIT.md`, 92 items triaged into
  three tiers), together with the four carry-overs. Roughly 6-8 weeks of focused work, sequenced
  below so each slice is independently shippable.
- **The Google console origins wait** — the APK signs in without them; the deployed PWA does not.
- **M5 status: COMPLETE** (slices 21-38 shipped).

**Sequence** (each slice lands on `main` with its gates green, per the standing convention):

| Slice | Scope | Tier | Effort |
| --- | --- | --- | --- |
| S21 | Corkboard/card view of the outline: the Scenes grid becomes real cards (title, status, POV, words, synopsis) with drag ordering | carry-over | 1-2 d |
| S22 | World category drag-nest (nest a lore category under another) | carry-over | 0.5 d |
| S23 | Multi-book UI: a book switcher plus create/rename/delete inside one library | carry-over | 2-3 d |
| S24 | Timeline wide-zoom clustering (the documented v1 overlap) | carry-over | 1 d |
| S25 | German: the full catalogue, the prompt library and the templates, `du` register; the language switcher and system detection learn `de` | owner | 3-4 d |
| S26 | The guided tour: a stop engine, 12-15 stops, the start-screen and Settings entry points, the one-time offer card | owner | 2-3 d |
| S27 | Tier-1 correctness: Ingermanson attribution in-app, snapshot before import/bulk-delete/migration, the scene editor's lore picker, cold-open and typing budgets as gates, sepia + high-contrast themes, `enabledModules` wired or deleted | T1 | 3-4 d |
| S28 | Command palette; the export dialog's declared options (chapter scope, include-notes, preview, progress) | T1 | 2 d |
| S29 | Character merge (with mention rewriting and undo) plus the dossier tabs: Psychology, Story arc, Appearance, Backstory, Voice, Appearances, Gallery, Custom | T2 | 4-6 d |
| S30 | Settings depth: Editor (smart quotes, auto-pair, spellcheck), Statuses (rename/recolour), Keyboard, Privacy | T1/T2 | 2 d |
| S31 | Lore depth: tag/kind/orphan filters, cards and map views, coordinate pins | T2 | 2-3 d |
| S32 | Outliner depth: multi-select and bulk actions, filters and dimming, saved filters, column chooser, group-by | T2 | 2-3 d |
| S33 | @mention depth: rename-safe chips, hover previews, fuzzy and recency ranking, backlinks for scenes and notes | T2 | 2-3 d |
| S34 | Import/export depth: open a `.starline` directly, per-entity issue reports, DOCX input for the split wizard, the published JSON-Schema, the read-only downgrade policy, the export extras | T2 | 3-4 d |
| S35 | Migration property tests with `fast-check` (declared but never imported) | T1 | 1 d |
| S36 | Tier-3 polish: the dashboard and creation extras (form, genre chips, deadline, word-count presets), the character list (avatars, scene counts, pinning, filters, sorts), the trait list, the Scenes statistics strip, the scene-editor extras | T3 | 4-5 d |
| S37 | First-run onboarding and module visibility (`enabledModules` driving the tab set) | T3 | 2 d |
| S38 | **shipped** — M5 close: docs (README counts + the Milestones note), the accessibility re-audit (61 checks green, `docs/ACCESSIBILITY.md`), a fresh signed release APK | - | 1 d |

**The audit itself** lives at `docs/SPEC-GAP-AUDIT.md`: every item with its spec line and the
evidence the independent sweep found, plus the corrections it forced (the HTML export ships; the
slice-3 `reviewedCharacterIds` line in this file was stale and is struck from the carry-over list).

**Ordering rationale:** the four carry-overs first because they are bounded and visible, then
German and the tour because the owner asked for them by name, then the tiers roughly in order of
correctness value per hour. S27 is deliberately early: three of its items are data-safety or
legal, and the perf budgets are the only spec requirement that has never been measured at all.

### Slices 21–27 shipped (the four carry-overs, German, the tour and Tier-1 correctness)

| Slice | Revision | CI | What shipped |
| --- | --- | --- | --- |
| S21 corkboard | `ad2c40e` | green | A third Scenes view: cards on a `rectSortingStrategy` board, reusing the list's drag machinery; cards match the list rows one for one and open the scene sheet. |
| S22 World drag-nest | `df08b9a` | `38382626450` | The lore tree nests by dragging a category onto another, with a keyboard path beside it; `world.moveUnder` carries the cycle guard. |
| S23 multi-book UI | `dd8bf4d` + `321c092` | `38384700256` | One library, many books: `project.rename`/`delete`/`restore`, `useActiveProject` (18 call sites across 13 files), the app-bar switcher. Two display bugs found by probing — `StepScreen` read the first book directly, and the step editors kept state across a switch; the database was proven intact first. |
| S24 timeline clustering | `2ddd120` + `4d206ce` | `38388542877` | `clusterTimelineItems` groups events closer than a fraction of the visible window (anchored, so a long run splits), and the lane renders a chip that opens the list. Zoom-aware: nothing clusters at the narrow zooms. |
| S25 German | `5d8a06c` | (run at push) | Full third locale, informal *du*: the catalogue (48 sections, ~890 leaves), the 9-step prompt library, the 4 templates (44 beats), the daily card for free. `availableLocales`/`catalogues`/`PromptLocale` widened; verify-pwa and check-a11y pinned to en-US, because German now really does open on a German machine. |
| S26 guided tour | `6819813` | (run at push) | Fifteen stops across every tab, the wizard and the key tools; an overlay that navigates itself and spotlights real anchors, polling for anchors that render after their data arrives, and falling back to a centred card; the one-time offer card plus buttons on the start screen and in Settings; `starline.tour` as device state; the tour in en/uk/de |
| S27 Tier-1 correctness | `ab01042` | (run at push) | Ingermanson attribution in en/uk/de; snapshots before the CSV import, the manuscript import, a lore cascade delete, emptying the trash and a schema migration (taken between open and migrate — the only moment the old schema exists); the scene lore picker (chips + searchable popup); perf gates as a new `check:perf` in `ci:gates` and CI (cold start 348 ms / 1200, typing p95 16.0 ms / 16 — 24 ms before the keystroke buffer); sepia and high-contrast themes with catalogue labels; `enabledModules` wired via a new `readProjectSettings` + hook + tab filter |

**Verified at the S38 close:** 351 tests (33 files) · WEB-VERIFY OK · PWA-VERIFY OK · A11Y OK
(61 checks) · chaos and web chaos · no-network over 240 files · contrast · bundle app 274.2 KiB / 330,
styles 10.2 / 11 (decision 27), install 4.05 MiB / 4 (tight) · perf: cold start ≤ 352 ms / 1200, typing
p95 16.0 ms / 16 standalone — 24.0 ms reads are the loaded machine, per the S34 bisect; CI applies its
documented 1.75x factor. Per-slice readings from the M5 runs are in the revision table above; the
M0-M4 readings stay in sections 2-5.

## 11. Appendix — screen → data map (abridged)

| Screen | Primary reads | Writes (commands) |
|---|---|---|
| Plan dashboard | `snowflake_step`, counts, `meta.revision` | — |
| Step 1–2 | `snowflake_step` | `saveStepContent`, `markStepComplete` |
| Step 3 / People list | `character`, `snowflake_step` | character commands, extraction |
| Dossier | `character`, `scene_character`, `character_relationship` | character/relationship commands |
| Scenes list | `scene`, `chapter`, `part`, join tables | scene commands, moves (one-row) |
| Scene editor | `scene` + joins | field updates (autosave) |
| World tree / entry | `lore_category`, `lore_entry`, `custom_field_value`, `entity_link` | lore commands |
| Backlinks / search | `mention`, FTS5 tables | mention mirroring on rich-text save |
| Matrix / graph | `character_relationship`, `relationship_group` | relationship commands |
| Timeline | `timeline_event`, `scene.story_time` | timeline commands |
| Notes | `idea_note` | note commands, promote transactions |
| Backups | `snapshot_record` + snapshot files | snapshot/restore operations |
| Export / import | all tables | new-project creation only |
