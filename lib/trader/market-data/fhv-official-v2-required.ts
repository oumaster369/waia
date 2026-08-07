import { existsSync } from "node:fs";

import {
  resolveFhvDatasetManifestV2Path,
  resolveFhvDatasetSealReceiptV2Path,
} from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import type { FhvQualificationMode } from "@/lib/trader/observability/fhv-dataset-qualification";

export const FHV_OFFICIAL_V2_REQUIRED_NO_LEGACY_FALLBACK_PASS =
  "FHV_OFFICIAL_V2_REQUIRED_NO_LEGACY_FALLBACK_PASS" as const;

export class FhvOfficialV2RequiredError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvOfficialV2RequiredError";
  }
}

export function assertFhvOfficialV2DatasetArtifactsPresent(input: {
  datasetRoot: string;
  qualificationMode: FhvQualificationMode;
}): typeof FHV_OFFICIAL_V2_REQUIRED_NO_LEGACY_FALLBACK_PASS | undefined {
  if (input.qualificationMode !== "OFFICIAL_MULTI_YEAR") {
    return undefined;
  }
  const manifestPath = resolveFhvDatasetManifestV2Path(input.datasetRoot);
  const sealPath = resolveFhvDatasetSealReceiptV2Path(input.datasetRoot);
  if (!existsSync(manifestPath)) {
    throw new FhvOfficialV2RequiredError(
      "OFFICIAL_MANIFEST_V2_REQUIRED",
      "OFFICIAL_MULTI_YEAR requires fhv-dataset-manifest.v2.json; v1 legacy path rejected.",
    );
  }
  if (!existsSync(sealPath)) {
    throw new FhvOfficialV2RequiredError(
      "OFFICIAL_SEAL_RECEIPT_V2_REQUIRED",
      "OFFICIAL_MULTI_YEAR requires fhv-dataset-seal-receipt.v2.json; incomplete or v1 dataset rejected.",
    );
  }
  return FHV_OFFICIAL_V2_REQUIRED_NO_LEGACY_FALLBACK_PASS;
}
