import type { Position } from "@/lib/trader/connectors/types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type PositionSnapshotRow = {
  id: string;
  organizationId: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  positions: string;
  positionCount: number;
  syncedAt: Date;
  createdAt: Date;
};

export type InsertPositionSnapshotRowInput = {
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  positions: Position[];
  positionCount: number;
  syncedAt: Date;
};

export type ListPositionSnapshotsQuery = {
  credentialId?: string;
  limit?: number;
};

export type PositionSnapshotRepository = {
  insertPositionSnapshotRow(
    context: OrgContext,
    input: InsertPositionSnapshotRowInput,
  ): PositionSnapshotRow | Promise<PositionSnapshotRow>;
  listPositionSnapshotRows(
    context: OrgContext,
    query?: ListPositionSnapshotsQuery,
  ): PositionSnapshotRow[] | Promise<PositionSnapshotRow[]>;
};

/** Domain snapshot returned by service methods — includes parsed positions, never secrets. */
export type PositionSnapshotMetadata = {
  id: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  positions: Position[];
  positionCount: number;
  syncedAt: Date;
  createdAt: Date;
};

export type RecordPositionSnapshotInput = {
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  positions: Position[];
  syncedAt: Date;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type PositionSnapshotServiceDeps = {
  repository: PositionSnapshotRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type PositionSnapshotService = {
  recordSnapshot(
    context: OrgContext,
    input: RecordPositionSnapshotInput,
  ): Promise<PositionSnapshotMetadata>;
  listSnapshots(
    context: OrgContext,
    query?: ListPositionSnapshotsQuery,
  ): Promise<PositionSnapshotMetadata[]>;
};

export type PositionSnapshotDto = {
  id: string;
  credentialId: string;
  venue: string;
  exchangeAccountId: string;
  positions: Position[];
  positionCount: number;
  syncedAt: string;
  createdAt: string;
};

export type PositionSnapshotsListResponse = {
  snapshots: PositionSnapshotDto[];
};

export type PositionSyncSuccessResponse = PositionSnapshotDto;

export function parsePositionsJson(raw: string): Position[] {
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
    (item): item is Position =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Position).symbol === "string" &&
      (item as Position).marketType === "spot" &&
      typeof (item as Position).quantity === "string",
  );
}

export function toPositionSnapshotMetadata(row: PositionSnapshotRow): PositionSnapshotMetadata {
  return {
    id: row.id,
    credentialId: row.credentialId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    positions: parsePositionsJson(row.positions),
    positionCount: row.positionCount,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
  };
}

export function toPositionSnapshotDto(metadata: PositionSnapshotMetadata): PositionSnapshotDto {
  return {
    id: metadata.id,
    credentialId: metadata.credentialId,
    venue: metadata.venue,
    exchangeAccountId: metadata.exchangeAccountId,
    positions: metadata.positions,
    positionCount: metadata.positionCount,
    syncedAt: metadata.syncedAt.toISOString(),
    createdAt: metadata.createdAt.toISOString(),
  };
}
