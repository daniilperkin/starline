import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachToGallery,
  buildAttachmentFiles,
  buildMarkdownFolder,
  ChangeBus,
  type Command,
  countNotesByStatus,
  createAttachment,
  createCharacter,
  createNote,
  createProject,
  deleteAttachment,
  deleteNote,
  detachFromGallery,
  executeCommand,
  getNote,
  listCharacterGallery,
  listNotes,
  listStaleIdeas,
  listTrash,
  moveNote,
  parseMarkdownFolder,
  promoteNote,
  readAttachmentBytes,
  readAttachmentThumb,
  readProjectExport,
  restoreEntity,
  setEntityImage,
  type UUID,
  updateNote,
  writeProjectExport,
} from "@starline/core";
import { unzipFiles, zipFiles } from "@starline/core/zip";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 14 on the real driver: the notes incubator (capture → sort → promote → trash) and
 * attachments (dedupe, blobs through the bridge, gallery, image slots), plus the folder format
 * carrying attachment bytes losslessly. The M3 gate rides on the last block: export → import →
 * export stays byte-identical *with* attachments in the project.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

const bus = new ChangeBus();
let dir: string;
let driver: TauriStorageDriver;
let transport: StdioTransport;
let projectId: UUID;

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

async function openLibrary(path: string): Promise<{
  driver: TauriStorageDriver;
  transport: StdioTransport;
}> {
  const stdio = new StdioTransport({ command: binPath });
  const instance = new TauriStorageDriver(stdio, { watchIntervalMs: 0 });
  await instance.open({ path, create: true, readOnly: false });
  await runMigrations(instance);
  return { driver: instance, transport: stdio };
}

async function run<A, R>(target: TauriStorageDriver, command: Command<A, R>, args: A): Promise<R> {
  return executeCommand({ transaction: (fn) => target.transaction(fn) }, bus, command, args);
}

/** Deterministic pseudo-bytes: enough to prove blob handling without real image codecs. */
function fakePng(seed: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  for (let index = 2; index < length; index += 1) bytes[index] = (seed * 31 + index) % 251;
  return bytes;
}

let mina: UUID;
let noteId: UUID;

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice14-"));
  const opened = await openLibrary(join(dir, "notes.starline"));
  driver = opened.driver;
  transport = opened.transport;
  projectId = (await run(driver, createProject, { title: "The Cartographer's Sea" })).projectId;
  mina = (await run(driver, createCharacter, { projectId, name: "Mina Voss", role: "protagonist" }))
    .characterId;
});

afterAll(async () => {
  await driver.close().catch(() => undefined);
  await transport.dispose().catch(() => undefined);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("notes incubator", () => {
  it("captures a thought into the inbox with nothing but a title", async () => {
    noteId = (await run(driver, createNote, { projectId, title: "A knife in the dark" })).noteId;
    const note = await getNote(driver, projectId, noteId);
    expect(note).not.toBeNull();
    expect(note?.status).toBe("inbox");
    expect(note?.kind).toBe("idea");
    expect(note?.pinned).toBe(false);
    expect(note?.promotedToId).toBeNull();
  });

  it("keeps column order stable when notes move across the board", async () => {
    const second = (await run(driver, createNote, { projectId, title: "The lighthouse keeper" }))
      .noteId;
    const third = (await run(driver, createNote, { projectId, title: "Salt in the ink" })).noteId;
    await run(driver, moveNote, { projectId, noteId: third, status: "incubating" });
    await run(driver, moveNote, {
      projectId,
      noteId: second,
      status: "incubating",
      beforeNoteId: third,
    });
    const incubating = await listNotes(driver, projectId, { status: "incubating" });
    expect(incubating.map((note) => note.title)).toEqual([
      "The lighthouse keeper",
      "Salt in the ink",
    ]);
    const counts = await countNotesByStatus(driver, projectId);
    expect(counts.inbox).toBe(1);
    expect(counts.incubating).toBe(2);
  });

  it("mirrors mentions typed into a note body into backlinks", async () => {
    await run(driver, updateNote, {
      projectId,
      noteId,
      patch: {
        body: {
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Mina should be the one holding it. " },
                  {
                    type: "mention",
                    attrs: { entityId: mina, entityType: "character", label: "Mina Voss" },
                  },
                ],
              },
            ],
          },
          text: "Mina should be the one holding it. @Mina Voss",
          wordCount: 8,
        },
      },
    });
    const mention = await driver.query<{ source_type: string; source_id: string }>(
      "SELECT source_type, source_id FROM mention WHERE target_type = 'character' AND target_id = ?",
      [mina],
    );
    expect(mention.some((row) => row.source_type === "note" && row.source_id === noteId)).toBe(
      true,
    );
  });

  it("promotes a note into a scene, character, lore entry and plotline", async () => {
    const scene = await run(driver, promoteNote, { projectId, noteId, target: "scene" });
    const promoted = await getNote(driver, projectId, noteId);
    expect(promoted?.status).toBe("used");
    expect(promoted?.promotedToType).toBe("scene");
    expect(promoted?.promotedToId).toBe(scene.entityId);
    const sceneRow = await driver.query<{ title: string; synopsis_text: string }>(
      "SELECT title, synopsis_text FROM scene WHERE id = ?",
      [scene.entityId],
    );
    expect(sceneRow[0]?.title).toBe("A knife in the dark");
    expect(sceneRow[0]?.synopsis_text).toContain("Mina should be the one");

    const second = (await run(driver, createNote, { projectId, title: "Tor Callis" })).noteId;
    const character = await run(driver, promoteNote, {
      projectId,
      noteId: second,
      target: "character",
    });
    const characterRow = await driver.query<{ name: string; role: string }>(
      "SELECT name, role FROM character WHERE id = ?",
      [character.entityId],
    );
    expect(characterRow[0]?.name).toBe("Tor Callis");
    expect(characterRow[0]?.role).toBe("supporting");

    const third = (await run(driver, createNote, { projectId, title: "The drowned archive" }))
      .noteId;
    const lore = await run(driver, promoteNote, {
      projectId,
      noteId: third,
      target: "lore",
      loreKind: "location",
    });
    const loreRow = await driver.query<{ kind: string; name: string }>(
      "SELECT kind, name FROM lore_entry WHERE id = ?",
      [lore.entityId],
    );
    expect(loreRow[0]?.kind).toBe("location");
    expect(loreRow[0]?.name).toBe("The drowned archive");

    const fourth = (await run(driver, createNote, { projectId, title: "Who took the maps?" }))
      .noteId;
    const plotline = await run(driver, promoteNote, {
      projectId,
      noteId: fourth,
      target: "plotline",
    });
    const plotlineRow = await driver.query<{ kind: string }>(
      "SELECT kind FROM plotline WHERE id = ?",
      [plotline.entityId],
    );
    expect(plotlineRow[0]?.kind).toBe("subplot");

    // Undo shape: the note goes back to its previous column and forgets the promotion.
    await run(driver, updateNote, {
      projectId,
      noteId: fourth,
      patch: { status: plotline.previousStatus, promoted: null },
    });
    const undone = await getNote(driver, projectId, fourth);
    expect(undone?.status).toBe("inbox");
    expect(undone?.promotedToId).toBeNull();
  });

  it("nudges only notes that sat in the incubator for over 30 days", async () => {
    const stale = (await run(driver, createNote, { projectId, title: "Old idea" })).noteId;
    await run(driver, moveNote, { projectId, noteId: stale, status: "incubating" });
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await driver.query("UPDATE idea_note SET updated_at = ? WHERE id = ?", [old, stale]);
    const ideas = await listStaleIdeas(driver, projectId);
    expect(ideas.map((idea) => idea.id)).toContain(stale);
    expect(ideas.every((idea) => idea.ageDays >= 30)).toBe(true);
  });

  it("sends a deleted note to the trash and restores it", async () => {
    const doomed = (await run(driver, createNote, { projectId, title: "Scrap this" })).noteId;
    await run(driver, deleteNote, { projectId, noteId: doomed });
    const trash = await listTrash(driver, projectId);
    expect(trash.some((item) => item.entityType === "note" && item.entityId === doomed)).toBe(true);
    await run(driver, restoreEntity, { projectId, entityType: "note", entityId: doomed });
    expect(await getNote(driver, projectId, doomed)).not.toBeNull();
  });
});

describe("attachments", () => {
  let first: UUID;
  const bytes = fakePng(7);

  it("stores bytes, dedupes by hash and reads the blob back through the bridge", async () => {
    const created = await run(driver, createAttachment, {
      projectId,
      fileName: "harbour.png",
      mimeType: "image/png",
      bytes,
      width: 800,
      height: 600,
      thumb: fakePng(9, 32),
    });
    first = created.attachmentId;
    expect(created.deduped).toBe(false);

    const again = await run(driver, createAttachment, {
      projectId,
      fileName: "harbour-copy.png",
      mimeType: "image/png",
      bytes,
    });
    expect(again.deduped).toBe(true);
    expect(again.attachmentId).toBe(first);

    const stored = await readAttachmentBytes(driver, first);
    expect(stored).not.toBeNull();
    expect(Array.from(stored ?? new Uint8Array())).toEqual(Array.from(bytes));
    const thumb = await readAttachmentThumb(driver, first);
    expect(thumb?.byteLength).toBe(32);
  });

  it("rejects an oversized file and an unsupported type before any row is written", async () => {
    await expect(
      run(driver, createAttachment, {
        projectId,
        fileName: "huge.png",
        mimeType: "image/png",
        bytes: new Uint8Array(20 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/exceeds/);
    await expect(
      run(driver, createAttachment, {
        projectId,
        fileName: "notes.txt",
        mimeType: "text/plain",
        bytes: fakePng(3, 16),
      }),
    ).rejects.toThrow(/unsupported/);
  });

  it("keeps a character gallery in order with captions", async () => {
    const second = (
      await run(driver, createAttachment, {
        projectId,
        fileName: "deck.png",
        mimeType: "image/png",
        bytes: fakePng(11),
      })
    ).attachmentId;
    await run(driver, attachToGallery, {
      projectId,
      characterId: mina,
      attachmentId: first,
      caption: "Mina at the harbour",
    });
    await run(driver, attachToGallery, {
      projectId,
      characterId: mina,
      attachmentId: second,
      caption: "On deck",
    });
    const gallery = await listCharacterGallery(driver, mina);
    expect(gallery.map((item) => item.caption)).toEqual(["Mina at the harbour", "On deck"]);
    await run(driver, detachFromGallery, { projectId, characterId: mina, attachmentId: second });
    expect((await listCharacterGallery(driver, mina)).length).toBe(1);
  });

  it("sets and clears the single-image slots", async () => {
    await run(driver, setEntityImage, {
      projectId,
      target: "character",
      entityId: mina,
      attachmentId: first,
    });
    await run(driver, setEntityImage, {
      projectId,
      target: "project",
      entityId: projectId,
      attachmentId: first,
    });
    const avatar = await driver.query<{ avatar_attachment_id: string | null }>(
      "SELECT avatar_attachment_id FROM character WHERE id = ?",
      [mina],
    );
    expect(avatar[0]?.avatar_attachment_id).toBe(first);
    await run(driver, setEntityImage, {
      projectId,
      target: "character",
      entityId: mina,
      attachmentId: null,
    });
    const cleared = await driver.query<{ avatar_attachment_id: string | null }>(
      "SELECT avatar_attachment_id FROM character WHERE id = ?",
      [mina],
    );
    expect(cleared[0]?.avatar_attachment_id).toBeNull();
  });

  it("deleting an attachment clears its gallery rows and slots", async () => {
    const temp = (
      await run(driver, createAttachment, {
        projectId,
        fileName: "temp.png",
        mimeType: "image/png",
        bytes: fakePng(13),
      })
    ).attachmentId;
    await run(driver, attachToGallery, { projectId, characterId: mina, attachmentId: temp });
    await run(driver, setEntityImage, {
      projectId,
      target: "character",
      entityId: mina,
      attachmentId: temp,
    });
    await run(driver, deleteAttachment, { projectId, attachmentId: temp });
    expect(await readAttachmentBytes(driver, temp)).toBeNull();
    const gallery = await listCharacterGallery(driver, mina);
    expect(gallery.some((item) => item.id === temp)).toBe(false);
    const avatar = await driver.query<{ avatar_attachment_id: string | null }>(
      "SELECT avatar_attachment_id FROM character WHERE id = ?",
      [mina],
    );
    expect(avatar[0]?.avatar_attachment_id).toBeNull();
  });
});

describe("interchange with attachments", () => {
  it("carries bytes through the folder format and re-exports the same archive", async () => {
    // Give the project a cover so the import has to survive the project ↔ attachment cycle.
    const cover = (
      await run(driver, createAttachment, {
        projectId,
        fileName: "cover.png",
        mimeType: "image/png",
        bytes: fakePng(21),
      })
    ).attachmentId;
    await run(driver, setEntityImage, {
      projectId,
      target: "project",
      entityId: projectId,
      attachmentId: cover,
    });

    const data = await readProjectExport(driver, projectId, { includeAttachments: true });
    expect(Object.keys(data.attachmentData ?? {}).length).toBeGreaterThan(0);
    const folderName = "the-cartographers-sea";
    const files = buildMarkdownFolder(data, { exportedAt: 0, folderName });
    const binary = buildAttachmentFiles(data, { folderName });
    expect(Object.keys(binary).length).toBeGreaterThan(0);
    const zip = zipFiles(files, binary);

    const unpacked = unzipFiles(zip);
    const parsed = parseMarkdownFolder(unpacked.text, unpacked.binary);
    expect(parsed.issues.filter((issue) => issue.includes("missing from the archive"))).toEqual([]);

    const second = await mkdtemp(join(tmpdir(), "starline-slice14-import-"));
    const opened = await openLibrary(join(second, "imported.starline"));
    try {
      const report = await opened.driver.transaction((tx) => writeProjectExport(tx, parsed.data));
      expect(report.issues).toEqual([]);
      const importedProjectId = report.projectId;
      const back = await readProjectExport(opened.driver, importedProjectId, {
        includeAttachments: true,
      });
      const backFiles = buildMarkdownFolder(back, { exportedAt: 0, folderName });
      const backBinary = buildAttachmentFiles(back, { folderName });
      expect(Object.keys(backBinary).sort()).toEqual(Object.keys(binary).sort());
      expect(zipFiles(backFiles, backBinary)).toEqual(zip);

      // The gallery and the cover survived, and the blob is readable in the new library.
      const firstCharacter = await opened.driver.query<{ id: string }>(
        "SELECT id FROM character LIMIT 1",
      );
      const gallery = await listCharacterGallery(
        opened.driver,
        (firstCharacter[0]?.id ?? "") as UUID,
      );
      expect(gallery.length).toBeGreaterThan(0);
      const coverRow = await opened.driver.query<{ cover_attachment_id: string | null }>(
        "SELECT cover_attachment_id FROM project WHERE id = ?",
        [importedProjectId],
      );
      expect(coverRow[0]?.cover_attachment_id).not.toBeNull();
      const restored = await readAttachmentBytes(
        opened.driver,
        coverRow[0]?.cover_attachment_id as UUID,
      );
      expect(Array.from(restored ?? new Uint8Array())).toEqual(Array.from(fakePng(21)));
    } finally {
      await opened.driver.close().catch(() => undefined);
      await opened.transport.dispose().catch(() => undefined);
      await rm(second, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("keeps the JSON document content-only, so its import can never dangle", async () => {
    const data = await readProjectExport(driver, projectId);
    expect(data.tables.attachments).toEqual([]);
    expect(data.tables.characterGallery).toEqual([]);
    expect(data.project.cover_attachment_id).toBeNull();
    expect(data.attachmentData).toBeUndefined();

    const third = await mkdtemp(join(tmpdir(), "starline-slice14-json-"));
    const opened = await openLibrary(join(third, "json.starline"));
    try {
      const report = await opened.driver.transaction((tx) => writeProjectExport(tx, data));
      expect(report.issues).toEqual([]);
      const attachments = await opened.driver.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM attachment",
      );
      expect(Number(attachments[0]?.n ?? -1)).toBe(0);
    } finally {
      await opened.driver.close().catch(() => undefined);
      await opened.transport.dispose().catch(() => undefined);
      await rm(third, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
