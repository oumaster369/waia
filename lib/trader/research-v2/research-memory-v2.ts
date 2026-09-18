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
): ResearchMemoryV2 {
  if (evidencePackage.records.length === 0) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_EMPTY");
  }
  const supportingCount = evidencePackage.records.filter(
    (record) => record.evaluationRole === "SUPPORTING",
  ).length;
  const contradictingCount = evidencePackage.records.filter(
    (record) => record.evaluationRole === "CONTRADICTING",
  ).length;
  const body = {
    schemaVersion: RESEARCH_MEMORY_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    authority: "APPEND_ONLY_RESEARCH_MEMORY" as const,
    organizationId: evidencePackage.organizationId,
    campaignId: evidencePackage.campaignId,
    evidencePackageDigestHex: evidencePackage.contentDigestHex,
    records: evidencePackage.records,
    supportingCount,
    contradictingCount,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
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
