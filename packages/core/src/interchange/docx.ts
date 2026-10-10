/**
 * DOCX output (spec §4.5.1, decision 20): a hand-written minimal OOXML package zipped with
 * `fflate` instead of the `docx` library, which would blow the per-route bundle budget. Two
 * presets, both ours: **Manuscript** (Times-like, double-spaced, title page, chapters as
 * headings, `#` scene breaks, only the draft body) and **Planning** (synopsis, character
 * sheets, world bible, scene list).
 *
 * The package is the smallest one Word, LibreOffice and Google Docs all open:
 * `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/styles.xml`,
 * `word/_rels/document.xml.rels`, `docProps/core.xml`.
 */
import { pmDocToPlainText } from "../richtext";
import { buildManuscript, type ManuscriptOptions } from "./manuscript";
import type { FileMap } from "./markdown";
import type { ExportRow, ProjectExport } from "./types";

export type DocxPreset = "manuscript" | "planning";

function xmlEscape(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Control characters are illegal in XML 1.0 and Word refuses the whole file for one of them,
      // so this character class is the point of the line, not an accident.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: see above
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  );
}

interface RunOptions {
  bold?: boolean;
  italic?: boolean;
  style?: string;
}

/** One paragraph: `w:p` with an optional style and inline runs. */
function paragraph(text: string, options: RunOptions & { pageBreakBefore?: boolean } = {}): string {
  const properties: string[] = [];
  if (options.style !== undefined) properties.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.pageBreakBefore === true) properties.push("<w:pageBreakBefore/>");
  const pPr = properties.length > 0 ? `<w:pPr>${properties.join("")}</w:pPr>` : "";
  const runProps =
    options.bold === true || options.italic === true
      ? `<w:rPr>${options.bold === true ? "<w:b/>" : ""}${options.italic === true ? "<w:i/>" : ""}</w:rPr>`
      : "";
  const safe = xmlEscape(text);
  return `<w:p>${pPr}${safe.length === 0 ? "" : `<w:r>${runProps}<w:t xml:space="preserve">${safe}</w:t></w:r>`}</w:p>`;
}

/** Paragraphs for a multi-line block, one `w:p` per line (blank lines become empty paragraphs). */
function paragraphs(text: string, options: RunOptions = {}): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => paragraph(line.trim(), options));
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Normal = Times-like 12 pt; the manuscript preset is double-spaced, the planning preset is not. */
function stylesXml(doubleSpaced: boolean): string {
  const spacing = doubleSpaced
    ? '<w:spacing w:line="480" w:lineRule="auto" w:after="0"/><w:ind w:firstLine="720"/>'
    : '<w:spacing w:after="160" w:line="276" w:lineRule="auto"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${spacing}</w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:i/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="360" w:after="200"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="320" w:after="160"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Break"><w:name w:val="Scene break"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="240"/></w:pPr></w:style>
</w:styles>`;
}

function coreXml(title: string, author: string, createdAt: number): string {
  const stamp = new Date(createdAt).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(author)}</dc:creator><cp:lastModifiedBy>StarLine</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
}

function documentXml(body: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return pmDocToPlainText(value as unknown as Parameters<typeof pmDocToPlainText>[0]);
}

/** Manuscript preset: title page, chapters, scene breaks, draft body only. */
function manuscriptBody(data: ProjectExport, options: ManuscriptOptions): string[] {
  const document = buildManuscript(data, options);
  const body: string[] = [];
  body.push(paragraph(document.title, { style: "Title" }));
  if (document.subtitle.length > 0) body.push(paragraph(document.subtitle, { style: "Subtitle" }));
  if (document.author.length > 0) {
    body.push(paragraph(""));
    body.push(paragraph(document.author, { style: "Subtitle" }));
  }
  body.push(paragraph("", { pageBreakBefore: true }));
  let lastPart = "";
  let lastChapter = "";
  let firstInChapter = true;
  for (const entry of document.scenes) {
    if (entry.partTitle !== lastPart && entry.partTitle.length > 0) {
      lastPart = entry.partTitle;
      lastChapter = "";
      body.push(paragraph(entry.partTitle, { style: "Heading1", pageBreakBefore: true }));
    }
    if (entry.chapterTitle !== lastChapter) {
      lastChapter = entry.chapterTitle;
      firstInChapter = true;
      body.push(
        paragraph(entry.chapterTitle.length > 0 ? entry.chapterTitle : "Unassigned", {
          style: "Heading2",
          pageBreakBefore: body.length > 2,
        }),
      );
    } else if (!firstInChapter) {
      body.push(paragraph(options.sceneSeparator ?? "#", { style: "Break" }));
    }
    firstInChapter = false;
    const title = String(entry.scene.title ?? "").trim();
    if (title.length > 0) body.push(paragraph(title, { style: "Heading3" }));
    if (options.includeBody !== false && entry.body.trim().length > 0) {
      for (const line of paragraphs(entry.body.trim())) body.push(line);
    }
  }
  return body;
}

/** Planning preset: everything a writer plans with, in one document. */
function planningBody(data: ProjectExport, options: ManuscriptOptions): string[] {
  const document = buildManuscript(data, { ...options, includeBody: false });
  const body: string[] = [];
  body.push(paragraph(document.title, { style: "Title" }));
  if (document.logline.length > 0) body.push(paragraph(document.logline, { italic: true }));
  if (document.description.trim().length > 0) {
    body.push(paragraph("Synopsis", { style: "Heading1" }));
    for (const line of paragraphs(document.description.trim())) body.push(line);
  }
  const characters = [...document.characters].sort((a, b) =>
    String(a.order_key ?? "").localeCompare(String(b.order_key ?? "")),
  );
  if (characters.length > 0) {
    body.push(paragraph("Characters", { style: "Heading1", pageBreakBefore: true }));
    for (const character of characters) {
      body.push(paragraph(String(character.name ?? ""), { style: "Heading2" }));
      const rows: Array<[string, unknown]> = [
        ["Role", character.role],
        ["One line", character.one_line],
        ["Motivation", character.motivation],
        ["Goal", character.goal],
        ["Conflict", character.conflict],
        ["Epiphany", character.epiphany],
        ["Want", character.want],
        ["Need", character.need],
        ["Arc", character.arc_type],
      ];
      for (const [label, value] of rows) {
        const textValue = typeof value === "string" ? value.trim() : "";
        if (textValue.length === 0) continue;
        body.push(paragraph(`${label}: ${textValue}`, { bold: false }));
      }
      for (const [column, label] of [
        ["one_paragraph_json", "One paragraph"],
        ["storyline_json", "Storyline"],
        ["backstory_json", "Backstory"],
      ] as const) {
        const value = text(character[column]).trim();
        if (value.length === 0) continue;
        body.push(paragraph(label, { style: "Heading3" }));
        for (const line of paragraphs(value)) body.push(line);
      }
    }
  }
  const lore = [...document.lore].sort((a, b) =>
    String(a.order_key ?? "").localeCompare(String(b.order_key ?? "")),
  );
  if (lore.length > 0) {
    body.push(paragraph("World", { style: "Heading1", pageBreakBefore: true }));
    for (const entry of lore) {
      body.push(paragraph(String(entry.name ?? ""), { style: "Heading2" }));
      const summary = String(entry.summary ?? "").trim();
      if (summary.length > 0) body.push(paragraph(summary, { italic: true }));
      const detail = text(entry.body_json).trim();
      if (detail.length > 0) {
        for (const line of paragraphs(detail)) body.push(line);
      }
    }
  }
  body.push(paragraph("Scene list", { style: "Heading1", pageBreakBefore: true }));
  let lastChapter = "";
  for (const entry of document.scenes) {
    if (entry.chapterTitle !== lastChapter) {
      lastChapter = entry.chapterTitle;
      body.push(
        paragraph(entry.chapterTitle.length > 0 ? entry.chapterTitle : "Unassigned", {
          style: "Heading2",
        }),
      );
    }
    const title = String(entry.scene.title ?? "").trim();
    const plan = entry.synopsis.trim().length > 0 ? entry.synopsis.trim() : entry.oneLine;
    const parts = [
      title.length > 0 ? title : plan,
      entry.pov.length > 0 ? `POV: ${entry.pov}` : "",
      entry.location.length > 0 ? `at ${entry.location}` : "",
      String(entry.scene.status ?? ""),
    ].filter((part) => part.length > 0);
    body.push(paragraph(parts.join(" · ")));
    // The plan under the heading: the synopsis when written, else the step-8 line.
    if (options.includeSynopsis !== false && title.length > 0 && plan.length > 0) {
      body.push(paragraph(plan, { italic: true }));
    }
  }
  return body;
}

/** The DOCX package as text files; `zipTextFiles` turns it into the actual `.docx` bytes. */
export function buildDocxFiles(
  data: ProjectExport,
  options: ManuscriptOptions & { preset?: DocxPreset; createdAt?: number } = {},
): FileMap {
  const preset: DocxPreset = options.preset ?? "manuscript";
  const title = String(data.project.title ?? "Untitled");
  const author = String(data.project.author_name ?? "");
  const body = preset === "planning" ? planningBody(data, options) : manuscriptBody(data, options);
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/_rels/document.xml.rels": DOCUMENT_RELS,
    "word/styles.xml": stylesXml(preset === "manuscript"),
    "word/document.xml": documentXml(body),
    "docProps/core.xml": coreXml(title, author, options.createdAt ?? 0),
  };
}

/** Exported for the tests: the parts Word needs to accept the package. */
export const DOCX_REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/_rels/document.xml.rels",
  "docProps/core.xml",
] as const;

export type { ExportRow };
