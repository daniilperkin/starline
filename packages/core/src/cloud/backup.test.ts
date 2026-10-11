import { describe, expect, it } from "vitest";
import { type BackupDeps, backupSnapshots, readCloudManifest, snapshotFileName } from "./backup";
import { type CloudFetch, type CloudFetchResponse, DriveClient } from "./drive";

function response(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): CloudFetchResponse {
  const status = init.status ?? 200;
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
    arrayBuffer: async () =>
      typeof body === "string" ? (encode(body).buffer as ArrayBuffer) : (body as ArrayBuffer),
  };
}

function recorder() {
  const calls: Array<{ url: string; init: { method?: string; body?: unknown } }> = [];
  const queue: CloudFetchResponse[] = [];
  const fetchImpl: CloudFetch = async (url, init) => {
    calls.push({ url, init: (init ?? {}) as (typeof calls)[number]["init"] });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return next;
  };
  return { calls, queue, fetchImpl };
}

const utf8 = globalThis as unknown as {
  TextEncoder: new () => { encode(input?: string): Uint8Array };
  TextDecoder: new () => { decode(input?: Uint8Array): string };
};
const encode = (value: string): Uint8Array => new utf8.TextEncoder().encode(value);
const decode = (value: unknown): string => new utf8.TextDecoder().decode(value as Uint8Array);

const UPLOAD_LOCATION =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";

function makeDeps(
  rec: ReturnType<typeof recorder>,
  overrides: Partial<BackupDeps> = {},
): BackupDeps {
  const drive = new DriveClient({ accessToken: async () => "tok", fetchImpl: rec.fetchImpl });
  return {
    drive,
    libraryId: "lib-1",
    libraryName: "My Novel",
    now: 1_700_000_000_000,
    ...overrides,
  };
}

const candidate = {
  name: "2026-10-11T18-02-manual.starline",
  bytes: new Uint8Array([1, 2, 3]),
  reason: "manual",
  createdAt: 1_700_000_000_000,
  sha256: "a".repeat(64),
  counts: { scenes: 44 },
};

describe("snapshotFileName", () => {
  it("is sortable, readable and free of path-hostile characters", () => {
    const name = snapshotFileName(Date.UTC(2026, 9, 11, 18, 2), "on open");
    expect(name).toBe("2026-10-11T18-02-on-open.starline");
  });
});

describe("backupSnapshots", () => {
  it("uploads missing snapshots and writes a fresh manifest", async () => {
    const rec = recorder();
    rec.queue.push(response({ files: [] })); // list: empty cloud
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } })); // create session
    rec.queue.push(response({ id: "snap-1", name: candidate.name, size: "3" })); // PUT bytes
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } })); // manifest session
    rec.queue.push(response({ id: "man-1", name: "manifest.json" })); // PUT manifest

    const result = await backupSnapshots(makeDeps(rec), [candidate]);

    expect(result.uploaded.map((entry) => entry.fileId)).toEqual(["snap-1"]);
    expect(result.skipped).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.manifest.entries).toHaveLength(1);
    expect(result.manifest.entries[0]?.counts).toEqual({ scenes: 44 });

    const manifestBody = JSON.parse(decode(rec.calls[4]?.init.body)) as { entries: unknown[] };
    expect(manifestBody.entries).toHaveLength(1);
  });

  it("never uploads a snapshot that the manifest already lists, and replaces the manifest in place", async () => {
    const rec = recorder();
    const existing = JSON.stringify({
      version: 1,
      libraryId: "lib-1",
      libraryName: "My Novel",
      updatedAt: 1,
      entries: [
        {
          name: candidate.name,
          fileId: "snap-1",
          uploadedAt: 1,
          reason: "manual",
          bytes: 3,
          sha256: "b".repeat(64),
        },
      ],
    });
    rec.queue.push(response({ files: [{ id: "man-1", name: "manifest.json" }] }));
    rec.queue.push(response(existing)); // download manifest
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } }));
    rec.queue.push(response({ id: "man-1", name: "manifest.json" }));

    const result = await backupSnapshots(makeDeps(rec), [candidate]);

    expect(result.uploaded).toEqual([]);
    expect(result.skipped).toEqual([candidate.name]);
    expect(rec.calls[2]?.init.method).toBe("PATCH");
    expect(rec.calls[2]?.url).toContain("/upload/drive/v3/files/man-1");
  });

  it("thins what retention says is old and drops it from the manifest", async () => {
    const rec = recorder();
    const now = 1_700_000_000_000;
    const oldEntry = {
      name: "2026-06-01T10-00-activity.starline",
      fileId: "old-1",
      uploadedAt: now - 90 * 24 * 60 * 60 * 1000,
      reason: "activity",
      bytes: 10,
      sha256: "c".repeat(64),
    };
    rec.queue.push(response({ files: [{ id: "man-1", name: "manifest.json" }] }));
    rec.queue.push(
      response(
        JSON.stringify({
          version: 1,
          libraryId: "lib-1",
          libraryName: "My Novel",
          updatedAt: 1,
          entries: [oldEntry],
        }),
      ),
    );
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } })); // session
    rec.queue.push(response({ id: "snap-9", name: candidate.name })); // PUT snapshot
    rec.queue.push(response(null, { status: 204 })); // DELETE old
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } })); // manifest session
    rec.queue.push(response({ id: "man-1" })); // PUT manifest

    const result = await backupSnapshots(makeDeps(rec, { now }), [candidate]);

    expect(result.deleted).toEqual([oldEntry.name]);
    expect(result.manifest.entries.map((entry) => entry.name)).toEqual([candidate.name]);
    const deleteCall = rec.calls.find((call) => call.init.method === "DELETE");
    expect(deleteCall?.url).toContain("/drive/v3/files/old-1");
    const finalManifest = JSON.parse(decode(rec.calls.at(-1)?.init.body)) as { entries: unknown[] };
    expect(finalManifest.entries).toHaveLength(1);
  });
});

describe("readCloudManifest", () => {
  it("returns an empty manifest when the cloud has none", async () => {
    const rec = recorder();
    rec.queue.push(response({ files: [] }));
    const manifest = await readCloudManifest(makeDeps(rec).drive, "lib-1", "My Novel");
    expect(manifest.entries).toEqual([]);
    expect(manifest.libraryId).toBe("lib-1");
  });

  it("returns an empty manifest when the stored one is unreadable", async () => {
    const rec = recorder();
    rec.queue.push(response({ files: [{ id: "man-1", name: "manifest.json" }] }));
    rec.queue.push(response("not json at all"));
    const manifest = await readCloudManifest(makeDeps(rec).drive, "lib-1", "My Novel");
    expect(manifest.entries).toEqual([]);
  });

  it("reads the entries back", async () => {
    const rec = recorder();
    rec.queue.push(response({ files: [{ id: "man-1", name: "manifest.json" }] }));
    rec.queue.push(
      response(
        JSON.stringify({
          version: 1,
          libraryId: "lib-1",
          libraryName: "My Novel",
          updatedAt: 42,
          entries: [
            {
              name: "snap.starline",
              fileId: "f1",
              uploadedAt: 42,
              reason: "manual",
              bytes: 3,
              sha256: "d".repeat(64),
            },
          ],
        }),
      ),
    );
    const manifest = await readCloudManifest(makeDeps(rec).drive, "lib-1", "My Novel");
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.updatedAt).toBe(42);
  });
});
