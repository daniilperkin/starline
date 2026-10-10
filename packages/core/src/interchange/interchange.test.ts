import { describe, expect, it } from "vitest";

import {
  buildDocxFiles,
  buildHtml,
  buildManuscript,
  buildMarkdownFolder,
  buildPlainText,
  csvValue,
  DOCX_REQUIRED_PARTS,
  type ExportRow,
  emitFrontmatter,
  FOLDER_MANIFEST,
  PROJECT_MARKDOWN,
  type ProjectExport,
  parseCsv,
  parseFrontmatter,
  parseMarkdownFolder,
  toCsv,
  uniqueSlugs,
} from "./index";
import { stripRootFolder, unzipTextFiles, zipTextFiles } from "./zip";

/** A hand-built project: the formats are pure, so their tests need no database. */
function sampleProject(): ProjectExport {
  const project: ExportRow = {
    id: "01a10000-0000-7000-8000-000000000001",
    series_id: null,
    series_order_key: null,
    title: "The Cartographer's Sea: a novel",
    subtitle: "Book one",
    author_name: "Daniil Perkin",
    form: "novel",
    method: "snowflake",
    genres: ["fantasy", "adventure"],
    logline: "A cartographer maps a sea that keeps moving.",
    description_json: null,
    description_text: "Mina Voss sails with a broken compass.",
    target_word_count: 90000,
    deadline: null,
    cover_attachment_id: null,
    archived: 0,
    settings: { calendar: "gregorian" },
    created_at: 1000,
    updated_at: 2000,
  };
  const sceneA: ExportRow = {
    id: "01a10000-0000-7000-8000-0000000000a1",
    project_id: project.id,
    chapter_id: "01a10000-0000-7000-8000-0000000000c1",
    order_key: "a0",
    title: "The ferry — a crossing, at night",
    synopsis_json: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Cold water, warm lantern." }] },
      ],
    },
    synopsis_text: "Cold water, warm lantern.",
    pov_character_id: "01a10000-0000-7000-8000-0000000000b1",
    location_id: null,
    objective: "Cross before dawn",
    obstacle: "The tide",
    outcome: "yes_but",
    outcome_note: "They land, but the map is wrong",
    emotion_start: "dread",
    emotion_end: "resolve",
    status: "drafted",
    body_json: null,
    body_text: "The ferry pushed off.\n\nMina counted the gulls.",
    body_word_count: 9,
    target_word_count: 1200,
    story_time: 39299904000,
    story_time_label: "the night of the storm",
    time_of_day: "night",
    color: "#88ccff",
    is_flashback: 0,
    snowflake_source: { step: 8, line: 1, oneLine: "Mina crosses at night" },
    created_at: 1500,
    updated_at: 1600,
  };
  return {
    project,
    series: null,
    graphPositions: { "01a10000-0000-7000-8000-0000000000b1": { x: 10, y: 20 } },
    tables: {
      snowflakeSteps: [
        {
          id: "01a10000-0000-7000-8000-0000000000d1",
          project_id: project.id,
          step: 1,
          status: "complete",
          content: { sentence: "A cartographer maps a moving sea." },
          completed_at: 1200,
          overrides: [],
          created_at: 1100,
          updated_at: 1200,
        },
      ],
      characters: [
        {
          id: "01a10000-0000-7000-8000-0000000000b1",
          project_id: project.id,
          name: "Mina Voss",
          aliases: ["the cartographer"],
          role: "protagonist",
          color: "#ffcc88",
          pronouns: "she/her",
          age: "34",
          birth_story_date: null,
          occupation: "Cartographer",
          one_line: "She maps what will not hold still",
          one_paragraph_json: null,
          one_paragraph_text: "",
          motivation: "A safe harbour",
          goal: "Chart the moving sea",
          conflict: "The sea keeps rewriting her maps",
          epiphany: "Some maps are promises",
          want: "",
          need: "",
          lie: "",
          truth: "",
          flaws: ["stubborn"],
          strengths: [],
          fears: [],
          values: [],
          internal_conflict_json: null,
          internal_conflict_text: "",
          external_conflict_json: null,
          external_conflict_text: "",
          arc_type: "positive_change",
          ghost_json: null,
          ghost_text: "",
          voice_notes_json: null,
          voice_notes_text: "",
          appearance_json: null,
          appearance_text: "",
          backstory_json: null,
          backstory_text: "",
          storyline_json: null,
          storyline_text: "",
          bible_json: null,
          bible_text: "",
          order_key: "a0",
          pinned: 1,
          created_at: 1300,
          updated_at: 1400,
        },
      ],
      relationshipGroups: [],
      parts: [],
      chapters: [
        {
          id: "01a10000-0000-7000-8000-0000000000c1",
          project_id: project.id,
          part_id: null,
          title: "Chapter one: departure",
          summary_json: null,
          summary_text: "",
          order_key: "a0",
          target_word_count: null,
          color: null,
          created_at: 1450,
          updated_at: 1450,
        },
      ],
      loreCategories: [],
      loreEntries: [],
      plotlines: [],
      scenes: [sceneA],
      sceneCharacters: [
        {
          scene_id: sceneA.id,
          character_id: "01a10000-0000-7000-8000-0000000000b1",
          presence: "present",
        },
      ],
      sceneLore: [],
      scenePlotlines: [],
      relationships: [
        {
          id: "01a10000-0000-7000-8000-0000000000e1",
          project_id: project.id,
          source_id: "01a10000-0000-7000-8000-0000000000b1",
          target_id: "01a10000-0000-7000-8000-0000000000b2",
          kind: "ally",
          custom_label: "",
          directed: 0,
          sentiment: 2,
          notes_json: null,
          notes_text: "",
          group_id: null,
          starts_at_scene_id: null,
          ends_at_scene_id: null,
          secret: 0,
          created_at: 1500,
          updated_at: 1500,
        },
      ],
      timelineEvents: [
        {
          id: "01a10000-0000-7000-8000-0000000000f1",
          project_id: project.id,
          title: "The comet falls",
          description_json: null,
          description_text: "A second sun",
          story_time: 39299994000,
          story_time_end: null,
          story_time_label: "",
          lane: "world",
          character_id: null,
          plotline_id: null,
          scene_id: null,
          lore_entry_id: null,
          color: null,
          created_at: 1600,
          updated_at: 1600,
        },
      ],
      notes: [
        {
          id: "01a10000-0000-7000-8000-0000000000a9",
          project_id: project.id,
          title: "Compass ideas",
          kind: "idea",
          status: "inbox",
          body_json: null,
          body_text: "A compass that points at what you lost.",
          source_url: "",
          pinned: 0,
          color: null,
          promoted_to_type: null,
          promoted_to_id: null,
          order_key: "a0",
          created_at: 1700,
          updated_at: 1700,
        },
      ],
      tags: [
        {
          id: "01a10000-0000-7000-8000-0000000000aa",
          project_id: project.id,
          name: "Act one",
          color: "#8899ff",
          created_at: 1800,
        },
      ],
      entityTags: [
        {
          tag_id: "01a10000-0000-7000-8000-0000000000aa",
          entity_type: "scene",
          entity_id: sceneA.id,
        },
      ],
      fieldDefs: [],
      fieldValues: [],
      entityLinks: [],
    },
  };
}

describe("slugs", () => {
  it("slugifies and de-duplicates in order", () => {
    expect(uniqueSlugs(["The ferry", "The ferry", "The ferry!"])).toEqual([
      "the-ferry",
      "the-ferry-2",
      "the-ferry-3",
    ]);
  });

  it("keeps unicode letters and strips path-hostile characters", () => {
    expect(uniqueSlugs(["Місто: гавань?"])).toEqual(["місто-гавань"]);
    expect(uniqueSlugs(["a/b\\c:d*e"])).toEqual(["a-b-c-d-e"]);
  });
});

describe("yaml frontmatter subset", () => {
  it("round-trips every scalar shape the exporter can produce", () => {
    const row: ExportRow = {
      id: "01a1",
      title: "A title: with a colon",
      empty: "",
      count: 42,
      ratio: 1.5,
      flag: true,
      nothing: null,
      list: ["a", "b"],
      nested: { x: 1, y: { z: 2 } },
      quoted: 'He said "hello"',
      multiline: "line one\nline two",
    };
    const text = `${emitFrontmatter(row, Object.keys(row))}\n# Body\n\ntext\n`;
    const parsed = parseFrontmatter(text);
    expect(parsed.data.title).toBe("A title: with a colon");
    expect(parsed.data.empty).toBe("");
    expect(parsed.data.count).toBe(42);
    expect(parsed.data.ratio).toBe(1.5);
    expect(parsed.data.flag).toBe(true);
    expect(parsed.data.nothing).toBeNull();
    expect(parsed.data.list).toEqual(["a", "b"]);
    expect(parsed.data.nested).toEqual({ x: 1, y: { z: 2 } });
    expect(parsed.data.quoted).toBe('He said "hello"');
    expect(parsed.data.multiline).toBe("line one\nline two");
    expect(parsed.body).toContain("# Body");
  });
});

describe("csv", () => {
  it("quotes only what needs quoting", () => {
    expect(csvValue("plain")).toBe("plain");
    expect(csvValue("has,comma")).toBe('"has,comma"');
    expect(csvValue('has "quote"')).toBe('"has ""quote"""');
    expect(csvValue(null)).toBe("");
  });

  it("round-trips a table with commas, quotes and newlines", () => {
    const text = toCsv(
      ["a", "b"],
      [
        ["one", 'two, "three"'],
        ["four", "five\nsix"],
      ],
    );
    const parsed = parseCsv(text);
    expect(parsed.header).toEqual(["a", "b"]);
    expect(parsed.rows[0]).toEqual(["one", 'two, "three"']);
    expect(parsed.rows[1]).toEqual(["four", "five\nsix"]);
  });

  it("sniffs a semicolon or tab delimiter and tolerates CRLF", () => {
    expect(parseCsv("a;b;c\r\n1;2;3\r\n").delimiter).toBe(";");
    expect(parseCsv("a\tb\n1\t2\n").delimiter).toBe("\t");
    expect(parseCsv("a,b\r\n1,2\r\n").rows).toEqual([["1", "2"]]);
  });
});

describe("markdown folder", () => {
  it("exports the layout the spec names", () => {
    const files = buildMarkdownFolder(sampleProject(), {
      exportedAt: 1,
      folderName: "The Cartographers Sea",
    });
    const paths = Object.keys(files);
    expect(paths).toContain("The Cartographers Sea/starline.json");
    expect(paths).toContain("The Cartographers Sea/project.md");
    expect(paths).toContain("The Cartographers Sea/snowflake/01-one-sentence.md");
    expect(paths.some((path) => path.startsWith("The Cartographers Sea/characters/"))).toBe(true);
    expect(paths.some((path) => path.includes("/outline/") && path.includes("chapter-01-"))).toBe(
      true,
    );
    expect(paths).toContain("The Cartographers Sea/relationships.csv");
    expect(paths).toContain("The Cartographers Sea/tags.json");
    expect(paths).toContain("The Cartographers Sea/custom-fields.json");
    expect(JSON.parse(files[`The Cartographers Sea/${FOLDER_MANIFEST}`] as string)).toMatchObject({
      format: "starline-folder",
      schemaVersion: 1,
      projectId: "01a10000-0000-7000-8000-000000000001",
    });
  });

  it("round-trips: import the folder and export it again, byte for byte", () => {
    const first = buildMarkdownFolder(sampleProject(), { exportedAt: 1 });
    const parsed = parseMarkdownFolder(first);
    expect(parsed.issues).toEqual([]);
    expect(parsed.data.tables.scenes?.length).toBe(1);
    expect(parsed.data.tables.characters?.length).toBe(1);
    const second = buildMarkdownFolder(parsed.data, { exportedAt: 1 });
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    for (const path of Object.keys(first)) {
      expect(second[path], path).toBe(first[path]);
    }
  });

  it("keeps the project file and refuses a folder without one", () => {
    const files = buildMarkdownFolder(sampleProject(), { exportedAt: 1 });
    expect(files[PROJECT_MARKDOWN]).toContain("The Cartographer's Sea");
    const parsed = parseMarkdownFolder({ "notes/x.md": "---\nid: nope\n---\n" });
    expect(parsed.issues.join(" ")).toContain("project.md");
  });
});

describe("manuscript output", () => {
  it("renders the outline in reading order with a configurable separator", () => {
    const document = buildManuscript(sampleProject());
    expect(document.scenes.length).toBe(1);
    expect(document.scenes[0]?.pov).toBe("Mina Voss");
    const text = buildPlainText(document, { sceneSeparator: "***", includeBody: true });
    expect(text).toContain("The Cartographer's Sea");
    expect(text).toContain("Chapter one: departure");
    expect(text).toContain("The ferry — a crossing, at night");
    expect(text).toContain("Mina counted the gulls.");
  });

  it("escapes the HTML export and keeps it self-contained", () => {
    const html = buildHtml(buildManuscript(sampleProject()), { includeBody: true });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("prefers-color-scheme");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).toContain("Mina counted the gulls.");
  });
});

describe("docx package", () => {
  it("builds every part Word needs, in both presets", () => {
    for (const preset of ["manuscript", "planning"] as const) {
      const files = buildDocxFiles(sampleProject(), { preset, createdAt: 1 });
      for (const part of DOCX_REQUIRED_PARTS) expect(Object.keys(files)).toContain(part);
      const document = files["word/document.xml"] as string;
      expect(document).toContain("<w:document");
      expect(document).toContain("The Cartographer");
      if (preset === "manuscript") {
        expect(document).toContain("Mina counted the gulls.");
        expect(files["word/styles.xml"]).toContain('w:line="480"');
      } else {
        expect(document).toContain("Scene list");
        expect(document).toContain("Characters");
      }
    }
  });

  it("strips characters XML cannot carry", () => {
    const project = sampleProject();
    project.project.title = "Bad\u0000Title";
    const files = buildDocxFiles(project, { preset: "manuscript" });
    expect(files["word/document.xml"]).not.toContain("\u0000");
  });

  it("zips and unzips deterministically", () => {
    const files = buildDocxFiles(sampleProject(), { preset: "manuscript", createdAt: 1 });
    const bytes = zipTextFiles(files);
    const again = zipTextFiles(files);
    expect(Array.from(bytes)).toEqual(Array.from(again));
    const back = unzipTextFiles(bytes);
    expect(Object.keys(back).sort()).toEqual(Object.keys(files).sort());
    expect(back["word/document.xml"]).toBe(files["word/document.xml"]);
  });

  it("strips the folder root of an archive", () => {
    const stripped = stripRootFolder({ "My Novel/project.md": "x", "My Novel/notes/a.md": "y" });
    expect(Object.keys(stripped).sort()).toEqual(["notes/a.md", "project.md"]);
  });
});
