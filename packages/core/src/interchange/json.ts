/**
 * Canonical JSON interchange (spec §4.5.1): one document holding every table of one project,
 * rich text as ProseMirror JSON, versioned independently of the database schema. This is the
 * format the round-trip gate compares, so key order is fixed here and nowhere else.
 */
import type { UUID } from "../primitives";
import { slugify } from "./slug";
import type { ExportApp, ExportDocument, ExportRow, ProjectExport } from "./types";
import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION } from "./types";

export const STARLINE_APP_NAME = "StarLine";
/** Bumped with the app version; part of the export so a re-import knows what wrote it. */
export const STARLINE_APP_VERSION = "0.11.0";

export function buildExportDocument(
  data: ProjectExport,
  options: { exportedAt: number; app?: ExportApp },
): ExportDocument {
  const document: ExportDocument = {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: options.exportedAt,
    app: options.app ?? { name: STARLINE_APP_NAME, version: STARLINE_APP_VERSION },
    project: data.project,
    series: data.series,
    graphPositions: data.graphPositions,
  };
  for (const [key, rows] of Object.entries(data.tables)) {
    document[key] = rows;
  }
  return document;
}

/** Pretty JSON with a trailing newline — readable in a diff, stable for the round-trip gate. */
export function serializeExportDocument(document: ExportDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function exportFileName(title: string): string {
  return `${slugify(title, "project")}.starline.json`;
}

export interface ParsedExport {
  document: ExportDocument;
  data: ProjectExport;
  schemaVersion: number;
  exportedAt: number;
  app: ExportApp;
}

export type ParseResult = { ok: true; value: ParsedExport } | { ok: false; issues: string[] };

/**
 * Version handling (spec §4.5.4): older versions are upgraded, the current one loads, anything
 * newer is refused with a message a human can act on rather than a half-imported project.
 */
export function parseExportDocument(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      issues: [`not valid JSON: ${cause instanceof Error ? cause.message : "?"}`],
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, issues: ["the file does not contain a StarLine export object"] };
  }
  const raw = parsed as Record<string, unknown>;
  const issues: string[] = [];
  if (raw.format !== EXPORT_FORMAT) {
    issues.push(
      `unknown format: ${String(raw.format ?? "(missing)")} — expected "${EXPORT_FORMAT}"`,
    );
  }
  const schemaVersion = Number(raw.schemaVersion ?? 0);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    issues.push("missing schemaVersion");
  } else if (schemaVersion > EXPORT_SCHEMA_VERSION) {
    issues.push(
      `this export was written by a newer StarLine (schema ${schemaVersion}, this build reads ${EXPORT_SCHEMA_VERSION}) — update StarLine to import it`,
    );
  }
  const project = raw.project;
  if (project === null || typeof project !== "object" || Array.isArray(project)) {
    issues.push("the export has no project object");
  } else if (typeof (project as ExportRow).id !== "string") {
    issues.push("the project has no id");
  }
  if (issues.length > 0) return { ok: false, issues };

  const upgraded = upgradeExportDocument(raw, schemaVersion);
  const document = upgraded as ExportDocument;
  const tables: Record<string, ExportRow[]> = {};
  for (const [key, value] of Object.entries(document)) {
    if (Array.isArray(value)) tables[key] = value as ExportRow[];
  }
  const series = document.series;
  return {
    ok: true,
    value: {
      document,
      data: {
        project: document.project,
        series: series !== null && typeof series === "object" ? series : null,
        graphPositions:
          document.graphPositions !== null && typeof document.graphPositions === "object"
            ? document.graphPositions
            : {},
        tables,
      },
      schemaVersion,
      exportedAt: Number(document.exportedAt ?? 0),
      app:
        document.app !== null && typeof document.app === "object"
          ? (document.app as ExportApp)
          : { name: STARLINE_APP_NAME, version: "unknown" },
    },
  };
}

/**
 * Explicit upgrade seam (spec §4.5.4). v1 is the first published version, so nothing to migrate
 * yet; a v2 must add its step here (`upgradeV1toV2`) rather than editing the v1 reader.
 */
export function upgradeExportDocument(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  if (fromVersion > EXPORT_SCHEMA_VERSION) {
    throw new Error(`unsupported export schema version ${fromVersion}`);
  }
  return raw;
}

/** Convenience for callers that already know where the document came from. */
export function projectIdOf(document: ExportDocument): UUID {
  return document.project.id as UUID;
}
