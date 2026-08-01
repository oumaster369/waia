import { existsSync, readFileSync } from "node:fs";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export const FHV_CONTROL_REPLAY_RECEIPT_SCHEMA_VERSION = "fhv-control-replay-receipt/v1" as const;

export type FhvControlReplayReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_CONTROL_REPLAY_RECEIPT_SCHEMA_VERSION;
  classification: "CONTROL_REPLAY=PASS";
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  runOneId: string;
  runTwoId: string;
  runOneDigest: string;
  runTwoDigest: string;
  digestsMatch: true;
  capturedAtUtc: string;
  controlReplayReceiptDigest: string;
}>;

export class FhvControlReplayReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvControlReplayReceiptError";
  }
}

function computeControlReplayReceiptDigest(
  receipt: Omit<FhvControlReplayReceiptV1, "controlReplayReceiptDigest">,
): string {
  return computePayloadDigest(receipt);
}

export function buildFhvControlReplayReceipt(
  body: Omit<FhvControlReplayReceiptV1, "controlReplayReceiptDigest">,
): FhvControlReplayReceiptV1 {
  return {
    ...body,
    controlReplayReceiptDigest: computeControlReplayReceiptDigest(body),
  };
}

export function readFhvControlReplayReceipt(receiptPath: string): FhvControlReplayReceiptV1 {
  const parsed = JSON.parse(readFileSync(receiptPath, "utf8")) as FhvControlReplayReceiptV1;
  const { controlReplayReceiptDigest, ...body } = parsed;
  const expected = computeControlReplayReceiptDigest(body);
  if (expected !== controlReplayReceiptDigest) {
    throw new FhvControlReplayReceiptError(
      "CONTROL_REPLAY_RECEIPT_DIGEST_MISMATCH",
      "Control replay receipt digest mismatch.",
    );
  }
  if (parsed.classification !== "CONTROL_REPLAY=PASS") {
    throw new FhvControlReplayReceiptError(
      "CONTROL_REPLAY_RECEIPT_NOT_PASS",
      "Control replay receipt must classify PASS.",
    );
  }
  return parsed;
}

export function writeFhvControlReplayReceiptAtomic(input: {
  receiptPath: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  runOneId: string;
  runTwoId: string;
  runOneDigest: string;
  runTwoDigest: string;
  capturedAtUtc?: string;
}): FhvControlReplayReceiptV1 {
  if (existsSync(input.receiptPath)) {
    return readFhvControlReplayReceipt(input.receiptPath);
  }
  const body = {
    schemaVersion: FHV_CONTROL_REPLAY_RECEIPT_SCHEMA_VERSION,
    classification: "CONTROL_REPLAY=PASS" as const,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    runOneId: input.runOneId,
    runTwoId: input.runTwoId,
    runOneDigest: input.runOneDigest,
    runTwoDigest: input.runTwoDigest,
    digestsMatch: true as const,
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
  };
  const receipt = buildFhvControlReplayReceipt(body);
  writeFileAtomicExclusive(input.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
