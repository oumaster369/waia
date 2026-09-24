export type AdminDataState =
  | "ok"
  | "empty"
  | "partial"
  | "stale"
  | "unavailable"
  | "forbidden"
  | "not_applicable";

export type AdminTimes = {
  sourceAt: string | null;
  observedAt: string | null;
  effectiveAt: string | null;
};

export type AdminFact<T> = {
  state: AdminDataState;
  value: T | null;
  times: AdminTimes;
  source: string | null;
  reasons: string[];
  breakdownRef?: string;
};

export type AdminMoney = { amount: string; currency: string; method: string };
export type AdminMode = "live" | "paper" | "history" | "observation" | "undetermined";

export type AdminCoverage = {
  included: number;
  total: number;
  excluded: { id: string; reason: string }[];
};

export type AdminAction = {
  action: string;
  enabled: boolean;
  reason: string | null;
  href?: string;
};

export type AdminScope = {
  kind: "fleet" | "organization" | "account";
  organizationId?: string;
  exchangeAccountId?: string;
};

export type AdminReadEnvelope<T> = {
  schemaVersion: "admin-console/v1";
  generatedAt: string;
  revision: string;
  financeRevision?: string;
  cursor?: string;
  scope: AdminScope;
  mode: AdminMode | "all";
  coverage: AdminCoverage | null;
  missingSources: string[];
  data: T;
};

export type AdminPage<T> = {
  items: T[];
  total: number | null;
  nextCursor: string | null;
  truncated: boolean;
};

export const ADMIN_STREAM_TOPICS = [
  "overview",
  "attention",
  "accounts",
  "orders",
  "fills",
  "positions",
  "billing",
  "payments",
  "clients",
  "strategies",
  "research_runs",
  "market",
  "news",
  "incidents",
  "diagnostics",
  "jobs",
  "audit",
] as const;

export type AdminStreamTopic = (typeof ADMIN_STREAM_TOPICS)[number];

export type AdminStreamEventType =
  | "upsert"
  | "entity_removed"
  | "snapshot"
  | "resync_required"
  | "access_revoked"
  | "heartbeat";
