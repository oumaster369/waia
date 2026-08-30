/**
 * DEE-436 — FHV v2 dataset sealing CLI (atomic manifest + seal receipt).
 *
 * Usage:
 *   pnpm trader:fhv:seal-v2-dataset -- --dataset-root <path> \
 *     --acquisition-receipt-dir <path> --seal-run-id <id> \
 *     --release-sha <sha> --organization-id <uuid> --operator-id <id>
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { sealFhvV2Dataset } from "@/lib/trader/market-data/fhv-dataset-seal";
import { assertHtxOfficialSourceCapabilityProven } from "@/lib/trader/market-data/fhv-htx-source-capability";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITER_VERSION = "waia-fhv-v2-writer/1.0.0";
const MIN_READER_VERSION = "waia-fhv-v2-reader/1.0.0";

function parseArgv(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const value = tokens[index + 1]?.trim();
    if (!value) {
      throw new Error(`Missing value for ${token}`);
    }
    parsed.set(token, value);
    index += 1;
  }
  return parsed;
}

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));
  const datasetRoot = flags.get("--dataset-root") ?? process.env.FHV_DATASET_ROOT?.trim();
  const receiptDir =
    flags.get("--acquisition-receipt-dir") ??
    (datasetRoot ? join(datasetRoot, "control", "acquisition") : undefined);
  const sealRunId = flags.get("--seal-run-id") ?? process.env.FHV_SEAL_RUN_ID?.trim();
  const releaseSha = flags.get("--release-sha") ?? process.env.FHV_RELEASE_SHA?.trim();
  const organizationId = flags.get("--organization-id") ?? process.env.FHV_ORGANIZATION_ID?.trim();
  const operatorId = flags.get("--operator-id") ?? process.env.FHV_OPERATOR_ID?.trim();

  if (!datasetRoot) {
    throw new Error("--dataset-root is required");
  }
  if (!receiptDir) {
    throw new Error("--acquisition-receipt-dir is required");
  }
  if (!sealRunId) {
    throw new Error("--seal-run-id is required");
  }
  if (!releaseSha || !FULL_SHA.test(releaseSha)) {
    throw new Error("--release-sha must be a full git SHA");
  }
  if (!organizationId || !UUID_V4.test(organizationId)) {
    throw new Error("--organization-id must be UUID v4");
  }
  if (!operatorId?.trim()) {
    throw new Error("--operator-id is required");
  }

  const capability = assertHtxOfficialSourceCapabilityProven();
  const receiptNames = readdirSync(receiptDir);
  const preHoldoutV2Receipts = receiptNames.filter(
    (name) => name.startsWith("fhv-acquisition-receipt.") && name.endsWith(".v2.json"),
  );
  if (preHoldoutV2Receipts.length > 0) {
    throw new Error(
      "PRE_HOLDOUT_REQUIRES_QUALIFICATION_FLOW: four real-provider v2 receipts must use " +
        "trader:fhv:pre-holdout-qualify then trader:fhv:dataset-qualify with " +
        "OFFICIAL_PRE_HOLDOUT_REAL_DATA; full sealing requires six receipts including a " +
        "separately authorized blind holdout and is forbidden here.",
    );
  }
  const acquisitionReceiptPaths = receiptNames
    .filter((name) => name.startsWith("fhv-acquisition-receipt.") && name.endsWith(".v1.json"))
    .map((name) => join(receiptDir, name))
    .sort();

  const result = sealFhvV2Dataset({
    datasetRoot,
    acquisitionReceiptPaths,
    releaseSha,
    organizationId,
    operatorId,
    sourceCapabilityReceiptDigest: capability.sourceCapabilityEvidenceDigest,
    writerVersion: WRITER_VERSION,
    minimumReaderVersion: MIN_READER_VERSION,
    sealRunId,
  });

  console.log(
    JSON.stringify(
      {
        classification: "FHV_V2_DATASET_LOGICAL_ATOMIC_SEAL_COMMIT_PASS",
        sealRunId,
        manifestSemanticDigest: result.manifest.manifestSemanticDigest,
        datasetContentDigest: result.manifest.datasetContentDigest,
        sealReceiptDigest: result.sealReceipt.sealReceiptDigest,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
