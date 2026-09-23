export type StrategyPromotionRequestBody = {
  command: "request";
  organization_id: string;
  strategy_id: string;
  evidence: unknown;
  research_evidence: unknown;
  inputs: unknown;
  idempotency_key?: string;
};

export type StrategyPromotionRequestResult =
  | { ok: true; body: StrategyPromotionRequestBody }
  | { ok: false; message: string };

function parseJsonField(
  raw: string,
  emptyMessage: string,
  invalidMessage: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, message: emptyMessage };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, message: invalidMessage };
  }
}

/**
 * Builds the promotion request before POST. State version and digests stay on the server.
 * The operator supplies the evidence documents they are confirming.
 */
export function buildStrategyPromotionRequestBody(input: {
  organizationId: string;
  strategyId: string;
  evidenceJson: string;
  researchEvidenceJson: string;
  inputsJson: string;
  idempotencyKey?: string;
}): StrategyPromotionRequestResult {
  const evidence = parseJsonField(
    input.evidenceJson,
    "Evidence JSON must not be empty.",
    "Evidence JSON is invalid.",
  );
  if (!evidence.ok) return evidence;
  const research = parseJsonField(
    input.researchEvidenceJson,
    "Research evidence JSON must not be empty.",
    "Research evidence JSON is invalid.",
  );
  if (!research.ok) return research;
  const inputs = parseJsonField(
    input.inputsJson,
    "Operator inputs JSON must not be empty.",
    "Operator inputs JSON is invalid.",
  );
  if (!inputs.ok) return inputs;
  const idempotency = input.idempotencyKey?.trim();
  return {
    ok: true,
    body: {
      command: "request",
      organization_id: input.organizationId,
      strategy_id: input.strategyId,
      evidence: evidence.value,
      research_evidence: research.value,
      inputs: inputs.value,
      ...(idempotency ? { idempotency_key: idempotency } : {}),
    },
  };
}
