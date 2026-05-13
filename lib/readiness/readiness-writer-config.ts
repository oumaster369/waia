/**
 * Opt-in v1 demo readiness writer (bounded slice). Default off — safe for production.
 * Replaced by DEE-37 readiness service when that ships.
 */
export function isReadinessWriterEnabled(): boolean {
  const raw = process.env.WAIA_READINESS_WRITER;
  if (raw === undefined || raw === "") {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
