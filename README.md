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
- `crates/starline-storage*` — native storage crate + headless NDJSON CLI (tests, chaos)
- `SPECIFICATION.md` (source of truth) · `DECISIONS.md` (owner decisions & audit resolutions) · `docs/`

## Live

- **PWA:** https://daniilperkin.github.io/starline/ — deploys automatically from `main` (see docs/HOSTING.md)
- **Android APK:** `artifacts/starline-debug.apk` — debug build, sideload

## Gates (all green means shippable)

- `pnpm typecheck` / `pnpm lint`
- `pnpm test` — contract tests across both drivers + core domain unit tests (97 total, incl. the slice-5 trash/undo integration suite on the real rusqlite driver)
- `pnpm chaos` — kill-9 durability harness (native driver)
- `pnpm chaos:web` — web crash harness: random write batches killed mid-flight, then reopen asserts crash detection + integrity + row consistency
- `node scripts/verify-web.mjs` — wizard E2E: library + story + steps 1–6 (character card, extraction, dossier edit, step-4 seed, storylines, sections, Stale badge) + step 8 (paste 40 scenes, merge re-import) + Scenes tab (reorder, reassign, editor round-trip) + slice 5 (step 9 accordion + copy-to-synopsis, dashboard cards + manual snapshot, trash round-trip, undo toast, drag reorder, axe scans on every screen) + persistence (serves its own dev build)
- `node scripts/verify-pwa.mjs` — service worker + offline reopen with the plan intact (serves its own preview build)
- `node scripts/check-contrast.mjs` — WCAG pin for the star-library palette (accent-is-decoration rule)
- `node scripts/check-no-network.mjs` — offline-complete invariant: no network primitives in app source
- `node scripts/verify-android.mjs` — scripted emulator QA: fresh APK install → wizard steps 1–4 (character card, step-4 seed, rich-text editors) → step-8 paste import → Scenes tab + scene-sheet round-trip → slice 5 on-device (step 9, dashboard + snapshot, trash round-trip, undo toast, long-press drag) → back-button/minimise → cold relaunch (needs a booted emulator)
