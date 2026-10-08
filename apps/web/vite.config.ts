import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The Capacitor (APK) build ships inside a local app container where updates arrive via the
// APK itself — a service worker there only risks serving stale assets after an app update.
// Field builds set STARLINE_CAP=1 (see DECISIONS.md 12); the PWA build stays the default.
const isCapacitorBuild = process.env.STARLINE_CAP === "1";

export default defineConfig({
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
              start_url: "/",
              scope: "/",
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
});
