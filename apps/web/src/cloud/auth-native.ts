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

async function plugin(): Promise<NativeAuthPlugin> {
  if (!cached) {
    const { registerPlugin } = await import("@capacitor/core");
    cached = registerPlugin<NativeAuthPlugin>("StarlineGoogleAuth");
  }
  return cached;
}

/** True when this app runs inside the Android shell (where Identity Services is blocked). */
export async function isNativeShell(): Promise<boolean> {
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform();
}

export async function signInNative(config: CloudConfig): Promise<CloudAccount> {
  const auth = await plugin();
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
