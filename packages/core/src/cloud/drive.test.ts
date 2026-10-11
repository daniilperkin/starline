import { describe, expect, it } from "vitest";
import { type CloudFetch, type CloudFetchResponse, DriveClient, DriveError } from "./drive";

/** A structural stand-in for a fetch response — no DOM types needed in this package. */
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
    statusText: status === 200 ? "OK" : "",
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
    arrayBuffer: async () => body as ArrayBuffer,
  };
}

function recorder() {
  const calls: Array<{
    url: string;
    init: { method?: string; headers?: Record<string, string>; body?: unknown };
  }> = [];
  const queue: CloudFetchResponse[] = [];
  const fetchImpl: CloudFetch = async (url, init) => {
    calls.push({ url, init: (init ?? {}) as (typeof calls)[number]["init"] });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return next;
  };
  return { calls, queue, fetchImpl };
}

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] ?? "";
}

function paramsOf(url: string): Record<string, string> {
  const query = url.split("?")[1] ?? "";
  const out: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [key, value = ""] = pair.split("=");
    out[decodeURIComponent(key ?? "")] = decodeURIComponent(value.replaceAll("+", " "));
  }
  return out;
}

const UPLOAD_LOCATION =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";

function clientWith(rec: ReturnType<typeof recorder>, token = "tok-1") {
  const tokenCalls: number[] = [];
  const client = new DriveClient({
    accessToken: async () => {
      tokenCalls.push(1);
      return token;
    },
    fetchImpl: rec.fetchImpl,
  });
  return { client, tokenCalls };
}

describe("DriveClient.list", () => {
  it("asks for the app folder, newest first, with the bearer token", async () => {
    const rec = recorder();
    rec.queue.push(
      response({
        files: [
          { id: "f1", name: "2026-10-11T18-02-manual.starline", size: "4096" },
          { id: "f2", name: "manifest.json" },
        ],
      }),
    );
    const { client, tokenCalls } = clientWith(rec);
    const files = await client.list();

    const url = rec.calls[0]?.url ?? "";
    expect(pathOf(url)).toBe("/drive/v3/files");
    expect(paramsOf(url).spaces).toBe("appDataFolder");
    expect(paramsOf(url).orderBy).toBe("createdTime desc");
    expect(paramsOf(url).fields).toContain("nextPageToken");
    expect(rec.calls[0]?.init.headers?.Authorization).toBe("Bearer tok-1");
    expect(tokenCalls).toHaveLength(1);

    expect(files).toHaveLength(2);
    expect(files[0]?.size).toBe(4096);
    expect(files[1]?.size).toBeUndefined();
  });

  it("follows nextPageToken until the listing is complete", async () => {
    const rec = recorder();
    rec.queue.push(response({ files: [{ id: "a", name: "a" }], nextPageToken: "page-2" }));
    rec.queue.push(response({ files: [{ id: "b", name: "b" }] }));
    const { client } = clientWith(rec);
    const files = await client.list();

    expect(files.map((file) => file.id)).toEqual(["a", "b"]);
    expect(paramsOf(rec.calls[1]?.url ?? "").pageToken).toBe("page-2");
  });
});

describe("DriveClient.upload (resumable)", () => {
  it("creates a session in the app folder, then PUTs the bytes", async () => {
    const rec = recorder();
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } }));
    rec.queue.push(response({ id: "new-1", name: "snap.starline", size: "3" }));
    const { client } = clientWith(rec);

    const bytes = new Uint8Array([1, 2, 3]);
    const file = await client.upload("snap.starline", bytes, { mimeType: "application/x-sqlite3" });

    const url = rec.calls[0]?.url ?? "";
    expect(pathOf(url)).toBe("/upload/drive/v3/files");
    expect(paramsOf(url).uploadType).toBe("resumable");
    const metadata = JSON.parse(String(rec.calls[0]?.init.body)) as {
      name: string;
      parents: string[];
    };
    expect(metadata.name).toBe("snap.starline");
    expect(metadata.parents).toEqual(["appDataFolder"]);

    expect(rec.calls[1]?.url).toBe(UPLOAD_LOCATION);
    expect(rec.calls[1]?.init.method).toBe("PUT");
    expect(rec.calls[1]?.init.body).toBe(bytes);

    expect(file).toEqual({ id: "new-1", name: "snap.starline", size: 3 });
  });

  it("falls back to the byte length when Drive omits the size", async () => {
    const rec = recorder();
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } }));
    rec.queue.push(response({ id: "new-2", name: "x" }));
    const { client } = clientWith(rec);
    const file = await client.upload("x", new Uint8Array([1, 2, 3, 4]));
    expect(file.size).toBe(4);
  });

  it("refuses to continue when the session URL is missing", async () => {
    const rec = recorder();
    rec.queue.push(response({}));
    const { client } = clientWith(rec);
    await expect(client.upload("x", new Uint8Array([1]))).rejects.toThrow(/upload URL/);
  });
});

describe("DriveClient.download / remove / replace", () => {
  it("downloads bytes with alt=media", async () => {
    const rec = recorder();
    rec.queue.push(response(new Uint8Array([9, 8, 7]).buffer));
    const { client } = clientWith(rec);
    const bytes = await client.download("file-1");

    expect([...bytes]).toEqual([9, 8, 7]);
    const url = rec.calls[0]?.url ?? "";
    expect(pathOf(url)).toBe("/drive/v3/files/file-1");
    expect(paramsOf(url).alt).toBe("media");
  });

  it("deletes by id", async () => {
    const rec = recorder();
    rec.queue.push(response(null, { status: 204 }));
    const { client } = clientWith(rec);
    await client.remove("file-2");
    expect(rec.calls[0]?.init.method).toBe("DELETE");
    expect(pathOf(rec.calls[0]?.url ?? "")).toBe("/drive/v3/files/file-2");
  });

  it("replaces in place with PATCH, keeping the file id", async () => {
    const rec = recorder();
    rec.queue.push(response({}, { headers: { Location: UPLOAD_LOCATION } }));
    rec.queue.push(response({ id: "file-3", name: "manifest.json" }));
    const { client } = clientWith(rec);
    await client.replace("file-3", new Uint8Array([123, 125])); // "{}"

    expect(pathOf(rec.calls[0]?.url ?? "")).toBe("/upload/drive/v3/files/file-3");
    expect(rec.calls[0]?.init.method).toBe("PATCH");
    expect(rec.calls[1]?.init.method).toBe("PUT");
  });
});

describe("DriveClient error mapping", () => {
  it("surfaces the status and reason from a Drive error body", async () => {
    const rec = recorder();
    rec.queue.push(
      response(
        {
          error: {
            code: 403,
            message: "Google Drive API has not been used in project …",
            errors: [{ reason: "accessNotConfigured" }],
          },
        },
        { status: 403 },
      ),
    );
    const { client } = clientWith(rec);
    await expect(client.list()).rejects.toMatchObject({
      name: "DriveError",
      status: 403,
      reason: "accessNotConfigured",
    });
  });

  it("maps an expired token to a DriveError with status 401", async () => {
    const rec = recorder();
    rec.queue.push(
      response({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 }),
    );
    const { client } = clientWith(rec);
    const error = await client.download("file-9").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DriveError);
    expect((error as DriveError).status).toBe(401);
    expect((error as DriveError).reason).toBe("unknown");
  });
});
