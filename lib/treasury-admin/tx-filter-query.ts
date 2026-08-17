import { dateOnlyToIso } from "@/lib/treasury-admin/datetime-local";

export const TRANSACTION_FILTER_KEYS = [
  "status",
  "detail_publication",
  "kind",
  "direction",
  "provenance",
  "needs_reconciliation",
  "budget_id",
  "category",
  "project_module",
  "asset",
  "network",
  "token_contract",
  "occurred_at_from",
  "occurred_at_to",
] as const;

export type TransactionFilterKey = (typeof TRANSACTION_FILTER_KEYS)[number];
export type TransactionFilterState = Record<TransactionFilterKey, string>;

export function emptyTransactionFilters(): TransactionFilterState {
  return Object.fromEntries(
    TRANSACTION_FILTER_KEYS.map((key) => [key, ""]),
  ) as TransactionFilterState;
}

/**
 * Map operator filter controls onto existing GET /transactions query params.
 * Does not invent parameters. needs_reconciliation=true omits a conflicting status.
 */
export function buildTransactionListQueryParams(
  filters: TransactionFilterState,
): Record<string, string> {
  const extra: Record<string, string> = {};
  const needsReconciliation = filters.needs_reconciliation === "true";
  if (needsReconciliation) {
    extra.needs_reconciliation = "true";
  } else if (filters.status) {
    extra.status = filters.status;
  }
  if (filters.detail_publication) extra.detail_publication = filters.detail_publication;
  if (filters.kind) extra.kind = filters.kind;
  if (filters.direction) extra.direction = filters.direction;
  if (filters.provenance) extra.provenance = filters.provenance;
  if (filters.budget_id) extra.budget_id = filters.budget_id;
  if (filters.category) extra.category = filters.category;
  if (filters.project_module) extra.project_module = filters.project_module;
  if (filters.asset) extra.asset = filters.asset;
  if (filters.network) extra.network = filters.network;
  if (filters.token_contract) extra.token_contract = filters.token_contract;

  const fromIso = filters.occurred_at_from.includes("T")
    ? filters.occurred_at_from
    : dateOnlyToIso(filters.occurred_at_from);
  const toIso = filters.occurred_at_to.includes("T")
    ? filters.occurred_at_to
    : dateOnlyToIso(filters.occurred_at_to);
  if (fromIso) extra.occurred_at_from = fromIso;
  if (toIso) extra.occurred_at_to = toIso;
  return extra;
}
