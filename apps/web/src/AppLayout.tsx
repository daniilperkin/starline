import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { format, messages } from "@starline/core";
import { Outlet, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lastActivityTime, onActivity, queryClient } from "./data";
import { useSessionStore } from "./session";
import { snapshotAfterActivity, snapshotOnOpenIfStale } from "./snapshots";
import { TabBar } from "./TabBar";
import { relativeTime } from "./time";
import { UndoToast } from "./UndoToast";

/** Route shell: content outlet + bottom tab bar + native lifecycle wiring. */
export function AppLayout() {
  const router = useRouter();
  const session = useSessionStore((state) => state.session);
  const [healthDismissed, setHealthDismissed] = useState(false);

  // Android back button: step back through history, then minimise the app (decision 12).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const subscription = CapApp.addListener("backButton", () => {
      if (router.history.canGoBack()) {
        router.history.back();
      } else {
        void CapApp.minimizeApp();
      }
    });
    return () => {
      void subscription.then((handle) => handle.remove());
    };
  }, [router]);

  // Backgrounding flushes pending autosaves; editors listen for this event (spec §4.2.1).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const subscription = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) window.dispatchEvent(new Event("starline:background"));
    });
    return () => {
      void subscription.then((handle) => handle.remove());
    };
  }, []);

  // Snapshot on open when the newest one is over an hour old (spec §4.5.3, best effort).
  // Delayed a moment: the VACUUM INTO blocks the single-threaded wasm worker, and on a cold
  // phone boot that competes with the first paint and the first taps.
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      void snapshotOnOpenIfStale(session).then((entry) => {
        if (entry !== null) void queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [session]);

  // Rolling snapshot after 15 minutes of edit activity (spec §4.5.3): a slow poll checks the
  // bus's last-activity clock; writes themselves are what reset it.
  useEffect(() => {
    if (!session) return;
    const unsubscribe = onActivity(() => undefined);
    const interval = setInterval(() => {
      void snapshotAfterActivity(session, lastActivityTime()).then((entry) => {
        if (entry !== null) void queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      });
    }, 60_000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [session]);

  const health = session?.health ?? null;
  const showHealth = health !== null && !healthDismissed && (health.crashed || !health.integrityOk);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pt-6 pb-28">
      {showHealth && health !== null ? (
        <div className="sl-banner" role="alert">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {health.crashed
                ? format(messages.health.recovered, { when: relativeTime(health.lastChangeAt) })
                : format(messages.health.integrityFailed, {
                    messages: health.integrityMessages.join("; "),
                  })}
            </p>
            <p className="mt-1 text-xs text-muted">
              {health.crashed ? messages.health.recoveredHint : messages.health.integrityHint}
            </p>
          </div>
          <button
            type="button"
            className="sl-btn-small shrink-0"
            onClick={() => setHealthDismissed(true)}
          >
            {messages.health.dismiss}
          </button>
        </div>
      ) : null}
      <Outlet />
      <UndoToast />
      <TabBar />
    </div>
  );
}
