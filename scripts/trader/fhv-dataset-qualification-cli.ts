/**
 * DEE-436 — FHV dataset qualification CLI (bounded fixture).
 *
 * Usage: pnpm trader:fhv:dataset-qualify -- [--fixture-path <path>]
 */

import { runIngressManifestEvidenceHarness } from "@/lib/trader/market-data/dataset/ingress-manifest-evidence-harness";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";

export type FhvDatasetQualificationResult = Readonly<{
  schemaVersion: "fhv-dataset-qualification/v1";
  classification: "DATASET_QUALIFICATION=PASS" | "DATASET_QUALIFICATION=FAIL";
  fixturePath: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  gapPolicyId: string;
  failureReason?: string;
}>;

export function runFhvDatasetQualification(): FhvDatasetQualificationResult {
  try {
    const harness = runIngressManifestEvidenceHarness();
    const partitionsDigest = computeSemanticSha256Hex(FHV_DATASET_PARTITIONS_V1);
    const manifestSemanticDigest = computeSemanticSha256Hex({
      schemaVersion: harness.manifest.schemaVersion,
      barSetDigest: harness.manifest.barSetDigest,
      normalizedContentDigest: harness.manifest.normalizedContentDigest,
      partitions: harness.manifest.partitions,
      holdoutSeal: harness.manifest.holdoutSeal,
    });

    if (harness.manifest.holdoutSeal.contaminationStatus !== "RESERVED_SEALED_NOT_ACCESSED") {
      return {
        schemaVersion: "fhv-dataset-qualification/v1",
        classification: "DATASET_QUALIFICATION=FAIL",
        fixturePath: harness.fixturePath,
        manifestSemanticDigest,
        partitionsDigest,
        gapPolicyId: harness.gapPolicy.policyId,
        failureReason: "HOLDOUT_CONTAMINATION",
      };
    }

    return {
      schemaVersion: "fhv-dataset-qualification/v1",
      classification: "DATASET_QUALIFICATION=PASS",
      fixturePath: harness.fixturePath,
      manifestSemanticDigest,
      partitionsDigest,
      gapPolicyId: harness.gapPolicy.policyId,
    };
  } catch (error) {
    return {
      schemaVersion: "fhv-dataset-qualification/v1",
      classification: "DATASET_QUALIFICATION=FAIL",
      fixturePath: "unknown",
      manifestSemanticDigest: "0".repeat(64),
      partitionsDigest: computeSemanticSha256Hex(FHV_DATASET_PARTITIONS_V1),
      gapPolicyId: "unknown",
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const result = runFhvDatasetQualification();
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
