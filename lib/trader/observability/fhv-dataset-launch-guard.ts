import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  FhvDatasetQualificationError,
  readFhvDatasetQualificationReceipt,
  recomputeFhvDatasetQualificationDigests,
  type FhvDatasetQualificationReceiptV1,
} from "@/lib/trader/observability/fhv-dataset-qualification";

export class FhvDatasetLaunchGuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvDatasetLaunchGuardError";
  }
}

/** Recompute all qualification digests at launch and fail closed on mutation (R8 TOCTOU). */
export function revalidateFhvDatasetAtLaunch(input: {
  datasetQualificationReceiptPath: string;
  datasetRoot: string;
  manifestPath: string;
}): FhvDatasetQualificationReceiptV1 {
  const receipt = readFhvDatasetQualificationReceipt(input.datasetQualificationReceiptPath);
  if (receipt.classification !== "DATASET_QUALIFICATION=PASS") {
    throw new FhvDatasetLaunchGuardError(
      "DATASET_QUALIFICATION_FAILED",
      "Dataset qualification receipt must classify PASS at launch.",
    );
  }
  if (receipt.datasetRoot.trim() !== input.datasetRoot.trim()) {
    throw new FhvDatasetLaunchGuardError(
      "DATASET_ROOT_MISMATCH",
      "Launch datasetRoot must match qualification receipt.",
    );
  }
  if (receipt.manifestPath.trim() !== input.manifestPath.trim()) {
    throw new FhvDatasetLaunchGuardError(
      "MANIFEST_PATH_MISMATCH",
      "Launch manifestPath must match qualification receipt.",
    );
  }

  if (receipt.qualificationMode === "BOUNDED_INGRESS_FIXTURE") {
    return receipt;
  }

  try {
    const recomputed = recomputeFhvDatasetQualificationDigests({
      datasetRoot: input.datasetRoot,
      manifestPath: input.manifestPath,
      qualificationMode: receipt.qualificationMode,
    });
    if (recomputed.datasetContentDigest !== receipt.datasetContentDigest) {
      throw new FhvDatasetLaunchGuardError(
        "DATASET_CONTENT_DIGEST_MUTATION",
        "Dataset content digest changed since qualification (TOCTOU).",
      );
    }
    if (recomputed.manifestSemanticDigest !== receipt.manifestSemanticDigest) {
      throw new FhvDatasetLaunchGuardError(
        "MANIFEST_SEMANTIC_DIGEST_MUTATION",
        "Manifest semantic digest changed since qualification (TOCTOU).",
      );
    }
    if (recomputed.partitionsDigest !== receipt.partitionsDigest) {
      throw new FhvDatasetLaunchGuardError(
        "PARTITIONS_DIGEST_MUTATION",
        "Partitions digest changed since qualification (TOCTOU).",
      );
    }
    if (receipt.symbolDigests && recomputed.symbolDigests) {
      for (const symbol of ["BTCUSDT", "ETHUSDT"] as const) {
        if (receipt.symbolDigests[symbol] !== recomputed.symbolDigests[symbol]) {
          throw new FhvDatasetLaunchGuardError(
            "SYMBOL_DIGEST_MUTATION",
            `Symbol digest mutation detected for ${symbol} (TOCTOU).`,
          );
        }
      }
    }
    if (receipt.partitionEvidence) {
      for (const evidence of receipt.partitionEvidence) {
        const raw = readFileSync(evidence.filePath, "utf8");
        const digest = createHash("sha256").update(raw, "utf8").digest("hex");
        if (digest !== evidence.fileContentDigest) {
          throw new FhvDatasetLaunchGuardError(
            "PARTITION_FILE_DIGEST_MUTATION",
            `Partition file digest mutation detected for ${evidence.filePath} (TOCTOU).`,
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof FhvDatasetLaunchGuardError) {
      throw error;
    }
    if (error instanceof FhvDatasetQualificationError) {
      throw new FhvDatasetLaunchGuardError(error.code, error.message);
    }
    throw error;
  }

  return receipt;
}
