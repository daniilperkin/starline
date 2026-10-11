/**
 * Web sign-in for cloud backup (slice 15): Google Identity Services, no Firebase.
 *
 * The PWA (and any browser tab) gets its Drive access token straight from GIS — the token model,
 * not the code model, so there is no redirect and no popup: `initTokenClient` opens Google's own
 * account chooser and hands back an access token for the `drive.appdata` scope. Firebase is not
 * involved on this side at all; on Android the native flow supplies the same shape of token.
 *
 * The `sub` from the userinfo call is the Drive folder key, so the phone and the browser land in
 * the same backup folder even though they sign in through different mechanisms.
 */

import type { CloudConfig } from "@starline/core";
import type { CloudAccount } from "./types";

const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPES = "openid email https://www.googleapis.com/auth/drive.appdata";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GisGlobal {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (response: TokenResponse) => void;
          error_callback?: (error: { message?: string }) => void;
        }): TokenClient;
      };
    };
  };
}

let scriptPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services could not be loaded"));
    document.head.append(script);
  });
  return scriptPromise;
}

export interface WebSession {
  accessToken(): Promise<string>;
  email: string;
  subject: string;
}

/** Sign in with Google and return a session whose token is refreshed automatically. */
export async function signInWithGoogle(config: CloudConfig): Promise<WebSession> {
  await loadGis();
  const oauth2 = (window as unknown as GisGlobal).google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services is unavailable in this browser");

  let settle: ((response: TokenResponse) => void) | null = null;
  const client = oauth2.initTokenClient({
    client_id: config.webClientId,
    scope: SCOPES,
    callback: (response) => settle?.(response),
    error_callback: (error) => settle?.({ error: error.message ?? "sign-in failed" }),
  });

  const request = (prompt: string): Promise<TokenResponse> =>
    new Promise<TokenResponse>((resolve) => {
      settle = resolve;
      client.requestAccessToken({ prompt });
    });

  const response = await request("select_account");
  if (!response.access_token) throw new Error(response.error ?? "sign-in was cancelled");

  let token = response.access_token;
  let expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000;

  const userinfo = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userinfo.ok) throw new Error(`Google userinfo failed (${userinfo.status})`);
  const profile = (await userinfo.json()) as { sub?: string; email?: string };
  if (!profile.sub) throw new Error("Google userinfo returned no account id");

  return {
    email: profile.email ?? "",
    subject: profile.sub,
    async accessToken() {
      if (Date.now() < expiresAt) return token;
      const refreshed = await request(""); // silent when the grant is still valid
      if (!refreshed.access_token) throw new Error("Google sign-in expired — sign in again");
      token = refreshed.access_token;
      expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000 - 60_000;
      return token;
    },
  };
}

/** The web session satisfies the shared CloudAccount shape (no sign-out API exists for GIS). */
export function asCloudAccount(session: WebSession): CloudAccount {
  return {
    email: session.email,
    subject: session.subject,
    accessToken: () => session.accessToken(),
  };
}
