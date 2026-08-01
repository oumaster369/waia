/**
 * DEE-436 — FHV dataset qualification CLI.
 *
 * Usage:
 *   pnpm trader:fhv:dataset-qualify -- --dataset-root <path> --manifest-path <path> [--receipt-dir <path>]
 *   pnpm trader:fhv:dataset-qualify -- --bounded-fixture [--receipt-dir <path>]
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  qualifyFhvBoundedFixtureDataset,
  qualifyFhvOfficialDataset,
  writeFhvDatasetQualificationReceiptAtomic,
  type FhvDatasetQualificationReceiptV1,
  type FhvQualificationMode,
} from "@/lib/trader/observability/fhv-dataset-qualification";

export type FhvDatasetQualificationResult = Readonly<{
  schemaVersion: "fhv-dataset-qualification/v1";
  classification: "DATASET_QUALIFICATION=PASS" | "DATASET_QUALIFICATION=FAIL";
  datasetRoot: string;
  manifestPath: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  gapPolicyId: string;
  qualificationReceiptPath?: string;
  failureReason?: string;
}>;

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    if (token === "--bounded-fixture") {
      parsed.set(token, true);
      continue;
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

export function resolveFhvDatasetQualificationCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): {
  boundedFixture: boolean;
  datasetRoot?: string;
  manifestPath?: string;
  receiptDir?: string;
  qualificationMode?: FhvQualificationMode;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
} {
  const flags = parseArgv(argv);
  const boundedFixture = flags.has("--bounded-fixture");
  const datasetRoot =
    (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim();
  const manifestPath =
    (flags.get("--manifest-path") as string | undefined) ?? env.FHV_MANIFEST_PATH?.trim();
  const receiptDir =
    (flags.get("--receipt-dir") as string | undefined) ?? env.FHV_RECEIPT_DIR?.trim();
  const qualificationMode = flags.get("--qualification-mode") as FhvQualificationMode | undefined;
  const releaseSha =
    (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim();
  const releaseTag =
    (flags.get("--release-tag") as string | undefined) ?? env.FHV_RELEASE_TAG?.trim();
  const organizationId =
    (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim();
  const operatorId =
    (flags.get("--operator-id") as string | undefined) ?? env.FHV_OPERATOR_ID?.trim();

  if (!boundedFixture) {
    if (!datasetRoot || !manifestPath) {
      throw new Error("--dataset-root and --manifest-path are required.");
    }
    const mode = qualificationMode ?? "OFFICIAL_MULTI_YEAR";
    if (mode === "OFFICIAL_MULTI_YEAR") {
      if (!releaseSha || !FULL_SHA.test(releaseSha)) {
        throw new Error("OFFICIAL_MULTI_YEAR requires --release-sha (full git SHA).");
      }
      if (!releaseTag?.trim()) {
        throw new Error("OFFICIAL_MULTI_YEAR requires --release-tag.");
      }
      if (!organizationId || !UUID_V4.test(organizationId)) {
        throw new Error("OFFICIAL_MULTI_YEAR requires --organization-id (UUID v4).");
      }
      if (!operatorId?.trim()) {
        throw new Error("OFFICIAL_MULTI_YEAR requires --operator-id.");
      }
      if (!receiptDir) {
        throw new Error("OFFICIAL_MULTI_YEAR requires --receipt-dir.");
      }
    }
  }

  return {
    boundedFixture,
    datasetRoot,
    manifestPath,
    receiptDir,
    qualificationMode,
    releaseSha,
    releaseTag,
    organizationId,
    operatorId,
  };
}

export function runFhvDatasetQualification(input?: {
  boundedFixture?: boolean;
  datasetRoot?: string;
  manifestPath?: string;
  receiptDir?: string;
  qualificationMode?: FhvQualificationMode;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
}): FhvDatasetQualificationResult {
  const config = input ?? resolveFhvDatasetQualificationCliConfig();
  try {
    const body = config.boundedFixture
      ? qualifyFhvBoundedFixtureDataset()
      : qualifyFhvOfficialDataset({
          datasetRoot: config.datasetRoot!,
          manifestPath: config.manifestPath!,
          qualificationMode: config.qualificationMode,
          releaseSha: config.releaseSha,
          releaseTag: config.releaseTag,
          organizationId: config.organizationId,
          operatorId: config.operatorId,
        });

    let receipt: FhvDatasetQualificationReceiptV1 | undefined;
    if (config.receiptDir) {
      mkdirSync(config.receiptDir, { recursive: true });
      receipt = writeFhvDatasetQualificationReceiptAtomic({
        receiptDir: config.receiptDir,
        datasetRoot: body.datasetRoot,
        manifestPath: body.manifestPath,
        boundedFixture: config.boundedFixture,
        qualificationMode: config.qualificationMode,
        releaseSha: config.releaseSha,
        releaseTag: config.releaseTag,
        organizationId: config.organizationId,
        operatorId: config.operatorId,
      });
    }

    return {
      schemaVersion: "fhv-dataset-qualification/v1",
      classification: body.classification,
      datasetRoot: body.datasetRoot,
      manifestPath: body.manifestPath,
      datasetContentDigest: body.datasetContentDigest,
      manifestSemanticDigest: body.manifestSemanticDigest,
      partitionsDigest: body.partitionsDigest,
      gapPolicyId: body.gapPolicyId,
      ...(receipt
        ? {
            qualificationReceiptPath: join(
              config.receiptDir!,
              "fhv-dataset-qualification-receipt.v1.json",
            ),
          }
        : {}),
    };
  } catch (error) {
    return {
      schemaVersion: "fhv-dataset-qualification/v1",
      classification: "DATASET_QUALIFICATION=FAIL",
      datasetRoot: config.datasetRoot ?? "unknown",
      manifestPath: config.manifestPath ?? "unknown",
      datasetContentDigest: "0".repeat(64),
      manifestSemanticDigest: "0".repeat(64),
      partitionsDigest: "0".repeat(64),
      gapPolicyId: "unknown",
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const config = resolveFhvDatasetQualificationCliConfig();
  const result = runFhvDatasetQualification(config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${result.classification}\n`);
  process.exitCode = result.classification === "DATASET_QUALIFICATION=PASS" ? 0 : 1;
}

const invokedDirectly = process.argv[1]?.includes("fhv-dataset-qualification-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-dataset-qualify] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
