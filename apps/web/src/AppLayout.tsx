import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { TabBar } from "./TabBar";

/** Route shell: content outlet + bottom tab bar + native lifecycle wiring. */
export function AppLayout() {
  const router = useRouter();

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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pt-6 pb-28">
      <Outlet />
      <TabBar />
    </div>
  );
}
