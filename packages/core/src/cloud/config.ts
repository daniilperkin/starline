/**
 * Cloud-backup configuration (slice 15, decisions 18 and 23).
 *
 * The module is deliberately boring: it answers one question — "can this build offer cloud
 * backup at all?" — and it answers `null` unless the flavor flag is on *and* all four values are
 * present. Two consequences the rest of the slice leans on:
 *
 * - The default build ships with the flag off, so no cloud code is ever imported and the app
 *   stays offline-complete (decision 15 / spec §5.2). The signed APK and the deployed PWA are
 *   built with `STARLINE_CLOUD=1` (decision 23d).
 * - A half-filled config disables the feature instead of half-enabling it: a clean checkout, or a
 *   machine that never ran the console setup, simply has no cloud.
 *
 * The values are Firebase's client config — public by design (they ship in every Firebase app);
 * the security that matters is the consent screen, the signing keys and the per-user Drive folder.
 */

/** Build-time flag: `1` only in a cloud-enabled flavor. */
export const CLOUD_FLAG_KEY = "VITE_CLOUD_ENABLED";

/** The four values the one-time console setup produces (see docs/CLOUD-SETUP.md). */
export const CLOUD_ENV_KEYS = {
  apiKey: "VITE_FIREBASE_API_KEY",
  appId: "VITE_FIREBASE_APP_ID",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  webClientId: "VITE_GOOGLE_WEB_CLIENT_ID",
} as const;

export interface CloudConfig {
  /** Firebase API key (public; used to initialise the SDK and to call Identity Toolkit). */
  apiKey: string;
  /** Firebase Android app id, `1:<project-number>:android:<hash>`. */
  appId: string;
  /** Firebase project id, e.g. `starline-backup`. */
  projectId: string;
  /** **Web** OAuth client id — the Android one silently fails with the native sign-in flow. */
  webClientId: string;
}

export type CloudEnv = Record<string, string | undefined>;

/**
 * Parse a build environment into a cloud config, or `null` when the build must stay local.
 * Pure on purpose: the web app passes `import.meta.env`, tests pass plain objects.
 */
export function parseCloudConfig(env: CloudEnv): CloudConfig | null {
  if (env[CLOUD_FLAG_KEY] !== "1") return null;

  const read = (key: string): string => (env[key] ?? "").trim();
  const apiKey = read(CLOUD_ENV_KEYS.apiKey);
  const appId = read(CLOUD_ENV_KEYS.appId);
  const projectId = read(CLOUD_ENV_KEYS.projectId);
  const webClientId = read(CLOUD_ENV_KEYS.webClientId);

  if (!apiKey || !appId || !projectId || !webClientId) return null;
  return { apiKey, appId, projectId, webClientId };
}

/** Convenience for UI gates: "this build *can* offer cloud backup". */
export function cloudAvailable(env: CloudEnv): boolean {
  return parseCloudConfig(env) !== null;
}
