/**
 * SHA-256 of attachment bytes (spec §3.1: "same hash ⇒ same row"). WebCrypto exists in browsers,
 * workers and Node ≥ 19, so core stays dependency-free; the native CLI never calls this.
 *
 * The signature is typed locally: core compiles without the DOM lib, and a structural type keeps
 * it honest without dragging `lib.dom` into a package that must run in a worker too.
 */
interface WebCryptoLike {
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const webcrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (webcrypto === undefined) throw new Error("WebCrypto is not available in this runtime");
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
