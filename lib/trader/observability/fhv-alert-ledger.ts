import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type FhvAlertLedgerEntry = Readonly<{
  alertId: string;
  severity: "WARNING" | "CRITICAL";
  firedAtUtc: string;
  message: string;
  detector: "Observer" | "Campaign";
  dedupeKey: string;
}>;

export function resolveFhvAlertLedgerPath(runRoot: string): string {
  return join(runRoot, "alerts", "alert-ledger.jsonl");
}

export function appendFhvAlertLedger(runRoot: string, entry: FhvAlertLedgerEntry): void {
  mkdirSync(join(runRoot, "alerts"), { recursive: true });
  appendFileSync(resolveFhvAlertLedgerPath(runRoot), `${JSON.stringify(entry)}\n`, "utf8");
}

export function readFhvAlertLedger(runRoot: string, limit = 200): readonly FhvAlertLedgerEntry[] {
  const path = resolveFhvAlertLedgerPath(runRoot);
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line) as FhvAlertLedgerEntry);
}

export function paginateFhvAlertLedger(
  runRoot: string,
  cursor: string | null,
  limit: number,
): { items: readonly FhvAlertLedgerEntry[]; nextCursor: string | null } {
  const all = readFhvAlertLedger(runRoot, 10_000);
  const startIndex = cursor ? Number.parseInt(cursor, 10) : 0;
  const slice = all.slice(startIndex, startIndex + limit);
  const nextIndex = startIndex + slice.length;
  return {
    items: slice,
    nextCursor: nextIndex < all.length ? String(nextIndex) : null,
  };
}
