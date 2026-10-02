import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  ClosedTradeOutcomeEvidencePackageV2,
  ClosedTradeOutcomePolarityV2,
  ClosedTradeOutcomeRecordV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import {
  assertClosedTradeOutcomeEvidencePackageV2Integrity,
  assertClosedTradeOutcomeRecordV2Integrity,
  discardLosingOutcomesFromEvidencePackageV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import {
  assertResearchV2ContentDigest,
  requireResearchV2DigestHex,
  requireResearchV2IsoUtc,
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";

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

const RESEARCH_MEMORY_V2_KEYS = [
  "authority",
  "campaignId",
  "capitalAuthority",
  "contentDigestHex",
  "contradictingCount",
  "evidencePackageDigestHex",
  "organizationId",
  "records",
  "schemaVersion",
  "supportingCount",
] as const;

function assertExactMemoryKeys(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_INVALID");
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== "string") ||
    actual.length !== RESEARCH_MEMORY_V2_KEYS.length ||
    !RESEARCH_MEMORY_V2_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_INVALID");
  }
}

function assertPriorMemoryIntegrityV2(prior: ResearchMemoryV2, evidenceCutoffUtc: string): void {
  assertExactMemoryKeys(prior);
  if (
    typeof prior.contentDigestHex !== "string" ||
    typeof prior.evidencePackageDigestHex !== "string" ||
    typeof prior.organizationId !== "string" ||
    typeof prior.campaignId !== "string" ||
    typeof prior.supportingCount !== "number" ||
    !Number.isSafeInteger(prior.supportingCount) ||
    typeof prior.contradictingCount !== "number" ||
    !Number.isSafeInteger(prior.contradictingCount)
  ) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_INVALID");
  }
  assertResearchV2ContentDigest(
    prior as Readonly<{ contentDigestHex: string }>,
    "RESEARCH_MEMORY_INVALID",
  );
  if (
    prior.schemaVersion !== RESEARCH_MEMORY_V2_SCHEMA ||
    prior.capitalAuthority !== "NONE" ||
    prior.authority !== "APPEND_ONLY_RESEARCH_MEMORY" ||
    !Array.isArray(prior.records) ||
    prior.records.length === 0
  ) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_INVALID");
  }
  requireResearchV2NonEmpty(prior.organizationId, "RESEARCH_MEMORY_INVALID");
  requireResearchV2NonEmpty(prior.campaignId, "RESEARCH_MEMORY_INVALID");
  requireResearchV2DigestHex(prior.evidencePackageDigestHex, "RESEARCH_MEMORY_INVALID");
  requireResearchV2IsoUtc(evidenceCutoffUtc, "RESEARCH_EVIDENCE_CUTOFF_INVALID");
  let supportingCount = 0;
  let contradictingCount = 0;
  for (let index = 0; index < prior.records.length; index += 1) {
    const record = prior.records[index];
    try {
      assertClosedTradeOutcomeRecordV2Integrity(record, evidenceCutoffUtc, "RESEARCH_MEMORY_INVALID");
    } catch (error) {
      if (error instanceof StrategyEvolutionResearchError && error.code === "RESEARCH_OUTCOME_AFTER_CUTOFF") {
        throw new StrategyEvolutionResearchError(
          "RESEARCH_MEMORY_OUTCOME_AFTER_CUTOFF",
          "Prior memory contains an outcome later than the incoming evidence cutoff",
        );
      }
      throw error;
    }
    if (index > 0 && prior.records[index - 1]!.outcomeId >= record.outcomeId) {
      throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_INVALID");
    }
    if (record.evaluationRole === "SUPPORTING") supportingCount += 1;
    if (record.evaluationRole === "CONTRADICTING") contradictingCount += 1;
  }
  if (
    prior.supportingCount !== supportingCount ||
    prior.contradictingCount !== contradictingCount
  ) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_INVALID");
  }
}

function snapshotOutcomeRecordV2(record: ClosedTradeOutcomeRecordV2): ClosedTradeOutcomeRecordV2 {
  return Object.freeze({ ...record });
}

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
  assertClosedTradeOutcomeEvidencePackageV2Integrity(evidencePackage);
  if (evidencePackage.records.length === 0) {
    throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_EMPTY");
  }
  if (prior) {
    assertPriorMemoryIntegrityV2(prior, evidencePackage.evidenceCutoffUtc);
    if (
      prior.organizationId !== evidencePackage.organizationId ||
      prior.campaignId !== evidencePackage.campaignId
    ) {
      throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_SCOPE_MISMATCH");
    }
  }

  const merged: ClosedTradeOutcomeRecordV2[] = prior
    ? prior.records.map(snapshotOutcomeRecordV2)
    : [];
  const seen = new Map(merged.map((record) => [record.outcomeId, record] as const));
  for (const record of evidencePackage.records) {
    const existing = seen.get(record.outcomeId);
    if (existing) {
      if (computeSemanticSha256Hex(existing) !== computeSemanticSha256Hex(record)) {
        throw new StrategyEvolutionResearchError("RESEARCH_MEMORY_OUTCOME_CONFLICT");
      }
      continue;
    }
    const snapshot = snapshotOutcomeRecordV2(record);
    merged.push(snapshot);
    seen.set(snapshot.outcomeId, snapshot);
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
