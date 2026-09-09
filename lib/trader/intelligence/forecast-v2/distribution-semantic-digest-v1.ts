import { createHash } from "node:crypto";

import {
  COMPONENT_LAYOUT_VERSION,
  DISTRIBUTION_SEMANTIC_VERSION,
  QUANTIZER_VERSION,
  TARGET_ROLE_EXECUTION,
  TARGET_ROLE_TERMINAL,
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
  samples: readonly (readonly (readonly number[])[])[];
};

function assertHex64(name: string, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`[forecast-v2/dist-sem] ${name} must be 64-char lowercase hex`);
  }
}

/**
 * Streaming SHA-256 distribution semantic digest (dist-sem-v1, §2.5.2).
 */
function distributionHeader(input: DistributionSemanticDigestInput): string {
  assertHex64("forecastGenerationIdentityDigestHex", input.forecastGenerationIdentityDigestHex);
  assertHex64("predictivePackageContentDigestHex", input.predictivePackageContentDigestHex);
  assertHex64("normalizationVersionDigestHex", input.normalizationVersionDigestHex);

  const s = input.k * input.m;
  return [
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
}

export function computeDistributionSemanticDigest(input: DistributionSemanticDigestInput): Buffer {
  const hash = createHash("sha256");
  hash.update(distributionHeader(input), "utf8");

  for (let kIdx = 0; kIdx < input.k; kIdx += 1) {
    for (let mIdx = 0; mIdx < input.m; mIdx += 1) {
      const sample = input.samples[kIdx]?.[mIdx];
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

/** Same dist-sem-v1 bytes for both roles, with only one quantization pass.
 * The temporary fragment is bounded to one 13-component sample, not K×M samples.
 * Hash states and headers remain separate; no result/input cache crosses issuances.
 */
export function computeExecutionAndTerminalDistributionSemanticDigests(
  input: Omit<DistributionSemanticDigestInput, "targetRoleId">,
): Readonly<{ execution: Buffer; terminal: Buffer }> {
  const execution = createHash("sha256").update(distributionHeader({
    ...input, targetRoleId: TARGET_ROLE_EXECUTION,
  }), "utf8");
  const terminal = createHash("sha256").update(distributionHeader({
    ...input, targetRoleId: TARGET_ROLE_TERMINAL,
  }), "utf8");
  for (let kIdx = 0; kIdx < input.k; kIdx++) {
    for (let mIdx = 0; mIdx < input.m; mIdx++) {
      const sample = input.samples[kIdx]?.[mIdx];
      if (!sample || sample.length !== 13) {
        throw new Error("[forecast-v2/dist-sem] each sample must have 13 components");
      }
      let fragment = "";
      for (let component = 0; component < 13; component++) {
        fragment += `${quantizeScale8HalfUp(sample[component]!)}\n`;
      }
      execution.update(fragment, "utf8");
      terminal.update(fragment, "utf8");
    }
  }
  return { execution: execution.digest(), terminal: terminal.digest() };
}

export function distributionSemanticDigestHex(input: DistributionSemanticDigestInput): string {
  return computeDistributionSemanticDigest(input).toString("hex");
}
