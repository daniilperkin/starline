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

## Gates (all green means shippable)

- `pnpm typecheck` / `pnpm lint`
- `pnpm test` — 26 contract tests across both drivers
- `pnpm chaos` — kill-9 durability harness
- `node scripts/verify-web.mjs` — create/open/close E2E (serves its own dev build)
- `node scripts/verify-pwa.mjs` — service worker + offline reopen (serves its own preview build)
