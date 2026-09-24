export type AdminPageCursor = { t: string; id: string };

export function encodePageCursor(cursor: AdminPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Same order as the page SQL: `(t DESC, id DESC)`, rows strictly before the cursor. */
export function rowIsBeforePageCursor(
  row: AdminPageCursor,
  cursor: AdminPageCursor | null,
): boolean {
  if (!cursor) return true;
  if (row.t < cursor.t) return true;
  if (row.t > cursor.t) return false;
  return row.id < cursor.id;
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

/** Rows that belong on the next page of `ORDER BY created_at DESC, id DESC`. */
export function rowFollowsOrderCursor(
  row: { createdAt: string; id: string },
  cursor: AdminPageCursor | null,
): boolean {
  if (!cursor) return true;
  if (row.createdAt !== cursor.t) return row.createdAt < cursor.t;
  return row.id < cursor.id;
}
