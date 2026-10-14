# StarLine

A phone-first, offline novel-planning workstation — your story, among the stars.
Walk a single sentence through the 9-step Snowflake Method into a scene-by-scene outline;
plan characters, relationships, lore and notes while everything lives on **your** device in a
single SQLite library file. No accounts, no telemetry, no network.

Ships as an installable PWA (Android/iOS via the browser) — a native wrapper can follow later.

## Run it

```bash
pnpm install
pnpm --filter @starline/web dev        # http://localhost:5183
```

Build + preview (what the PWA ships):

```bash
pnpm --filter @starline/web build
pnpm --filter @starline/web preview    # http://localhost:5184
```

### Install on your phone

1. Open the preview URL (same Wi-Fi) in Chrome on the phone.
2. Menu → **Add to Home screen**.
3. Works fully offline afterwards.

## What's inside

- `packages/core` — primitives, rich-text helpers, settings, ChangeBus, command executor
- `packages/db` — StorageDriver contract, migrations (schema v1), the shared contract suite
- `packages/driver-tauri` / `packages/driver-wasm` — the two driver transports (native rusqlite / sqlite-wasm OPFS)
- `apps/web` — the phone PWA (React 19 + Vite + Tailwind 4); visual identity in `docs/DESIGN.md`
- Optional cloud backup (slice 15): snapshots mirrored to your own Google Drive `appDataFolder`, off by default, absent from the default build (`STARLINE_CLOUD=1` carries it) — `docs/CLOUD-SETUP.md`
- English + Ukrainian out of the box — system language on first run, a Language control in Settings, real Ukrainian plural forms (one/few/many/other)
- `crates/starline-storage*` — native storage crate + headless NDJSON CLI (tests, chaos)
- `AGENTS.md` — the working guide: truth order, layout, commands, conventions, gotchas
- `SPECIFICATION.md` (source of truth) · `DECISIONS.md` (owner decisions & audit resolutions) · `docs/` (DESIGN, ARCHITECTURE, ACCESSIBILITY, ANDROID-RELEASE, CLOUD-BACKUP, HOSTING, FABULA-PARITY, PLAN)

## Live

- **PWA:** https://daniilperkin.github.io/starline/ — deploys automatically from `main` (see docs/HOSTING.md)
- **Android APK (release):** `artifacts/starline-release.apk` — signed with the StarLine release key, production bundle, sideload it. See `docs/ANDROID-RELEASE.md`.
- **Android APK (QA):** `artifacts/starline-debug.apk` — debug-signed, carries the DEV hook `scripts/verify-android.mjs` needs

## Milestones

- **M0-M4 complete** (slices 1-20): foundation, planning core, the connected world, safety & output, polish.
- **M5 complete** (slices 21-38): the full audit remediation - the four carry-overs, German, the tour, the Tier-1/2/3 passes, and this close (docs, the accessibility re-audit, the release APK).

## Gates (all green means shippable)

- `pnpm ci:gates` — the whole suite in one command, the same sequence CI runs (`.github/workflows/ci.yml`, on every push to `main` and every PR): typecheck, lint, tests, chaos, chaos:web, clean build → bundle budgets, no-network, contrast, verify-web, verify-pwa, check:a11y. Emulator QA stays local — GitHub runners get no Android emulator (decision 22).
- `pnpm typecheck` / `pnpm lint`
- `pnpm test` — contract tests across both drivers + core domain unit tests (356 total, incl. the slice-5 trash/undo, slice-6 lore, slice-7 search/backlink, slice-8 relationship, slice-9 tag/field/grid, slice-10 timeline, slice-11 snapshot/restore, slice-12 interchange, slice-13 writing-mode, slice-14 notes/attachments suites and the M5 migration property tests on the real rusqlite driver, plus the perf suites that assert the §5.1 budgets — timeline read and scene-drag commit included — on the reference project)
- `pnpm chaos` — kill-9 durability harness (native driver)
- `pnpm chaos:web` — web crash harness: random write batches killed mid-flight, then reopen asserts crash detection + integrity + row consistency
- `node scripts/verify-web.mjs` — wizard E2E: library + story + steps 1–6 (character card, extraction, dossier edit, step-4 seed, storylines, sections, Stale badge) + step 8 (paste 40 scenes, merge re-import) + Scenes tab (reorder, reassign, editor round-trip) + slice 5 (step 9 accordion + copy-to-synopsis, dashboard cards + manual snapshot, trash round-trip, undo toast, drag reorder) + slice 6 (World taxonomy, entry + kind-template fields, `@`-mention picker, delete → undo) + slice 7 (backlinks panel, possible mention → one-tap Link with the prose intact, global search sheet, checks screen, and the two §5.1 budgets measured through the wasm driver) + slice 8 (matrix cell → edge sheet → edit, relationship group, web nodes + node drag pinning, list twin) + slice 9 (plotline grid attach → beat → balance, zoom, tag manager create/rename/recolour/merge, a custom field that lands on an existing scene and counts its fills) + slice 10 (timeline: tray place → world event → block drag asserted against the row → zoom labels) + slice 11 (backups: snapshot now → 3-scene destructive change → preview diff "+3 scenes" → restore rolls the library back → single-entity restore from the pre-restore guard snapshot; pool holds exactly one library file afterwards) + slice 12 (export JSON / Markdown folder / DOCX manuscript / DOCX planning / CSV tables from the open project, each file unpacked and checked; CSV paste import with dry run; manuscript split preview; then the exported JSON imported as a NEW library and its scenes and characters verified) + slice 13 (writing mode: the resume card opens "The Ferry", 14 words typed with a live count, autosave, the scene switcher lists 43 scenes and the prose comes back, 18 → 20 px + serif, focus mode hides the chrome, reload → reopen → prose still there) + slice 14 (notes: quick capture → inbox, row menu → incubating, body autosave, promote → a real scene carrying the note's title and body, the 40-day revisit card; attachments: a PNG through the file input with matching blob/metadata sizes, and the folder export carrying `attachments/<sha256>.png` as a real file) + slice 18 (switch to Ukrainian: `html lang`, «44 сцени · ≈ 48 200 слів», the start screen, then back) + the M5 slices 21-37 (corkboard, World drag-nest, the multi-book switcher, timeline clustering, German, the guided tour, the Tier-1 correctness pass, the command palette, the character merge + dossier tabs, the Settings depth, the lore depth, the outliner depth, the mention depth, the import/export depth, the Tier-3 polish, the first-run wizard) + axe scans on every screen (both locales) + pool no-leak assertion + persistence (serves its own dev build)
- `node scripts/verify-pwa.mjs` — service worker + offline reopen with the plan intact (serves its own preview build)
- `node scripts/check-contrast.mjs` — WCAG pin for the star-library palette (accent-is-decoration rule)
- `node scripts/check-no-network.mjs` — offline-complete invariant: no network primitives in app source
- `node scripts/check-a11y.mjs` — the WCAG 2.2 AA audit harness (slice 19): 61 checks axe cannot make — keyboard-only walks with a visible focus indicator at every stop on 9 screens, 24 px targets, 320 px reflow, WCAG 1.4.12 text spacing, reduced motion, the starfield stop control, page titles, `html lang`, Escape closing a sheet, a live region for status messages. The checklist lives in `docs/ACCESSIBILITY.md`
- `pnpm check:bundle` — gzip budgets from spec §5.1 (app 330 KiB, css 11 (decision 27), worker 72, install payload 4 MiB, **per-route lazy chunk 150 KiB**; fails beyond +5 %, prints TIGHT inside the band)
- `node scripts/verify-android.mjs` — scripted emulator QA: fresh APK install → wizard steps 1–4 (character card, step-4 seed, rich-text editors) → step-8 paste import → Scenes tab + scene-sheet round-trip → slice 5 on-device (step 9, dashboard + snapshot, trash round-trip, undo toast, long-press drag) → slice 6 on-device (World tab, kind template, `@`-mention, delete → undo) → slice 7 on-device (backlinks panel, possible mention → Link, search sheet, checks screen, §5.1 budgets on the emulator's wasm driver) → slice 8 on-device (matrix ready time, edge from a cell, web nodes + node pin, list twin) → slice 9 on-device (grid cells, cell + beat persisted, tag manager) → slice 10 on-device (timeline tray place, world event, block drag) → slice 11 on-device (snapshot now, preview diff, restore 5 → 3 scenes, single-entity restore) → slice 12 on-device (export JSON → 25.7 KB file lands in the app-scoped files folder, share sheet asserted, size checked) → slice 13 on-device (write in the phone editor → HOME → force-stop → cold relaunch → the resume card brings the scene back with every word) → slice 14 on-device (quick capture → promote to a character; a PNG pushed to the phone through the gallery input; force-stop → cold relaunch → the note and the gallery tile are both intact) → back-button/minimise → cold relaunch (plan + lore entry intact) — **48 PASS** (needs a booted emulator)
