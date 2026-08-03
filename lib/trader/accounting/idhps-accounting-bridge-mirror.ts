import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";

import type {
  HtrAccountingCashEvent,
  HtrAccountingCycleBridge,
  HtrRuntimeCallEvent,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { bumpIdhpsCounter } from "@/lib/trader/execution/idhps-hot-path-counters";

export const IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION =
  "idhps-accounting-bridge-mirror/v1" as const;

export type IdhpsAccountingBridgeMirrorV1 = {
  schemaVersion: typeof IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION;
  accountingSequence: number;
  semanticContentDigest: string;
  /** Events after most recent durable EPOCH_COMMIT only. */
  cashEvents: HtrAccountingCashEvent[];
  callOrder: HtrRuntimeCallEvent[];
};

export function captureIdhpsAccountingBridgeMirror(
  bridge: HtrAccountingCycleBridge,
): IdhpsAccountingBridgeMirrorV1 {
  return {
    schemaVersion: IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION,
    accountingSequence: bridge.state.accountingSequence,
    semanticContentDigest: computeAccountingSemanticDigest(bridge.state),
    cashEvents: [...bridge.cashEvents],
    callOrder: [...bridge.callOrder],
  };
}

export function digestIdhpsAccountingBridgeMirror(mirror: IdhpsAccountingBridgeMirrorV1): string {
  return createHash("sha256").update(canonicalJsonString(mirror), "utf8").digest("hex");
}

/**
 * Durable authority step 10: clear epoch-scoped arrays on the live bridge.
 * Must run only after EPOCH_COMMIT + journal + claim are durable.
 */
export function clearIdhpsEpochArraysAfterDurableCommit(bridge: HtrAccountingCycleBridge): void {
  bridge.cashLedgerBaseUsdt = bridge.state.cash;
  bridge.cashEvents.length = 0;
  bridge.callOrder.length = 0;
  bridge.epochConsumedFillIds.length = 0;
}

export function assertNoPriorEpochEntriesInBridgeArrays(
  bridge: HtrAccountingCycleBridge,
  expectedMaxLength: number,
): void {
  if (bridge.cashEvents.length > expectedMaxLength || bridge.callOrder.length > expectedMaxLength) {
    throw new Error(
      "BLOCKED_BY_H_ARCH_1_IDHPS_EPOCH_EVICTION_OR_RETENTION_FAIL: epoch arrays exceeded bound",
    );
  }
}

export function noteIdhpsReconciliationCall(): void {
  bumpIdhpsCounter("reconciliationCalls");
}
