import { readFileSync } from "node:fs";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";

export const FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA =
  "fhv-pre-holdout-runtime-requalification/v1" as const;
const FULL_SHA = /^[0-9a-f]{40}$/;

export type FhvPreHoldoutRuntimeRequalificationV1 = Readonly<{
  schemaVersion: typeof FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA;
  classification: "RUNTIME_REQUALIFICATION=PASS";
  sourceQualificationReceiptDigest: string;
  sourceReleaseSha: string;
  targetReleaseSha: string;
  datasetContentDigest: string;
  organizationId: string;
  operatorId: string;
  verifiedAtUtc: string;
  requalificationReceiptDigest: string;
}>;

function digest(body: Omit<FhvPreHoldoutRuntimeRequalificationV1, "requalificationReceiptDigest">) {
  return computePayloadDigest(body);
}

export function writeFhvPreHoldoutRuntimeRequalification(input: {
  datasetRoot: string;
  sourceQualificationReceiptPath: string;
  targetReleaseSha: string;
  outputPath: string;
  verifiedAtUtc?: string;
}): FhvPreHoldoutRuntimeRequalificationV1 {
  const targetReleaseSha = input.targetReleaseSha.trim().toLowerCase();
  if (!FULL_SHA.test(targetReleaseSha)) throw new Error("TARGET_RELEASE_SHA_INVALID");
  const source = readFhvPreHoldoutQualificationReceipt(input.sourceQualificationReceiptPath);
  assertFhvPreHoldoutFilesMatchReceipt({ datasetRoot: input.datasetRoot, receipt: source });
  const body = {
    schemaVersion: FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
    classification: "RUNTIME_REQUALIFICATION=PASS" as const,
    sourceQualificationReceiptDigest: source.qualificationReceiptDigest,
    sourceReleaseSha: source.releaseSha,
    targetReleaseSha,
    datasetContentDigest: source.developmentWalkForwardContentDigest,
    organizationId: source.organizationId,
    operatorId: source.operatorId,
    verifiedAtUtc: input.verifiedAtUtc ?? new Date().toISOString(),
  };
  const receipt = { ...body, requalificationReceiptDigest: digest(body) };
  writeFileAtomicExclusive(input.outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function readFhvPreHoldoutRuntimeRequalification(
  path: string,
): FhvPreHoldoutRuntimeRequalificationV1 {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvPreHoldoutRuntimeRequalificationV1;
  const { requalificationReceiptDigest, ...body } = parsed;
  if (
    parsed.schemaVersion !== FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA ||
    parsed.classification !== "RUNTIME_REQUALIFICATION=PASS" ||
    digest(body) !== requalificationReceiptDigest
  ) {
    throw new Error("RUNTIME_REQUALIFICATION_RECEIPT_INVALID");
  }
  return parsed;
}
