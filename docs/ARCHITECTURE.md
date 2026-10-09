# Architecture — StarLine

Phone-first PWA over a single-file SQLite library. Product spec: `SPECIFICATION.md`; owner
decisions: `DECISIONS.md`; visual identity: `docs/DESIGN.md`.

## Monorepo

| Path | What lives there |
|---|---|
| `packages/core` | Primitives (UUIDv7, epoch-ms, fractional order keys), rich-text helpers + word count, entity/enum types (spec §3), settings (Zod), ChangeBus, command executor |
| `packages/db` | `StorageDriver` contract (§2.3.2), forward-only migration runner, `migrations/0001_init.sql` (all §3 tables, FTS, triggers), the shared contract suite (`testing/contract.ts`) |
| `packages/driver-tauri` | Transport-generic driver + NDJSON stdio transport (tests, chaos harness, future desktop shell) |
| `packages/driver-wasm` | sqlite-wasm over the OPFS sahpool VFS in a dedicated worker + postMessage transport |
| `apps/web` | The phone app — React 19, Vite 8, Tailwind 4, `vite-plugin-pwa` |
| `crates/starline-storage(-cli)` | Native rusqlite storage layer + headless NDJSON CLI (chaos harness) |

## Data flow

UI → `StorageDriver` → transport (postMessage / stdio) → worker or native process → one SQLite
file. One interface, two drivers, one contract suite; behaviour differences are declared as
capabilities (`locking`, `externalChange`, `multiInstance`), never by forking tests.

## Library storage (web target)

A library is a SQLite file in the origin’s OPFS pool (`starline-sahpool`, capacity 64). One
worker owns the pool while a library is open; closing disposes it. Pool names are
percent-encoded (the UI decodes for display, opens by the stored name).
`navigator.storage.persist()` is requested on first creation (§5.4.1).

## Offline

`vite-plugin-pwa` precaches the shell including the sqlite-wasm binary (≤5 MB per file); data
never leaves the device and no network code path exists. Proven by `scripts/verify-pwa.mjs`:
SW install → offline reload → library reopened with the network off.

## Migrations

Forward-only; each migration runs in its own transaction via `tx.execScript`; `user_version`
stamps progress; fresh files get `application_id` 0x5354524C (“STRL”); opening a newer schema is
refused with a clear error.

## Gates (all green means shippable)

- `pnpm typecheck` · `pnpm lint`
- `pnpm test` — the same contract suite on both drivers + core domain unit tests (141, incl. slice-5 trash/undo, slice-6 lore and slice-7 search/backlink/perf integration on rusqlite)
- `pnpm chaos` — kill-9 chaos harness (durability of acknowledged writes, native driver)
- `pnpm chaos:web` — web crash harness (random writes killed mid-flight + reopen assertions: crash banner, integrity, FK sanity)
- `node scripts/verify-web.mjs` — wizard E2E: library + story + steps 1–6 (character card, extraction, dossier edit, step-4 seed, storylines, sections, Stale badge) + step 8 (paste 40 scenes, merge re-import) + Scenes tab (reorder, reassign, editor round-trip) + slice 5 (step 9, dashboard, trash, undo, drag) + slice 6 (World taxonomy, entry + kind-template fields, `@`-mentions, delete → undo) + slice 7 (backlinks, possible mention → Link, search sheet, checks screen, §5.1 budgets on the wasm path) + axe scans (8) + pool no-leak assertion + persistence across reload/reopen (serves its own dev build)
- `node scripts/verify-pwa.mjs` — service-worker + offline reopen keeping the plan (serves its own preview build)
- `node scripts/check-contrast.mjs` — WCAG pin for the star-library palette (accent-is-decoration rule)
- `node scripts/check-no-network.mjs` — offline-complete invariant (no network primitives in apps/*/src or packages/*/src)
- `pnpm check:bundle` — gzip budgets (spec §5.1: app 330 KiB, css 8, worker 72, payload 4 MiB; fails beyond +5 %)
- `node scripts/verify-android.mjs` — scripted emulator QA: fresh APK install → wizard steps 1–4 (character card, step-4 seed, rich-text editors) → step-8 paste import → Scenes tab + scene-sheet round-trip → slice 5 on-device (step 9, dashboard + snapshot, trash, undo, drag) → slice 6 on-device (World, kind template, `@`-mention, delete → undo) → slice 7 on-device (backlinks, possible mention → Link, search sheet, checks, budgets on the emulator wasm path) → back-button/minimise → cold relaunch (booted emulator required)
- `node scripts/cargo.mjs build` — native storage crate
