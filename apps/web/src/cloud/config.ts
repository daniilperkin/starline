import { type CloudConfig, parseCloudConfig } from "@starline/core";

/**
 * The cloud config as this build sees it (slice 15).
 *
 * The `import.meta.env.VITE_*` reads must stay literal: vite replaces the exact expression at
 * build time, so a dynamic `env[key]` lookup would never be substituted. Values come from the
 * untracked `apps/web/android/cloud.properties`, injected by `vite.config.ts` only when the build
 * sets `STARLINE_CLOUD=1` — in every other build this module reports "no cloud" and nothing else
 * in the slice is ever imported.
 */
export const cloudConfig: CloudConfig | null = parseCloudConfig({
  VITE_CLOUD_ENABLED: import.meta.env.VITE_CLOUD_ENABLED as string | undefined,
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  VITE_GOOGLE_WEB_CLIENT_ID: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined,
});

/** True when this artifact can offer cloud backup at all (the Settings gate keys off this). */
export const cloudAvailable: boolean = cloudConfig !== null;

/**
 * True when the build carried the flag but no usable values — a CI build whose repository
 * variables are unset, for instance. The panel says so instead of blaming the flag, because the
 * two situations have different fixes and only one of them is a build-time mistake.
 */
export const cloudFlavourWithoutConfig: boolean =
  import.meta.env.VITE_CLOUD_ENABLED === "1" && cloudConfig === null;
