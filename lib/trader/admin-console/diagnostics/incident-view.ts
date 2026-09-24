import { adminRevision } from "@/lib/trader/admin-console/revision";
export function presentIncident(row: Record<string, unknown>) {
  const iso = (value: unknown) =>
    value instanceof Date
      ? value.toISOString()
      : value
        ? new Date(String(value)).toISOString()
        : null;
  const item = {
    id: String(row.id),
    environment: String(row.environment),
    service: String(row.service),
    fingerprint: String(row.fingerprint),
    title: String(row.title),
    severity: String(row.severity),
    status: String(row.status),
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    occurrences: Number(row.occurrences),
    affectedAccounts: Number(row.affected_accounts),
    stateVersion: Number(row.state_version),
    mutedUntil: iso(row.muted_until),
  };
  return { ...item, revision: adminRevision(item) };
}
