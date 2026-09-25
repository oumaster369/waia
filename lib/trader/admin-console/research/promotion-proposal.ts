export type PromotionProposalSummary = {
  id: string;
  organizationId: string;
  disposition: string;
  createdAt: string | null;
  proposalId: string | null;
  symbols: string[];
  approvalAuthority: string | null;
  capitalAuthority: string | null;
  readable: boolean;
  evidence: {
    positive: { id: string; tradeRef: string; polarity: string }[];
    negative: { id: string; tradeRef: string; polarity: string }[];
  };
  digests: {
    candidate: string | null;
    hypothesis: string | null;
    development: string | null;
    walkForward: string | null;
  };
  assignmentReason: string;
  humanApprovalRequired: boolean;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function presentPromotionProposal(row: {
  id: string;
  organizationId: string;
  disposition: string;
  createdAt: string | null;
  payloadJson: string;
}): PromotionProposalSummary {
  const base = {
    id: row.id,
    organizationId: row.organizationId,
    disposition: row.disposition,
    createdAt: row.createdAt,
    proposalId: null,
    symbols: [] as string[],
    approvalAuthority: null,
    capitalAuthority: null,
    readable: false,
    evidence: { positive: [], negative: [] },
    digests: { candidate: null, hypothesis: null, development: null, walkForward: null },
    assignmentReason: "PROPOSED_ACCOUNT_ASSIGNMENTS_NOT_PERSISTED",
    humanApprovalRequired: true,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  const record = parsed as Record<string, unknown>;
  const symbols = Array.isArray(record.proposedEligibleSymbols)
    ? record.proposedEligibleSymbols.filter((item): item is string => typeof item === "string")
    : [];
  const outcomes = (value: unknown) =>
    Array.isArray(value)
      ? value
          .slice(0, 100)
          .flatMap((v) =>
            v && typeof v === "object" && !Array.isArray(v) && typeof v.outcomeId === "string"
              ? [
                  {
                    id: v.outcomeId,
                    tradeRef: text(v.closedTradeRef) ?? "",
                    polarity: text(v.polarity) ?? "UNKNOWN",
                  },
                ]
              : [],
          )
      : [];
  return {
    ...base,
    evidence: {
      positive: outcomes(record.positiveEvidence),
      negative: outcomes(record.negativeEvidence),
    },
    digests: {
      candidate: text(record.candidateDigestHex),
      hypothesis: text(record.hypothesisDigestHex),
      development: text(record.developmentDigestHex),
      walkForward: text(record.walkForwardDigestHex),
    },
    assignmentReason:
      Array.isArray(record.proposedAccountAssignments) &&
      record.proposedAccountAssignments.length === 0
        ? "PROPOSAL_HAS_NO_ACCOUNT_ASSIGNMENTS"
        : "PROPOSED_ACCOUNT_ASSIGNMENTS_NOT_PERSISTED",
    humanApprovalRequired: record.humanApprovalRequired === true,
    proposalId: text(record.proposalId),
    symbols,
    approvalAuthority: text(record.approvalAuthority),
    capitalAuthority: text(record.capitalAuthority),
    readable: true,
  };
}
