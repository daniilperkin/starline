/**
 * One place that turns a project into the bytes of one export format. The export worker calls it,
 * so everything here must stay free of DOM access — the only browser-side step is saving the
 * result (`files.ts`).
 */
import {
  buildAttachmentFiles,
  buildCsvTables,
  buildDocxFiles,
  buildExportDocument,
  buildHtml,
  buildManuscript,
  buildMarkdownFolder,
  buildMarkdownManuscript,
  buildPlainText,
  exportFileName,
  type ManuscriptOptions,
  type ProjectExport,
  serializeExportDocument,
} from "@starline/core/interchange";
import { zipFiles, zipTextFiles } from "@starline/core/zip";

export type ExportFormat =
  | "json"
  | "markdown-folder"
  | "docx-manuscript"
  | "docx-planning"
  | "html"
  | "markdown-manuscript"
  | "text"
  | "csv";

export interface ExportOptions extends ManuscriptOptions {
  /** Include the notes appendix in planning/manuscript output. */
  includeNotes?: boolean;
  /** Restrict the manuscript to these chapters (empty = all). */
  chapterIds?: readonly string[];
}

export interface BuildRequest {
  format: ExportFormat;
  options: ExportOptions;
  data: ProjectExport;
  exportedAt: number;
  title: string;
}

export interface BuiltFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

const encoder = new TextEncoder();

function textFile(name: string, mime: string, text: string): BuiltFile {
  return { name, mime, bytes: encoder.encode(text) };
}

export function slugForFileName(title: string): string {
  return exportFileName(title).replace(/\.starline\.json$/, "");
}

/** The whole build, in one switch — the worker only marshals this. */
export function buildExportFile(request: BuildRequest): BuiltFile {
  const { format, data, options, title } = request;
  const base = slugForFileName(title);
  const manuscriptOptions: ManuscriptOptions = {
    includeSynopsis: options.includeSynopsis,
    includeBody: options.includeBody,
    sceneSeparator: options.sceneSeparator,
    statuses: options.statuses,
    includeNotes: options.includeNotes,
    chapters: options.chapters,
  };
  switch (format) {
    case "json": {
      const document = buildExportDocument(data, { exportedAt: request.exportedAt });
      return textFile(exportFileName(title), "application/json", serializeExportDocument(document));
    }
    case "markdown-folder": {
      const files = buildMarkdownFolder(data, { exportedAt: request.exportedAt, folderName: base });
      const binary = buildAttachmentFiles(data, { folderName: base });
      return {
        name: `${base}.starline.zip`,
        mime: "application/zip",
        bytes: zipFiles(files, binary),
      };
    }
    case "docx-manuscript": {
      const files = buildDocxFiles(data, { ...manuscriptOptions, preset: "manuscript" });
      return {
        name: `${base}-manuscript.docx`,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: zipTextFiles(files),
      };
    }
    case "docx-planning": {
      const files = buildDocxFiles(data, {
        ...manuscriptOptions,
        preset: "planning",
        includeSynopsis: options.includeSynopsis !== false,
      });
      return {
        name: `${base}-planning.docx`,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: zipTextFiles(files),
      };
    }
    case "html": {
      const html = buildHtml(buildManuscript(data, manuscriptOptions), manuscriptOptions);
      return textFile(`${base}.html`, "text/html", html);
    }
    case "markdown-manuscript": {
      const markdown = buildMarkdownManuscript(
        buildManuscript(data, manuscriptOptions),
        manuscriptOptions,
      );
      return textFile(`${base}.md`, "text/markdown", markdown);
    }
    case "text": {
      const text = buildPlainText(buildManuscript(data, manuscriptOptions), manuscriptOptions);
      return textFile(`${base}.txt`, "text/plain", text);
    }
    case "csv": {
      const files = buildCsvTables(data);
      return { name: `${base}-tables.zip`, mime: "application/zip", bytes: zipTextFiles(files) };
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`unsupported export format: ${String(exhaustive)}`);
    }
  }
}

/** Human label per format, for the export sheet. */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  "json",
  "markdown-folder",
  "docx-manuscript",
  "docx-planning",
  "html",
  "markdown-manuscript",
  "text",
  "csv",
];
