# StarLine — Optional cloud backup: analysis (Firebase)

> **Owner request 2026-10-08:** "can we do firebase (as the catreader [CatBookTracker]) and
> local if no firebase." This document analyses that option and proposes a design.
> **Nothing here is scheduled or built** — recorded per the owner's instruction ("just
> analyse and write it somewhere"). Implementation requires its own go-ahead and the
> invariant revision described in §5.

## 1. The CatBookTracker pattern to match

- Firebase (auth + Firestore) is **optional at build time**: keys come from build fields fed
  by an untracked local config; no `google-services.json` in the repo; manual SDK init; an
  empty key means the feature is disabled at runtime.
- The app always runs fully on a **local fallback**; cloud is additive.
- Cloud = structured records (Firestore); local = the single source of truth.

## 2. What maps to StarLine — and what cannot

- **Cannot map: live record sync.** StarLine's source of truth is one SQLite file per library
  (holding one or more books). Per-record cloud sync would need conflict handling the design
  deliberately avoids — spec §4.5.3 already argues that live-syncing the DB through cloud
  folders risks corruption; a record-sync engine has the same failure modes plus merge
  ambiguity.
- **Maps cleanly: snapshot mirroring.** StarLine already produces **immutable snapshots**
  (`VACUUM INTO`) as its backup unit. Cloud backup = uploading those immutable files plus a
  small manifest. Conflict-free by construction — the same safety argument §4.5.3 makes for
  mirroring to a cloud-synced folder, applied to a cloud bucket.

## 3. Options considered

| | A. Snapshot mirror (recommended MVP) | B. A + cloud manifest/registry | C. Live sync engine |
|---|---|---|---|
| What syncs | `.starline` snapshot files to Cloud Storage | snapshots + a manifest doc (device list, last-backup badges, restore-by-date) | per-entity records |
| Conflict surface | none (immutable files) | none | high — rejected |
| Effort | modest | moderate | very high |
| Offline behaviour | queue uploads; the app never blocks | same | complex, fragile |
| Multi-device | restore/download the latest snapshot | + “backed up from phone, restore on tablet” listing | “sync” expectations hard to meet |

## 4. Recommended design (MVP, when green-lit)

- **Identity:** Firebase Auth with Google sign-in. Web/PWA: JS SDK (popup/redirect) works.
  Android APK: WebView popup auth is unreliable → use the `@capacitor-firebase/authentication`
  plugin (native Google flow).
- **Storage layout:** `…/u/<uid>/<library-uuid>/<timestamp>-<reason>.starline` plus
  `manifest.json` (snapshot list + counts). One folder per library; user-owned and deletable.
- **Config:** build-time Firebase config; **no config = module disabled** (guarded dynamic
  import), app stays 100 % local — the CatBookTracker fallback pattern. Honest note: the
  Firebase web config is **not a secret** (it ships in every Firebase web app); real security
  is **Auth + Storage/Firestore rules** — deny by default, per-uid paths, rules file in the
  repo and tested with the Firebase emulator.
- **Upload triggers:** after each successful snapshot (on open if > 1 h old, every 15 min of
  activity, manual) enqueue an upload; opportunistic flush while the app is open and online;
  never blocks the UI; silent retry on next launch. (No reliable background sync on the web;
  Android could add WorkManager later.)
- **Restore:** the Backups screen gains a “Cloud” tab — list from the manifest → download →
  read-only preview + diff (reuses the Slice 11 machinery) → restore (local snapshot first,
  then replace). Single-entity restore works unchanged.
- **Settings gate:** off by default; enabling starts sign-in; disabling leaves files in the
  cloud with an explicit delete action. The privacy status line becomes verifiable at a
  glance: “No network requests — cloud backup is off” / “…cloud backup is on (last upload
  14:02)”.

## 5. What this changes in our invariants (honest accounting)

- Decision 15 and spec §5.2 currently promise **zero network code paths**. An optional module
  revises the wording: *the default build ships and makes no network requests; cloud backup
  is an explicitly-enabled module.* The CI no-network check becomes config-aware: scan the
  default artifact strictly; the sync-enabled flavor gets its own check.
- Decision 10 (no collaboration/social) is untouched: this is single-user backup, nothing
  shared, no feeds.
- Data leaves the device only when the user enables backup. Encryption-at-rest is
  provider-managed by default; **candidate addition: client-side encryption before upload**
  (passphrase-derived key — trade-off: a lost passphrase means unreadable backups). Decide at
  go/no-go.

## 6. Effort & risks (rough, when green-lit)

- MVP (Option A): ~3–5 working sessions — auth plumbing (incl. the Android plugin), upload/
  download jobs, the Cloud tab in Backups, rules + emulator tests, a second build flavor.
- Main risks: Android Google sign-in plugin setup (Firebase project + signing SHA-1), rules
  misconfiguration (mitigated by emulator tests), quota/cost (free tier is ample for personal
  snapshot volumes), two artifacts to keep green.
- **Sequencing:** candidate **Slice 15** after the v1 core (post-Slice 14), or earlier if
  dogfooding creates real backup urgency.

## 7. Open questions (for the go/no-go)

1. Client-side encryption of uploaded snapshots — yes (passphrase, recommended) or plain?
2. One personal Firebase project, or a configurable template others could adapt? (recommend:
   personal now; config stays external either way)
3. Cloud retention: mirror the §4.5.3 thinning (keep last N), or keep everything? (recommend
   mirror the thinning, cap ~1 GB)
4. Provider note: Firebase is the owner's request; the module sits behind one
   `CloudBackupProvider` interface so S3/WebDAV could follow later without a rewrite.

## 8. Verified recipe (from CatBookTracker, 2026-10-09)

Researched with the CatBookTracker bot; its recipe is implemented, audited and written down in
that repo (`docs/GOOGLE_SYNC_SETUP.md` — the console steps; `docs/LOGIN_SYNC_BACKUP_REVIEW.md`
§0 — 14 audited findings). What changes or firms up in the design above:

- **Store: use Drive `appDataFolder`, not Cloud Storage.** Hidden, app-scoped, survives
  reinstall, needs no billing and no Storage rules; the `drive.appdata` scope is
  non-sensitive (no OAuth verification). The snapshot manifest is a JSON file in the same
  folder; uploads are plain REST. This replaces §4's Cloud Storage layout.
- **Skip Firestore entirely** (as already decided — record sync stays rejected).
- **Auth: Google provider only.** Android: `@capacitor-firebase/authentication` (native
  picker → idToken → `signInWithCredential`). Never the JS SDK popup/redirect inside the
  WebView — Google blocks it with `disallowed_useragent`.
- **Config without `google-services.json`**: values (apiKey, appId, projectId, webClientId)
  live in an untracked local config → build-time fields → manual
  `FirebaseApp.initialize(FirebaseOptions)`; an empty config disables the module at runtime.
  Client keys are not secrets — security is the consent screen, the keystore and the rules.
- **Sign-in is optional and never gates the UI.** Couple it to "enable backup", not to app
  entry (CatBookTracker's mandatory login wall is a product choice that would contradict our
  offline-first stance). **Sign-out must never touch local `.starline` files.**
- **Two tokens, two systems**: Firebase holds the ID token; Drive needs its own OAuth access
  token (Identity AuthorizationClient, scope `drive.appdata`, ~1 h lifetime) — cache the grant
  per signed-in account and drop it on sign-out.
- **Setup pitfalls that cost them real time** (all transfer to us): register **SHA-1 and
  SHA-256 for both debug and release** (4 fingerprints; Android Studio can silently recreate
  the debug keystore → fingerprints change); `google.webClientId` must be the **Web** client
  ID (the Android one fails silently); enable the **Drive API** (else every call is `403
  accessNotConfigured`); **publish the OAuth consent screen to "In production"** — in Testing,
  grants expire every **7 days**; emulator QA needs a Play-Store system image with a Google
  account added.
- **No background uploads on the web/WebView**: upload on app open + a manual "Back up now";
  a failed token refresh queues rather than errors (snapshots are immutable, retries are safe).
