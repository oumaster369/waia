export type FactKind = "zero" | "null" | "pending" | "unavailable" | "not_configured" | "value";

export type FactPresentation =
  | { kind: "zero"; label: string }
  | { kind: "null"; label: string }
  | { kind: "pending"; label: string; reason?: string }
  | { kind: "unavailable"; label: string; code?: string }
  | { kind: "not_configured"; label: string }
  | { kind: "value"; label?: string };

export function classifyMoneyFact(raw: string | null | undefined): FactKind {
  if (raw === null || raw === undefined || raw === "") return "null";
  if (raw === "0") return "zero";
  return "value";
}

export function backendUnavailableLabel(code?: string): string {
  if (code === "TREASURY_BACKEND_UNAVAILABLE") {
    return "Treasury backend is unavailable on this environment. Postgres is required for ledger reads.";
  }
  if (code === "EVIDENCE_STORAGE_NOT_CONFIGURED") {
    return "Evidence object storage is not configured.";
  }
  if (code === "EVIDENCE_CONTENT_UNAVAILABLE") {
    return "Evidence content is unavailable.";
  }
  return "This Treasury service is currently unavailable.";
}

export const WATCHER_DARK_COPY = "Watcher unavailable. Watcher is currently disabled.";
