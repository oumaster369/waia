/**
 * Operator CLI: generate OFFICIAL_PRE_HOLDOUT_REAL_DATA qualification from acquired receipts.
 *
 * Usage:
 *   pnpm trader:fhv:pre-holdout-qualify -- --release-sha <40hex> --organization-id <uuid> \
 *     --operator-id <id> --dataset-root <path> --source-capability-digest <64hex> \
 *     --revision-risk-evidence <path> --acquisition-receipts <p1,p2,p3,p4> --out-dir <path>
 */

import { mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  qualifyFhvPreHoldoutRealData,
  writeFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import type { FhvRevisionRiskSampleEvidenceV1 } from "@/lib/trader/market-data/fhv-revision-risk-evidence";

const FULL_SHA = /^[0-9a-f]{40}$/;

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
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

export function resolveFhvPreHoldoutQualifyCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  return {
    releaseSha: (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim(),
    organizationId:
      (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim(),
    operatorId: (flags.get("--operator-id") as string | undefined) ?? env.FHV_OPERATOR_ID?.trim(),
    datasetRoot:
      (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim(),
    sourceCapabilityDigest:
      (flags.get("--source-capability-digest") as string | undefined) ??
      env.FHV_SOURCE_CAPABILITY_DIGEST?.trim(),
    revisionRiskEvidence: flags.get("--revision-risk-evidence") as string | undefined,
    acquisitionReceipts: flags.get("--acquisition-receipts") as string | undefined,
    outDir: (flags.get("--out-dir") as string | undefined) ?? env.FHV_RECEIPT_DIR?.trim(),
  };
}

async function main(): Promise<void> {
  const config = resolveFhvPreHoldoutQualifyCliConfig();
  if (!config.releaseSha || !FULL_SHA.test(config.releaseSha.trim().toLowerCase())) {
    throw new Error("--release-sha <40 hex chars> is required");
  }
  if (
    !config.organizationId ||
    !config.operatorId ||
    !config.datasetRoot ||
    !config.sourceCapabilityDigest ||
    !config.revisionRiskEvidence ||
    !config.acquisitionReceipts ||
    !config.outDir
  ) {
    throw new Error(
      "--organization-id, --operator-id, --dataset-root, --source-capability-digest, --revision-risk-evidence, --acquisition-receipts, and --out-dir are required",
    );
  }
  assertPathDoesNotAccessBlindHoldoutPayload(config.datasetRoot);
  assertPathDoesNotAccessBlindHoldoutPayload(config.revisionRiskEvidence);
  assertPathDoesNotAccessBlindHoldoutPayload(config.outDir);
  const parsedEvidence = JSON.parse(readFileSync(config.revisionRiskEvidence, "utf8")) as {
    samples?: readonly FhvRevisionRiskSampleEvidenceV1[];
  };
  const receipts = config.acquisitionReceipts.split(",").map((path) => path.trim());
  for (const receiptPath of receipts) {
    assertPathDoesNotAccessBlindHoldoutPayload(receiptPath);
  }
  mkdirSync(config.outDir, { recursive: true });
  const receipt = qualifyFhvPreHoldoutRealData({
    datasetRoot: config.datasetRoot,
    acquisitionReceiptPaths: receipts,
    releaseSha: config.releaseSha,
    organizationId: config.organizationId,
    operatorId: config.operatorId,
    sourceCapabilityEvidenceDigest: config.sourceCapabilityDigest,
    revisionRiskEvidence: parsedEvidence.samples ?? [],
  });
  const path = writeFhvPreHoldoutQualificationReceipt({
    receiptDir: config.outDir,
    receipt,
  });
  process.stdout.write(
    `artifact=${path}\ndigest=${receipt.qualificationReceiptDigest}\nclassification=${receipt.classification}\n`,
  );
  if (receipt.classification !== "PRE_HOLDOUT_QUALIFICATION=PASS") {
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
