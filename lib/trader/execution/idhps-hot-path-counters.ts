import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

/**
 * Deterministic structural counters for H-ARCH-1 IDHPS RED/GREEN gates.
 * Non-semantic: does not affect digests, orders, or fills.
 */
export type IdhpsHotPathCounters = {
  listOrdersSqliteCalls: number;
  listOrdersSqliteRows: number;
  listFillsSqliteCalls: number;
  listFillsSqliteRows: number;
  listOpenOrdersSqliteCalls: number;
  listOpenOrdersSqliteRows: number;
  loadPaperFillEventsCalls: number;
  derivePortfolioAccountStateCalls: number;
  deriveAccountRiskStateFromMockOrdersCalls: number;
  reconciliationCalls: number;
  preparedStatementBuilds: number;
  fullChainDigestRecomputes: number;
  canonicalSerializeCount: number;
  canonicalSerializeBytes: number;
  sqliteTransactions: number;
};

const ZERO: IdhpsHotPathCounters = {
  listOrdersSqliteCalls: 0,
  listOrdersSqliteRows: 0,
  listFillsSqliteCalls: 0,
  listFillsSqliteRows: 0,
  listOpenOrdersSqliteCalls: 0,
  listOpenOrdersSqliteRows: 0,
  loadPaperFillEventsCalls: 0,
  derivePortfolioAccountStateCalls: 0,
  deriveAccountRiskStateFromMockOrdersCalls: 0,
  reconciliationCalls: 0,
  preparedStatementBuilds: 0,
  fullChainDigestRecomputes: 0,
  canonicalSerializeCount: 0,
  canonicalSerializeBytes: 0,
  sqliteTransactions: 0,
};

let counters: IdhpsHotPathCounters = { ...ZERO };
let idhpsHotPathEnabled = false;
let banListOrdersOnHotPath = false;
let banLoadPaperFillEventsOnHotPath = false;
let banDerivePortfolioFillWalkOnHotPath = false;

export function resetIdhpsHotPathCounters(): void {
  counters = { ...ZERO };
}

export function getIdhpsHotPathCounters(): Readonly<IdhpsHotPathCounters> {
  return { ...counters };
}

export function setIdhpsHotPathEnabled(enabled: boolean): void {
  idhpsHotPathEnabled = enabled;
}

export function isIdhpsHotPathEnabled(): boolean {
  return idhpsHotPathEnabled;
}

export function setIdhpsHotPathBans(input: {
  banListOrders?: boolean;
  banLoadPaperFillEvents?: boolean;
  banDerivePortfolioFillWalk?: boolean;
}): void {
  banListOrdersOnHotPath = input.banListOrders ?? banListOrdersOnHotPath;
  banLoadPaperFillEventsOnHotPath = input.banLoadPaperFillEvents ?? banLoadPaperFillEventsOnHotPath;
  banDerivePortfolioFillWalkOnHotPath =
    input.banDerivePortfolioFillWalk ?? banDerivePortfolioFillWalkOnHotPath;
}

export function enableIdhpsProductionBans(): void {
  setIdhpsHotPathEnabled(true);
  setIdhpsHotPathBans({
    banListOrders: true,
    banLoadPaperFillEvents: true,
    banDerivePortfolioFillWalk: true,
  });
}

/** Suspend hot-path bans for terminal/offline rebuilds; restores production bans afterward. */
export async function withIdhpsOfflineRebuild<T>(fn: () => Promise<T>): Promise<T> {
  if (!idhpsHotPathEnabled) {
    return fn();
  }
  setIdhpsHotPathBans({
    banListOrders: false,
    banLoadPaperFillEvents: false,
    banDerivePortfolioFillWalk: false,
  });
  try {
    return await fn();
  } finally {
    enableIdhpsProductionBans();
  }
}

export function bumpIdhpsCounter(key: keyof IdhpsHotPathCounters, delta = 1): void {
  counters[key] += delta;
}

export function assertIdhpsHotPathAllowsListOrders(): void {
  if (banListOrdersOnHotPath) {
    throw new Error("BLOCKED_BY_H_ARCH_1_GS01: listOrdersSqlite banned on IDHPS hot path");
  }
}

export function assertIdhpsHotPathAllowsLoadPaperFillEvents(): void {
  if (banLoadPaperFillEventsOnHotPath) {
    throw new Error("BLOCKED_BY_H_ARCH_1_GS03: loadPaperFillEvents banned on IDHPS hot path");
  }
}

export function assertIdhpsHotPathAllowsDerivePortfolioFillWalk(): void {
  if (banDerivePortfolioFillWalkOnHotPath) {
    throw new Error(
      "BLOCKED_BY_H_ARCH_1_GS05: derivePortfolioAccountState fill-walk banned on IDHPS hot path",
    );
  }
}
