import { describe, expect, it } from "vitest";
import {
  CLOUD_MANIFEST_VERSION,
  type CloudManifest,
  type CloudSnapshotEntry,
  emptyManifest,
  entriesBeyondRetention,
  parseCloudManifest,
  serializeCloudManifest,
  withEntry,
  withoutEntry,
} from "./manifest";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function entry(overrides: Partial<CloudSnapshotEntry> = {}): CloudSnapshotEntry {
  return {
    name: "2026-10-11T18-02-manual.starline",
    fileId: "file-1",
    uploadedAt: 1_000_000,
    reason: "manual",
    bytes: 4096,
    sha256: "a".repeat(64),
    ...overrides,
  };
}

describe("manifest round trip", () => {
  it("serializes and parses back unchanged", () => {
    const manifest: CloudManifest = {
      ...emptyManifest("lib-1", "My Novel"),
      entries: [entry()],
      updatedAt: 1_000_000,
    };
    const parsed = parseCloudManifest(serializeCloudManifest(manifest));
    expect(parsed).toEqual(manifest);
  });

  it("stamps the current version on serialize", () => {
    const text = serializeCloudManifest({ ...emptyManifest("lib-1", "x"), version: 0 });
    expect(JSON.parse(text).version).toBe(CLOUD_MANIFEST_VERSION);
  });
});

describe("parseCloudManifest tolerance", () => {
  it("returns null for garbage instead of throwing", () => {
    expect(parseCloudManifest("not json")).toBeNull();
    expect(parseCloudManifest("[]")).toBeNull();
    expect(parseCloudManifest("null")).toBeNull();
  });

  it("returns null for a version it does not know", () => {
    const text = JSON.stringify({ version: 99, libraryId: "lib-1", entries: [] });
    expect(parseCloudManifest(text)).toBeNull();
  });

  it("returns null without a library id", () => {
    expect(parseCloudManifest(JSON.stringify({ version: 1, entries: [] }))).toBeNull();
  });

  it("drops malformed entries but keeps the good ones", () => {
    const text = JSON.stringify({
      version: 1,
      libraryId: "lib-1",
      libraryName: "My Novel",
      updatedAt: 5,
      entries: [entry(), { name: "broken" }, null, "nope"],
    });
    const parsed = parseCloudManifest(text);
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]?.fileId).toBe("file-1");
  });
});

describe("withEntry / withoutEntry", () => {
  it("adds newest-first", () => {
    const base = emptyManifest("lib-1", "My Novel");
    const older = entry({ name: "old.starline", fileId: "a", uploadedAt: 100 });
    const newer = entry({ name: "new.starline", fileId: "b", uploadedAt: 200 });
    const manifest = withEntry(withEntry(base, older), newer);
    expect(manifest.entries.map((item) => item.name)).toEqual(["new.starline", "old.starline"]);
    expect(manifest.updatedAt).toBe(200);
  });

  it("replaces an entry with the same file name instead of duplicating it", () => {
    const base = emptyManifest("lib-1", "My Novel");
    const first = entry({ fileId: "a", bytes: 10 });
    const second = entry({ fileId: "b", bytes: 20 });
    const manifest = withEntry(withEntry(base, first), second);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.fileId).toBe("b");
  });

  it("removes by file id", () => {
    const base = withEntry(emptyManifest("lib-1", "x"), entry({ fileId: "a" }));
    expect(withoutEntry(base, "a").entries).toHaveLength(0);
    expect(withoutEntry(base, "missing").entries).toHaveLength(1);
  });
});

describe("entriesBeyondRetention (decision 23c: mirror the local thinning)", () => {
  const limits = { keepAllWindowMs: 24 * HOUR, dailyKeepWindowMs: 60 * DAY };
  const now = 100 * DAY;

  it("keeps everything from the last 24 hours, however many", () => {
    const manifest: CloudManifest = {
      ...emptyManifest("lib-1", "x"),
      entries: [
        entry({ fileId: "h1", name: "h1", uploadedAt: now - 1 * HOUR, reason: "activity" }),
        entry({ fileId: "h2", name: "h2", uploadedAt: now - 2 * HOUR, reason: "activity" }),
        entry({ fileId: "h3", name: "h3", uploadedAt: now - 3 * HOUR, reason: "on-open" }),
      ],
    };
    expect(entriesBeyondRetention(manifest, now, limits)).toHaveLength(0);
  });

  it("keeps every manual snapshot forever", () => {
    const manifest: CloudManifest = {
      ...emptyManifest("lib-1", "x"),
      entries: [entry({ fileId: "m", name: "m", uploadedAt: now - 300 * DAY, reason: "manual" })],
    };
    expect(entriesBeyondRetention(manifest, now, limits)).toHaveLength(0);
  });

  it("keeps only the newest automatic snapshot per day inside the 60-day window", () => {
    const day = now - 10 * DAY;
    const manifest: CloudManifest = {
      ...emptyManifest("lib-1", "x"),
      entries: [
        entry({ fileId: "d1", name: "d1", uploadedAt: day, reason: "activity" }),
        entry({ fileId: "d2", name: "d2", uploadedAt: day + 2 * HOUR, reason: "activity" }),
        entry({ fileId: "d3", name: "d3", uploadedAt: day + 4 * HOUR, reason: "on-open" }),
      ],
    };
    const doomed = entriesBeyondRetention(manifest, now, limits);
    expect(doomed.map((item) => item.fileId)).toEqual(["d1", "d2"]);
  });

  it("drops automatic snapshots older than 60 days, oldest first", () => {
    const manifest: CloudManifest = {
      ...emptyManifest("lib-1", "x"),
      entries: [
        entry({ fileId: "old1", name: "old1", uploadedAt: now - 90 * DAY, reason: "activity" }),
        entry({ fileId: "old2", name: "old2", uploadedAt: now - 80 * DAY, reason: "on-open" }),
      ],
    };
    expect(entriesBeyondRetention(manifest, now, limits).map((item) => item.fileId)).toEqual([
      "old1",
      "old2",
    ]);
  });
});
