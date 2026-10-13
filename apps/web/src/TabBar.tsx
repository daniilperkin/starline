import { messages } from "@starline/core";
import { Link, useRouterState } from "@tanstack/react-router";
import { useActiveProject } from "./active-project";
import { useProjectSettings } from "./data";

const TABS = [
  { to: "/plan", key: "plan", glyph: "✦" },
  { to: "/scenes", key: "scenes", glyph: "▤" },
  { to: "/people", key: "people", glyph: "◍" },
  { to: "/world", key: "world", glyph: "✧" },
  { to: "/notes", key: "notes", glyph: "✎" },
] as const;

/** Which module of the project's settings each tab belongs to (spec §4.7). */
type ModuleId = "snowflake" | "characters" | "graph" | "outliner" | "timeline" | "wiki" | "notes";

const MODULE_FOR_TAB: Record<(typeof TABS)[number]["key"], ModuleId> = {
  plan: "snowflake",
  scenes: "outliner",
  people: "characters",
  world: "wiki",
  notes: "notes",
};

export function TabBar() {
  const { project } = useActiveProject();
  const settings = useProjectSettings(project?.id ?? null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav className="sl-tabbar" aria-label={messages.tabs.label}>
      <div className="sl-tabbar-inner">
        {(settings.data === undefined
          ? TABS
          : TABS.filter((tab) => settings.data?.enabledModules.includes(MODULE_FOR_TAB[tab.key]))
        ).map((tab) => {
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
