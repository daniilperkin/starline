# Android release — the signed APK

StarLine ships two APKs, and they are not interchangeable (decision 22):

| | **Debug** (`artifacts/starline-debug.apk`) | **Release** (`artifacts/starline-release.apk`) |
| --- | --- | --- |
| Purpose | the QA artifact — what `scripts/verify-android.mjs` drives | what a writer installs |
| Web bundle | built with `VITE_STARLINE_DEV=1`, so `window.__starlineDev` exists for the test harness | production build, **no DEV hook** |
| Signing | Android's debug key | the StarLine release key |
| Where it is built | laptop or CI | **laptop only** — the keystore never leaves this machine |

Both are gitignored. Neither is uploaded anywhere; they travel to a phone by cable or by the
owner's own file transfer.

## The release key

- Keystore: `%USERPROFILE%\.starline\starline-release.keystore` — **outside the repository**, so a
  clean checkout can never carry it.
- Credentials: `apps/web/android/keystore.properties` (untracked, ignored by `.gitignore`).
  It points at the keystore with an absolute path and holds the store/key passwords.
- `apps/web/android/app/build.gradle` loads that file when it exists. Without it the build still
  runs and produces an **unsigned** release APK — a clean checkout is never broken by a missing
  secret.

**Back up both files.** The keystore is the only thing that can sign an update that installs over
an existing installation. Lose it and every user has to uninstall first — which also deletes the
app's private storage, including their `.starline` files. (That is exactly why the app also has
snapshots and exports: a library that has been exported can always come back.)

## Building a release

```bash
cd apps/web
STARLINE_CAP=1 node node_modules/vite/bin/vite.js build      # production bundle, no DEV hook
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
JAVA_HOME="C:/Program Files/Java/jdk-21" ./gradlew.bat assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../../../artifacts/starline-release.apk
```

(Three `../` from `apps/web/android` back to the repo root, then into `artifacts/`.)

## Verifying what was built

```bash
# signed, and by which certificate
"$ANDROID_HOME/build-tools/<version>/apksigner.bat" verify --print-certs artifacts/starline-release.apk

# package id + version actually inside the file
"$ANDROID_HOME/build-tools/<version>/aapt.exe" dump badging artifacts/starline-release.apk | head -3
```

Expected: `applicationId app.starline`, `versionCode`/`versionName` matching
`apps/web/android/app/build.gradle`, and a certificate whose digest matches the release keystore.
A debug-signed file will report `CN=Android Debug` — that is the QA artifact, not this one.

## Installing

```bash
adb install -r artifacts/starline-release.apk        # over USB
```

On the phone without a cable: copy the file across, open it, and allow installing from that
source when Android asks. Android refuses to install a release APK **over** a debug-signed
installation (different key): uninstall the debug build first, or install the release build on a
phone that never had the debug one.

## Version bumps

`apps/web/android/app/build.gradle`:

- `versionCode` — an integer Android compares; **must increase** for every release that is meant
  to install over a previous one.
- `versionName` — what the user sees; keep it in step with `STARLINE_APP_VERSION` in
  `packages/core/src/interchange` (the export format records it).

## Why CI does not build this

GitHub runners get no keystore (by design) and no Android emulator (decision 22), so CI runs the
web gates and the durability suites; the Android QA journey and the release build stay on the
laptop. `scripts/verify-android.mjs` drives the **debug** APK — it needs the DEV hook to seed
fixtures quickly.

## Sideloading on MIUI / HyperOS

HyperOS (and MIUI before it) refuses `adb install` with `INSTALL_FAILED_USER_RESTRICTED` unless
the developer option "Install via USB" is on. The scripted QA falls back to `adb push` +
`pm install`. For a manual sideload, open the APK from the phone's file manager; when Play
Protect asks whether to send the app for a security scan, choose **Don't send** — the APK is
signed by the StarLine release key, which Play Protect simply does not know.

