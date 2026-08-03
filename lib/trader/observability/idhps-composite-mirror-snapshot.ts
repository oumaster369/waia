import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { IdhpsInventoryMirrorV1 } from "@/lib/trader/paper/idhps-inventory-mirror";
import type { IdhpsAccountRiskMirrorV1 } from "@/lib/trader/paper/idhps-account-risk-mirror";
import {
  IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION,
  type IdhpsAccountingBridgeMirrorV1,
} from "@/lib/trader/accounting/idhps-accounting-bridge-mirror";
import type { IdhpsSemanticDigestFrontierV1 } from "@/lib/trader/backtest/streaming-evidence/idhps-semantic-digest-frontier";

export const IDHPS_COMPOSITE_MIRROR_SNAPSHOT_SCHEMA_VERSION =
  "idhps-composite-mirror-snapshot/v1" as const;

export const IDHPS_COMPOSITE_MIRROR_FILENAME = "idhps-composite-mirror-snapshot.v1.json" as const;

export type IdhpsCompositeMirrorSnapshotV1 = {
  schemaVersion: typeof IDHPS_COMPOSITE_MIRROR_SNAPSHOT_SCHEMA_VERSION;
  epochId: number;
  inventory: IdhpsInventoryMirrorV1;
  accountRisk: IdhpsAccountRiskMirrorV1;
  accountingBridge: IdhpsAccountingBridgeMirrorV1;
  semanticDigestFrontier: IdhpsSemanticDigestFrontierV1;
  contentDigest: string;
};

export function buildIdhpsCompositeMirrorSnapshot(input: {
  epochId: number;
  inventory: IdhpsInventoryMirrorV1;
  accountRisk: IdhpsAccountRiskMirrorV1;
  accountingBridge: IdhpsAccountingBridgeMirrorV1;
  semanticDigestFrontier: IdhpsSemanticDigestFrontierV1;
}): IdhpsCompositeMirrorSnapshotV1 {
  const withoutDigest = {
    schemaVersion: IDHPS_COMPOSITE_MIRROR_SNAPSHOT_SCHEMA_VERSION,
    epochId: input.epochId,
    inventory: structuredClone(input.inventory),
    accountRisk: structuredClone(input.accountRisk),
    accountingBridge: structuredClone(input.accountingBridge),
    semanticDigestFrontier: structuredClone(input.semanticDigestFrontier),
  };
  const contentDigest = createHash("sha256")
    .update(canonicalJsonString(withoutDigest), "utf8")
    .digest("hex");
  return { ...withoutDigest, contentDigest };
}

export function idhpsCompositeMirrorPath(checkpointDir: string): string {
  return join(checkpointDir, IDHPS_COMPOSITE_MIRROR_FILENAME);
}

export function writeIdhpsCompositeMirrorSnapshotAtomic(
  checkpointDir: string,
  snapshot: IdhpsCompositeMirrorSnapshotV1,
): string {
  mkdirSync(checkpointDir, { recursive: true });
  const target = idhpsCompositeMirrorPath(checkpointDir);
  const temp = `${target}.tmp`;
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  writeFileSync(temp, body, "utf8");
  const fd = openSync(temp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, target);
  const dirFd = openSync(dirname(target), "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  return target;
}

export function digestIdhpsCompositeMirrorSnapshot(
  snapshot: IdhpsCompositeMirrorSnapshotV1,
): string {
  return createHash("sha256").update(canonicalJsonString(snapshot), "utf8").digest("hex");
}

export function createEmptyIdhpsAccountingBridgeMirrorShell(): IdhpsAccountingBridgeMirrorV1 {
  return {
    schemaVersion: IDHPS_ACCOUNTING_BRIDGE_MIRROR_SCHEMA_VERSION,
    accountingSequence: 0,
    semanticContentDigest: "0".repeat(64),
    cashEvents: [],
    callOrder: [],
  };
}

export function readIdhpsCompositeMirrorSnapshot(
  checkpointDir: string,
): IdhpsCompositeMirrorSnapshotV1 | null {
  const path = idhpsCompositeMirrorPath(checkpointDir);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as IdhpsCompositeMirrorSnapshotV1;
  if (parsed.schemaVersion !== IDHPS_COMPOSITE_MIRROR_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: composite schema");
  }
  const { contentDigest, ...withoutDigest } = parsed;
  const expected = createHash("sha256")
    .update(canonicalJsonString(withoutDigest), "utf8")
    .digest("hex");
  if (expected !== contentDigest) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: composite digest");
  }
  return parsed;
}
