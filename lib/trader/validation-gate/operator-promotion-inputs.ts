import type { PaperEvaluationExportDocument } from "@/lib/trader/paper/paper-evaluation-export.types";
import type {
  AssembleStrategyPromotionRecordInput,
  PromotionCostModel,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";

/**
 * S2 — fail-closed operator input contract for the Strategy Validation Gate runway.
 *
 * Parses the operator-authored promotion inputs JSON with strict validation: no
 * defaults, malformed JSON rejected, missing/empty fields rejected, wrong types
 * rejected, unknown keys rejected. This is the first line of defense; the assembler
 * ({@link assembleStrategyPromotionRecord}) re-validates and verifies the evidence digest.
 *
 * NOTE: `costModel.feesBps` and `costModel.slippageBps` are required, non-empty
 * *evidence-completeness* fields (no silent zero-cost assumption). They are NOT a
 * profitability, performance, edge, or gate-passing threshold.
 */

export const REQUIRED_EFFECTIVE_ACK =
  "I confirm the paper evidence exceeds the 48h plumbing soak" as const;

export class OperatorRunwayInputError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "OperatorRunwayInputError";
    this.code = code;
  }
}

export type OperatorPromotionInputs = {
  /** Optional; if present must equal the --org-id flag and the evidence org. */
  organizationId?: string;
  strategyId: string;
  strategyVersion: string;
  gitCommitSha: string;
  hypothesis: string;
  intendedRegime: string;
  costModel: { feesBps: string; slippageBps: string; notes?: string };
  failureModes: string[];
  reasonCodeDistribution: Record<string, number>;
  confidenceAttestation: {
    edgeNetOfCosts: string;
    liveTracksPaper: string;
    downsideRiskBounded: string;
  };
};

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "organizationId",
  "strategyId",
  "strategyVersion",
  "gitCommitSha",
  "hypothesis",
  "intendedRegime",
  "costModel",
  "failureModes",
  "reasonCodeDistribution",
  "confidenceAttestation",
]);

const ALLOWED_COST_MODEL_KEYS = new Set(["feesBps", "slippageBps", "notes"]);
const ALLOWED_ATTESTATION_KEYS = new Set([
  "edgeNetOfCosts",
  "liveTracksPaper",
  "downsideRiskBounded",
]);

function assertObject(value: unknown, code: string, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OperatorRunwayInputError(code, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  code: string,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new OperatorRunwayInputError(code, `${label} has unknown key: ${key}`);
    }
  }
}

function requireNonEmptyString(value: unknown, code: string, label: string): string {
  if (typeof value !== "string") {
    throw new OperatorRunwayInputError(code, `${label} must be a string`);
  }
  if (value.trim().length === 0) {
    throw new OperatorRunwayInputError(code, `${label} must not be empty`);
  }
  return value;
}

function parseCostModel(
  value: unknown,
): PromotionCostModel & { feesBps: string; slippageBps: string } {
  const record = assertObject(value, "OPERATOR_INPUTS_COST_MODEL_INVALID", "costModel");
  rejectUnknownKeys(
    record,
    ALLOWED_COST_MODEL_KEYS,
    "OPERATOR_INPUTS_COST_MODEL_UNKNOWN_KEY",
    "costModel",
  );

  const feesBps = requireNonEmptyString(
    record.feesBps,
    "OPERATOR_INPUTS_COST_MODEL_FEES_REQUIRED",
    "costModel.feesBps",
  );
  const slippageBps = requireNonEmptyString(
    record.slippageBps,
    "OPERATOR_INPUTS_COST_MODEL_SLIPPAGE_REQUIRED",
    "costModel.slippageBps",
  );

  const costModel: PromotionCostModel & { feesBps: string; slippageBps: string } = {
    feesBps,
    slippageBps,
  };

  if (record.notes !== undefined) {
    costModel.notes = requireNonEmptyString(
      record.notes,
      "OPERATOR_INPUTS_COST_MODEL_NOTES_INVALID",
      "costModel.notes",
    );
  }

  return costModel;
}

function parseFailureModes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new OperatorRunwayInputError(
      "OPERATOR_INPUTS_FAILURE_MODES_INVALID",
      "failureModes must be an array",
    );
  }
  if (value.length === 0) {
    throw new OperatorRunwayInputError(
      "OPERATOR_INPUTS_FAILURE_MODES_REQUIRED",
      "failureModes must not be empty",
    );
  }
  return value.map((entry, index) =>
    requireNonEmptyString(entry, "OPERATOR_INPUTS_FAILURE_MODE_INVALID", `failureModes[${index}]`),
  );
}

function parseReasonCodeDistribution(value: unknown): Record<string, number> {
  const record = assertObject(
    value,
    "OPERATOR_INPUTS_REASON_CODES_INVALID",
    "reasonCodeDistribution",
  );
  const keys = Object.keys(record);
  if (keys.length === 0) {
    throw new OperatorRunwayInputError(
      "OPERATOR_INPUTS_REASON_CODES_REQUIRED",
      "reasonCodeDistribution must not be empty",
    );
  }
  const result: Record<string, number> = {};
  for (const key of keys) {
    const count = record[key];
    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      throw new OperatorRunwayInputError(
        "OPERATOR_INPUTS_REASON_CODE_COUNT_INVALID",
        `reasonCodeDistribution.${key} must be a non-negative integer`,
      );
    }
    result[key] = count;
  }
  return result;
}

function parseConfidenceAttestation(
  value: unknown,
): OperatorPromotionInputs["confidenceAttestation"] {
  const record = assertObject(
    value,
    "OPERATOR_INPUTS_ATTESTATION_INVALID",
    "confidenceAttestation",
  );
  rejectUnknownKeys(
    record,
    ALLOWED_ATTESTATION_KEYS,
    "OPERATOR_INPUTS_ATTESTATION_UNKNOWN_KEY",
    "confidenceAttestation",
  );
  return {
    edgeNetOfCosts: requireNonEmptyString(
      record.edgeNetOfCosts,
      "OPERATOR_INPUTS_ATTESTATION_EDGE_REQUIRED",
      "confidenceAttestation.edgeNetOfCosts",
    ),
    liveTracksPaper: requireNonEmptyString(
      record.liveTracksPaper,
      "OPERATOR_INPUTS_ATTESTATION_TRACKING_REQUIRED",
      "confidenceAttestation.liveTracksPaper",
    ),
    downsideRiskBounded: requireNonEmptyString(
      record.downsideRiskBounded,
      "OPERATOR_INPUTS_ATTESTATION_DOWNSIDE_REQUIRED",
      "confidenceAttestation.downsideRiskBounded",
    ),
  };
}

/** Parse + strictly validate the operator inputs JSON string. Fail-closed. */
export function parseOperatorPromotionInputs(raw: string): OperatorPromotionInputs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OperatorRunwayInputError(
      "OPERATOR_INPUTS_MALFORMED_JSON",
      "Operator inputs file is not valid JSON",
    );
  }

  const record = assertObject(parsed, "OPERATOR_INPUTS_NOT_OBJECT", "operator inputs");
  rejectUnknownKeys(
    record,
    ALLOWED_TOP_LEVEL_KEYS,
    "OPERATOR_INPUTS_UNKNOWN_KEY",
    "operator inputs",
  );

  const inputs: OperatorPromotionInputs = {
    strategyId: requireNonEmptyString(
      record.strategyId,
      "OPERATOR_INPUTS_STRATEGY_ID_REQUIRED",
      "strategyId",
    ),
    strategyVersion: requireNonEmptyString(
      record.strategyVersion,
      "OPERATOR_INPUTS_STRATEGY_VERSION_REQUIRED",
      "strategyVersion",
    ),
    gitCommitSha: requireNonEmptyString(
      record.gitCommitSha,
      "OPERATOR_INPUTS_GIT_COMMIT_REQUIRED",
      "gitCommitSha",
    ),
    hypothesis: requireNonEmptyString(
      record.hypothesis,
      "OPERATOR_INPUTS_HYPOTHESIS_REQUIRED",
      "hypothesis",
    ),
    intendedRegime: requireNonEmptyString(
      record.intendedRegime,
      "OPERATOR_INPUTS_REGIME_REQUIRED",
      "intendedRegime",
    ),
    costModel: parseCostModel(record.costModel),
    failureModes: parseFailureModes(record.failureModes),
    reasonCodeDistribution: parseReasonCodeDistribution(record.reasonCodeDistribution),
    confidenceAttestation: parseConfidenceAttestation(record.confidenceAttestation),
  };

  if (record.organizationId !== undefined) {
    inputs.organizationId = requireNonEmptyString(
      record.organizationId,
      "OPERATOR_INPUTS_ORG_ID_INVALID",
      "organizationId",
    );
  }

  return inputs;
}

/** Verify the typed cooling-off acknowledgement phrase for `effective`. Fail-closed. */
export function assertEffectiveAck(ack: string | undefined): void {
  if (ack !== REQUIRED_EFFECTIVE_ACK) {
    throw new OperatorRunwayInputError(
      "OPERATOR_RUNWAY_ACK_REQUIRED",
      `--ack must be exactly: "${REQUIRED_EFFECTIVE_ACK}"`,
    );
  }
}

/**
 * Merge operator inputs + the parsed evidence document into the assembler input,
 * enforcing org consistency. Does not mutate either source.
 */
export function buildAssembleInput(params: {
  organizationId: string;
  inputs: OperatorPromotionInputs;
  document: PaperEvaluationExportDocument;
}): AssembleStrategyPromotionRecordInput {
  const { organizationId, inputs, document } = params;

  if (inputs.organizationId !== undefined && inputs.organizationId !== organizationId) {
    throw new OperatorRunwayInputError(
      "OPERATOR_INPUTS_ORG_MISMATCH",
      "operator inputs organizationId does not match --org-id",
    );
  }

  if (document.envelope.organizationId !== organizationId) {
    throw new OperatorRunwayInputError(
      "OPERATOR_EVIDENCE_ORG_MISMATCH",
      "evidence document organizationId does not match --org-id",
    );
  }

  return {
    organizationId,
    strategyId: inputs.strategyId,
    strategyVersion: inputs.strategyVersion,
    gitCommitSha: inputs.gitCommitSha,
    hypothesis: inputs.hypothesis,
    intendedRegime: inputs.intendedRegime,
    costModel: inputs.costModel,
    failureModes: inputs.failureModes,
    reasonCodeDistribution: inputs.reasonCodeDistribution,
    paperTradingEvidenceDocument: document,
    confidenceAttestation: inputs.confidenceAttestation,
  };
}
