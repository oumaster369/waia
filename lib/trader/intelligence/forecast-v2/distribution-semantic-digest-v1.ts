import { createHash } from "node:crypto";

import {
  COMPONENT_LAYOUT_VERSION,
  DISTRIBUTION_SEMANTIC_VERSION,
  QUANTIZER_VERSION,
} from "./constants";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";

export { DISTRIBUTION_SEMANTIC_VERSION };

export type DistributionSemanticDigestInput = {
  forecastGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
  k: number;
  m: number;
  normalizationVersionDigestHex: string;
  targetRoleId: string;
  samples: readonly (readonly number[])[];
};

function assertHex64(name: string, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`[forecast-v2/dist-sem] ${name} must be 64-char lowercase hex`);
  }
}

/**
 * Streaming SHA-256 distribution semantic digest (dist-sem-v1, §2.5.2).
 */
export function computeDistributionSemanticDigest(input: DistributionSemanticDigestInput): Buffer {
  assertHex64("forecastGenerationIdentityDigestHex", input.forecastGenerationIdentityDigestHex);
  assertHex64("predictivePackageContentDigestHex", input.predictivePackageContentDigestHex);
  assertHex64("normalizationVersionDigestHex", input.normalizationVersionDigestHex);

  const s = input.k * input.m;
  const header = [
    DISTRIBUTION_SEMANTIC_VERSION,
    input.forecastGenerationIdentityDigestHex,
    input.predictivePackageContentDigestHex,
    String(input.k),
    String(input.m),
    String(s),
    COMPONENT_LAYOUT_VERSION,
    input.normalizationVersionDigestHex,
    QUANTIZER_VERSION,
    input.targetRoleId,
  ]
    .join("\n")
    .concat("\n");

  const hash = createHash("sha256");
  hash.update(header, "utf8");

  for (let k = 0; k < input.k; k += 1) {
    for (let m = 0; m < input.m; m += 1) {
      const sample = input.samples[k]?.[m];
      if (!sample || sample.length !== 13) {
        throw new Error("[forecast-v2/dist-sem] each sample must have 13 components");
      }
      for (let component = 0; component < 13; component += 1) {
        hash.update(quantizeScale8HalfUp(sample[component]!), "utf8");
        hash.update("\n", "utf8");
      }
    }
  }

  return hash.digest();
}

export function distributionSemanticDigestHex(input: DistributionSemanticDigestInput): string {
  return computeDistributionSemanticDigest(input).toString("hex");
}
