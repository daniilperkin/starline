# AGENTS.md — working in this repository

StarLine is an offline-by-default novel-planning and writing app. A writer goes from one sentence
to a scene-by-scene outline with Randy Ingermanson's nine-step Snowflake method, then keeps
characters, relationships, lore, timeline and notes cross-linked while drafting. Everything lives
in a single user-owned SQLite file (`*.starline`). The interface is a phone app: an installable
PWA, wrapped as a sideloadable Android APK.

## The truth lives here, in this order

1. `docs/SPECIFICATION.md` — the implementation-ready spec (v1.0.0). `[Decision]` items are binding.
2. `docs/DECISIONS.md` — every owner decision and audit resolution, numbered, with rationale. **Owner
   overrides beat the spec.**
3. `docs/PLAN.md` — the slice-by-slice build plan and the record of what each shipped slice
   actually measured.

If code and documents disagree, the documents win and the code is the bug — except where a
decision explicitly overrides the spec, in which case the decision wins.

## Layout

- `packages/core` — domain logic: schema, migrations, commands, the change bus, i18n catalogues,
  interchange (JSON / Markdown folder / DOCX / CSV), snapshots, search, notes, attachments.
- `packages/driver-rusqlite` — the native driver (a stdio NDJSON CLI used by the Rust side and
  the tests) · `packages/driver-wasm` — the sqlite-wasm OPFS driver (the web app) · one contract
  suite runs against both.
- `apps/web` — the PWA (React 19 + Vite + Tailwind 4 + TanStack). `apps/web/android` — the
  Capacitor wrap. `apps/web/src-tauri` — the Tauri shell (later native path).
- `scripts/` — every gate: `verify-web`, `verify-pwa`, `verify-android`, `check-a11y`,
  `check-bundle`, `check-contrast`, `check-no-network`, `chaos/`, plus `cargo.mjs` (Rust builds)
  and `launch-emulator.mjs`.
- `docs/` — SPECIFICATION, DECISIONS, DESIGN, ARCHITECTURE, ACCESSIBILITY, ANDROID-RELEASE,
  CLOUD-BACKUP, CLOUD-SETUP, HOSTING, FABULA-PARITY, PLAN, SPEC-GAP-AUDIT.

## Commands

```bash
pnpm ci:gates        # the whole local suite, the same sequence CI runs
pnpm typecheck       # tsc -b  (emits into apps/web/dist-types, never into dist/)
pnpm lint            # biome check .
pnpm test            # vitest: node project (contract + domain) and browser project
pnpm chaos           # kill-9 durability, native driver
pnpm chaos:web       # crash harness through the wasm driver
pnpm check:bundle    # spec §5.1 gzip budgets
pnpm check:a11y      # WCAG 2.2 AA audit harness (55 scripted checks)
node scripts/verify-web.mjs      # the full web journey, axe scans included
node scripts/verify-pwa.mjs      # service worker + offline reopen
node scripts/verify-android.mjs  # emulator QA against the debug APK (local only)
```

`pnpm --filter @starline/web dev` runs the app; the E2E scripts start their own servers on fixed
ports.

## Conventions

- **Offline-complete is a hard invariant.** No network primitives in app source — enforced by
  `scripts/check-no-network.mjs`. Do not add a fetch, a CDN link, a web font, or a telemetry call
  without an owner decision; the optional cloud backup (decision 18) is the single, explicitly
  gated exception and is off by default.
- **Every user-facing string lives in the catalogue** (`packages/core/src/i18n/en.ts` + `uk.ts`)
  and is read through the live `messages` proxy. Never hardcode text in a component — the
  catalogue shape test fails if the two locales drift apart.
- **Bundle budgets are gates**, not targets: app 330 KiB gz, CSS **11 KiB** gz (decision 27), storage worker 72 KiB, export worker 40 KiB, install payload
  4 MiB, per-route lazy chunk 150 KiB.
- **Stage specific files, never `git add -A`.** Commit messages are plain-English imperatives
  with the reasoning behind every decision, not a list of touched files.
- **Build artifacts are never committed**: `node_modules/`, `dist/`, `dist-types/`, `target/`,
  `artifacts/`, Gradle output, `local.properties`, `keystore.properties`.
- Licence: **MPL-2.0**.

## Gotchas that have cost real time

- `pnpm typecheck` (`tsc -b`) used to emit into `apps/web/dist`; since slice 17 it emits into
  `apps/web/dist-types`. Run `check:bundle` **after a clean `vite build`**, never after an APK
  (`STARLINE_CAP=1`) build — the service-worker precache manifest then describes assets that are
  no longer there and the payload budget looks inflated.
- `apps/web/node_modules/.vite` caches pre-bundled deps. After touching `packages/core`'s entry,
  delete it before a cold E2E run; on a cold cache vite also **reloads the page mid-session**,
  which is why `check-a11y` retries its library-creation step.
- The sqlite-wasm OPFS pool is slot-based: `open` needs 4 slots, `snapshot` 2, an imported DB 4;
  `unlink` takes an absolute name; the pool's file map is keyed by **percent-encoded** names
  (`resolvePoolName`); `ensureInit` must stay single-flight. The only supported byte ingress is
  `pool.importDb(name, bytes)`.
- On Android the writable, permission-free folder is the app-scoped external files dir
  (`Android/data/app.starline/files/<folder>`) — `/sdcard/Documents` fails with `EACCES` on
  Android 11+. The share sheet needs `<external-files-path>` in `file_paths.xml`.
- The emulator is launched through `node scripts/launch-emulator.mjs [avd] [--app]` — never a bare
  `emulator.exe`; it docks bottom-right and remembers its position.
- Playwright resolves file-input paths on the **host**, not on the device: push test files through
  an in-page `DataTransfer` into the real input instead of `setInputFiles` when driving the APK.
- In Hermes/git-bash background shells, `node` is an alias that dies without a TTY — call
  `env node …` (or an absolute path) after putting the project Node on `PATH`.

## Shipping a slice

1. Make the change; keep the catalogue, the budgets and the docs in step.
2. Run `pnpm ci:gates` (plus `verify-android` when the change touches anything on-device).
3. Commit with the rationale; push; watch the CI run.
4. Add the marker commit that records the shipped revision and the measured numbers in
   `docs/PLAN.md` — the plan is the history, so keep it true.
