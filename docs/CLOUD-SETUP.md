# Cloud backup setup — the one-time Google console work

Slice 15 ships an **optional** cloud backup: immutable snapshot files mirrored to your own Google
Drive (`appDataFolder`), Firebase Auth with Google sign-in, off by default, and absent from the
default build entirely (the cloud flavor is built with `STARLINE_CLOUD=1`).

This document is the one-time setup only. The click-path is adapted from CatBookTracker's verified
runbook (its `docs/GOOGLE_SYNC_SETUP.md`), which already ships this exact pattern; the differences
are called out. Nothing here is a secret: client keys are public by design, and the security that
matters is the consent screen, the signing keys and the per-user folder.

## What is already done on this machine

- **Release keystore** — `%USERPROFILE%\.starline\starline-release.keystore`, credentials in the
  untracked `apps/web/android/keystore.properties`, `signingConfigs.release` wired (slice 20).
- **The four fingerprints below** — read from the actual keystores with `keytool`, so they are
  correct for the APKs this repo builds today.

| Key | SHA-1 | SHA-256 |
| --- | --- | --- |
| debug (`~/.android/debug.keystore`, alias `androiddebugkey`) | `4C:CA:63:82:E4:7F:B2:25:36:9C:A4:3A:D1:CB:01:09:4E:85:DF:73` | `D2:44:34:F7:5A:F4:40:C2:6D:44:A9:67:C3:A9:A4:BB:D3:70:F7:AA:06:1B:65:8E:81:B4:0A:DF:44:DD:9C:2B` |
| release (`starline-release.keystore`, alias `starline`) | `9E:6F:D4:26:E1:81:35:DD:49:37:95:AD:92:F9:02:3B:52:0A:4C:B9` | `24:70:0C:EF:78:11:0B:FE:E8:41:D5:3F:BF:DE:D4:73:6A:C0:5A:8B:3F:0E:1E:FF:F9:CB:6F:86:63:AF:C4:FD` |

Both keys are needed because Google binds OAuth to the **signing certificate**, and debug and
release are different certificates. Re-read them any time:

```bash
./gradlew signingReport                     # from apps/web/android
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
```

## Console — Firebase (console.firebase.google.com)

1. **Add project** → name it → Google Analytics **off** → Create.
2. Project overview → **Add app → Android** → package name `app.starline` (it must equal
   `applicationId` exactly) → Register app.
   **Do not download and do not commit `google-services.json`** — this build never reads it.
3. Gear → **Project settings → Your apps** → the Android app → **Add fingerprint** — all four
   values from the table above.
   Each fingerprint creates an additional Android OAuth client for that (package, certificate)
   pair. Four is the expected number; do not "tidy them up".
4. **Build → Authentication → Get started → Google → Enable** → pick a support email → Save.
5. Authentication → Settings → **Web SDK configuration** → copy the **Web client ID**. This exact
   value is `webClientId`; the *Android* client ID silently fails with the native sign-in flow.
6. Project settings → Your apps → the Android app → copy **App ID** (`1:…:android:…`), **API key**
   and **Project ID**.

## Console — Google Cloud (same project)

7. **APIs & Services → Library → Google Drive API → Enable.** Without it every upload answers
   `403 accessNotConfigured`.
8. **Google Auth Platform → Audience** → User type *External*, app name, support email, developer
   contact → **Publish app** until the status reads **In production**. While it sits in *Testing*,
   Google expires every authorization after **7 days**, which reads like random weekly breakage.
9. **Google Auth Platform → Data access** → add scope `https://www.googleapis.com/auth/drive.appdata`.
   It is non-sensitive: no verification, no 100-user cap, no "unverified app" screen.
10. **Firestore: skip.** Snapshot mirroring is REST into `appDataFolder` plus a manifest JSON; it
    needs no database. (If one is ever added: it must be *Standard* edition — the Enterprise
    MongoDB-compatible edition cannot be reached by the Android SDK.)

## Where the values go

Into the untracked `apps/web/android/cloud.properties` (gitignored; a tracked
`cloud.properties.example` shows the shape):

```
firebase.apiKey=<API key from step 6>
firebase.appId=<App ID from step 6>
firebase.projectId=<Project ID from step 6>
google.webClientId=<Web client ID from step 5>
```

Gradle turns these into build fields; the app initialises Firebase manually. **Missing or empty
values disable the cloud module at runtime** — the app stays 100 % local, which is also how the
routine QA runs stay stable (see below).

## Pitfalls that cost real time elsewhere

- **Android Studio recreates `~/.android/debug.keystore` if it is deleted**, and both debug
  fingerprints change silently. Sign-in then fails with *"Developer console is not set up
  correctly"*, which really means: the installed APK's certificate is not registered. Fix by
  re-running `signingReport` and adding the new lines.
- **Missing-account failures masquerade as network failures.** Credential Manager distinguishes
  `NoCredentialException` (no Google account on the device) from
  `GetCredentialCancellationException` (the user dismissed the sheet). Map both families
  explicitly or the error copy lies.
- **Do not use Android Studio's Firebase Assistant** — it wants to inject the google-services
  plugin and JSON file; this setup deliberately has neither.
- **Cheap status checks without the console:** a freshly downloaded `google-services.json` is a
  status report — `client_type: 3` is the Web client ID, and each `client_type: 1` entry's
  `android_info.certificate_hash` is one registered SHA-1.

## QA strategy for the cloud slice

- **Routine UI passes need no Google account.** Keep a byte copy of `cloud.properties`, blank the
  four values, build the local-only variant, run the whole journey, then restore the file
  byte-identically (the same discipline as the release keystore). No account state to rot.
- **Testing the real sign-in** needs a **Play-Store system image** AVD — `medium_phone` already is
  one (`google_apis_playstore`) — with a Google account added inside the emulator once
  (Settings → Passwords & accounts). Treat that account as disposable: an unclean emulator
  shutdown can wipe the data partition and sign it out.
- A fresh Play AVD starts with **0 accounts**, which is useful on demand: the sign-in button then
  exercises the no-account error path for free.
- The account picker is system UI, not ours — drive it with `uiautomator dump` → tap the bounds
  centre, never guessed coordinates.
