import init0001 from "./0001_init.sql?raw";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Forward-only, numbered migrations (spec §4.5.4). Append here; never edit a shipped one. */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: "0001_init", sql: init0001 }];

export const LATEST_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);
