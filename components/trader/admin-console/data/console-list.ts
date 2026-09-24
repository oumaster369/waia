export const CONSOLE_LIST_REFRESH_MS = 5_000;

export type ConsoleListBody<T> = {
  cursor?: string;
  error?: { code?: string };
  data?: { items?: T[]; reasons?: string[] };
};

export function consoleListFromBody<T>(
  body: ConsoleListBody<T>,
): { ok: true; items: T[] } | { ok: false; reason: string } {
  if (body.data && Array.isArray(body.data.items)) {
    return { ok: true, items: body.data.items };
  }
  const reason = body.data?.reasons?.[0];
  return {
    ok: false,
    reason: reason && reason.length > 0 ? reason : (body.error?.code ?? "ADMIN_RESPONSE_INVALID"),
  };
}
