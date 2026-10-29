# Architecture — StarLine

Phone-first PWA over a single-file SQLite library. Product spec: `docs/SPECIFICATION.md`; owner
decisions: `docs/DECISIONS.md`; visual identity: `docs/DESIGN.md`.

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

A library is a SQLite file in the origin’s OPFS pool (`starline-sahpool`, initial capacity 16,
reserved on demand — one slot per file SQLite creates, journals and WAL included). One
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
- `pnpm test` — the same contract suite on both drivers + core domain unit tests (**356**, incl.
  trash/undo, lore, search/backlink/perf, relationships, tags/fields/grid, timeline,
  snapshots/restore, interchange, writing mode, notes/attachments and the migration property
  tests, on rusqlite and on the wasm driver)
- `pnpm chaos` — kill-9 chaos harness (durability of acknowledged writes, native driver)
- `pnpm chaos:web` — web crash harness (random writes killed mid-flight + reopen assertions: crash banner, integrity, FK sanity)
- `node scripts/verify-web.mjs` — the whole journey: library + story → wizard steps 1-9 (validators,
  extraction, staleness) → the outliner (list, corkboard, grid, bulk edits) → World + relationships
  (taxonomy, kind templates, `@`-mentions, backlinks, matrix, graph pinning) → backups (preview,
  restore, single entity) → export/import round-trip → writing mode → notes and attachments →
  settings, palette, tour; **37 axe scans** (both locales), the pool no-leak assertion and
  persistence across reload/reopen (serves its own dev build)
- `node scripts/verify-pwa.mjs` — service-worker + offline reopen keeping the plan (serves its own preview build)
- `node scripts/check-contrast.mjs` — WCAG pin for the star-library palette (accent-is-decoration rule)
- `node scripts/check-no-network.mjs` — offline-complete invariant (no network primitives in apps/*/src or packages/*/src)
- `pnpm check:bundle` — gzip budgets (spec §5.1: app 330 KiB, css **11** (decision 27), worker 72,
  export worker 40, payload 4 MiB, per-route chunk 150 KiB; fails beyond +5 %)
- `node scripts/verify-android.mjs` — scripted device QA (**53 checks**) over the WebView devtools
  socket: the full journey on the APK — wizard, scenes, World, relationships, grid, timeline,
  backups + restore drill, export to the app-scoped folder + share sheet, writing mode, notes and
  attachments, hardware back, cold relaunch and the S21-S37 smoke. Runs on the emulator **and on a
  real phone** (Redmi 14C, Android 16 — see the MIUI note in `docs/ANDROID-RELEASE.md`)
- `node scripts/cargo.mjs build` — native storage crate
