import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The Capacitor (APK) build ships inside a local app container where updates arrive via the
// APK itself — a service worker there only risks serving stale assets after an app update.
// Field builds set STARLINE_CAP=1 (see DECISIONS.md 12); the PWA build stays the default.
const isCapacitorBuild = process.env.STARLINE_CAP === "1";

// Hosting at a subpath (GitHub Pages project site = /starline/) sets STARLINE_BASE; the
// default build stays at the root for Cloudflare Pages / Netlify / local preview.
const base = process.env.STARLINE_BASE ?? "/";

// Cloud backup (slice 15, decisions 18/23). With STARLINE_CLOUD=1 four values are injected as
// VITE_* defines; without it every value stays blank, the cloud config reports "no cloud" and no
// cloud code is ever imported — the default build stays offline-complete (decision 15).
//
// The values come from the untracked android/cloud.properties for local builds (APK and PWA
// alike), or from repository variables passed in as environment variables when that file is
// absent — CI runners, where it is deliberately untracked. They are Google client identifiers,
// not secrets: every deployed web bundle ships them, which is why a repository variable is the
// right home rather than a secret.
const CLOUD_ENV_KEYS: Record<string, string> = {
  "firebase.apiKey": "STARLINE_FIREBASE_API_KEY",
  "firebase.appId": "STARLINE_FIREBASE_APP_ID",
  "firebase.projectId": "STARLINE_FIREBASE_PROJECT_ID",
  "google.webClientId": "STARLINE_GOOGLE_WEB_CLIENT_ID",
};

function readCloudProperties(): Record<string, string> {
  const fromEnv: Record<string, string> = {};
  for (const [key, name] of Object.entries(CLOUD_ENV_KEYS)) {
    const value = process.env[name];
    if (value && value.length > 0) fromEnv[key] = value;
  }
  try {
    const text = readFileSync(
      fileURLToPath(new URL("android/cloud.properties", import.meta.url)),
      "utf8",
    );
    const values: Record<string, string> = {};
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (/^[A-Za-z0-9._]+$/.test(key) && value.length > 0) values[key] = value;
    }
    return { ...values, ...fromEnv };
  } catch {
    return fromEnv; // no file is normal on CI; the environment is then the only source
  }
}

const cloudEnabled = process.env.STARLINE_CLOUD === "1";
const cloudValues = cloudEnabled ? readCloudProperties() : {};
const cloudDefine: Record<string, string> = {
  "import.meta.env.VITE_CLOUD_ENABLED": JSON.stringify(cloudEnabled ? "1" : "0"),
  "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify(cloudValues["firebase.apiKey"] ?? ""),
  "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify(cloudValues["firebase.appId"] ?? ""),
  "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify(
    cloudValues["firebase.projectId"] ?? "",
  ),
  "import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID": JSON.stringify(
    cloudValues["google.webClientId"] ?? "",
  ),
};

export default defineConfig({
  base,
  define: cloudDefine,
  plugins: [
    react(),
    tailwindcss(),
    ...(isCapacitorBuild
      ? []
      : [
          VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
            manifest: {
              name: "StarLine",
              short_name: "StarLine",
              description: "Offline novel-planning workstation — your story, among the stars.",
              theme_color: "#060714",
              background_color: "#060714",
              display: "standalone",
              start_url: base,
              scope: base,
              icons: [
                { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
                {
                  src: "icons/maskable-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable",
                },
              ],
              // Long-press the installed icon → straight into quick capture (spec §4.4.2's
              // global hotkey, translated to the phone's own affordance).
              shortcuts: [
                {
                  name: "Quick capture",
                  short_name: "Capture",
                  url: `${base}#/notes?capture=1`,
                },
              ],
            },
            workbox: {
              // Offline-complete (spec §5.2): the shell, the sqlite-wasm binary and the worker
              // chunks are all precached, so the app runs with the network off after first visit.
              globPatterns: ["**/*.{js,css,html,wasm,svg,png,ico,webmanifest}"],
              maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            },
          }),
        ]),
  ],
  server: { port: 5183 },
  preview: { port: 5184 },
  optimizeDeps: {
    // Pre-bundle everything the shell imports at boot. Without this, vite discovers a new
    // dependency mid-session, re-optimizes and hard-reloads the page — which aborts an
    // in-flight library create (this flaked the E2E gate twice) and slows cold start.
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "zustand",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/extension-mention",
      "@tiptap/suggestion",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@tanstack/react-virtual",
      "@xyflow/react",
      "d3-force",
      // The workspace packages are dependencies like any other: adding an export to core
      // (slice 9's tags/grid) re-optimises them and reloads the page mid-journey unless they
      // are pinned here too. Only `core` can be pre-bundled — `@starline/db` imports its
      // migration SQL with `?raw`, which the optimizer cannot load, and pre-bundling it kills
      // the dev server outright ("UNLOADABLE_DEPENDENCY").
      "@starline/core",
    ],
  },
});
