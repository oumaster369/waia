import {
  PAPER_EVALUATION_EXPORT_SCHEMA_VERSION,
  type PaperEvaluationExportDocument,
} from "@/lib/trader/paper/paper-evaluation-export.types";

/**
 * S1 — operator evidence surfacing for the Strategy Validation Gate runway.
 *
 * Pure, read-only helpers. They parse a {@link PaperEvaluationExportDocument} and
 * surface *facts* about the evidence window. They never compute an edge/profitability
 * judgment and never block: a mock or thin-evidence window still produces a document.
 * Whether the evidence is sufficient to promote remains an operator decision
 * (ADR-0010: absence of evidence = failure, judged by the operator).
 */

export class OperatorEvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "OperatorEvidenceError";
    this.code = code;
  }
}

export type EvidenceSummary = {
  executionMode: string;
  window: { start: string; end: string };
  reconciliationStatus: string;
  closedTradeCount: number;
  strategiesWithNoFills: string[];
  /** True when the window is structurally weak (mock / no fills / zero closed trades). Advisory only. */
  insufficientEvidence: boolean;
  insufficientReasons: string[];
};

/**
 * Parse a serialized export document. Fail-closed on malformed JSON, non-objects,
 * or schema-version drift. Does NOT verify the content digest — that is the
 * assembler's responsibility at request time ({@link assembleStrategyPromotionRecord}).
 */
export function parsePaperEvaluationExportDocument(raw: string): PaperEvaluationExportDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OperatorEvidenceError(
      "OPERATOR_EVIDENCE_MALFORMED_JSON",
      "Evidence file is not valid JSON",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OperatorEvidenceError(
      "OPERATOR_EVIDENCE_NOT_OBJECT",
      "Evidence document must be a JSON object",
    );
  }

  const doc = parsed as {
    schemaVersion?: unknown;
    envelope?: unknown;
    evidenceBody?: unknown;
  };

  if (doc.schemaVersion !== PAPER_EVALUATION_EXPORT_SCHEMA_VERSION) {
    throw new OperatorEvidenceError(
      "OPERATOR_EVIDENCE_SCHEMA_MISMATCH",
      `Evidence schemaVersion must be ${PAPER_EVALUATION_EXPORT_SCHEMA_VERSION}`,
    );
  }

  if (typeof doc.envelope !== "object" || doc.envelope === null || Array.isArray(doc.envelope)) {
    throw new OperatorEvidenceError(
      "OPERATOR_EVIDENCE_ENVELOPE_INVALID",
      "Evidence envelope is missing or invalid",
    );
  }

  if (
    typeof doc.evidenceBody !== "object" ||
    doc.evidenceBody === null ||
    Array.isArray(doc.evidenceBody)
  ) {
    throw new OperatorEvidenceError(
      "OPERATOR_EVIDENCE_BODY_INVALID",
      "Evidence body is missing or invalid",
    );
  }

  return parsed as PaperEvaluationExportDocument;
}

/**
 * Surface the evidence facts an operator must weigh, and flag structurally weak
 * windows. The flag is advisory; it never prevents export or promotion.
 */
export function summarizePaperEvidence(document: PaperEvaluationExportDocument): EvidenceSummary {
  const { envelope, evidenceBody } = document;
  const strategiesWithNoFills = [...evidenceBody.dataQuality.strategiesWithNoFills];
  const closedTradeCount = evidenceBody.strategyEvaluations.reduce(
    (total, evaluation) => total + evaluation.closedTradeCount,
    0,
  );

  const insufficientReasons: string[] = [];
  if (envelope.executionMode === "mock") {
    insufficientReasons.push(
      "execution mode is mock — plumbing evidence only, not real-market edge (ADR-0010: Accelerated Historical Replay Validation plumbing is necessary but NOT sufficient)",
    );
  }
  if (strategiesWithNoFills.length > 0) {
    insufficientReasons.push(
      `strategies with no fills in window: ${strategiesWithNoFills.join(", ")}`,
    );
  }
  if (closedTradeCount === 0) {
    insufficientReasons.push("no closed trades in window");
  }

  return {
    executionMode: envelope.executionMode,
    window: { start: envelope.window.start, end: envelope.window.end },
    reconciliationStatus: evidenceBody.dataQuality.reconciliationStatus,
    closedTradeCount,
    strategiesWithNoFills,
    insufficientEvidence: insufficientReasons.length > 0,
    insufficientReasons,
  };
}
