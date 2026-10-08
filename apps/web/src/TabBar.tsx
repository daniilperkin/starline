import { messages } from "@starline/core";
import { Link, useRouterState } from "@tanstack/react-router";

const TABS = [
  { to: "/plan", key: "plan", glyph: "✦" },
  { to: "/scenes", key: "scenes", glyph: "▤" },
  { to: "/people", key: "people", glyph: "◍" },
  { to: "/world", key: "world", glyph: "✧" },
  { to: "/notes", key: "notes", glyph: "✎" },
] as const;

export function TabBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav className="sl-tabbar" aria-label="Sections">
      <div className="sl-tabbar-inner">
        {TABS.map((tab) => {
          const active = pathname === tab.to || pathname.startsWith(`${tab.to}/`);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className="sl-tab"
              data-active={active}
              aria-current={active ? "page" : undefined}
            >
              <span className="sl-tab-glyph" aria-hidden="true">
                {tab.glyph}
              </span>
              {messages.tabs[tab.key]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
