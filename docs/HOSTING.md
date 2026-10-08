# Hosting the StarLine PWA

**Live:** https://daniilperkin.github.io/starline/ (GitHub Pages, deployed by
`.github/workflows/deploy-pages.yml` on every push to `main`).

## Why hosting is needed at all

The app's storage (OPFS) and its offline mode (service worker) only work in a **secure
context** — `https://` or `localhost`. A phone cannot reach a PC's localhost, and a plain
`http://192.168.x.x` origin is *not* secure, so the app cannot store anything there. An
HTTPS URL is the only no-cable install route for the PWA (the APK sidesteps this: Capacitor
serves it from `https://localhost` inside the WebView).

## What hosting is — and is not

- **Is:** a static host serving `apps/web/dist/` over HTTPS (~2 MB, service-worker
  precached). No server code, no database, no API, no accounts, no environment secrets.
- **Is not:** a data path. The app makes zero network calls at runtime (enforced by
  `scripts/check-no-network.mjs`); every story lives in the device's OPFS and never leaves
  it. Hosting is only the delivery truck.

## GitHub Pages (current route)

- Project site → the build runs with `STARLINE_BASE=/starline/` so assets, the manifest
  `start_url` and the service-worker `scope` all sit under the subpath.
- Deploy is automatic: push to `main` → Actions builds `apps/web/dist` → Pages publishes.
- Manual build: `cd apps/web && STARLINE_BASE=/starline/ node node_modules/vite/bin/vite.js build`.
- Note: a Pages site served from a private repo is itself **public** (the URL is
  unlisted, but anyone with the link can load the app shell — the shell contains no user
  data, which stays on-device).

## Alternatives (any static host works)

1. **Cloudflare Pages** — connect the repo (works with private repos on the free tier) or
   drag-and-drop `apps/web/dist`. Build command `pnpm --filter @starline/web build`
   (leave `STARLINE_BASE` unset → served at the root), output dir `apps/web/dist`.
2. **Netlify / Vercel** — same shape: build command + `apps/web/dist` as publish dir.
3. **Local / LAN development only** — `node scripts/verify-pwa.mjs` serves a build on
   `localhost:5184`; `localhost` is a secure context, so OPFS works there.

## Updates & platform notes

- Updates flow through the service worker (`autoUpdate`): open the app, the new version
  installs in the background and applies on the next launch. No re-sideloading.
- Android Chrome is the primary target ("Add to Home screen" installs it standalone).
- iOS Safari works via Share → "Add to Home Screen"; Safari may evict site storage after
  long inactivity, so iOS is best treated as a secondary device for now.
