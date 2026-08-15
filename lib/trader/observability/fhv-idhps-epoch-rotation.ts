import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION,
  captureIdhpsAccountingBridgeMirror,
  type IdhpsAccountingBridgeMirrorV1,
} from "@/lib/trader/accounting/idhps-accounting-bridge-mirror";
import {
  captureIdhpsSemanticDigestFrontier,
  type IdhpsSemanticDigestFrontierV1,
} from "@/lib/trader/backtest/streaming-evidence/idhps-semantic-digest-frontier";
import {
  captureIdhpsAccountRiskMirror,
  type IdhpsAccountRiskMirrorV1,
} from "@/lib/trader/paper/idhps-account-risk-mirror";
import {
  captureIdhpsInventoryMirror,
  evictTerminalFilledQuantityAfterEpochCommit,
  type IdhpsInventoryMirrorV1,
} from "@/lib/trader/paper/idhps-inventory-mirror";
import {
  buildIdhpsCompositeMirrorSnapshot,
  createEmptyIdhpsAccountingBridgeMirrorShell,
  type IdhpsCompositeMirrorSnapshotV1,
} from "@/lib/trader/observability/idhps-composite-mirror-snapshot";
import {
  getIdhpsSession,
  type IdhpsSessionRuntime,
} from "@/lib/trader/execution/idhps-session-registry";

export class FhvIdhpsEpochRotationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvIdhpsEpochRotationError";
  }
}

export type FrozenPendingIdhpsEpochV1 = Readonly<{
  epochId: number;
  inventory: IdhpsInventoryMirrorV1;
  accountRisk: IdhpsAccountRiskMirrorV1;
  semanticDigestFrontier: IdhpsSemanticDigestFrontierV1;
  accounting: Readonly<{
    accountingSequence: number;
    semanticContentDigest: string;
    cashLedgerBaseUsdt: string;
    cashAtFreeze: string;
    cashEvents: IdhpsAccountingBridgeMirrorV1["cashEvents"];
    callOrder: IdhpsAccountingBridgeMirrorV1["callOrder"];
    epochConsumedFillIds: string[];
  }> | null;
}>;

function requireRuntime(): IdhpsSessionRuntime {
  const runtime = getIdhpsSession();
  if (!runtime) {
    throw new FhvIdhpsEpochRotationError(
      "FHV_IDHPS_FROZEN_SNAPSHOT_MISSING",
      "IDHPS session is not open",
    );
  }
  return runtime;
}

/** Detached freeze-time snapshot. Does not mutate live state. */
export function captureFrozenPendingIdhpsEpoch(epochId: number): FrozenPendingIdhpsEpochV1 {
  const runtime = requireRuntime();
  const bridge = runtime.accountingBridge;
  return {
    epochId,
    inventory: captureIdhpsInventoryMirror(runtime.inventory),
    accountRisk: captureIdhpsAccountRiskMirror(runtime.accountRisk),
    semanticDigestFrontier: captureIdhpsSemanticDigestFrontier(runtime.semanticDigestFrontier),
    accounting: bridge
      ? {
          accountingSequence: bridge.state.accountingSequence,
          semanticContentDigest: captureIdhpsAccountingBridgeMirror(bridge).semanticContentDigest,
          cashLedgerBaseUsdt: bridge.cashLedgerBaseUsdt,
          cashAtFreeze: bridge.state.cash,
          cashEvents: [...bridge.cashEvents],
          callOrder: [...bridge.callOrder],
          epochConsumedFillIds: [...bridge.epochConsumedFillIds],
        }
      : null,
  };
}

/**
 * Live working-set rotation after frozen N exists.
 * Must not call applyIdhpsDurableEpochStep10 or clearIdhpsEpochArraysAfterDurableCommit.
 */
export function rotateIdhpsLiveEpochWorkingSetAfterProvisionalFreeze(
  frozen: FrozenPendingIdhpsEpochV1,
): void {
  const runtime = requireRuntime();
  const freezeTerminalIds = new Set(frozen.inventory.terminalOrderIdsSinceEpoch);
  const openIds = new Set(Object.values(runtime.inventory.openOrderIdsBySymbol).flat());
  for (const orderId of Object.keys(runtime.inventory.filledQuantityByOrder)) {
    if (!openIds.has(orderId) && freezeTerminalIds.has(orderId)) {
      delete runtime.inventory.filledQuantityByOrder[orderId];
    }
  }
  runtime.inventory.terminalOrderIdsSinceEpoch = [];

  const bridge = runtime.accountingBridge;
  if (bridge && frozen.accounting) {
    bridge.cashLedgerBaseUsdt = frozen.accounting.cashAtFreeze;
    bridge.cashEvents = [];
    bridge.callOrder = [];
    bridge.epochConsumedFillIds = [];
  }
}

/**
 * Pure post-Step-10 composite from frozen N. Does not mutate live N+1.
 * Must be written into the verified bundle before journal authority.
 */
export function materializePostCommitIdhpsCompositeFromFrozen(
  frozen: FrozenPendingIdhpsEpochV1,
): IdhpsCompositeMirrorSnapshotV1 {
  const inventory = structuredClone(frozen.inventory);
  evictTerminalFilledQuantityAfterEpochCommit(inventory);
  const accountingBridge: IdhpsAccountingBridgeMirrorV1 = frozen.accounting
    ? {
        schemaVersion: IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION,
        accountingSequence: frozen.accounting.accountingSequence,
        semanticContentDigest: frozen.accounting.semanticContentDigest,
        cashEvents: [],
        callOrder: [],
      }
    : createEmptyIdhpsAccountingBridgeMirrorShell();
  return buildIdhpsCompositeMirrorSnapshot({
    epochId: frozen.epochId,
    inventory,
    accountRisk: frozen.accountRisk,
    accountingBridge,
    semanticDigestFrontier: frozen.semanticDigestFrontier,
  });
}
