import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  ClosedTradeOutcomeEvidencePackageV2,
  ClosedTradeOutcomePolarityV2,
  ClosedTradeOutcomeRecordV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import { discardLosingOutcomesFromEvidencePackageV2 } from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import { StrategyEvolutionResearchError } from "@/lib/trader/research-v2/research-v2-guards";

export const RESEARCH_MEMORY_V2_SCHEMA = "waia.trader.research_memory.v2" as const;

export type ResearchMemoryV2 = Readonly<{
  schemaVersion: typeof RESEARCH_MEMORY_V2_SCHEMA;
  capitalAuthority: "NONE";
  authority: "APPEND_ONLY_RESEARCH_MEMORY";
  organizationId: string;
  campaignId: string;
  evidencePackageDigestHex: string;
  records: readonly ClosedTradeOutcomeRecordV2[];
  supportingCount: number;
  contradictingCount: number;
  contentDigestHex: string;
}>;

export function queryContradictingResearchMemoryV2(
  memory: ResearchMemoryV2,
): readonly ClosedTradeOutcomeRecordV2[] {
  return memory.records.filter((record) => record.evaluationRole === "CONTRADICTING");
}

export function filterResearchMemoryByProfitabilityV2(
  memory: ResearchMemoryV2,
  _keep: Extract<ClosedTradeOutcomePolarityV2, "PROFIT">,
): never {
  void memory;
  void _keep;
  throw new StrategyEvolutionResearchError(
    "SURVIVORSHIP_DISCARD_FORBIDDEN",
    "Research memory cannot drop losing outcomes",
  );
}

export function appendResearchMemoryV2(
  evidencePackage: ClosedTradeOutcomeEvidencePackageV2,
  prior?: ResearchMemoryV2,
): ResearchMemoryV2 {
  if (evidencePackage.records.length === 0) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_EMPTY");
  }
  if (prior) {
    if (
      prior.organizationId !== evidencePackage.organizationId ||
      prior.campaignId !== evidencePackage.campaignId
    ) {
      throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_SCOPE_MISMATCH");
    }
  }

  const merged: ClosedTradeOutcomeRecordV2[] = prior ? [...prior.records] : [];
  const seen = new Map(merged.map((record) => [record.outcomeId, record] as const));
  for (const record of evidencePackage.records) {
    const existing = seen.get(record.outcomeId);
    if (existing) {
      if (computeSemanticSha256Hex(existing) !== computeSemanticSha256Hex(record)) {
        throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_OUTCOME_CONFLICT");
      }
      continue;
    }
    merged.push(record);
    seen.set(record.outcomeId, record);
  }
  merged.sort((left, right) => (left.outcomeId < right.outcomeId ? -1 : 1));

  const supportingCount = merged.filter((record) => record.evaluationRole === "SUPPORTING").length;
  const contradictingCount = merged.filter(
    (record) => record.evaluationRole === "CONTRADICTING",
  ).length;
  const body = {
    schemaVersion: RESEARCH_MEMORY_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    authority: "APPEND_ONLY_RESEARCH_MEMORY" as const,
    organizationId: evidencePackage.organizationId,
    campaignId: evidencePackage.campaignId,
    evidencePackageDigestHex: evidencePackage.contentDigestHex,
    records: Object.freeze(merged),
    supportingCount,
    contradictingCount,
  };
  const memory = Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
  assertResearchMemoryRetainsPackageV2(memory, evidencePackage);
  if (prior) {
    for (const record of prior.records) {
      if (!memory.records.some((row) => row.outcomeId === record.outcomeId)) {
        filterResearchMemoryByProfitabilityV2(memory, "PROFIT");
      }
    }
  }
  return memory;
}

export function resumeResearchMemoryV2(
  prior: ResearchMemoryV2,
  evidencePackage: ClosedTradeOutcomeEvidencePackageV2,
): ResearchMemoryV2 {
  return appendResearchMemoryV2(evidencePackage, prior);
}

export function assertResearchMemoryRetainsPackageV2(
  memory: ResearchMemoryV2,
  evidencePackage: ClosedTradeOutcomeEvidencePackageV2,
): void {
  const memoryIds = new Set(memory.records.map((record) => record.outcomeId));
  for (const record of evidencePackage.records) {
    if (!memoryIds.has(record.outcomeId)) {
      discardLosingOutcomesFromEvidencePackageV2(evidencePackage);
    }
  }
}
