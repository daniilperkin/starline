# StarLine vs Fabula — parity analysis

> **Owner directive 2026-10-09:** StarLine should be a *better* clone of Fabula
> (`com.fabula.app`): contain every feature its paid members get, and can have more and better.
> This document is the working checklist. Verified against the Play/App Store listings,
> UpdateStar's feature FAQ and user reviews on 2026-10-09.
>
> **Status: the checklist below stands as implemented through the M5 close** (slices 21-38);
> re-verify against the stores before any future parity push.

## 1. Fabula's model (what "paid members get")

- **App**: `com.fabula.app` — "Story & Book Writing — Fabula", Fabula Apps (Natalia Bosyakova),
  fabula.so. Play: 1M+ downloads, ~3.7★; iOS counterpart 4.6★ (57 ratings). Contains ads +
  in-app purchases; 19 languages; Android 7+.
- **Pro**: $4.99/month or $39.99/year (7-day free trial).
- **Pro unlocks**: unlimited worlds and characters, extra inspiration content, and **export**
  (a review states plainly: "export is a paid feature"). The free tier carries ads, caps
  characters/worlds, and cannot export.
- **Free-tier core** (per listings): Snowflake-Method planning (nine steps), characters,
  scenes/plot, world building, notes, plotlines, structure view, timeline, images.
- **Multi-device**: no true sync yet — the developer has said a server-side data store is
  planned; data is primarily on-device (some server recovery exists for account holders).
- **Known weaknesses (from their own reviews)**: very long load times; laggy saves; several
  credible "the app deleted my work, no recovery" reports; no landscape orientation; Worlds
  gated behind Pro; ads + tracking (contact info, device IDs); no declared accessibility
  features.

## 2. Feature matrix

| Capability | Fabula | StarLine | Verdict |
|---|---|---|---|
| Snowflake Method, 9 steps | Yes | Shipped — wizard 1–9 with validators, staleness, extraction triggers | **better** |
| Characters: personality, motivation, conflicts, backstory, habits | Yes | Shipped — dossier | parity |
| Character relationships | Yes (basic) | S8 — matrix + graph, sentiment/directed/secret, a11y list twin | **better** |
| Scenes: planning, pacing, tension | Yes | Shipped — statuses, outcomes, POV, plotlines, estimates | parity+ |
| Plotlines + balance stats | Yes | S9 — grid + "appears in N of M, longest gap" | **better** |
| World building (rules, magic, culture, economy…) | Yes | S6 — lore wiki, seeded taxonomy, kind templates, child entries | **better** |
| Notes | Yes | Basic shipped; S14 — incubator board, promote-to, attachments | **better** |
| Timeline | Yes | S10 — swimlanes, drag storyTime, conflict warnings | **better** |
| "See the whole book at a glance" | Yes | Dashboard + outliner: list, corkboard and plotline grid (S21, S32) | **better** |
| Images / visual materials | Yes | S14 — attachments per character/lore (≤ 20 MB, dedupe) | parity |
| Export | **Pro only** | S12 — MD zip, JSON, HTML, DOCX, CSV, plain text; round-trip gate | **better** (free) |
| Cross-device / cloud | Unfinished | S15 — opt-in immutable snapshot mirroring to the user's own Google Drive `appDataFolder`, off by default, absent from the default build | **better** (when enabled) |
| Inspiration content | Pro extra | Bundled static prompt library + a daily card (S16), all offline | **better** |
| Ads | Yes | None, ever (decision 10) | **better** |
| Limits (worlds/characters) | Free tier capped | Unlimited everything, free | **better** |
| Privacy | Ads + tracking, contact/device IDs | Offline-complete, no accounts, no telemetry | **better** |
| Data safety | Loss reports, no recovery | Snapshots, trash, undo, crash recovery, integrity checks (shipped); restore drill (S11) | **better** |
| Languages | 19 | English, Ukrainian and German at full parity (real plural rules); adding a locale is one catalogue file | behind on count, equal in quality |
| Accessibility | None declared | WCAG 2.2 AA target, axe scans in CI | **better** |

## 3. Where we already win (by design, not by accident)

- The safety net is the headline: Fabula's worst reviews are data loss. StarLine ships
  crash-recovery markers, integrity checks, snapshots, trash + undo today, with the restore
  drill in S11 and immutable cloud snapshots in S15.
- No ads, no accounts, no telemetry, no Pro gates — the whole app is free and unlimited.
- Backlinks/mentions, FTS search, relationship matrix/graph, custom fields and tags go past
  Fabula's feature list rather than merely matching it.

## 4. Gaps and candidates

| Candidate | Why | Where it could land |
|---|---|---|
| Story-structure templates (3-act, Hero's Journey, Save the Cat beat sheet, story circle → generate a scene skeleton) | Not in Fabula; a natural "more and better" for outline building | **Shipped in S16** (builds on `createScenesFromList`) |
| Daily inspiration card (offline, from the bundled prompt library) | Matches Fabula's paid "inspiration content" with zero network | **Shipped in S16** |
| Series container (several books per library, schema-ready) | Fabula is per-book; we already allow multiple books in one `.starline` file | v1.1 (already in spec) |
| iOS packaging | Fabula ships iOS; our PWA already runs on iPhone browsers; a native iOS build needs a Mac + signing | Only if asked |

## 5. Sequencing

All four steps below shipped; the list is kept as the original order.

1. **M2 (S6–S10)** as planned — covers Fabula's core loop (world, relationships, plotlines,
   timeline) and adds search/backlinks Fabula does not have.
2. **M3 (S11–S14)** — safety and output: restore UI, export/import, writing mode, notes.
3. **Slice 15** — opt-in cloud backup (snapshot mirroring; the safe version of Fabula's
   unfinished sync).
4. **Slice 16** — the §4 extras (shipped: story-structure templates, the daily card and the
   extras surface).
