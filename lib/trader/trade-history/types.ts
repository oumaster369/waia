import type { Trade } from "@/lib/trader/connectors/types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type TradeHistorySnapshotRow = {
  id: string;
  organizationId: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  symbol: string;
  trades: string;
  tradeCount: number;
  syncedAt: Date;
  createdAt: Date;
};

export type InsertTradeHistorySnapshotRowInput = {
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  symbol: string;
  trades: Trade[];
  tradeCount: number;
  syncedAt: Date;
};

export type ListTradeHistorySnapshotsQuery = {
  credentialId?: string;
  symbol?: string;
  limit?: number;
};

export type TradeHistorySnapshotRepository = {
  insertTradeHistorySnapshotRow(
    context: OrgContext,
    input: InsertTradeHistorySnapshotRowInput,
  ): TradeHistorySnapshotRow | Promise<TradeHistorySnapshotRow>;
  listTradeHistorySnapshotRows(
    context: OrgContext,
    query?: ListTradeHistorySnapshotsQuery,
  ): TradeHistorySnapshotRow[] | Promise<TradeHistorySnapshotRow[]>;
};

/** Domain snapshot returned by service methods — includes parsed trades, never secrets. */
export type TradeHistorySnapshotMetadata = {
  id: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  symbol: string;
  trades: Trade[];
  tradeCount: number;
  syncedAt: Date;
  createdAt: Date;
};

export type RecordTradeHistorySnapshotInput = {
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  symbol: string;
  trades: Trade[];
  syncedAt: Date;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type TradeHistorySnapshotServiceDeps = {
  repository: TradeHistorySnapshotRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type TradeHistorySnapshotService = {
  recordSnapshot(
    context: OrgContext,
    input: RecordTradeHistorySnapshotInput,
  ): Promise<TradeHistorySnapshotMetadata>;
  listSnapshots(
    context: OrgContext,
    query?: ListTradeHistorySnapshotsQuery,
  ): Promise<TradeHistorySnapshotMetadata[]>;
};

export type TradeHistorySnapshotDto = {
  id: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  symbol: string;
  trades: Trade[];
  tradeCount: number;
  syncedAt: string;
  createdAt: string;
};

export type TradeHistorySnapshotsListResponse = {
  snapshots: TradeHistorySnapshotDto[];
};

export type TradeHistorySyncSuccessResponse = TradeHistorySnapshotDto;

export function parseTradesJson(raw: string): Trade[] {
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
    (item): item is Trade =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Trade).tradeId === "string" &&
      typeof (item as Trade).orderId === "string" &&
      typeof (item as Trade).clientOrderId === "string" &&
      typeof (item as Trade).symbol === "string" &&
      ((item as Trade).side === "buy" || (item as Trade).side === "sell") &&
      typeof (item as Trade).price === "string" &&
      typeof (item as Trade).quantity === "string" &&
      typeof (item as Trade).fee === "string" &&
      typeof (item as Trade).feeAsset === "string" &&
      typeof (item as Trade).executedAt === "string",
  );
}

export function toTradeHistorySnapshotMetadata(
  row: TradeHistorySnapshotRow,
): TradeHistorySnapshotMetadata {
  return {
    id: row.id,
    credentialId: row.credentialId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    symbol: row.symbol,
    trades: parseTradesJson(row.trades),
    tradeCount: row.tradeCount,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
  };
}

export function toTradeHistorySnapshotDto(
  metadata: TradeHistorySnapshotMetadata,
): TradeHistorySnapshotDto {
  return {
    id: metadata.id,
    credentialId: metadata.credentialId,
    venue: metadata.venue,
    exchangeAccountId: metadata.exchangeAccountId,
    symbol: metadata.symbol,
    trades: metadata.trades,
    tradeCount: metadata.tradeCount,
    syncedAt: metadata.syncedAt.toISOString(),
    createdAt: metadata.createdAt.toISOString(),
  };
}
