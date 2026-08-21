const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Convert datetime-local (browser local time) to canonical ISO-8601 UTC. */
export function datetimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !DATETIME_LOCAL.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Convert a date-only control (YYYY-MM-DD) to ISO-8601 UTC midnight. */
export function dateOnlyToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !DATE_ONLY.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function isoToDatetimeLocal(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getFullYear())}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

/** Capture a browser-local form timestamp once; callers own when this function runs. */
export function dateToDatetimeLocal(value: Date): string {
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
