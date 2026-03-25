/** Browser-safe SHA-256 hex of UTF-8 string (matches server `createHash("sha256").update(s, "utf8")`). */
export async function sha256HexUtf8(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function payloadJsonSha256(payload: unknown): Promise<string> {
  return sha256HexUtf8(JSON.stringify(payload ?? null));
}
