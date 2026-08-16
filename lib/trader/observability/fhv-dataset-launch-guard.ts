import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  readFhvDatasetQualificationReceipt,
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

function resolvePartitionPath(datasetRoot: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(datasetRoot, filePath);
}

function computeRawFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(65536);
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Revalidate dataset at launch (R8 TOCTOU) without re-parsing every bar.
 * Verifies seal/manifest digests against the qualification receipt, then
 * streaming-hashes each partition file against manifest.rawSha256.
 */
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

  // Fixture modes are not sealed OFFICIAL_MULTI_YEAR datasets; digests are bound via receipt.
  if (
    receipt.qualificationMode === "BOUNDED_INGRESS_FIXTURE" ||
    receipt.qualificationMode === "SCHEMA_INTEGRATION_FIXTURE"
  ) {
    return receipt;
  }

  if (receipt.qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA") {
    const preHoldout = readFhvPreHoldoutQualificationReceipt(input.manifestPath);
    assertFhvPreHoldoutFilesMatchReceipt({
      datasetRoot: input.datasetRoot,
      receipt: preHoldout,
    });
    if (preHoldout.developmentWalkForwardContentDigest !== receipt.datasetContentDigest) {
      throw new FhvDatasetLaunchGuardError(
        "DATASET_CONTENT_DIGEST_MUTATION",
        "Pre-holdout DEVELOPMENT+WALK_FORWARD digest changed since qualification (TOCTOU).",
      );
    }
    if (preHoldout.qualificationReceiptDigest !== receipt.manifestSemanticDigest) {
      throw new FhvDatasetLaunchGuardError(
        "MANIFEST_SEMANTIC_DIGEST_MUTATION",
        "Pre-holdout qualification digest changed since qualification (TOCTOU).",
      );
    }
    return receipt;
  }

  const sealed = assertFhvDatasetSealed(input.datasetRoot);
  if (sealed.manifest.datasetContentDigest !== receipt.datasetContentDigest) {
    throw new FhvDatasetLaunchGuardError(
      "DATASET_CONTENT_DIGEST_MUTATION",
      "Dataset content digest changed since qualification (TOCTOU).",
    );
  }
  if (sealed.manifest.manifestSemanticDigest !== receipt.manifestSemanticDigest) {
    throw new FhvDatasetLaunchGuardError(
      "MANIFEST_SEMANTIC_DIGEST_MUTATION",
      "Manifest semantic digest changed since qualification (TOCTOU).",
    );
  }
  if (sealed.sealReceipt.datasetContentDigest !== receipt.datasetContentDigest) {
    throw new FhvDatasetLaunchGuardError(
      "DATASET_CONTENT_DIGEST_MUTATION",
      "Seal receipt dataset content digest mismatch (TOCTOU).",
    );
  }

  const fullContentRevalidate = process.env.FHV_DATASET_FULL_CONTENT_REVALIDATE === "1";
  for (const partition of sealed.manifest.partitions) {
    const absolutePath = resolvePartitionPath(input.datasetRoot, partition.filePath);
    let size: number;
    try {
      size = statSync(absolutePath).size;
    } catch {
      throw new FhvDatasetLaunchGuardError(
        "PARTITION_FILE_DIGEST_MUTATION",
        `Partition file missing for ${partition.filePath}`,
      );
    }
    if (size !== partition.byteSize) {
      throw new FhvDatasetLaunchGuardError(
        "PARTITION_FILE_DIGEST_MUTATION",
        `Partition file size mutation detected for ${partition.filePath}`,
      );
    }
    // Seal + byteSize TOCTOU is the default hot path. Opt into full streaming rehash
    // with FHV_DATASET_FULL_CONTENT_REVALIDATE=1 for ceremony/release hosts.
    if (fullContentRevalidate) {
      const digest = computeRawFileSha256(absolutePath);
      if (digest !== partition.rawSha256) {
        throw new FhvDatasetLaunchGuardError(
          "PARTITION_FILE_DIGEST_MUTATION",
          `Partition file digest mutation detected for ${partition.filePath}`,
        );
      }
    }
  }

  if (receipt.symbolDigests) {
    for (const symbol of ["BTCUSDT", "ETHUSDT"] as const) {
      if (receipt.symbolDigests[symbol] !== sealed.manifest.symbolDigests[symbol]) {
        throw new FhvDatasetLaunchGuardError(
          "SYMBOL_DIGEST_MUTATION",
          `Symbol digest mutation detected for ${symbol} (TOCTOU).`,
        );
      }
    }
  }

  return receipt;
}
