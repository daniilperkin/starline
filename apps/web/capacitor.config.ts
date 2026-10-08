import type { CapacitorConfig } from "@capacitor/cli";

// The Android wrap (owner decision 12): same web build, shipped as a sideloadable APK.
// Source of truth stays the PWA; this project only packages it. App assets come from
// scripts/generate-icons.mjs via @capacitor/assets (see package.json scripts).
const config: CapacitorConfig = {
  appId: "app.starline",
  appName: "StarLine",
  webDir: "dist",
  backgroundColor: "#060714",
  android: {
    allowMixedContent: false,
  },
};

export default config;
