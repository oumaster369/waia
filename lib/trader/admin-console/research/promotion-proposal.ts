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
  return {
    ...base,
    proposalId: text(record.proposalId),
    symbols,
    approvalAuthority: text(record.approvalAuthority),
    capitalAuthority: text(record.capitalAuthority),
    readable: true,
  };
}
