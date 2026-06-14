import type { Balance } from "@/lib/trader/connectors/types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type BalanceSnapshotRow = {
  id: string;
  organizationId: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  balances: string;
  assetCount: number;
  syncedAt: Date;
  createdAt: Date;
};

export type InsertBalanceSnapshotRowInput = {
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  balances: Balance[];
  assetCount: number;
  syncedAt: Date;
};

export type ListBalanceSnapshotsQuery = {
  credentialId?: string;
  limit?: number;
};

export type BalanceSnapshotRepository = {
  insertBalanceSnapshotRow(
    context: OrgContext,
    input: InsertBalanceSnapshotRowInput,
  ): BalanceSnapshotRow | Promise<BalanceSnapshotRow>;
  listBalanceSnapshotRows(
    context: OrgContext,
    query?: ListBalanceSnapshotsQuery,
  ): BalanceSnapshotRow[] | Promise<BalanceSnapshotRow[]>;
};

/** Domain snapshot returned by service methods — includes parsed balances, never secrets. */
export type BalanceSnapshotMetadata = {
  id: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  balances: Balance[];
  assetCount: number;
  syncedAt: Date;
  createdAt: Date;
};

export type RecordBalanceSnapshotInput = {
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  balances: Balance[];
  syncedAt: Date;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type BalanceSnapshotServiceDeps = {
  repository: BalanceSnapshotRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type BalanceSnapshotService = {
  recordSnapshot(
    context: OrgContext,
    input: RecordBalanceSnapshotInput,
  ): Promise<BalanceSnapshotMetadata>;
  listSnapshots(
    context: OrgContext,
    query?: ListBalanceSnapshotsQuery,
  ): Promise<BalanceSnapshotMetadata[]>;
};

export type BalanceSnapshotDto = {
  id: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  balances: Balance[];
  assetCount: number;
  syncedAt: string;
  createdAt: string;
};

export type BalanceSnapshotsListResponse = {
  snapshots: BalanceSnapshotDto[];
};

export type BalanceSyncSuccessResponse = BalanceSnapshotDto;

export function parseBalancesJson(raw: string): Balance[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (item): item is Balance =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Balance).asset === "string" &&
      typeof (item as Balance).free === "string" &&
      typeof (item as Balance).locked === "string" &&
      typeof (item as Balance).total === "string",
  );
}

export function toBalanceSnapshotMetadata(row: BalanceSnapshotRow): BalanceSnapshotMetadata {
  return {
    id: row.id,
    credentialId: row.credentialId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    balances: parseBalancesJson(row.balances),
    assetCount: row.assetCount,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
  };
}

export function toBalanceSnapshotDto(metadata: BalanceSnapshotMetadata): BalanceSnapshotDto {
  return {
    id: metadata.id,
    credentialId: metadata.credentialId,
    venue: metadata.venue,
    exchangeAccountId: metadata.exchangeAccountId,
    balances: metadata.balances,
    assetCount: metadata.assetCount,
    syncedAt: metadata.syncedAt.toISOString(),
    createdAt: metadata.createdAt.toISOString(),
  };
}
