import {
  canonicalizeSemanticObject,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { TimeframeEvidenceLaneAuthorityMatrix } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix.types";

export function canonicalizeMatrix(
  matrix: TimeframeEvidenceLaneAuthorityMatrix,
): TimeframeEvidenceLaneAuthorityMatrix {
  return canonicalizeSemanticObject(
    matrix as unknown as Record<string, unknown>,
  ) as unknown as TimeframeEvidenceLaneAuthorityMatrix;
}

export function computeMatrixDigest(matrix: TimeframeEvidenceLaneAuthorityMatrix): string {
  return computeSemanticSha256Hex(canonicalizeMatrix(matrix));
}
