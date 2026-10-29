# StarLine — Technical & Product Specification

> **Product name:** StarLine (a local-first Snowflake-method novel planner and writer workstation; renamed 2026-10-07 from working title "Plotflake")
> **Spec version:** 1.0.0 · **Date:** 2026-10-07 · **Status:** implemented — M0-M5 shipped (slices 1-38); see `docs/PLAN.md` for what each measured
> **Scope:** Functional clone of the *concept set* of "Fabula. Romanplaner / Story Planner" (Fabula Apps, `com.fabula.app`) plus the local-first, desktop-first, open-format features Fabula lacks. No Fabula code, assets, copy or branding are reused.

---

## 0. How to Read This Document

| Label | Meaning |
|---|---|
| **[Verified]** | Stated in a public source (store listing, review, press) — see Appendix A |
| **[Inferred]** | Not publicly documented; derived from the Snowflake method, from competitor behaviour, or from reviewer descriptions. Treated as a design decision, not a fact about Fabula |
| **[Decision]** | A choice made by this spec; implementers should treat it as binding |

**Research limits (read first).** Fabula is closed source. Its Play/App Store listings, third-party reviews and user reviews describe *what* it does, not its data model, so every schema in §3 is **[Inferred/Decision]**. The Google Play page could be fetched only as search snippets; screenshots were not inspectable. Where the sources disagree (e.g. rating 3.4 vs 3.6★; "500K+" vs "1M+" installs; 5-day vs 7-day trial) the spec does not depend on the number.

---

## 1. Executive Summary & Product Vision

### 1.1 Core value proposition

StarLine is a **desktop-first, offline-only-by-default story planning workstation** that walks a writer from a single sentence to a scene-by-scene outline using Randy Ingermanson's 9-step Snowflake Method, then keeps characters, relationships, lore and notes cross-linked while the draft is written. A project is **one file the user owns** (`*.starline`, a SQLite database) that can be opened by any SQLite tool, backed up by copying, and exported losslessly to Markdown/JSON.

> **One-line pitch:** *Fabula's guided planning flow, on your desktop, in a file you own.*

### 1.2 What Fabula is (research summary)

- **[Verified]** Mobile-first story planner (Android/iOS, also on iPad; Chromebook works via Android). Publisher: Fabula Apps / Natalia Bosyakova. Free tier + "Fabula Pro" subscription (store prices seen: $4.99/mo, $39.99/yr on iOS US; 5–7 day trial).
- **[Verified]** Built explicitly on the **Snowflake Method** ("nine simple steps"), usable for novels, short stories, fairy tales, fanfiction.
- **[Verified]** Modules: characters (profiles, gallery, interactive **relationship diagram**), scenes/chapters ("plan your story scene by scene"), worldbuilding (magic systems, religions, cultures, economies, politics, geography, history), notes/research, book structure, timeline, a 10-step in-app onboarding guide, new book *or series* creation, an AI-style "writing assistance" for brainstorming.
- **[Verified]** Account-based cloud sync across devices; some offline use; no web/desktop client; limited export.

### 1.3 Target audience

| Persona | Need | StarLine answer |
|---|---|---|
| **Planner-novelist** (primary) | Structured plotting before drafting; wants to see holes | Snowflake wizard with validations and coverage views |
| **Series / worldbuilder** | Persistent bible across books | Series container, shared lore & characters across projects (v1.1; schema-ready in v1.0) |
| **Neurodivergent / low-executive-function writer** (quoted in Play reviews as the app's core win) | Small, auto-saved pieces instead of one giant document | Each step/entity is its own atomic, autosaved record |
| **Privacy-conscious / offline writer** | No account, no telemetry | No network code path in the default build; the optional cloud backup is an explicitly enabled module that is off by default (decision 23d) |
| **Scrivener / Plottr migrator** | Keep drafting elsewhere | Lossless Markdown/DOCX/JSON export |

### 1.4 Competitive differentiation

| Capability | Fabula | Scrivener | Plottr | **StarLine** |
|---|---|---|---|---|
| Guided Snowflake wizard | Yes | No | Template-only | **Yes, with per-step validation + auto-extraction of characters/scenes** |
| Desktop / large-screen UX | No (mobile only) | Yes | Yes | **Yes (Win/macOS/Linux), keyboard-first** |
| Account required | Yes (sync, login) | No | Yes (license) | **No** |
| User-owned file format | No | Proprietary bundle | Proprietary | **Open SQLite + folder/Markdown export** |
| Data-loss reports | Yes (see §A.3) | Rare | Rare, historic | **Pre-migration snapshots, rolling backups, integrity check on open** |
| Relationship graph | Limited connections, hard to group | No | Basic | **Typed, directed, evolving over scenes, grouped** |
| Cross-reference `@mentions` + backlinks | No (inferred) | Limited | Tags | **First-class, bidirectional, indexed** |
| Export | Limited | Strong | Strong | **MD, JSON, HTML, DOCX, plain text, CSV** |
| Price model | Subscription paywall (complaints) | One-time | One-time/sub | **Free core; no feature held hostage; optional one-time license** |

---

## 2. Technology Stack & Architectural Decision Record (ADR)

### 2.1 Primary stack **[Decision]**

| Layer | Choice | Version floor |
|---|---|---|
| Language | **TypeScript** (strict, `noUncheckedIndexedAccess`) | 5.6 |
| UI framework | **React 19** + **TanStack Router** (file-based, type-safe) | React 19.0 |
| Styling | **Tailwind CSS v4** + **Radix UI** primitives (shadcn-style, owned components) + CSS variable design tokens | TW 4.0 |
| Rich text | **TipTap 3** (ProseMirror) with custom `mention` + `snowflakeSentence` nodes | 3.x |
| Persistence | **SQLite** (single file) — **native `rusqlite` in the desktop shell**, **`@sqlite.org/sqlite-wasm` (OPFS `opfs-sahpool` VFS) in the web build**, both behind one `StorageDriver` interface | SQLite ≥ 3.45 (FTS5, JSONB, STRICT) |
| Query layer | **Kysely** (type-safe SQL builder) + hand-written SQL migrations | 0.27 |
| Runtime validation | **Zod** at import/export boundaries and for JSON columns | 3.x |
| Server/async state | **TanStack Query** keyed by entity + invalidated by a DB change bus | v5 |
| UI/ephemeral state | **Zustand** (selection, panels, command palette, drag state) | v5 |
| Graph view | **@xyflow/react** + `d3-force` layout (computed in a Web Worker) | 12 |
| Drag & drop | **dnd-kit** (+ `fractional-indexing` for order keys) | 6 |
| Virtualization | **TanStack Virtual** | v3 |
| Full-text search | **SQLite FTS5** (`unicode61 remove_diacritics 2` + `trigram` tables) | — |
| Desktop wrapper | **Tauri 2** (Rust core, system WebView) | 2.x |
| Web target | Same React bundle as an installable **PWA** (secondary target) | — |
| Bundler | **Vite 6** (+ `vite-plugin-pwa`) | 6.x |
| Tests | **Vitest**, **Playwright** (web + Tauri driver), **fast-check** (property tests for ordering/migrations) | — |
| Lint/format | **Biome** | 1.9 |

### 2.2 Selection rationale and trade-offs

#### 2.2.1 Persistence: SQLite vs IndexedDB/Dexie vs PGlite vs JSON files

| Criterion (weight) | SQLite file | IndexedDB + Dexie | PGlite | Folder of JSON/MD files |
|---|---|---|---|---|
| Relational integrity: FKs, cascades, CHECKs (**high**) | **Native, enforced** | None; hand-rolled | Native (Postgres) | None |
| User-owned, portable file (**high**) | **Yes: one file, readable by any SQLite tool** | No: lives in browser profile | Dump-only | **Yes** |
| Cross-reference queries (backlinks, "scenes where X appears") (**high**) | **Joins + indexes** | Manual multi-store scans | Joins | Needs custom index |
| Full-text search (**high**) | **FTS5 built in** | Needs MiniSearch/FlexSearch in memory | `tsvector` | Needs custom index |
| Crash safety (**high**) | **ACID, WAL, `integrity_check`** | Browser-managed, eviction risk | ACID | Partial writes, no transactions |
| Footprint | ~1 MB wasm / 0 MB native | 0 | **~3–6 MB wasm, higher RAM** | 0 |
| Sync-folder friendliness (Dropbox/Syncthing) | Medium (mitigated, §5.4) | Poor | Poor | **Best** |
| Ecosystem/longevity | **Library of Congress–recommended archival format** | Browser-vendor dependent | Young | Evergreen |

**Verdict:** SQLite wins on integrity + portability + FTS in one dependency. IndexedDB is rejected because Fabula's documented failure mode — data disappearing after updates/logouts (Play/Chrome-Stats reviews) — is exactly what browser-managed storage invites. PGlite is rejected for footprint and because Postgres features add nothing a single-writer local app needs. Folder-of-files is kept as an **export/interchange format** and a possible v1.2 "folder mode" for sync-heavy users, but not the primary store because it cannot provide atomic multi-entity transactions (e.g. "delete character + clean mentions + renumber scenes").

**Cost accepted:** two driver implementations (native + wasm). Mitigation: the interface is five methods (§2.3.2), the SQL and migrations are identical, and the same contract-test suite runs against both.

#### 2.2.2 Shell: Tauri 2 vs Electron vs pure PWA

| Criterion | Tauri 2 | Electron | PWA only |
|---|---|---|---|
| Installer size | **~8–15 MB** | ~90–150 MB | 0 |
| Idle RAM | **~60–120 MB** | ~200–400 MB | browser tab |
| Native file open/save dialogs, file association `.starline` | **Yes** | Yes | Chromium-only File System Access API |
| Native SQLite with real file handle (WAL, `VACUUM INTO`, backup API) | **Yes (Rust)** | Yes (better-sqlite3) | OPFS only; user file via export |
| Consistent rendering engine | No (WebView2 / WKWebView / WebKitGTK) | **Yes (Chromium)** | Browser-dependent |
| Language surface | TS + ~400 lines Rust | TS only | TS only |

**Verdict:** Tauri 2. The size/RAM gap supports the "snappy, distraction-free" requirement; Rust is confined to a thin storage/FS/backup layer. **Known risk:** WebKitGTK on Linux has weaker scrolling/GPU behaviour than Chromium. Mitigation: all animation is `transform`/`opacity` only; a Playwright perf gate runs on Ubuntu CI; if the gate fails twice in a release cycle, the contingency is to ship the *unchanged* React bundle in Electron (the `StorageDriver` abstraction makes this a ~1-day swap using `better-sqlite3`). The PWA build is retained as the zero-install demo and mobile-browser fallback, not the primary target.

#### 2.2.3 UI framework: React vs Svelte/Solid

Svelte 5 and Solid beat React on raw runtime size and update granularity. **React is chosen anyway** because the three hardest UI components — the ProseMirror editor (TipTap), the node-graph canvas (React Flow/xyflow) and the accessible drag-and-drop kanban (dnd-kit) — have first-class, battle-tested React bindings, and re-implementing any of them would cost more than the framework delta saves. The 16 ms interaction budget is met by (a) virtualizing all lists > 100 rows, (b) fine-grained Zustand selectors, (c) `useDeferredValue` for search, (d) keeping the graph layout in a worker.

#### 2.2.4 State management: why Zustand + TanStack Query and not a global store

The database is the source of truth. Duplicating it in Redux/Zustand creates the "two copies drift" bug class. So: **reads** are TanStack Query hooks over SQL (`useCharacter(id)`, `useScenesByChapter(id)`); **writes** are commands that run in a transaction and then publish a `ChangeEvent` which invalidates the affected query keys; **Zustand** holds only ephemeral UI state that is never persisted to the project file.

#### 2.2.5 Styling: Tailwind v4 + Radix

Zero runtime CSS cost, design tokens as CSS variables (light/dark/sepia/high-contrast themes without re-render), accessible primitives (dialogs, menus, tabs, popovers, command palette via `cmdk`) without owning a11y logic. Rejected: CSS-in-JS (runtime cost), MUI/Chakra (heavy, opinionated look conflicts with distraction-free typography).

### 2.3 Architecture pattern

#### 2.3.1 Layered data flow

```
┌────────────────────────────── WebView (React 19) ──────────────────────────────┐
│  Views (Wizard · Characters · Graph · Outliner · Wiki · Notes · Export)         │
│        │ hooks                              ▲ invalidate(keys)                  │
│        ▼                                    │                                   │
│  Query hooks (TanStack Query) ◄──── ChangeBus (pub/sub, in-process)             │
│        │ read                               ▲ publish(ChangeEvent[])            │
│        ▼                                    │                                   │
│  Repositories (typed Kysely) ──► Commands (transactional write use-cases)       │
│        │                                    │                                   │
│        └──────────────► StorageDriver (interface) ◄───────────────┘             │
└──────────────────────────────┬────────────────────────────────────────────────┘
          Tauri `invoke` (JSON) │                      postMessage (Worker)
                 ┌──────────────▼───────────┐        ┌─────────────▼───────────┐
                 │ Rust: rusqlite, FS, dialogs│        │ sqlite-wasm in Worker   │
                 │ backup, file lock, watcher │        │ OPFS opfs-sahpool VFS   │
                 └──────────────┬───────────┘        └─────────────┬───────────┘
                                ▼                                   ▼
                      `MyNovel.starline` (SQLite)      OPFS DB + import/export file
```

#### 2.3.2 `StorageDriver` contract **[Decision]**

```ts
export interface StorageDriver {
  open(opts: { path: string | null; create: boolean; readOnly: boolean }): Promise<OpenResult>;
  close(): Promise<void>;
  /** Run a parameterised statement; returns rows as plain objects. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Run multiple statements atomically (BEGIN IMMEDIATE … COMMIT). Rolls back on throw. */
  transaction<R>(fn: (tx: TxHandle) => Promise<R>): Promise<R>;
  /** Consistent online snapshot (`VACUUM INTO` / SQLite backup API). */
  snapshot(destPath: string): Promise<SnapshotInfo>;
  integrityCheck(): Promise<{ ok: boolean; messages: string[] }>;
  onExternalChange(cb: (info: { mtimeMs: number }) => void): Unsubscribe;
}
export type SqlValue = string | number | bigint | Uint8Array | null;
export interface OpenResult { schemaVersion: number; applicationId: number; revision: number; lockedByOther: boolean; }
```

Performance rule: the renderer never issues N+1 queries. A screen loads through **one or two** composite queries (e.g. outliner = one query returning chapters, scenes, POV names, tag ids, plotline ids via JSON aggregation).

#### 2.3.3 Offline persistence lifecycle

1. **Open:** acquire advisory lock (`<file>.starline.lock`, PID + host + timestamp; stale after 60 s without heartbeat). `PRAGMA integrity_check(1)`. Compare `user_version` to the app's `LATEST_SCHEMA`: if lower → snapshot `pre-migration-vN.starline` then migrate in one transaction; if higher → open **read-only** with a "created by a newer version" banner.
2. **Edit:** every user action is a `Command` → one SQLite transaction. Text editors autosave **debounced 400 ms** and on blur/navigation/window-close. A "Saved · 14:02:11" indicator is bound to the last committed transaction, never to a timer.
3. **Change bus:** after commit, the repository publishes `ChangeEvent { table, op, id, parentIds }`. Query hooks map events to query keys.
4. **Undo/redo:** an in-memory per-session stack of **inverse commands** (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z) for structural edits (move scene, delete character, merge notes). Text edits use TipTap's own history. Deleting any entity first moves it to a **trash** (soft delete, 30 days) so a crash cannot make deletion permanent.
5. **Backups:** rolling snapshots (§4.5.3). Snapshot happens *before* destructive batch operations (bulk delete, import, merge, migration).
6. **Close:** flush debounced writes → `PRAGMA wal_checkpoint(TRUNCATE)` → release lock.
7. **Crash:** next open detects stale lock and a WAL file; SQLite recovers automatically; the app shows "Recovered from unexpected shutdown — last change 14:02:11" and offers the latest snapshot diff.

#### 2.3.4 Repository layout

```
/apps
  /desktop           Tauri shell (src-tauri/: main.rs, storage.rs, backup.rs, lock.rs)
  /web               PWA entry (vite-plugin-pwa)
/packages
  /core              domain types, Zod schemas, commands, validators (no DOM, no IO)
  /db                migrations/*.sql, Kysely types, repositories, StorageDriver interface
  /driver-tauri      invoke-based StorageDriver
  /driver-wasm       sqlite-wasm worker StorageDriver
  /ui                design system, Radix wrappers, editor extensions
  /features          snowflake/ characters/ graph/ outliner/ wiki/ notes/ export/
  /export            md/json/html/docx/csv writers + importers (pure, worker-safe)
```

`core` and `db` have **zero** React/DOM imports so they run in Vitest, a CLI (`starline export --format md`) and workers.

---

## 3. Domain Model & Relational Schema

### 3.1 Conventions **[Decision]**

- **IDs:** UUIDv7 as lowercase hyphenated `TEXT` (time-ordered → good B-tree locality). Branded type `UUID`.
- **Timestamps:** `INTEGER` Unix epoch **milliseconds** (`EpochMs`), UTC. Columns `created_at`, `updated_at`; `deleted_at` is `NULL` unless in trash.
- **Ordering:** `order_key TEXT` using **fractional indexing** (base-62 keys, `fractional-indexing` library). Reordering touches one row, never renumbers. Displayed numbers ("Scene 14") are derived by `ROW_NUMBER()`.
- **Rich text:** stored as TipTap/ProseMirror JSON (`*_json`) **plus** a denormalised plain-text copy (`*_text`) used by FTS and word counts. Mentions inside rich text are encoded as `mention` nodes (`attrs: { entityType, entityId, label }`) and mirrored into the `mention` table on every save.
- **Enums:** `TEXT` with `CHECK (col IN (...))`; TypeScript string-literal unions.
- **SQLite settings:** `PRAGMA foreign_keys=ON; journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000; application_id=0x5354524C ('STRL'); user_version=<schema version>`; all tables `STRICT`.

### 3.2 Shared TypeScript primitives

```ts
export type UUID = string & { readonly __brand: "UUID" };
export type EpochMs = number;
export type OrderKey = string;            // fractional-indexing key
export type HexColor = `#${string}`;      // "#RRGGBB"
export type IsoDate = string;             // "YYYY-MM-DD" for real-world dates only

export interface PMMark { type: string; attrs?: Record<string, string | number | boolean | null>; }
export interface PMNode {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}
export interface PMDoc { type: "doc"; content: PMNode[]; }

/** Rich text value as stored in a row (two columns: `<name>_json`, `<name>_text`). */
export interface RichText {
  json: PMDoc | null;
  text: string;       // plain-text projection, '' when empty
  wordCount: number;  // Unicode-aware word count of `text`
}

export type EntityType =
  | "character" | "scene" | "chapter" | "part" | "lore" | "note"
  | "plotline" | "location" | "timeline_event" | "project";

export interface EntityRef { type: EntityType; id: UUID; }

export interface Timestamps { createdAt: EpochMs; updatedAt: EpochMs; deletedAt: EpochMs | null; }
```

### 3.3 `Project` / `Series` / settings

```ts
export type StoryForm = "novel" | "novella" | "short_story" | "fairy_tale" | "fanfiction" | "screenplay_treatment";
export type PlanningMethod = "snowflake" | "freeform";   // Fabula's "choose your story method"

export interface Series extends Timestamps {
  id: UUID;
  title: string;
  description: RichText;
  orderKey: OrderKey;
}

export interface Project extends Timestamps {
  id: UUID;
  seriesId: UUID | null;          // FK series.id ON DELETE SET NULL
  seriesOrderKey: OrderKey | null;
  title: string;                  // 1..200 chars
  subtitle: string;
  authorName: string;
  form: StoryForm;
  method: PlanningMethod;
  genres: string[];               // JSON array, each 1..40 chars, max 8
  logline: string;                // mirror of Snowflake step 1 sentence (see §3.4); denormalised for dashboards
  description: RichText;
  targetWordCount: number | null; // 0..10_000_000
  deadline: IsoDate | null;
  coverAttachmentId: UUID | null; // FK attachment.id ON DELETE SET NULL
  archived: boolean;
  settings: ProjectSettings;      // JSON column, validated by Zod
}

export interface ProjectSettings {
  schemaVersion: 1;
  language: string;               // BCP-47, e.g. "en", "de"
  wordsPerPageEstimate: number;   // default 300
  defaultSceneTargetWords: number;// default 1500
  povLabel: "POV" | "Viewpoint" | "Narrator";
  statusPalette: Record<SceneStatus, HexColor>;
  timelineCalendar: TimelineCalendar;
  enabledModules: Array<"snowflake" | "characters" | "graph" | "outliner" | "timeline" | "wiki" | "notes">;
}

export interface TimelineCalendar {
  kind: "gregorian" | "custom";
  eraLabel: string;                         // "AD", "Third Age", …
  monthNames: string[] | null;              // custom calendar only; length 1..24
  daysPerMonth: number[] | null;            // same length as monthNames
  hoursPerDay: number;                      // 24 for Earth
}
```

```sql
CREATE TABLE project (
  id TEXT PRIMARY KEY, series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
  series_order_key TEXT, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  subtitle TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL CHECK (form IN ('novel','novella','short_story','fairy_tale','fanfiction','screenplay_treatment')),
  method TEXT NOT NULL CHECK (method IN ('snowflake','freeform')),
  genres TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genres)),
  logline TEXT NOT NULL DEFAULT '',
  description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  target_word_count INTEGER CHECK (target_word_count IS NULL OR target_word_count BETWEEN 0 AND 10000000),
  deadline TEXT, cover_attachment_id TEXT REFERENCES attachment(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  settings TEXT NOT NULL CHECK (json_valid(settings)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
```

**File-scope rule [Decision]:** one `.starline` file = one `project` row (single-project files keep backups, sharing and "open this book" trivial). `series` rows exist for v1.1 multi-book bibles; in v1.0 `series_id` is always `NULL` and shared lore is achieved by *export/import of lore packs*.

### 3.4 `SnowflakeStep` — Steps 1–9 state machine and validation

The Snowflake Method **[Verified: Ingermanson; Fabula implements it as "nine steps"]**:

| # | Method artefact | StarLine storage |
|---|---|---|
| 1 | One-sentence summary (≈ 15–25 words, no character names, big-picture) | `SnowflakeStep1` |
| 2 | One-paragraph summary: setup, **three disasters**, ending (≈ 5 sentences) | `SnowflakeStep2` |
| 3 | One-page per major character: name, motivation (ambition), goal, conflict, epiphany, 1-sentence and 1-paragraph storyline | creates/updates `Character` rows; `SnowflakeStep3` holds the checklist |
| 4 | Expand each sentence of step 2 into a paragraph → one-page synopsis | `SnowflakeStep4` (5 paragraphs, each linked to its step-2 sentence) |
| 5 | Character descriptions: one page per major, half page per minor, each from the character's POV | `Character.storyline` rich text |
| 6 | Expand step-4 paragraphs into a four-page synopsis | `SnowflakeStep6` |
| 7 | Character charts: detailed bible per character | `Character` dossier fields + custom fields |
| 8 | Scene list (spreadsheet: POV, one-line description, estimated length) | creates `Scene` rows |
| 9 | Scene narratives: multi-paragraph description per scene (optional) | `Scene.synopsis` / `Scene.beats` |

```ts
export type SnowflakeStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type StepStatus = "not_started" | "in_progress" | "complete";
export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  code: string;               // stable id, e.g. "S1_TOO_LONG"
  severity: Severity;         // "error" blocks completion; "warning" can be overridden
  message: string;            // user-facing, i18n key resolved by UI
  field?: string;             // JSON pointer within the step content
}

export interface SnowflakeStepBase<N extends SnowflakeStepNumber, C> {
  id: UUID;
  projectId: UUID;            // FK project.id ON DELETE CASCADE; UNIQUE(projectId, step)
  step: N;
  status: StepStatus;
  content: C;                 // JSON column, validated by Zod schema per step
  completedAt: EpochMs | null;
  overrides: string[];        // ValidationIssue.code values the user chose to ignore
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** Step 1 */
export interface Step1Content {
  sentence: string;           // plain text
  alternatives: Array<{ id: UUID; text: string; createdAt: EpochMs }>; // brainstorm drafts, max 20
}

/** Step 2: the classic 5-sentence "three-disaster" structure */
export interface Step2Content {
  setup: string;
  disaster1: string;
  disaster2: string;
  disaster3: string;
  ending: string;
}

/** Step 3: tracks which characters have been summarised */
export interface Step3Content {
  majorCharacterIds: UUID[];  // each must exist in `character` and have role in ('protagonist','antagonist','major')
  skipped: boolean;           // true for stories with a single viewpoint where the user opts out
}

/** Step 4: five paragraphs, each expanding one Step 2 sentence */
export interface Step4Content {
  paragraphs: Array<{
    sourceKey: "setup" | "disaster1" | "disaster2" | "disaster3" | "ending";
    text: RichText;
  }>;                         // exactly 5, in that order
}

/** Step 5 */
export interface Step5Content { reviewedCharacterIds: UUID[]; }

/** Step 6: four-page synopsis = 4 sections (one per ¼ of Step 4), free-form length each */
export interface Step6Content {
  sections: Array<{ sourceKey: Step4Content["paragraphs"][number]["sourceKey"]; text: RichText }>;
}

/** Step 7 */
export interface Step7Content { completedCharacterIds: UUID[]; }

/** Step 8: bookkeeping for the extraction trigger */
export interface Step8Content {
  generatedSceneIds: UUID[];  // scenes created via the "Create scenes from list" trigger
  lastImportedAt: EpochMs | null;
}

/** Step 9 */
export interface Step9Content { expandedSceneIds: UUID[]; skipped: boolean; }

export type SnowflakeStep =
  | SnowflakeStepBase<1, Step1Content> | SnowflakeStepBase<2, Step2Content>
  | SnowflakeStepBase<3, Step3Content> | SnowflakeStepBase<4, Step4Content>
  | SnowflakeStepBase<5, Step5Content> | SnowflakeStepBase<6, Step6Content>
  | SnowflakeStepBase<7, Step7Content> | SnowflakeStepBase<8, Step8Content>
  | SnowflakeStepBase<9, Step9Content>;
```

```sql
CREATE TABLE snowflake_step (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  step INTEGER NOT NULL CHECK (step BETWEEN 1 AND 9),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  completed_at INTEGER, overrides TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(overrides)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (project_id, step),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL))
) STRICT;
```

#### 3.4.1 State machine

```
            edit content                    all errors cleared + user clicks "Mark complete"
not_started ───────────────► in_progress ────────────────────────────────────────────► complete
     ▲                           ▲  │                                                       │
     │ clear all content         │  └── content changes make an error appear ◄──────────────┤ (auto-demote
     └───────────────────────────┴───────────────────────────────────────────────────────────┘  to in_progress)
```

**Guard rules [Decision]:**
- **Soft gating, not hard locking.** Step *N* is *recommended* only when steps 1…N-1 are `complete`; the UI shows a "Steps 1–3 incomplete — continue anyway?" confirmation once per session per step. Reason: real writers jump around; Fabula's reviewers praise small pieces, not rigidity.
- **Staleness propagation:** editing an upstream step after a downstream step is `complete` marks downstream steps with a `stale` badge (computed, not stored): step 4 is stale if its source Step-2 sentence `updatedAt` > step 4 `updatedAt`; step 6 stale vs. step 4; step 8 stale if any step-6 section changed after the last scene extraction.
- **Completion requires zero `error` issues.** `warning`s never block.

#### 3.4.2 Validation rules (complete list)

| Code | Step | Severity | Rule |
|---|---|---|---|
| `S1_EMPTY` | 1 | error | `sentence.trim().length === 0` |
| `S1_TOO_LONG` | 1 | warning | > 25 words (advice: aim 15–25) |
| `S1_HAS_NAMES` | 1 | warning | contains a known `character.name`/alias (case-insensitive word match) — "describe roles, not names" |
| `S1_MULTI_SENTENCE` | 1 | warning | > 1 sentence terminator outside quotes |
| `S2_MISSING_PART` | 2 | error | any of the five fields empty |
| `S2_NOT_ONE_SENTENCE` | 2 | warning | any field contains > 2 sentences |
| `S2_ENDING_UNRESOLVED` | 2 | info | ending shares no noun with `setup` (heuristic prompt "does the ending answer the setup?") |
| `S3_NO_MAJOR` | 3 | error | `majorCharacterIds.length === 0` and `skipped === false` |
| `S3_FIELD_MISSING` | 3 | warning | a major character lacks `motivation`, `goal`, `conflict` or `epiphany` |
| `S3_NO_ANTAGONISTIC_FORCE` | 3 | info | no character with role `antagonist` and no lore entry of kind `antagonistic_force` |
| `S4_PARAGRAPH_EMPTY` | 4 | error | any of 5 paragraphs empty |
| `S4_DISASTER_ORDER` | 4 | info | paragraph 3 (`disaster2`) shorter than 40 % of the median of the others (prompt to raise stakes) |
| `S5_NOT_REVIEWED` | 5 | warning | a major character has empty `storyline` |
| `S6_SECTION_EMPTY` | 6 | error | fewer than 4 sections non-empty |
| `S7_BIBLE_THIN` | 7 | info | major character has < 8 filled dossier fields |
| `S8_NO_SCENES` | 8 | error | `scene` count = 0 |
| `S8_SCENE_NO_POV` | 8 | warning | a scene has `povCharacterId = NULL` |
| `S8_UNASSIGNED` | 8 | info | scenes with `chapterId = NULL` |
| `S9_SCENE_THIN` | 9 | info | scene `synopsis.wordCount < 40` |

Each validator is a pure function `(project snapshot) => ValidationIssue[]` in `packages/core/snowflake/validators.ts`, unit-tested with fixtures.

#### 3.4.3 Extraction triggers

| Trigger (button) | Step | Behaviour (all in one transaction, with undo) |
|---|---|---|
| **"Find characters in this text"** | 1–2, 4, 6 | Tokenises text, proposes capitalised multi-word names not already in `character` (user confirms each; max 20 proposals). Creates `Character` with `role='supporting'`; step 3 list updated |
| **"Create character summaries"** | 3 | Creates a stub `Character` per proposed protagonist/antagonist with the 6 Snowflake fields blank and focuses the first |
| **"Break step 2 into step 4 paragraphs"** | 4 | Creates 5 paragraphs pre-seeded with each step-2 sentence as the first line |
| **"Create scenes from list"** | 8 | Parses a pasted/typed list (one scene per line, `POV: description (≈1500)`) into `Scene` rows with `status='outlined'`; reports "12 created, 2 skipped (empty)" |
| **"Copy to scene synopsis"** | 9 | Appends step-8 line to `Scene.synopsis` as the first paragraph |

### 3.5 `Character` and `CharacterRelationship`

```ts
export type CharacterRole = "protagonist" | "antagonist" | "major" | "supporting" | "minor" | "mentioned";
export type ArcType = "positive_change" | "flat" | "negative_fall" | "negative_corruption" | "negative_disillusionment" | "none";

export interface Character extends Timestamps {
  id: UUID;
  projectId: UUID;                      // FK project.id ON DELETE CASCADE
  name: string;                         // 1..120
  aliases: string[];                    // ≤ 10, each 1..60; used for mention matching
  role: CharacterRole;
  color: HexColor;                      // graph + badge colour
  avatarAttachmentId: UUID | null;      // FK attachment.id ON DELETE SET NULL
  pronouns: string;                     // free text, ≤ 40
  age: string;                          // free text ("27", "ancient")
  birthStoryDate: number | null;        // sortable story-time ordinal (see TimelineEvent.storyTime)
  occupation: string;
  oneLine: string;                      // Snowflake step 3: one-sentence summary
  oneParagraph: RichText;               // Snowflake step 3: one-paragraph summary

  // --- Snowflake step 3 core quartet ---
  motivation: string;                   // ambition (abstract want)
  goal: string;                         // concrete story goal
  conflict: string;                     // what prevents the goal
  epiphany: string;                     // what the character learns/becomes

  // --- Psychology dossier (wants / needs / flaws / conflicts) ---
  want: string;                         // conscious external desire
  need: string;                         // unconscious internal requirement
  lie: string;                          // false belief the character holds
  truth: string;                        // truth that resolves the lie
  flaws: string[];                      // ≤ 12 short phrases
  strengths: string[];                  // ≤ 12
  fears: string[];                      // ≤ 12
  values: string[];                     // ≤ 12
  internalConflict: RichText;
  externalConflict: RichText;
  arcType: ArcType;
  ghost: RichText;                      // wound / formative backstory event
  voiceNotes: RichText;                 // speech patterns, tics, sample lines

  // --- Description & history ---
  appearance: RichText;
  backstory: RichText;
  storyline: RichText;                  // Snowflake step 5 (told from the character's POV)
  bible: RichText;                      // Snowflake step 7 free chart/notes

  orderKey: OrderKey;                   // manual list ordering
  pinned: boolean;
}

export type RelationshipKind =
  | "family_parent" | "family_child" | "family_sibling" | "family_spouse" | "family_other"
  | "romantic" | "friend" | "ally" | "rival" | "enemy" | "mentor" | "mentee"
  | "employer" | "employee" | "servant" | "master" | "acquaintance" | "custom";

export interface CharacterRelationship extends Timestamps {
  id: UUID;
  projectId: UUID;                      // FK project.id ON DELETE CASCADE
  sourceId: UUID;                       // FK character.id ON DELETE CASCADE
  targetId: UUID;                       // FK character.id ON DELETE CASCADE; CHECK(sourceId <> targetId)
  kind: RelationshipKind;
  customLabel: string;                  // required iff kind='custom', else ''
  directed: boolean;                    // false → symmetric (friend); true → source→target (mentor)
  sentiment: -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5;  // hostility ↔ affection
  notes: RichText;
  groupId: UUID | null;                 // FK relationship_group.id ON DELETE SET NULL
  startsAtSceneId: UUID | null;         // FK scene.id ON DELETE SET NULL — when relationship begins (story order)
  endsAtSceneId: UUID | null;           // FK scene.id ON DELETE SET NULL — when it ends/changes
  secret: boolean;                      // hidden from the reader until revealed (UI dashed edge)
}

export interface RelationshipGroup extends Timestamps {   // "House Stark", "The Crew"
  id: UUID; projectId: UUID; name: string; color: HexColor; memberIds?: never; orderKey: OrderKey;
}
```

```sql
CREATE TABLE character (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  aliases TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases)),
  role TEXT NOT NULL DEFAULT 'supporting' CHECK (role IN ('protagonist','antagonist','major','supporting','minor','mentioned')),
  color TEXT NOT NULL, avatar_attachment_id TEXT REFERENCES attachment(id) ON DELETE SET NULL,
  pronouns TEXT NOT NULL DEFAULT '', age TEXT NOT NULL DEFAULT '', birth_story_date REAL, occupation TEXT NOT NULL DEFAULT '',
  one_line TEXT NOT NULL DEFAULT '', one_paragraph_json TEXT, one_paragraph_text TEXT NOT NULL DEFAULT '',
  motivation TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '', conflict TEXT NOT NULL DEFAULT '', epiphany TEXT NOT NULL DEFAULT '',
  want TEXT NOT NULL DEFAULT '', need TEXT NOT NULL DEFAULT '', lie TEXT NOT NULL DEFAULT '', truth TEXT NOT NULL DEFAULT '',
  flaws TEXT NOT NULL DEFAULT '[]', strengths TEXT NOT NULL DEFAULT '[]', fears TEXT NOT NULL DEFAULT '[]', "values" TEXT NOT NULL DEFAULT '[]',
  internal_conflict_json TEXT, internal_conflict_text TEXT NOT NULL DEFAULT '',
  external_conflict_json TEXT, external_conflict_text TEXT NOT NULL DEFAULT '',
  arc_type TEXT NOT NULL DEFAULT 'none' CHECK (arc_type IN ('positive_change','flat','negative_fall','negative_corruption','negative_disillusionment','none')),
  ghost_json TEXT, ghost_text TEXT NOT NULL DEFAULT '', voice_notes_json TEXT, voice_notes_text TEXT NOT NULL DEFAULT '',
  appearance_json TEXT, appearance_text TEXT NOT NULL DEFAULT '', backstory_json TEXT, backstory_text TEXT NOT NULL DEFAULT '',
  storyline_json TEXT, storyline_text TEXT NOT NULL DEFAULT '', bible_json TEXT, bible_text TEXT NOT NULL DEFAULT '',
  order_key TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
CREATE INDEX idx_character_project_order ON character(project_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_character_project_role  ON character(project_id, role)      WHERE deleted_at IS NULL;

CREATE TABLE relationship_group (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, order_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;

CREATE TABLE character_relationship (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('family_parent','family_child','family_sibling','family_spouse','family_other','romantic','friend','ally','rival','enemy','mentor','mentee','employer','employee','servant','master','acquaintance','custom')),
  custom_label TEXT NOT NULL DEFAULT '', directed INTEGER NOT NULL DEFAULT 0 CHECK (directed IN (0,1)),
  sentiment INTEGER NOT NULL DEFAULT 0 CHECK (sentiment BETWEEN -5 AND 5),
  notes_json TEXT, notes_text TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES relationship_group(id) ON DELETE SET NULL,
  starts_at_scene_id TEXT REFERENCES scene(id) ON DELETE SET NULL,
  ends_at_scene_id   TEXT REFERENCES scene(id) ON DELETE SET NULL,
  secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0,1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (source_id <> target_id),
  CHECK ((kind = 'custom') = (length(custom_label) > 0))
) STRICT;
-- Prevent duplicate edges. Undirected edges are normalised so source_id < target_id before insert.
CREATE UNIQUE INDEX uq_rel_edge ON character_relationship(source_id, target_id, kind, custom_label) WHERE deleted_at IS NULL;
CREATE INDEX idx_rel_target ON character_relationship(target_id);
CREATE INDEX idx_rel_project ON character_relationship(project_id);
```

> **Improvement over Fabula (**[Verified]** complaint: "limited connections between characters, difficult to manage groups"):** unlimited typed edges per pair, `RelationshipGroup`, and edge lifetimes tied to scenes so the graph can be **filtered "as of Scene N"**.

#### 3.5.1 Custom attribute builder (user-defined fields)

```ts
export type CustomFieldType = "text" | "longtext" | "number" | "date" | "boolean" | "select" | "multiselect" | "url" | "color" | "entity_ref";
export type CustomFieldTarget = "character" | "lore" | "scene" | "location";

export interface CustomFieldDef extends Timestamps {
  id: UUID; projectId: UUID;
  target: CustomFieldTarget;
  loreKind: string | null;              // restricts to one lore template (e.g. "faction"); null = all
  label: string;                        // 1..60, unique per (project,target,loreKind)
  type: CustomFieldType;
  options: string[] | null;             // select/multiselect only, 1..50 items
  entityRefTarget: EntityType | null;   // entity_ref only
  required: boolean;
  orderKey: OrderKey;
  section: string;                      // visual grouping header, '' = default
}
export interface CustomFieldValue {
  id: UUID; defId: UUID;                // FK custom_field_def.id ON DELETE CASCADE
  ownerType: CustomFieldTarget; ownerId: UUID;  // polymorphic; cleaned by delete triggers (§3.12)
  value: string | number | boolean | string[] | null;   // JSON column
  updatedAt: EpochMs;
}
```

### 3.6 `Part`, `Chapter`, `Scene`, `Plotline`

```ts
export interface Part extends Timestamps {        // "Act I", "Book Two"
  id: UUID; projectId: UUID; title: string; summary: RichText; orderKey: OrderKey; color: HexColor | null;
}

export interface Chapter extends Timestamps {
  id: UUID;
  projectId: UUID;                      // FK ON DELETE CASCADE
  partId: UUID | null;                  // FK part.id ON DELETE SET NULL
  title: string;                        // ≤ 200, may be ''
  summary: RichText;
  orderKey: OrderKey;                   // order within (projectId, partId)
  targetWordCount: number | null;
  color: HexColor | null;
}

export type SceneStatus = "idea" | "outlined" | "drafting" | "drafted" | "revising" | "done";
export type SceneOutcome = "yes" | "no" | "yes_but" | "no_and" | "unresolved";   // goal achieved? (Swain/Bickham scene–sequel logic)
export type TimeOfDay = "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night" | "unspecified";

export interface Scene extends Timestamps {
  id: UUID;
  projectId: UUID;                      // FK ON DELETE CASCADE
  chapterId: UUID | null;               // FK chapter.id ON DELETE SET NULL  (null → "Unassigned" pool)
  orderKey: OrderKey;                   // order within chapter (or within the unassigned pool)
  title: string;                        // ≤ 200; may be ''
  synopsis: RichText;                   // Snowflake step 8/9 description
  povCharacterId: UUID | null;          // FK character.id ON DELETE SET NULL
  locationId: UUID | null;              // FK lore_entry.id ON DELETE SET NULL (kind='location')
  objective: string;                    // POV character's goal in the scene
  obstacle: string;                     // conflict / opposition
  outcome: SceneOutcome;
  outcomeNote: string;                  // the disaster/setback or victory in one line
  emotionStart: string;                 // e.g. "hopeful"
  emotionEnd: string;
  status: SceneStatus;
  body: RichText;                       // optional manuscript text for this scene
  targetWordCount: number | null;       // estimate (Snowflake step 8 "estimated length")
  storyTime: number | null;             // sortable story-time ordinal in seconds since calendar epoch
  storyTimeLabel: string;               // display, e.g. "Day 3, dusk"
  timeOfDay: TimeOfDay;
  color: HexColor | null;
  isFlashback: boolean;
  snowflakeSource: { step: 8 | 9; line: number } | null;   // provenance for re-sync
}

export interface Plotline extends Timestamps {   // A-plot, B-plot, romance subplot, mystery thread
  id: UUID; projectId: UUID; name: string; description: RichText; color: HexColor; orderKey: OrderKey;
  kind: "main" | "subplot" | "character_arc" | "mystery" | "theme";
  characterId: UUID | null;             // for kind='character_arc'; FK character.id ON DELETE SET NULL
}

// Join tables (composite PK, no surrogate id)
export interface SceneCharacter { sceneId: UUID; characterId: UUID; presence: "present" | "mentioned" | "offstage"; }
export interface SceneLore      { sceneId: UUID; loreEntryId: UUID; }
export interface ScenePlotline  { sceneId: UUID; plotlineId: UUID; beat: string; }   // beat ≤ 120 chars
```

```sql
CREATE TABLE part (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL, summary_json TEXT, summary_text TEXT NOT NULL DEFAULT '', order_key TEXT NOT NULL, color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER) STRICT;

CREATE TABLE chapter (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES part(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '', summary_json TEXT, summary_text TEXT NOT NULL DEFAULT '',
  order_key TEXT NOT NULL, target_word_count INTEGER CHECK (target_word_count IS NULL OR target_word_count >= 0), color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER) STRICT;
CREATE INDEX idx_chapter_order ON chapter(project_id, part_id, order_key) WHERE deleted_at IS NULL;

CREATE TABLE scene (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapter(id) ON DELETE SET NULL, order_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', synopsis_json TEXT, synopsis_text TEXT NOT NULL DEFAULT '',
  pov_character_id TEXT REFERENCES character(id) ON DELETE SET NULL,
  location_id TEXT REFERENCES lore_entry(id) ON DELETE SET NULL,
  objective TEXT NOT NULL DEFAULT '', obstacle TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'unresolved' CHECK (outcome IN ('yes','no','yes_but','no_and','unresolved')),
  outcome_note TEXT NOT NULL DEFAULT '', emotion_start TEXT NOT NULL DEFAULT '', emotion_end TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','outlined','drafting','drafted','revising','done')),
  body_json TEXT, body_text TEXT NOT NULL DEFAULT '', body_word_count INTEGER NOT NULL DEFAULT 0,
  target_word_count INTEGER CHECK (target_word_count IS NULL OR target_word_count >= 0),
  story_time REAL, story_time_label TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT 'unspecified' CHECK (time_of_day IN ('dawn','morning','noon','afternoon','evening','night','unspecified')),
  color TEXT, is_flashback INTEGER NOT NULL DEFAULT 0 CHECK (is_flashback IN (0,1)),
  snowflake_source TEXT CHECK (snowflake_source IS NULL OR json_valid(snowflake_source)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER) STRICT;
CREATE INDEX idx_scene_chapter_order ON scene(project_id, chapter_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_pov      ON scene(pov_character_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_location ON scene(location_id)      WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_status   ON scene(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_scene_time     ON scene(project_id, story_time) WHERE deleted_at IS NULL AND story_time IS NOT NULL;

CREATE TABLE plotline (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL, order_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'subplot' CHECK (kind IN ('main','subplot','character_arc','mystery','theme')),
  character_id TEXT REFERENCES character(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER) STRICT;

CREATE TABLE scene_character (
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  presence TEXT NOT NULL DEFAULT 'present' CHECK (presence IN ('present','mentioned','offstage')),
  PRIMARY KEY (scene_id, character_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_scene_character_char ON scene_character(character_id);

CREATE TABLE scene_lore (
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  lore_entry_id TEXT NOT NULL REFERENCES lore_entry(id) ON DELETE CASCADE,
  PRIMARY KEY (scene_id, lore_entry_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_scene_lore_lore ON scene_lore(lore_entry_id);

CREATE TABLE scene_plotline (
  scene_id TEXT NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
  plotline_id TEXT NOT NULL REFERENCES plotline(id) ON DELETE CASCADE,
  beat TEXT NOT NULL DEFAULT '' CHECK (length(beat) <= 120),
  PRIMARY KEY (scene_id, plotline_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_scene_plotline_pl ON scene_plotline(plotline_id);
```

**Invariants (enforced in commands + triggers):**
1. A scene's `povCharacterId`, if set, is automatically inserted into `scene_character` with `presence='present'`.
2. A scene's `locationId` must reference a `lore_entry` whose `kind = 'location'` (trigger `trg_scene_location_kind`).
3. `chapter.partId` and `scene.chapterId` must belong to the same `project_id` (trigger).
4. Moving a scene between chapters updates only `chapter_id` + `order_key` (one row).

### 3.7 `LoreEntry` (worldbuilding bible)

```ts
export type LoreKind =
  | "location" | "faction" | "magic_system" | "technology" | "geography" | "history_event"
  | "culture" | "religion" | "politics" | "economy" | "species" | "language" | "item" | "organization"
  | "antagonistic_force" | "custom";

export interface LoreCategory extends Timestamps {          // hierarchical folder tree
  id: UUID; projectId: UUID;
  parentId: UUID | null;                // FK lore_category.id ON DELETE CASCADE (deleting a category deletes subtree entries → blocked unless confirmed, see §3.12)
  name: string; icon: string;           // emoji or Lucide icon name; '' = default
  orderKey: OrderKey; color: HexColor | null;
  defaultKind: LoreKind | null;         // new entries in this category start with this kind
}

export interface LoreEntry extends Timestamps {
  id: UUID;
  projectId: UUID;
  categoryId: UUID | null;              // FK lore_category.id ON DELETE SET NULL (null → "Uncategorised")
  parentEntryId: UUID | null;           // FK lore_entry.id ON DELETE SET NULL (city inside a country)
  kind: LoreKind;
  customKindLabel: string;              // required iff kind='custom'
  name: string;                         // 1..160
  aliases: string[];                    // ≤ 10, used for @mention matching
  summary: string;                      // ≤ 280 chars, shown on cards/hover previews
  body: RichText;
  imageAttachmentId: UUID | null;       // FK attachment.id ON DELETE SET NULL
  coordinates: { x: number; y: number; mapAttachmentId: UUID } | null;  // optional pin on a map image
  tagIds?: UUID[];                      // via entity_tag
  orderKey: OrderKey;
  pinned: boolean;
}

/** Explicit, typed link between two lore entries or lore↔character (beyond free-text mentions). */
export type LinkKind = "member_of" | "located_in" | "rules" | "worships" | "allied_with" | "at_war_with" | "created_by" | "uses" | "related";
export interface EntityLink {
  id: UUID; projectId: UUID;
  fromType: EntityType; fromId: UUID;
  toType: EntityType; toId: UUID;
  kind: LinkKind; note: string;
  createdAt: EpochMs;
}
```

Kind-specific **field templates** (rendered through the custom-field system, pre-seeded and editable):

| Kind | Seeded fields (label : type) |
|---|---|
| `location` | Region : text · Climate : text · Population : number · Ruler : entity_ref(character) · Notable sites : longtext |
| `faction` / `organization` | Goals : longtext · Leader : entity_ref(character) · Headquarters : entity_ref(lore) · Strength : select(Minor, Regional, Major, Dominant) · Symbol/Colours : text |
| `magic_system` | Source : text · Cost / limits : longtext · Who can use it : longtext · Rules : longtext · Known failures : longtext |
| `technology` | Tech level : select(Stone, Bronze/Iron, Medieval, Industrial, Modern, Near-future, Far-future) · Availability : text · Side effects : longtext |
| `geography` | Terrain : text · Climate : text · Resources : multiselect · Hazards : longtext |
| `history_event` | Era : text · Story date : date(story-time) · Participants : entity_ref(any) · Consequences : longtext |
| `culture` / `religion` | Values : longtext · Traditions : longtext · Taboos : longtext · Language : text · Holidays : longtext |
| `politics` / `economy` | Government form : select · Currency : text · Main trade : text · Law : longtext |
| `species` | Lifespan : text · Traits : longtext · Home region : entity_ref(lore) |

```sql
CREATE TABLE lore_category (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES lore_category(id) ON DELETE CASCADE,
  name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', order_key TEXT NOT NULL, color TEXT, default_kind TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (parent_id IS NULL OR parent_id <> id)) STRICT;
CREATE INDEX idx_lore_category_parent ON lore_category(project_id, parent_id, order_key);

CREATE TABLE lore_entry (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES lore_category(id) ON DELETE SET NULL,
  parent_entry_id TEXT REFERENCES lore_entry(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('location','faction','magic_system','technology','geography','history_event','culture','religion','politics','economy','species','language','item','organization','antagonistic_force','custom')),
  custom_kind_label TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160), aliases TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 280),
  body_json TEXT, body_text TEXT NOT NULL DEFAULT '',
  image_attachment_id TEXT REFERENCES attachment(id) ON DELETE SET NULL,
  coordinates TEXT CHECK (coordinates IS NULL OR json_valid(coordinates)),
  order_key TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (parent_entry_id IS NULL OR parent_entry_id <> id),
  CHECK ((kind = 'custom') = (length(custom_kind_label) > 0))) STRICT;
CREATE INDEX idx_lore_cat   ON lore_entry(project_id, category_id, order_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_lore_kind  ON lore_entry(project_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX idx_lore_parent ON lore_entry(parent_entry_id);

CREATE TABLE entity_link (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL, from_id TEXT NOT NULL, to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  UNIQUE (from_type, from_id, to_type, to_id, kind)) STRICT;
CREATE INDEX idx_entity_link_to ON entity_link(to_type, to_id);
```

Cycle prevention: `lore_category.parent_id` and `lore_entry.parent_entry_id` chains are validated in the command layer with a recursive CTE before write; the UI disables invalid drop targets.

### 3.8 `IdeaNote`

```ts
export type NoteStatus = "inbox" | "incubating" | "used" | "archived";
export type NoteKind = "idea" | "research" | "dialogue" | "scene_seed" | "question" | "todo";

export interface IdeaNote extends Timestamps {
  id: UUID; projectId: UUID;
  title: string;                        // may be '' → derived from first line in UI
  kind: NoteKind;
  status: NoteStatus;
  body: RichText;
  sourceUrl: string;                    // research notes; '' if none
  pinned: boolean;
  color: HexColor | null;
  promotedTo: EntityRef | null;         // set when "Promote to scene/character/lore" is used; status → 'used'
  orderKey: OrderKey;
}
```

```sql
CREATE TABLE idea_note (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea','research','dialogue','scene_seed','question','todo')),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','incubating','used','archived')),
  body_json TEXT, body_text TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0, color TEXT,
  promoted_to_type TEXT, promoted_to_id TEXT, order_key TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK ((promoted_to_type IS NULL) = (promoted_to_id IS NULL))) STRICT;
CREATE INDEX idx_note_status ON idea_note(project_id, status, order_key) WHERE deleted_at IS NULL;
```

### 3.9 Cross-cutting tables: tags, mentions, timeline, attachments, trash, snapshots

```ts
export interface Tag { id: UUID; projectId: UUID; name: string; color: HexColor; createdAt: EpochMs; }   // name unique case-insensitively per project
export interface EntityTag { tagId: UUID; entityType: Exclude<EntityType,"project">; entityId: UUID; }

/** Derived index of @mentions parsed from rich text on every save. Rebuildable from source rows. */
export interface Mention {
  sourceType: EntityType; sourceId: UUID;
  field: string;                        // "body", "synopsis", "backstory", …
  targetType: EntityType; targetId: UUID;
  count: number;                        // occurrences in that field
}

export interface TimelineEvent extends Timestamps {
  id: UUID; projectId: UUID; title: string; description: RichText;
  storyTime: number;                    // seconds since calendar epoch, may be negative
  storyTimeEnd: number | null;          // for durations
  storyTimeLabel: string;
  lane: "world" | "character" | "plot";
  characterId: UUID | null;             // lane='character'
  plotlineId: UUID | null;              // lane='plot'
  sceneId: UUID | null;                 // optional anchor to a scene
  loreEntryId: UUID | null;             // e.g. a history_event
  color: HexColor | null;
}

export interface Attachment {
  id: UUID; projectId: UUID;
  fileName: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";
  byteSize: number;                     // ≤ 20 MB per file
  sha256: string;                       // dedupe: same hash → same row
  data: Uint8Array;                     // BLOB column in table `attachment_blob`
  thumb: Uint8Array | null;             // 256 px WebP
  width: number | null; height: number | null;
  createdAt: EpochMs;
}

export interface TrashItem { entityType: EntityType; entityId: UUID; deletedAt: EpochMs; label: string; }   // view over rows with deleted_at != NULL

export interface SnapshotRecord {
  id: UUID; createdAt: EpochMs; reason: "auto_interval" | "on_open" | "pre_migration" | "pre_import" | "pre_bulk_delete" | "manual";
  fileName: string; byteSize: number; schemaVersion: number; wordCount: number; sceneCount: number; label: string;
}
```

```sql
CREATE TABLE tag (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE, color TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (project_id, name)) STRICT;
CREATE TABLE entity_tag (tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (tag_id, entity_type, entity_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_entity_tag_entity ON entity_tag(entity_type, entity_id);

CREATE TABLE mention (
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, field TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (source_type, source_id, field, target_type, target_id)) STRICT, WITHOUT ROWID;
CREATE INDEX idx_mention_target ON mention(target_type, target_id);   -- backlinks query

CREATE TABLE timeline_event (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description_json TEXT, description_text TEXT NOT NULL DEFAULT '',
  story_time REAL NOT NULL, story_time_end REAL, story_time_label TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL CHECK (lane IN ('world','character','plot')),
  character_id TEXT REFERENCES character(id) ON DELETE CASCADE,
  plotline_id  TEXT REFERENCES plotline(id)  ON DELETE CASCADE,
  scene_id     TEXT REFERENCES scene(id)     ON DELETE SET NULL,
  lore_entry_id TEXT REFERENCES lore_entry(id) ON DELETE SET NULL, color TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  CHECK (story_time_end IS NULL OR story_time_end >= story_time)) STRICT;
CREATE INDEX idx_timeline_time ON timeline_event(project_id, story_time) WHERE deleted_at IS NULL;

CREATE TABLE attachment (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL, width INTEGER, height INTEGER, thumb BLOB, created_at INTEGER NOT NULL,
  UNIQUE (project_id, sha256)) STRICT;
CREATE TABLE attachment_blob (attachment_id TEXT PRIMARY KEY REFERENCES attachment(id) ON DELETE CASCADE, data BLOB NOT NULL) STRICT;
-- split so listing galleries never reads image bytes

CREATE TABLE character_gallery (   -- "gallery for visual inspiration"
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachment(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '', order_key TEXT NOT NULL, PRIMARY KEY (character_id, attachment_id)) STRICT, WITHOUT ROWID;

CREATE TABLE custom_field_def (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('character','lore','scene','location')), lore_kind TEXT,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  type TEXT NOT NULL CHECK (type IN ('text','longtext','number','date','boolean','select','multiselect','url','color','entity_ref')),
  options TEXT CHECK (options IS NULL OR json_valid(options)), entity_ref_target TEXT,
  required INTEGER NOT NULL DEFAULT 0, order_key TEXT NOT NULL, section TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  UNIQUE (project_id, target, lore_kind, label)) STRICT;
CREATE TABLE custom_field_value (
  id TEXT PRIMARY KEY, def_id TEXT NOT NULL REFERENCES custom_field_def(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, value TEXT NOT NULL CHECK (json_valid(value)), updated_at INTEGER NOT NULL,
  UNIQUE (def_id, owner_type, owner_id)) STRICT;
CREATE INDEX idx_cfv_owner ON custom_field_value(owner_type, owner_id);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- keys: 'revision' (monotonic int, +1 per committed transaction), 'created_by_version', 'last_opened_by_version', 'file_uuid'

CREATE TABLE snapshot_record (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, reason TEXT NOT NULL, file_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL, schema_version INTEGER NOT NULL, word_count INTEGER NOT NULL, scene_count INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '') STRICT;
```

> `snapshot_record` is a convenience index; the authoritative snapshots are files in the project's `.snapshots/` sidecar folder so they survive corruption of the main DB.

### 3.10 Full-text search schema

```sql
CREATE VIRTUAL TABLE search_fts USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED, title, body,
  tokenize = "unicode61 remove_diacritics 2", prefix = '2 3 4');
CREATE VIRTUAL TABLE search_trigram USING fts5(
  entity_type UNINDEXED, entity_id UNINDEXED, title, tokenize = "trigram");   -- fuzzy/substring for names
```

Maintained by `AFTER INSERT/UPDATE/DELETE` triggers on `character`, `scene`, `chapter`, `lore_entry`, `idea_note` that rewrite the row's FTS entry from `name/title` + all `*_text` columns. A full `rebuild` command exists for repair.

### 3.11 ER overview

```
series 1─* project 1─* snowflake_step(9)
project 1─* part 1─* chapter 1─* scene ─* scene_character *─ character
                                   │  ├─* scene_lore  *─ lore_entry ─(parent_entry_id)→ lore_entry
                                   │  └─* scene_plotline *─ plotline
character *─* character via character_relationship (source,target) ─ relationship_group
lore_category (tree) 1─* lore_entry          entity_link: any↔any typed edge
mention: any rich-text field → any entity    entity_tag: tag ↔ any entity
timeline_event ─ (character | plotline | scene | lore_entry)
project 1─* idea_note ──(promotedTo)→ any entity       attachment ← avatar/cover/gallery/image
```

### 3.12 Cascading delete & referential rules (complete)

| Parent deleted | Child | Rule | Rationale / UX |
|---|---|---|---|
| `project` | every table with `project_id` | **CASCADE** | Deleting a file's project = deleting the file; requires typing the title |
| `series` | `project.series_id` | SET NULL | Books survive series deletion |
| `part` | `chapter.part_id` | SET NULL | Chapters become part-less, never lost |
| `chapter` | `scene.chapter_id` | **SET NULL** | Scenes drop into **Unassigned pool**; the confirm dialog says "12 scenes will be unassigned" |
| `character` (soft) | `scene.pov_character_id` | SET NULL | Scene keeps POV text in `povLabelCache`? **No** — scene shows "POV: (deleted)" until reassigned |
| `character` (hard purge) | `scene_character`, `character_relationship`, `character_gallery`, `timeline_event(lane='character')` | CASCADE | Relationship has no meaning without both ends |
| `character` | `plotline.character_id` | SET NULL | Arc line remains |
| `character` | `mention.target_*`, `entity_tag`, `entity_link`, `custom_field_value` (polymorphic) | **Trigger-cleaned** (`trg_cleanup_refs_character`) | Rich-text `mention` nodes are left intact but rendered as struck-through "deleted character" chips so prose is never altered silently |
| `lore_entry` | `scene.location_id` | SET NULL | |
| `lore_entry` | `scene_lore`, `entity_link` (either end) | CASCADE / trigger | |
| `lore_entry` | `lore_entry.parent_entry_id` | SET NULL | Children float to root of their category |
| `lore_category` | child `lore_category` | CASCADE | Subtree deletion — confirm shows total entry count |
| `lore_category` | `lore_entry.category_id` | **SET NULL** | Entries survive; deleting a category never deletes content |
| `plotline` | `scene_plotline`, `timeline_event(lane='plot')` | CASCADE | |
| `scene` | `scene_character`, `scene_lore`, `scene_plotline` | CASCADE | |
| `scene` | `character_relationship.starts_at/ends_at_scene_id`, `timeline_event.scene_id` | SET NULL | |
| `attachment` | `character.avatar_*`, `lore_entry.image_*`, `project.cover_*` | SET NULL | |
| `custom_field_def` | `custom_field_value` | CASCADE | Deleting a field deletes its values (confirm lists "used in 14 characters") |
| `tag` | `entity_tag` | CASCADE | |
| `idea_note` | — | none | `promotedTo` is one-way and never blocks deletion |

**Soft delete policy:** all user-facing deletes set `deleted_at` (Trash, 30-day auto-purge, restorable). The cascade rules above apply at **purge** time (`DELETE FROM … WHERE deleted_at < :cutoff`) and on "Delete permanently". While soft-deleted, an entity is excluded from every query by `deleted_at IS NULL` partial indexes and views (`v_character_live`, etc.).

---

## 4. Feature Specifications & UX Wireflows

### 4.0 Global shell

**Layout (desktop ≥ 1024 px):** left **rail** (icon + label, collapsible to icons) · centre **workspace** · optional right **inspector** (300–420 px, resizable, remembers per-view). Under 1024 px the rail becomes a bottom tab bar and the inspector becomes a full-screen sheet (the PWA/tablet case).

```
┌─────┬──────────────────────────────────────────────────────────────┬───────────┐
│ ◈   │  Project title ▾          ⌘K Search/Command    ● Saved 14:02 │ Inspector │
│Dash │ ┌──────────────────────────────────────────────────────────┐ │ (selected │
│Snow │ │                     active view                          │ │  entity,  │
│Char │ │                                                          │ │  backlinks│
│Web  │ │                                                          │ │  history) │
│Out  │ └──────────────────────────────────────────────────────────┘ │           │
│Wiki │                                                              │           │
│Note │                                                              │           │
└─────┴──────────────────────────────────────────────────────────────┴───────────┘
```

**Rail order (fixed):** Dashboard · Snowflake · Characters · Relationships · Outliner · Timeline · World · Notes · Export. Modules can be hidden in `ProjectSettings.enabledModules`.

**Command palette (`Ctrl/Cmd+K`)** — searches entities (FTS + trigram) and commands ("New scene", "Go to Step 4", "Export Markdown"). Results are grouped by entity type; arrow keys + Enter; `Tab` previews in the inspector; ≤ 30 ms p95 to first results.

**Distraction-free:** `Ctrl/Cmd+Shift+F` hides rail + inspector + chrome; typography uses a variable serif (bundled, no network fonts), measure 62–72 ch, line-height 1.6, user-selectable theme (Light, Dark, Sepia, High-contrast), font size 14–24 px.

**Dashboard:** project card (title, form, genre chips), snowflake progress ring (steps complete / 9), counts (characters, scenes, lore, notes), words written vs target, deadline countdown, "Continue where you left off" (last 5 edited entities), integrity/backup status ("Last backup 12 min ago").

#### 4.0.1 Onboarding & novel-creation wizard (first run; replaces Fabula's 10-step guide)

| # | Screen | Content | Output |
|---|---|---|---|
| 1 | Welcome | "Your stories live in a file on your computer. No account." Buttons: **New project**, **Open file…**, **Try sample project** | — |
| 2 | Where to save | Native save dialog default `~/Documents/StarLine/<title>.starline` (web: "stored in this browser — export anytime") | file created |
| 3 | Project basics | Title (required), genre chips (max 8; seeded list of 30), form (`novel`, `novella`, …), target word count (presets 20k / 50k / 80k / 120k / custom), optional deadline | `Project` row |
| 4 | Method | Cards: **Snowflake (guided, 9 steps)** (recommended) · **Freeform (blank outliner)** | `method` |
| 5 | Idea seed | "In one sentence, what happens?" (inline Step 1; skippable) | `SnowflakeStep1` |
| 6 | Tour (skippable) | 5 coach-marks: palette, `@` mentions, drag handles, trash/undo, backups | `meta.tour_done=1` |

The wizard is resumable (state in `localStorage`-equivalent app prefs, not the project file) and every screen is skippable except 3.

### 4.1 Snowflake Wizard View

**Purpose:** guide steps 1–9 with the smallest possible unit of work per screen.

```
┌ Steps ──────────┐ ┌ Step 2 of 9 · One paragraph ──────────────── ✔ complete? ┐ ┌ Prompts ──────┐
│ ● 1 One sentence│ │ Setup                                                    │ │ Three-disaster │
│ ◐ 2 Paragraph   │ │ ┌──────────────────────────────────────────────────────┐ │ │ structure:     │
│ ○ 3 Characters  │ │ │ A grieving cartographer…                             │ │ │ Disaster 1 ends│
│ ○ 4 One page    │ │ └──────────────────────────────────────────────────────┘ │ │ Act I …        │
│ ○ 5 Char. pages │ │ Disaster 1 [  ]   Disaster 2 [  ]   Disaster 3 [  ]      │ │ ── Examples ── │
│ ○ 6 Four pages  │ │ Ending     [  ]                                          │ │ ▸ Hunger Games │
│ ○ 7 Char. charts│ │ ⚠ "Disaster 2" is 3 sentences — aim for one.             │ │ ── Issues (2) ─│
│ ○ 8 Scene list  │ │ [ Find characters in this text ]   [ Mark step complete ]│ └────────────────┘
│ ○ 9 Scene detail│ └──────────────────────────────────────────────────────────┘
└─────────────────┘
```

**Behaviour:**
1. **Step navigation:** left stepper shows status glyph (`○` not started, `◐` in progress, `●` complete, `⚠` has warnings, `↻` stale). `Alt+↑/↓` or `[` / `]` move between steps. Any step is reachable (soft gating, §3.4.1).
2. **Contextual writing prompts (right panel):** per step, static, bundled, offline: (a) the method's rule in two sentences, (b) 3 worked examples from public-domain stories (Cinderella, Pride and Prejudice, Frankenstein), (c) 5–8 reflective questions (e.g. Step 2: "What does the story-world look like before the inciting disaster?"; Step 3: "What does this character want so badly that they'd lose something precious?"). Prompts never write for the user; no network.
3. **Live validation:** the issues list (§3.4.2) updates as the user types (debounced 250 ms); each issue is clickable and focuses the field. A word counter shows `14 / 25`.
4. **Alternatives (Step 1):** "Try another phrasing" stores drafts in `alternatives`; user can **Promote** one to the active sentence (swap).
5. **Step 3 — character summaries:** a card per major character with the six fields (name, motivation, goal, conflict, epiphany, one-sentence, one-paragraph) mapped directly to `Character` columns; adding a card creates the `Character` row immediately (no duplicate "snowflake character" concept).
6. **Step 4 and 6 — expansion:** side-by-side "source sentence ⇢ your paragraph" layout; source text is pinned in a collapsible header while typing.
7. **Step 8 — scene list:** a spreadsheet-style grid (`#`, POV, one-line description, est. words, chapter) with paste-from-clipboard (TSV/CSV/lines), keyboard navigation (arrows, Enter to edit, Tab to next cell), and **Create scenes from list**; shows a running total vs. `targetWordCount` ("62,400 / 80,000 est.").
8. **Step 9:** scene-by-scene accordion pulling in each scene's step-8 line; completion tracked by `expandedSceneIds`.
9. **Exit criteria:** completing step 8 unlocks the outliner "Planned" badge on the dashboard; completing step 9 is optional (never required).
10. **Edge cases:** deleting a character referenced in step 3 shows "1 major character removed" and removes the ID from `majorCharacterIds`; step content survives project settings changes; re-running step 8 import **merges** by `snowflakeSource.line` instead of duplicating.

### 4.2 Character Dossier & Relationship Views

#### 4.2.1 Character list (card layout)

- **Grid of cards** (default, 3–6 columns responsive) or compact table. Card: avatar (or coloured initials), name, role badge, one-line, scene count, relationship count, pin icon.
- Filters: role, tag, "appears in chapter X", "has no relationships", "not in any scene". Sort: manual (drag), name, role, first appearance, scene count.
- **Quick add:** `N` or "+" → inline name field → Enter creates `role='supporting'`.
- **Merge duplicates:** select 2 → "Merge into…"; combines relationships, scenes, mentions (rewrites `mention` nodes) in one undoable transaction after an automatic snapshot.

#### 4.2.2 Dossier (detail view)

```
┌ Avatar ┐  Name ▢  aliases [Mina, "The Surveyor"]   role ▾  colour ●   ★ pin
│  img   │  one-line: …
└────────┘  tabs: Overview │ Psychology │ Story │ Appearance │ Backstory │ Voice │ Relationships │ Appearances │ Gallery │ Custom
```

| Tab | Content |
|---|---|
| **Overview** | Snowflake quartet (motivation, goal, conflict, epiphany) + one-line + one-paragraph, role, arc type |
| **Psychology** | Want vs. Need (side-by-side), Lie ↔ Truth, flaws/strengths/fears/values as chip lists with autocompletion from a bundled trait list (200 entries, editable), internal vs. external conflict rich text, ghost/wound |
| **Story** | Step 5 storyline (character's POV) + arc visual: a 3-point strip (Start state → Midpoint shift → End state) editable as text |
| **Appearance / Backstory / Voice** | Rich text with `@mentions`; voice tab has "sample lines" (pinned quotes) |
| **Relationships** | Table of all edges (other character, type, sentiment slider, notes); "Add relationship" opens a two-field popover (character picker + type) |
| **Appearances** | Auto-generated: list of scenes where present/POV/mentioned (from `scene_character` + `mention`), grouped by chapter, with first/last appearance and POV-share percentage |
| **Gallery** | Masonry of images (drag-drop files, paste from clipboard), caption per image, set-as-avatar action |
| **Custom** | User-defined fields grouped by `section` (see below) |

**Backlinks panel (inspector):** "Mentioned in 7 places" → grouped list from `mention` (scene synopsis, lore entries, notes) with the snippet around each mention; click navigates.

**Custom attribute builder:** settings → *Fields* → pick target (Character/Lore/Scene/Location) → **Add field** (label, type, options, section, required). Drag to reorder; deleting prompts with usage count. New fields appear immediately on every existing entity (null values). Import/export of field sets as JSON ("Character template packs").

#### 4.2.3 Relationship view (visual character web)

- **Canvas** (xyflow): nodes = characters (avatar circle, colour ring by role, label), edges = relationships. Edge styling: colour by sentiment gradient (red ↔ grey ↔ green), width by `|sentiment|`, **dashed** if `secret`, **arrowhead** if `directed`, label shows kind (or `customLabel`).
- **Layout:** force-directed (d3-force in a worker; 300 nodes settle < 800 ms), plus **manual pin** (dragging a node pins its coordinates, stored in `meta` key `graph_positions` JSON — not a separate table; absence = auto-layout), **grouped layout** (nodes clustered by `RelationshipGroup` inside translucent hulls), and **radial** layout around a selected character.
- **Create edge:** drag from a node's handle to another node → popover (kind, sentiment, directed) → Enter. Or `E` with two nodes selected.
- **Filters (toolbar):** by kind (multi-select), by group, by minimum `|sentiment|`, **"As of scene…"** slider (choose a scene; edges whose `startsAtSceneId`/`endsAtSceneId` don't span it are hidden — scene order comes from outliner order), hide minor characters.
- **Matrix mode (relationship matrix):** an N×N grid; rows/columns = characters; cell shows the kind glyph + sentiment colour; clicking a cell opens/creates the edge. Virtualized for N ≤ 300. Reading is symmetric for undirected edges. Export matrix as CSV.
- **Selection inspector:** shows dossier snippet, edge list, shared scenes ("Mina & Tor appear together in 9 scenes").
- **Accessibility:** the graph has a "List view" twin (same data as a keyboard-navigable table) — required for screen readers.
- **Performance:** render budget 60 fps ≤ 300 nodes/1,000 edges; above that, edge labels hide until zoom ≥ 1.0 and nodes switch to canvas-rendered circles.

### 4.3 Outliner / Corkboard View

Three interchangeable presentations of the same `part → chapter → scene` tree, switch with `1` / `2` / `3`:

#### 4.3.1 Corkboard (cards by chapter) — default

```
Part I ▾
┌ Chapter 1 · "Arrival" ─ 4 scenes · ~5,800 w ┐  ┌ Chapter 2 …
│ ┌ Scene card ─────────────────────┐          │
│ │ ▌ The Ferry                      │ ← colour │
│ │ POV ● Mina   📍 Harbour          │          │
│ │ Goal: reach the customs office   │          │
│ │ ⚑ drafted   ≈1,500 w  🏷 mystery │          │
│ └──────────────────────────────────┘          │
│ + Add scene                                    │
└────────────────────────────────────────────────┘
Unassigned pool (3)  ← scenes with chapterId = NULL, always pinned at the end
```

- **Card badges:** POV avatar chip, location pin, status pill (colour from `statusPalette`), word-count estimate (actual `bodyWordCount` if > 0, else `targetWordCount`, prefixed "≈"), plotline dots (max 4 + "+N"), tag chips (max 2 + "+N"), flashback glyph, outcome icon (✓ / ✗ / ✓ but / ✗ and).
- **Drag & drop (dnd-kit):** reorder within a chapter; move between chapters; drag chapters within/between parts; drag from Unassigned into a chapter. Keyboard alternative: focus card → `Space` to pick up → arrows to move → `Space` to drop → `Esc` to cancel (announced via ARIA live region). Each drop writes **one row** (`chapter_id`, `order_key`) and is undoable.
- **Multi-select:** `Shift/Ctrl+click` or lasso; bulk actions: set status, set POV, add tag, add to plotline, move to chapter, delete.
- **Card density:** Compact (title + POV + status), Normal, Detailed (adds synopsis first 3 lines).
- **Filters / dimming:** highlight (not hide) scenes matching POV, status, tag, plotline, character present, location; "dim others" toggle; saved filters ("All of Tor's scenes").
- **Inspector:** selecting a scene shows the full scene editor (below).

#### 4.3.2 Outline (list) view

Indented tree, virtualized, one row per scene with inline editable columns: `#`, Title, POV, Location, Status, Words, Plotlines. Column chooser; sort disabled (order is meaning), group-by (POV, status) is read-only. Keyboard: arrows to navigate, `Enter` edit, `Tab/Shift+Tab` indent/outdent (scene ⇄ chapter promotion), `Alt+↑/↓` reorder.

#### 4.3.3 Plotline grid (Plottr-style matrix)

Rows = plotlines, columns = scenes in book order (grouped by chapter). Cell = filled dot with the `beat` text on hover/click. Click empty cell to attach the scene to the plotline. Header shows balance statistics ("Romance appears in 6 of 41 scenes; longest gap 14 scenes" — warning when gap > 25 % of book).

#### 4.3.4 Scene editor (inspector or full-page)

Fields in this order: Title · Status · POV (character picker) · Location (lore picker, `kind='location'`) · Present characters (multi-picker; POV auto-included) · Objective · Obstacle · Outcome (segmented: Yes / No / Yes, but / No, and) + outcome note · Emotion start → end · Plotlines (multi-picker with per-link beat) · Lore touched · Story time + time-of-day · Tags · Synopsis (rich text, `@mentions`) · **Draft text** (collapsed by default; "Write" opens the distraction-free editor) · Target words. Autosave per field.

#### 4.3.5 Statistics strip

Total scenes, by status (stacked bar), POV distribution (bar chart per character), estimated vs. actual words, pace chart (scene length over scene order). All derived by SQL; no stored aggregates.

### 4.4 Worldbuilding Wiki View

```
┌ Tree ────────────┐ ┌ Entry: "The Ember Court"  (faction) ─ tags: #politics ┐ ┌ Backlinks ───────┐
│ ▾ Geography      │ │ summary (≤ 280) …                                     │ │ Mentioned in:     │
│   ▸ Continents   │ │ ── Fields ──  Goals / Leader @Tor / Strength Major    │ │ Scene 7 (synopsis)│
│ ▾ Factions       │ │ ── Body (rich text, @mentions, headings) ──────────── │ │ Note "Heist idea" │
│   • Ember Court  │ │ ── Links ── member_of ▸ The Concord  [+ add link]     │ │ Char Tor (backstory)
│ ▸ Magic & Tech   │ │ ── Children ── Harbour Ward, Citadel                  │ └───────────────────┘
│ ▸ History        │ └───────────────────────────────────────────────────────┘
│ ＋ New category  │
└──────────────────┘
```

- **Hierarchical categories:** default seed tree (editable): *Geography → (Continents, Countries, Cities, Landmarks)*, *Factions & Organizations*, *Magic & Technology*, *History & Timeline*, *Cultures & Religions*, *Politics & Economy*, *Species & Creatures*, *Items & Artifacts*, *Languages*. Drag to reorder/nest (cycle-safe); breadcrumb on every entry.
- **Create entry:** `Ctrl/Cmd+Shift+N` anywhere → choose kind (pre-seeded fields appear) → name → Enter. Templates per §3.7.
- **Tag-based filtering:** top bar with tag multi-select (AND/OR toggle), kind filter, "orphans only" (no mentions/links), "pinned". Result view toggles between list, cards (with image), and **map** (entries with `coordinates` pinned on an uploaded map image; click pin → entry).
- **Bidirectional links:** (1) **`@mention`** — typing `@` in any rich-text field opens an autocomplete over characters, lore, scenes, notes (fuzzy via trigram, recency-weighted); chosen item inserts a `mention` node rendered as a coloured chip with hover-preview card (summary + image). (2) **Typed `EntityLink`s** (member_of, located_in…) created from the "Links" section. Both sides always show the relation: the target's *Backlinks* panel lists every mention and link with a snippet; typed links show inverse labels ("Ember Court — **has member** → Tor").
- **Rename safety:** mentions store the entity ID, not the text; renaming propagates instantly; the chip label is resolved at render time.
- **Unlinked mentions:** a "Possible mentions" section lists plain-text occurrences of the entry's name/aliases not yet linked, with one-click **Link** (rewrites that text range into a `mention` node).
- **Consistency checks (info-level):** entries with empty summaries; locations never used in a scene; factions with no members; duplicate names (trigram similarity ≥ 0.8).
- **Large-document support:** entry bodies up to 500k characters remain fluent (ProseMirror virtual scrolling is not available, so bodies > 150k characters show a "large entry" banner suggesting splitting; typing latency target still < 16 ms up to 150k).

### 4.4.1 Timeline view (supports Fabula's "Story Timeline")

Horizontal swimlane timeline: lanes = World (lore history events + timeline events), each Character, each Plotline. Items are scenes (placed by `storyTime`) and `TimelineEvent`s. Zoom (scale from hours to millennia using the project calendar), drag to change `storyTime`, "Scenes with no time" tray. Conflict detection: a character in two scenes whose `storyTime` ranges overlap in different locations → ⚠ "Can't be in two places" (warning only).

### 4.4.2 Notes / Idea incubator

- **Inbox-first:** global quick-capture (`Ctrl/Cmd+Shift+I`, also a tray/global shortcut in the desktop app) opens a one-field window; Enter saves to `inbox` in < 100 ms without loading the full app view.
- **Board columns:** Inbox → Incubating → Used → Archived (kanban, drag between). List mode with filters by kind/tag/pinned.
- **Promote:** note → **Scene** (title = note title, synopsis = body), **Character** (name from title), **Lore entry** (kind picker), **Plotline**. Promotion links `promotedTo`, sets `used`, and leaves a backlink chip. Undoable.
- **Incubation nudge:** notes in `incubating` untouched > 30 days appear in the dashboard "Revisit these ideas" card (no push notifications, no network).
- **Research notes:** `sourceUrl` field (stored as text, opened in the default browser on click; app never fetches it).
- **Attachments:** paste/drop images and PDFs (20 MB cap, deduped by SHA-256).

### 4.5 Export, Import & Backup

#### 4.5.1 Export formats

| Format | Scope | Details |
|---|---|---|
| **Markdown folder** (`.zip` or directory) | whole project (lossless-ish) | `project.md` (frontmatter + logline/synopsis), `snowflake/01-…09-*.md`, `characters/<slug>.md` (YAML frontmatter for all fields + body sections), `lore/<category-path>/<slug>.md`, `outline/<NN-chapter>/<NN-scene>.md`, `notes/<slug>.md`, `attachments/<sha256>.<ext>`. Mentions serialise as wiki-links `[[Tor]]` plus a `starline:` id in frontmatter so re-import is lossless. Compatible with Obsidian vaults |
| **JSON** (`*.starline.json`) | whole project | Canonical interchange: `{ "format": "starline-export", "schemaVersion": 1, "exportedAt": …, "app": {name,version}, "project": {…}, "snowflakeSteps": […], "characters": […], … }`, with rich text as ProseMirror JSON; validated by the published Zod/JSON-Schema (`/schema/export-v1.schema.json`) |
| **DOCX** | manuscript or planning doc | Two presets: **Manuscript** (Times-like, double-spaced, title page, parts/chapters as headings, scene breaks `#`, scenes in outline order, only `body`) and **Planning document** (synopsis, character sheets, world bible, scene list). Generated by the `docx` library inside a worker |
| **HTML** (single self-contained file) | any selection | Print-ready CSS, embedded images as data URIs, light/dark via `prefers-color-scheme`; used for "share with beta reader/editor" |
| **Plain text / Markdown manuscript** | manuscript | Chapters/scenes concatenated; configurable scene separator |
| **CSV** | tables | `characters.csv`, `scenes.csv` (with POV/location names resolved), `relationships.csv`, `lore.csv` |
| **PDF** | via system print dialog from the HTML export (no bundled PDF engine) |

**Export dialog:** choose preset → choose scope (whole project / selected chapters / filter by status e.g. only `done`) → options (include synopsis, include notes, include trashed = no by default) → preview first 2 pages → **Export…** (native save dialog). Export runs in a worker with a progress bar and is cancelable; exporting never blocks the UI.

#### 4.5.2 Import

| Source | Behaviour |
|---|---|
| `*.starline` | Open directly |
| StarLine JSON / Markdown folder | Creates a **new** project file (never overwrites); validates against schema; reports per-entity issues |
| CSV of characters / scenes | Column-mapping UI; dry-run summary (N to create, M skipped) before commit |
| Plain text / Markdown / DOCX manuscript | "Split into chapters/scenes" wizard: heading level → chapter, `***` or blank-line-scene-break → scene |
| **Fabula (migration)** | Fabula offers no export, so supported path = **paste-in**: Step 1/2/4/6 text, character fields and scene lists via the CSV importer and a documented template. A scripted import from a future Fabula export is explicitly **out of scope** until such an export exists |

#### 4.5.3 Backups & local snapshots

- **Rolling snapshots** to `<project-dir>/.starline-snapshots/<title>-YYYYMMDD-HHmmss-<reason>.starline` using `VACUUM INTO` (consistent while the app is running).
- **Triggers:** on open (if last snapshot > 1 h old), every **15 minutes of edit activity**, before migration, before import, before bulk delete/merge, and manual "Snapshot now" (with label).
- **Retention (defaults, configurable):** keep all from the last 24 h, hourly for 7 days, daily for 60 days, plus all labelled/manual and `pre_migration` snapshots indefinitely; hard cap on total snapshot size 2 GB with oldest-first thinning that never deletes the single newest snapshot.
- **Restore:** *Snapshots* panel lists reason, time, word/scene counts; **Preview** opens read-only in a new window with a diff summary vs. current ("+3 scenes, −1 character, 2,140 words changed"); **Restore** = snapshot current first, then replace; **Restore single entity** (extract one character/scene from a snapshot into the current project) is supported.
- **Second copy:** optional "Mirror backups to folder…" (user-chosen path, e.g. a cloud-synced folder). The mirrored files are *snapshots* (immutable files), which are safe for Dropbox/iCloud/Syncthing, unlike syncing the live DB.
- **Integrity check:** run on open and monthly; on failure, offer "Recover from latest snapshot" or `.recover` extraction.

#### 4.5.4 Schema migrations

- Forward-only numbered SQL files `packages/db/migrations/0001_init.sql … NNNN_*.sql`; each runs in a transaction and ends with `PRAGMA user_version = N`. TS-side migrations (JSON column reshapes) run in the same transaction through a `MigrationContext`.
- **Export schema** (`schemaVersion` in JSON/Markdown frontmatter) is versioned **independently** with explicit upgraders `upgradeV1toV2(json)`; the importer accepts any version ≤ current and rejects newer with a clear message.
- **Property tests:** for each migration, generate random valid DBs at version N−1, migrate, assert FK integrity (`PRAGMA foreign_key_check`), data preservation, and that export(import(export(x))) is idempotent.
- **Downgrade policy:** not supported; opening a newer file → read-only + "Update StarLine to edit".

### 4.6 Settings, themes, accessibility, i18n

- **Settings:** Appearance (theme, font family from 3 bundled families, size, editor width), Editor (smart quotes on/off, auto-pair, spellcheck language via OS), Backups (§4.5.3), Fields (custom fields), Statuses (rename/recolour scene statuses), Keyboard (view, rebind), Privacy ("This app makes no network requests" with a verifiable status line; update check is opt-in and fetches only a version JSON).
- **Accessibility:** WCAG 2.2 AA; every interactive element keyboard-reachable, visible focus ring ≥ 3:1, drag-and-drop has keyboard alternative, graph has table twin, `prefers-reduced-motion` disables transitions, minimum target size 24 px.
- **i18n:** ICU message format with `react-intl`/`lingui`; v1.0 ships `en`, `de`, `ru` (Fabula's listing exists in Russian; German title is "Romanplaner"); RTL layout supported by logical CSS properties; spellcheck/word-count use `Intl.Segmenter`.

### 4.7 Keyboard map (defaults)

| Action | Windows/Linux | macOS |
|---|---|---|
| Command palette | Ctrl+K | ⌘K |
| Quick capture note | Ctrl+Shift+I | ⌘⇧I |
| New (context-aware: scene / character / lore entry) | Ctrl+N | ⌘N |
| Switch module 1–9 | Ctrl+1…9 | ⌘1…9 |
| Next / previous Snowflake step | ] / [ | ] / [ |
| Corkboard / Outline / Plotline grid | 1 / 2 / 3 | 1 / 2 / 3 |
| Move selected item up/down | Alt+↑ / Alt+↓ | ⌥↑ / ⌥↓ |
| Insert mention | @ | @ |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z | ⌘Z / ⌘⇧Z |
| Distraction-free | Ctrl+Shift+F | ⌘⇧F |
| Snapshot now | Ctrl+Alt+S | ⌘⌥S |
| Toggle inspector / rail | Ctrl+. / Ctrl+\ | ⌘. / ⌘\ |

---

## 5. Non-Functional Requirements & Performance Budgets

### 5.1 Performance budgets (reference hardware: 2019 mid-range laptop, 8 GB RAM, SATA SSD; reference project: **120 000-word novel, 150 scenes, 60 characters, 400 lore entries, 300 notes, 2 000 mentions, 40 images**)

| Metric | Budget (p95) | Measurement |
|---|---|---|
| Cold start → interactive dashboard (desktop) | **≤ 1.2 s** (≤ 2.0 s on WebKitGTK/Linux) | Playwright `performance.mark` from process spawn |
| Cold start → interactive (PWA, first visit, warm cache) | ≤ 1.8 s | Lighthouse CI |
| Open 100 MB project file | ≤ 1.5 s to first paint of dashboard | integration test |
| View switch (rail click → first content frame) | **≤ 100 ms**; main-thread tasks ≤ 16 ms | Long Tasks API |
| Keystroke-to-paint in editors (≤ 150k chars) | **≤ 16 ms** | `PerformanceEventTiming` |
| Drag-and-drop frame time (corkboard, 500 cards) | ≤ 16 ms/frame (60 fps) | trace |
| Scene move commit (drop → persisted) | ≤ 30 ms | repository test |
| Autosave commit latency | ≤ 50 ms after debounce | transaction timer |
| Command palette first results | **≤ 30 ms** (≤ 100 ms to full list) | in-app timer |
| Full-text search over reference project | **≤ 30 ms** (≤ 80 ms for 10× project) | FTS5 benchmark |
| Backlink query for any entity | ≤ 10 ms | indexed `mention.target` |
| Relationship graph initial layout (300 nodes) | ≤ 800 ms off-thread, UI unblocked | worker trace |
| Export Markdown (reference project) | ≤ 3 s | e2e |
| Export DOCX (120k words) | ≤ 8 s, UI responsive | e2e |
| Snapshot (`VACUUM INTO`, 100 MB) | ≤ 2 s, non-blocking to reads | integration |
| Resident memory, reference project | ≤ 250 MB (desktop) | OS sampling |
| Idle CPU | < 1 % | OS sampling |

**Bundle & package limits:** initial JS (gzip) **≤ 350 KB** for dashboard route; per-route lazy chunks ≤ 150 KB gz (editor, graph, DOCX writer, d3-force worker loaded on demand); sqlite-wasm ≤ 1.2 MB gz (web only); total web transfer first visit ≤ 1.2 MB; installer ≤ 15 MB (Win MSI/macOS DMG/Linux AppImage+deb); **CI fails the build** when a budget is exceeded by > 5 %.

### 5.2 Offline & privacy guarantees

1. **Offline-complete:** every feature in §4 works with the network disabled. The PWA precaches the shell; all fonts, prompt text, examples, trait lists and icons are bundled.
2. **No network by default:** the desktop build ships with a restrictive Tauri capability set and CSP (`default-src 'self'; connect-src 'none'`); an e2e test asserts zero outbound requests during a full user journey. Optional **update check** is off until the user enables it.
3. **No accounts, no telemetry, no analytics.** Crash reports are written to a local log the user may attach manually.
4. **Data ownership:** the user's work is in an open file with a published schema (`/docs/file-format.md`) and CLI exporter.
5. **No encryption-at-rest in v1.0** (OS disk encryption recommended); v1.2 may add SQLCipher-based optional passphrase — out of scope but the driver interface does not preclude it.

### 5.3 Reliability

| Requirement | Target |
|---|---|
| Durability | Every acknowledged edit survives a process kill (WAL + `synchronous=NORMAL`: survives app crash; OS-crash window ≤ last checkpoint — mitigated by `synchronous=FULL` toggle in Settings → Reliability, default **FULL** for projects ≤ 200 MB) |
| Data-loss budget | RPO ≤ 15 min worst case (last snapshot), ≈ 0 for normal crashes |
| Corruption detection | `integrity_check` on open; checksum of each snapshot stored in `snapshot_record` |
| Multi-window safety | Single writer per file via lock; second instance opens read-only with "Open anyway (risk)" disabled by default |
| Test targets | ≥ 90 % statement coverage in `packages/core` and `packages/db`; fuzz tests for importers; chaos test (kill -9 during 1,000 random commands, then assert FK integrity and that the last acknowledged command is present) |

### 5.4 File format specification

#### 5.4.1 Primary: single-file SQLite project — `*.starline`

| Property | Value |
|---|---|
| Container | SQLite 3 database, `STRICT` tables, UTF-8 |
| Extension / MIME | `.starline` · `application/vnd.starline+sqlite3` |
| Header identification | SQLite magic `SQLite format 3\0`; `PRAGMA application_id = 0x5354524C` (`STRL`) |
| Version | `PRAGMA user_version = <integer schema version>`; `meta('created_by_version')` semver of the app |
| Journal mode | `WAL` normally; **"Sync-folder-safe mode"** switches to `journal_mode=DELETE`, checkpoints on idle (2 s) and on blur, and removes `-wal/-shm` side files so a single file is always consistent for Dropbox/Syncthing/iCloud |
| Sidecars | `<name>.starline.lock` (advisory lock, JSON `{pid, host, startedAt, heartbeatAt}`) and `.starline-snapshots/` folder; the project is fully valid without either |
| Concurrency | Single writer; readers allowed (read-only open for preview/restore) |
| External change detection | File mtime + `meta.revision` compare on focus; if changed externally while open → modal: **Reload** / **Keep mine (Save As…)** — never silent overwrite |
| Size guidance | Typical 5–40 MB (images dominate); soft warning at 500 MB |
| Third-party readability | Documented schema; `sqlite3 file.starline ".tables"` works; the CLI `starline export --format md|json` operates headlessly |

#### 5.4.2 Interchange: directory/zip — `*.starline.zip` (Markdown folder)

```
MyNovel/
  starline.json               # {"format":"starline-folder","schemaVersion":1,"projectId":…,"exportedAt":…}
  project.md                   # YAML frontmatter (title, form, genres, targetWordCount…) + description
  snowflake/01-one-sentence.md … 09-scene-narratives.md
  characters/<slug>.md         # YAML: id, role, color, aliases, want, need, …; body = sections
  relationships.csv            # sourceId,targetId,kind,customLabel,directed,sentiment,groupId,startsAtSceneId,endsAtSceneId,secret,notes
  outline/
    part-01-<slug>/chapter-01-<slug>/scene-01-<slug>.md   # YAML: id, status, pov, location, objective, …; body = synopsis + "---draft---" + text
  lore/<category-path>/<slug>.md
  notes/<slug>.md
  timeline.csv   plotlines.csv   tags.json   custom-fields.json
  attachments/<sha256>.<ext>
```

Rules: file names are slugified, de-duplicated with `-2`, `-3`; all IDs are preserved in frontmatter so re-import is idempotent (matching by `id`, falling back to slug for hand-edited files); unknown frontmatter keys are retained under `extra:` and round-trip.

#### 5.4.3 Web-build storage

PWA stores the live DB in OPFS (`opfs-sahpool` VFS, **no COOP/COEP headers required**); *Open/Save As* uses the File System Access API where available (Chromium) and import/export download elsewhere. A persistent banner ("Browser storage can be cleared by your browser — export a backup") appears until the user has exported within the last 7 days; `navigator.storage.persist()` is requested on first project creation.

### 5.5 Security

- Tauri 2 capabilities allow-list: `fs` only for user-chosen paths and the app data dir; `dialog`, `shell:open` for URLs (validated to `http(s)`), no arbitrary command execution.
- All rich text rendered via ProseMirror schema (no `dangerouslySetInnerHTML`); imported HTML/Markdown sanitised with DOMPurify before conversion; imported attachments MIME-sniffed (magic bytes) and size-capped.
- Supply chain: lockfile-pinned dependencies, `npm audit`/`cargo audit` and SBOM in CI, reproducible builds documented.
- SQL injection: all queries parameterised (Kysely/`?`); no string-built SQL outside migrations.

### 5.6 Compatibility matrix

| Platform | Support level | Notes |
|---|---|---|
| Windows 10 22H2+ / 11 (x64, ARM64) | Tier 1 | WebView2 evergreen runtime bootstrapped by installer |
| macOS 12+ (Intel + Apple Silicon) | Tier 1 | notarised DMG |
| Ubuntu 22.04+/Fedora 39+ (x64) | Tier 1 | AppImage + `.deb`; WebKitGTK 2.42+ |
| Chrome/Edge/Firefox/Safari latest-2 (PWA) | Tier 2 | Safari: OPFS + `navigator.storage.persist` caveats documented |
| iPadOS/Android tablets via PWA | Tier 3 | Responsive layout; no native packaging in v1.0 |
| Native Android/iOS apps | Out of scope v1.0 | Same React bundle can be wrapped by Tauri mobile in v1.3 |

### 5.7 Quality gates & roadmap

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Foundation (3 wks)** | Monorepo, StorageDriver ×2 + contract tests, migrations 0001, command/ChangeBus, shell, theming | Open/create/close file; chaos test green |
| **M1 Planning core (5 wks)** | Snowflake wizard (all validators/triggers), character dossier, outliner corkboard, autosave, trash, undo | Reference user journey "idea → 40-scene outline" in < 90 min, no data loss in 100 fuzz runs |
| **M2 Connected world (4 wks)** | Mentions/backlinks, lore wiki, relationship graph + matrix, tags, custom fields, FTS + palette | Backlink ≤ 10 ms, search ≤ 30 ms budgets met |
| **M3 Safety & output (3 wks)** | Snapshots/restore, exports (MD/JSON/HTML/DOCX/CSV), importers, timeline, notes incubator | Round-trip tests (export → import → export identical) |
| **M4 Polish (3 wks)** | a11y audit, i18n (en/de/ru), perf gates in CI, installers, PWA, docs | Budgets in §5.1 enforced by CI; WCAG 2.2 AA checklist signed off |
| **v1.1** | Series/multi-book bibles, shared lore packs, folder mode | — |
| **v1.2** | Optional SQLCipher passphrase, EPUB export, Scrivener/Fountain export | — |

---

## Appendix A — Research Log, Evidence & Gap Analysis

### A.1 Sources consulted (accessed 2026-10-07)

| Source | What it contributed |
|---|---|
| Google Play listing `com.fabula.app` (search snippets of en_IN / en_US / en_IN&gl=US variants) | Positioning copy; rating ≈ 3.4–3.6★ over ≈ 7 K reviews; "5L+" (≈ 500 K+) downloads shown in one snapshot; sample reviews |
| Apple App Store listing `id6469503124` (US/RU/AR locales) | Feature bullets (characters, scene-by-scene, worldbuilding incl. magic systems, religions, cultures, economies, offline), Snowflake Method by Ingermanson, Pro pricing, "7-day free trial", privacy labels, rating 3.1–4.0★ over ≤ 18 ratings |
| Uptodown / 40407 / UpdateStar descriptions | "Nine simple steps" claim; fiction, fairy tale, fanfiction scope; "limited diagram flexibility, no multi-device sync [cloud] in an older version, pro subscription frustrates some" (v3.6.1) |
| Chrome-Stats aggregation for `com.fabula.app` | Pros: useful relationship diagrams, Chromebook support; cons: stability (login failures, hangs), "limited connections between characters, difficult to manage groups"; lost data after reinstall despite sign-up |
| writersimranthakur.com review (2026-06-28) | 10-step onboarding guide; new book or series; account sign-up + sync; modules (characters, worldbuilding categories, timeline, notes & research, writing assistance); no web version; limited export; ~1 M installs; trial & pricing in INR |
| Play Store user reviews (via search snippets) | Positive: executive-function benefit of small, auto-saved pieces. Negative: stories vanishing after update/logout, scenes deleting after typing, scene-count vs. list mismatch (90 vs 74) with tags missing, unresponsive support, scroll bug in text areas |
| Competitor pages (Story Planner for Writers, Plottr/Capterra, Nola, Untold Novel) | Expected capabilities: iCloud sync, export to Word/Scrivener/Final Draft/Ulysses, plotline tagging, character photos, relationship charts, scene-type vocabularies; common failure mode "data loss on crash/export/sync" |

### A.2 Feature inventory: Fabula vs. this spec

| Fabula capability | Evidence | StarLine section |
|---|---|---|
| Snowflake 9 steps as the backbone | [Verified] store text | §3.4, §4.1 |
| Onboarding guide (10 steps) | [Verified] review | §4.0.1 |
| New book / new series | [Verified] review | §3.3 (series schema-ready) |
| Character profiles (traits, motivations, backstory, relationships, appearance), gallery | [Verified] | §3.5, §4.2 |
| Interactive relationship diagram | [Verified] | §4.2.3 |
| Scene-by-scene planning, chapters, summaries, POV, notes | [Verified] | §3.6, §4.3 |
| Worldbuilding (countries/cities, economy, geography, physical laws, politics, religion, culture, history, inhabitants, magic) | [Verified] | §3.7, §4.4 |
| Timeline | [Verified] | §4.4.1 |
| Notes & research | [Verified] | §4.4.2 |
| AI-style writing assistance / brainstorming | [Verified, details unknown] | **Deliberately out of v1.0** (network + privacy). Replaced by static prompts (§4.1). Optional local-LLM plug-in is a v1.3 research item |
| Cloud account sync | [Verified] | **Replaced** by user-owned file + mirrored snapshots (§4.5.3, §5.4.1) |
| Freemium + Pro subscription | [Verified] | Not reproduced |

### A.3 Weaknesses → requirements traceability

| # | Observed weakness (source) | Requirement | Where |
|---|---|---|---|
| W1 | Data vanishes after update/logout/reinstall; scenes erased after leaving app (Play, Chrome-Stats) | Local ACID file, autosave on every commit, soft-delete Trash, pre-migration snapshots, integrity check, crash-recovery banner | §2.3.3, §3.12, §4.5.3 |
| W2 | Scene list count ≠ visible scenes; tags missing (Play) | Count and list derived from the **same query**; FK-enforced joins; `PRAGMA foreign_key_check` in CI | §3.1, §5.3 |
| W3 | Login failures / hangs / account dependency | No accounts; offline-complete | §5.2 |
| W4 | No desktop/web client; mobile-only (review) | Tauri desktop + PWA, keyboard-first, inspector layout | §2.2.2, §4.0 |
| W5 | Limited export; vendor lock-in | MD/JSON/DOCX/HTML/CSV + open SQLite schema + CLI | §4.5.1, §5.4 |
| W6 | Diagram limited connections; groups hard to manage | Unlimited typed edges, groups, matrix mode, as-of-scene filter | §3.5, §4.2.3 |
| W7 | Scroll bug in text areas (Play) | Single battle-tested editor (ProseMirror) with perf gates | §2.1, §5.1 |
| W8 | Aggressive paywall / subscription fatigue (reviews of this app category) | All planning features free; no feature locks | §1.4 |
| W9 | Unresponsive support | Public issue tracker, local diagnostic bundle, documented file format so users can self-rescue | §5.2, §5.4 |
| W10 | Multi-device sync is the only "backup" | Mirrored immutable snapshots to any folder | §4.5.3 |

### A.4 Assumptions and open questions (need owner confirmation)

1. **Licence** — is the intent open source (recommended: AGPL-3.0 or MPL-2.0) or proprietary?
2. **Single project per file** — acceptable trade-off vs. a "library" file containing many books until v1.1?
3. **AI assistance** — excluded from v1.0 for privacy. Confirm, or specify whether an opt-in local-model integration is wanted earlier.
4. **Mobile** — PWA tablet support is Tier 3; confirm no native mobile in the first release.
5. **Languages at launch** — `en`, `de`, `ru` proposed from Fabula's observed locales and the German "Romanplaner" title.
6. **Legal** — only functional concepts (Snowflake Method steps, generic planner modules) are reproduced; the method is Ingermanson's — attribute him in-app and link to his published description; do not ship Fabula's name, icons or copy.
