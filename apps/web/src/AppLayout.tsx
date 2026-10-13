import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { format, messages } from "@starline/core";
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useActiveProject } from "./active-project";
import { BookSwitcher } from "./BookSwitcher";
import { CommandPalette } from "./CommandPalette";
import { lastActivityTime, onActivity, queryClient } from "./data";
import { useLocaleStore } from "./locale";
import { useOpenEntity } from "./openEntity";
import { SearchSheet } from "./SearchSheet";
import { useSessionStore } from "./session";
import { snapshotAfterActivity, snapshotOnOpenIfStale } from "./snapshots";
import { TabBar } from "./TabBar";
import { relativeTime } from "./time";
import { UndoToast } from "./UndoToast";

/** Route shell: app bar with search, content outlet, bottom tab bar + native lifecycle wiring. */
export function AppLayout() {
  const router = useRouter();
  const session = useSessionStore((state) => state.session);
  const { project: activeProject } = useActiveProject();
  const openEntity = useOpenEntity();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [healthDismissed, setHealthDismissed] = useState(false);

  // Ctrl/Cmd+K from anywhere (the spec's keybinding table). Escape and the arrow keys belong to
  // the dialog itself — cmdk owns them.
  // Ctrl/Cmd+K toggles the palette. The handler rides the layout's root element instead of the
  // window: a window-level keydown listener measurably slows the editor's keystroke-to-paint
  // (24.0 ms p95 against the 16 ms budget, verified by bisect), while React's delegated handler
  // keeps the editor at budget.
  const onAppKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setPaletteOpen((current) => !current);
    }
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);

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

  const banner =
    showHealth && health !== null ? (
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
    ) : null;

  // A language switch remounts the route subtree, which is what re-reads every message.
  const locale = useLocaleStore((state) => state.locale);

  // Writing mode owns the whole screen (PLAN slice 13): no app bar, no tab bar, no page padding.
  const immersive = useRouterState({
    select: (state) => state.location.pathname.startsWith("/write"),
  });

  if (immersive) {
    return (
      <div className="sl-immersive" role="application" onKeyDown={onAppKeyDown}>
        {banner}
        {/* Remount the screens when the book changes: their editors hold local state initialised
          from the row they were given, so switching books without a remount would show the
          previous book's content — the data was never at risk, but the display lied. */}
        <Outlet key={`${locale}-${activeProject?.id ?? ""}`} />
        <UndoToast />
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pt-6 pb-28"
      role="application"
      onKeyDown={onAppKeyDown}
    >
      <header className="sl-appbar">
        <span className="sl-wordmark">StarLine</span>
        {session && activeProject ? (
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-book-switcher"
            onClick={() => setBooksOpen(true)}
          >
            <span aria-hidden="true">▤</span> {activeProject.title}
          </button>
        ) : null}
        {session ? (
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-palette-open"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={() => setPaletteOpen(true)}
          >
            <span aria-hidden="true">⌘</span>K
          </button>
        ) : null}
        {session ? (
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-search-open"
            onClick={() => setSearchOpen(true)}
          >
            <span aria-hidden="true">⌕</span> {messages.search.open}
          </button>
        ) : null}
      </header>
      {banner}
      <Outlet key={locale} />
      {booksOpen ? <BookSwitcher open onClose={() => setBooksOpen(false)} /> : null}
      {searchOpen ? (
        <SearchSheet
          projectId={activeProject?.id ?? null}
          onClose={() => setSearchOpen(false)}
          onOpenHit={(hit) => openEntity(hit.entityType, hit.entityId)}
        />
      ) : null}
      <UndoToast />
      {paletteOpen ? <CommandPalette open onOpenChange={setPaletteOpen} /> : null}
      <TabBar />
    </div>
  );
}
