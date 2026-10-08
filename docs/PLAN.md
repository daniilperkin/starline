# StarLine — Deep Plan (phone-first)

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

### Slice 5 — Step 9 + dashboard + M1 hardening

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

### Slice 6 — Lore wiki v1

**Screens**: World tab (category tree with the seeded default taxonomy — Geography,
Factions & Organizations, Magic & Technology, History, Cultures & Religions, Politics &
Economy, Species, Items, Languages; drag to reorder/nest, cycle-safe; entry list or cards);
lore entry editor (kind templates from §3.7 rendered as custom fields — e.g. location:
Region / Climate / Population / Ruler / Notable sites; summary ≤ 280 chars; rich-text body;
aliases; image; pin; child entries; breadcrumbs).

**Build**: lore category/entry commands, kind-template seeding via `custom_field_def`,
`@`-mention autocomplete v1 inside rich text (chip nodes; mention table mirrored on save —
this is the backbone for backlinks), cycle prevention (recursive CTE before write).

**Exit**: build a world with 20+ entries across kinds; mentions resolve live; rename an
entity → chips re-render everywhere (ID-based).

### Slice 7 — Backlinks & global search

**Screens**: backlinks sheet on every entity ("Mentioned in N places", grouped by source,
with snippets; tap → navigate); "Possible mentions" (unlinked occurrences → one-tap Link);
global search sheet (FTS5 across characters/lore/scenes/notes, grouped results, recents);
consistency checks list (empty summaries, unused locations, factions without members,
near-duplicate names).

**Build**: backlinks queries over `mention` (+ typed `entity_link` later in Slice 8),
unlinked-mention rewrite (text range → mention node, one undoable transaction), FTS wiring
(`§3.10` tables already exist), search budget test.

**Exit**: backlink ≤ 10 ms and search ≤ 30 ms on the reference dataset (phone target: open
item #5); "Possible mentions" links without breaking text.

### Slice 8 — Relationships

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

### Slice 9 — Tags, custom fields, plotline grid

**Screens**: tag manager (create/rename/recolour/merge); tag chips + pickers everywhere;
Fields screen (settings → custom fields: target character/lore/scene/location, kind-scoped,
sections, reorder, usage-count on delete); plotline grid (phone: plotline rows × scene
columns, pinch-zoom, tap cell to attach/detach; balance stats "appears in 6 of 41 scenes,
longest gap 14" with the > 25 % warning).

**Build**: entity_tag commands, custom field def/value commands + validation per type,
plotline grid queries, balance statistics via SQL (no stored aggregates).

**Exit**: a custom field appears on every existing entity immediately; plotline grid
read/write; stats correct on the reference project.

### Slice 10 — Timeline v1

**Screens**: World → Timeline: horizontal swimlanes (World / per-character / per-plotline),
zoom from hours to millennia (project calendar), scene blocks placed by `storyTime` +
`TimelineEvent` items, drag to change storyTime, "scenes with no time" tray, conflict
warning (character in two places at once — warning only), event editor sheet.

**Build**: timeline queries, drag → one-row update, zoom levels + label formatting,
conflict detection query.

**Exit (M2 gate)**: on the reference project — backlinks, search, graph/matrix and timeline
budgets met; all gates green; APK rebuilt.

---

## 4. M3 — Safety, output, writing

### Slice 11 — Snapshots & restore UI

**Screens**: Backups screen (snapshot list: reason, time, counts; Preview = read-only open +
diff summary "+3 scenes, −1 character, 2,140 words changed"; Restore = snapshot current
first, then replace; "Restore single entity" from a snapshot); mirror-folder setting
(Android: SAF folder picker via Capacitor Filesystem; web: File System Access API where
available, else an export-reminder — open item #6).

**Build**: snapshot browser, preview/diff, restore transactions, retention thinning per
§4.5.3, `snapshot_record` index maintenance.

**Exit**: restore drill: make 3 destructive changes, restore from the pre-change snapshot,
verify counts; single-entity restore verified.

### Slice 12 — Export & import

**Screens**: Export sheet (format presets: manuscript / planning / interchange; scope
filters: whole project, chapters, only `done` scenes; include synopsis/notes toggles;
progress + cancel; share/save via Android share sheet or SAF); Import flows (StarLine
JSON/MD folder → new project; CSV column-mapping with dry-run "N to create, M skipped";
manuscript split wizard: heading level → chapters, scene breaks → scenes).

**Build**: MD zip (Obsidian-compatible layout per §4.5.1), JSON (versioned + upgraders),
HTML single-file, CSV tables, plain-text manuscript, DOCX in a worker; the **round-trip
gate**: `export → import → export` byte-identical.

**Exit**: round-trip gate green in CI; a real export opens cleanly in Obsidian.

### Slice 13 — Writing mode

**Screens**: scene "Write" — full-screen editor (TipTap; scene switcher; word count vs
target; quick sheet for the scene's characters/lore/backlinks); distraction-free mode
(hides chrome; serif option; 14–24 px size; measure 62–72 ch per §4.0); manuscript
navigation (chapters → scenes) with "continue writing" on the dashboard.

**Build**: body rich text with per-field autosave + app-background flush, word count via
`Intl.Segmenter`, cursor/last-scene persistence, IME hardening round 2.

**Exit**: write a full scene on the phone start-to-finish; kill app mid-scene → zero loss;
word counts flow into dashboard and stats.

### Slice 14 — Notes incubator (full) + attachments

**Screens**: Notes board (Inbox → Incubating → Used → Archived; phone: segmented columns,
swipe between; drag or swipe actions to move); quick capture (FAB long-press or shortcut);
promote-to (scene / character / lore / plotline — leaves a backlink chip, undoable);
"Revisit these ideas" card (incubating > 30 days — no notifications, no network);
attachments (paste/drop images + PDF, ≤ 20 MB, SHA-256 dedupe, gallery per character/lore).

**Build**: note commands, promote transactions, attachment pipeline (thumbnail 256 px,
blob split), sourceUrl opens in the system browser (the app never fetches it).

**Exit (M3 gate)**: export → import → export identical; restore drill passed; a scene
written end-to-end; all gates green; PWA + APK rebuilt.

---

## 5. AI seams (decision 15) — ship none, keep the attach points clean

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

## 6. Engineering conventions for the build phase

- **Slice discipline**: every slice lands on `main` as a small commit series with detailed
  rationale; each slice is only "done" when all gates are green and the APK has been
  rebuilt and smoke-tested. Each slice closes with a three-line "what you can do now" note.
- **Gates**: the existing (`typecheck`, `biome`, `test`, `chaos`, `verify-web`,
  `verify-pwa`, `check-contrast`, `check-no-network`) plus:
  - ✅ `scripts/verify-android.mjs` — scripted emulator flow, shipped with Slice 1: fresh
    install → wizard step 1 → hardware back/minimise → cold relaunch (drives the WebView
    over CDP; needs a booted emulator and `artifacts/starline-debug.apk`).
  - export round-trip gate — arrives with Slice 12 and stays in CI.
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

## 7. Explicitly out of v1

- Series container (schema-ready; v1.1), collaboration/social/ads (decision 10), AI
  generation (decision 15), Fabula import (no export exists on their side), live sync of
  the database file through cloud folders (snapshot mirroring only, §4.5.3), Tauri desktop
  shell beyond internal test duty.
- Optional **cloud backup** (Firebase snapshot mirroring) — analysed in
  `docs/CLOUD-BACKUP.md` per owner request (decision 18); candidate after v1 core, requires
  its own go-ahead and an invariant-wording revision.

## 8. Open items — resolved 2026-10-08 (all nine accepted as recommended, decision 17)

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

## 9. Appendix — screen → data map (abridged)

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

*End of plan — review comments welcome as numbered notes against §8 (or anywhere).*
