/**
 * Native (Android) sign-in for cloud backup (slice 15, decision 24).
 *
 * One consent, two tokens: the plugin returns the Google ID token (who signed in) and a Drive
 * access token (what may be written to the app's private folder). No Firebase is involved — it
 * would only have supplied the ID token, while Drive needs its own OAuth token anyway.
 *
 * The plugin is loaded lazily: a browser build never fetches this module, and a build without the
 * cloud flavour never reaches it at all.
 */

import type { CloudConfig } from "@starline/core";
import type { CloudAccount } from "./types";

interface NativeAuthResult {
  idToken?: string;
  accessToken?: string;
  email?: string;
  subject?: string;
}

interface NativeAuthPlugin {
  signIn(options: { webClientId: string }): Promise<NativeAuthResult>;
  getAccessToken(): Promise<{ accessToken?: string }>;
  signOut(): Promise<{ signedOut: boolean }>;
}

let cached: NativeAuthPlugin | null = null;

/**
 * Loads the plugin into `cached` — and deliberately returns **nothing**.
 *
 * Capacitor's plugin proxy is thenable (it forwards property access to the native side), so
 * returning it from an async function makes the promise adopt it and call `.then()` on the native
 * plugin, which answers `"StarlineGoogleAuth.then()" is not implemented on android`. Keeping the
 * proxy inside this module and never handing it across an await boundary is the fix.
 */
async function loadPlugin(): Promise<void> {
  if (cached) return;
  const { registerPlugin } = await import("@capacitor/core");
  cached = registerPlugin<NativeAuthPlugin>("StarlineGoogleAuth");
}

/** True when this app runs inside the Android shell (where Identity Services is blocked). */
export async function isNativeShell(): Promise<boolean> {
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform();
}

export async function signInNative(config: CloudConfig): Promise<CloudAccount> {
  await loadPlugin();
  const auth = cached;
  if (!auth) throw new Error("the Android sign-in plugin is unavailable");
  const result = await auth.signIn({ webClientId: config.webClientId });
  if (!result.accessToken || !result.subject) {
    throw new Error("Google sign-in returned no Drive access");
  }

  let token = result.accessToken;
  let expiresAt = Date.now() + 55 * 60 * 1000; // Google's Drive tokens live about an hour

  return {
    email: result.email ?? "",
    subject: result.subject,
    async accessToken() {
      if (Date.now() < expiresAt) return token;
      // Re-reading is cheap: Google caches the grant until it expires, so this usually does not
      // prompt. If it does need the user, the sheet is Google's own.
      const refreshed = await auth.getAccessToken();
      if (!refreshed.accessToken) throw new Error("Google sign-in expired — sign in again");
      token = refreshed.accessToken;
      expiresAt = Date.now() + 55 * 60 * 1000;
      return token;
    },
  };
}
