export type AdminPageCursor = { t: string; id: string };

export function encodePageCursor(cursor: AdminPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodePageCursor(value: string): AdminPageCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      t?: unknown;
      id?: unknown;
    };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string" || parsed.id.length === 0) {
      return null;
    }
    if (Number.isNaN(Date.parse(parsed.t))) return null;
    return { t: parsed.t, id: parsed.id };
  } catch {
    return null;
  }
}
