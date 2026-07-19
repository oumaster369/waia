import { describe, expect, it } from "vitest";

import {
  scanLegacyAuthorityNegativeVector,
  WP21_LEGACY_AUTHORITY_NEGATIVE_VECTORS,
} from "@/lib/trader/research/htr-legacy-cost-authority-scanner";

describe("trader g2 wp21 legacy authority scanner", () => {
  it("flags direct createCostModelV1 construction sites", () => {
    for (const vector of WP21_LEGACY_AUTHORITY_NEGATIVE_VECTORS.slice(0, 9)) {
      const result = scanLegacyAuthorityNegativeVector(vector);
      expect(result.verdict).toBe(vector.expectedVerdict);
      expect(result.ruleId).toBe(vector.expectedRuleId);
      expect(result.sinkCategory).toBe(vector.expectedSinkCategory);
      expect(result.detectedValues).toEqual(vector.expectedDetectedValues);
      expect(result.diagnosticCode).toBe(vector.expectedDiagnosticCode);
    }
  });

  it("flags obfuscated legacy authority construction sites", () => {
    for (const vector of WP21_LEGACY_AUTHORITY_NEGATIVE_VECTORS.slice(9)) {
      const result = scanLegacyAuthorityNegativeVector(vector);
      expect(result.verdict).toBe(vector.expectedVerdict);
      expect(result.ruleId).toBe(vector.expectedRuleId);
      expect(result.sinkCategory).toBe(vector.expectedSinkCategory);
      expect(result.detectedValues).toEqual(vector.expectedDetectedValues);
      expect(result.diagnosticCode).toBe(vector.expectedDiagnosticCode);
    }
  });
});
