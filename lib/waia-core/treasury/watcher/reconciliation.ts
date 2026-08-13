import { requireBigint } from "@/lib/waia-core/treasury/money";
import { compareBlockHeight } from "@/lib/waia-core/treasury/watcher/block-height";
import type { TreasuryChainObservationRecord } from "@/lib/waia-core/treasury/watcher/types";
import type { TreasuryBalanceReconStatus } from "@/lib/waia-core/treasury/watcher/types";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";

export const TREASURY_RECON_TOLERANCE_MICROS = 0n;

export function accountingCashBalanceAt(input: {
  transactions: readonly TreasuryTransactionRecord[];
  observationsByTransactionId: ReadonlyMap<string, readonly TreasuryChainObservationRecord[]>;
  asOfBlock: string;
  asOfTime: Date;
}): { cashMicros: bigint | null; unavailable: boolean } {
  let total = 0n;
  for (const tx of input.transactions) {
    if (tx.status !== "VERIFIED") continue;
    if (tx.cashEffectMicros === null) continue;
    if (tx.provenance === "WATCHER") {
      const linked = input.observationsByTransactionId.get(tx.id) ?? [];
      if (linked.length === 0) {
        return { cashMicros: null, unavailable: true };
      }
      let hasLater = false;
      for (const observation of linked) {
        if (!observation.blockHeight?.trim()) {
          return { cashMicros: null, unavailable: true };
        }
        try {
          if (compareBlockHeight(observation.blockHeight, input.asOfBlock) > 0) {
            hasLater = true;
            break;
          }
        } catch {
          return { cashMicros: null, unavailable: true };
        }
      }
      if (hasLater) continue;
      total += requireBigint(tx.cashEffectMicros, "cashEffectMicros");
      continue;
    }
    if (tx.occurredAt.getTime() > input.asOfTime.getTime()) continue;
    total += requireBigint(tx.cashEffectMicros, "cashEffectMicros");
  }
  return { cashMicros: total, unavailable: false };
}

export function pendingExplanationMicros(input: {
  observations: readonly TreasuryChainObservationRecord[];
  watchedAddressIds: ReadonlySet<string>;
}): bigint {
  let pending = 0n;
  const bySemantic = new Map<string, TreasuryChainObservationRecord[]>();
  for (const observation of input.observations) {
    if (observation.observationStatus !== "OBSERVED") continue;
    const key = `${observation.network}:${observation.txHash}:${observation.transferIndex}`;
    const group = bySemantic.get(key) ?? [];
    group.push(observation);
    bySemantic.set(key, group);
  }
  for (const group of bySemantic.values()) {
    const fromManaged = group.some(
      (row) => row.direction === "OUTFLOW" && input.watchedAddressIds.has(row.watchedAddressId),
    );
    const toManaged = group.some(
      (row) => row.direction === "INFLOW" && input.watchedAddressIds.has(row.watchedAddressId),
    );
    const amount = group[0] ? requireBigint(group[0].nativeAmountAtomic, "nativeAmountAtomic") : 0n;
    if (fromManaged && toManaged) {
      continue;
    }
    if (toManaged && !fromManaged) {
      pending += amount;
    } else if (fromManaged && !toManaged) {
      pending -= amount;
    }
  }
  return pending;
}

export function classifyReconciliation(input: {
  observedOnchainBalanceAtomic: bigint | null;
  accountingCashBalanceMicros: bigint | null;
  explainedPendingMicros: bigint;
  chainBalanceExact: boolean;
}): {
  status: TreasuryBalanceReconStatus;
  deltaMicros: bigint | null;
  unexplainedResidualMicros: bigint | null;
} {
  if (!input.chainBalanceExact || input.observedOnchainBalanceAtomic === null) {
    return {
      status: "UNAVAILABLE",
      deltaMicros: null,
      unexplainedResidualMicros: null,
    };
  }
  if (input.accountingCashBalanceMicros === null) {
    return {
      status: "UNAVAILABLE",
      deltaMicros: null,
      unexplainedResidualMicros: null,
    };
  }
  const delta = input.observedOnchainBalanceAtomic - input.accountingCashBalanceMicros;
  const unexplained = delta - input.explainedPendingMicros;
  if (delta === 0n) {
    return { status: "MATCHED", deltaMicros: delta, unexplainedResidualMicros: unexplained };
  }
  if (unexplained === 0n) {
    return {
      status: "PENDING_CONFIRMATIONS",
      deltaMicros: delta,
      unexplainedResidualMicros: unexplained,
    };
  }
  return { status: "MISMATCH", deltaMicros: delta, unexplainedResidualMicros: unexplained };
}
