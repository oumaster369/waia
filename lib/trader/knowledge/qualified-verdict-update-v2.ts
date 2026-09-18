import { EPISTEMIC_CONFIDENCE_UPDATE_CAP } from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import { absDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

import type { KnowledgeEdgeEpistemicContent } from "@/lib/trader/knowledge/knowledge-edge-version-v2";

export const QUALIFIED_VERDICT_UPDATE_POLICY_V2 =
  "waia.trader.qualified-verdict-update-policy.v2" as const;

export function assessQualifiedVerdictUpdateV2(
  current: KnowledgeEdgeEpistemicContent,
  next: KnowledgeEdgeEpistemicContent,
):
  | { ok: true }
  | {
      ok: false;
      code: "QUALIFIED_VERDICT_IDENTITY_MUTATION" | "QUALIFIED_VERDICT_UNBOUNDED_DELTA";
    } {
  if (
    current.fromRef !== next.fromRef ||
    current.toRef !== next.toRef ||
    current.hypothesisId !== next.hypothesisId ||
    current.regimeScope !== next.regimeScope ||
    current.failureCasesJson !== next.failureCasesJson ||
    current.strength !== next.strength
  ) {
    return { ok: false, code: "QUALIFIED_VERDICT_IDENTITY_MUTATION" };
  }

  let confidenceDelta: string;
  try {
    confidenceDelta = absDecimal(subtractDecimal(next.confidence, current.confidence));
  } catch {
    return { ok: false, code: "QUALIFIED_VERDICT_UNBOUNDED_DELTA" };
  }
  if (compareDecimal(confidenceDelta, EPISTEMIC_CONFIDENCE_UPDATE_CAP) > 0) {
    return { ok: false, code: "QUALIFIED_VERDICT_UNBOUNDED_DELTA" };
  }
  return { ok: true };
}
