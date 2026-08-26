import type { HypothesisType } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import {
  buildCanonicalRuntimeIntelligenceStateV1,
  type RuntimeKnowledgeHypothesisV1,
  type RuntimeKnowledgeAuthorityV1,
} from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { classifyKnowledgeEdgeState } from "@/lib/trader/knowledge/mkb-knowledge-state";
import type { MkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import type { HypothesisDefinition, MiHypothesis } from "@/lib/trader/mi/hypothesis.types";
import { MI_HYPOTHESIS_SCHEMA_VERSION } from "@/lib/trader/mi/hypothesis.types";
import type { MiEvidenceRepository, MiHypothesisRepository } from "@/lib/trader/mi/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type CanonicalRuntimeIntelligenceFoldDepsV1 = Readonly<{
  hypotheses: MiHypothesisRepository;
  evidence: MiEvidenceRepository;
  knowledgeSource: MkbReadModelSource;
}>;

export type CanonicalHypothesisRuntimeProjectionV1 = Readonly<{
  hypothesisType: HypothesisType;
  expectedPath: string;
}>;

export type FoldCanonicalRuntimeIntelligenceStateV1Input = Readonly<{
  context: OrgContext;
  symbol: string;
  asOf: Date;
  regimeScope?: string;
  projectHypothesis: (hypothesis: MiHypothesis, definition: HypothesisDefinition) => CanonicalHypothesisRuntimeProjectionV1 | null;
}>;

export type CanonicalRuntimeIntelligenceStateProviderV1 = (
  input: Omit<FoldCanonicalRuntimeIntelligenceStateV1Input, "projectHypothesis">,
) => Promise<RuntimeKnowledgeAuthorityV1>;

/** Bounded production composition point used by paper/live controllers. */
export function createCanonicalRuntimeIntelligenceStateProviderV1(
  deps: CanonicalRuntimeIntelligenceFoldDepsV1,
  projectHypothesis: FoldCanonicalRuntimeIntelligenceStateV1Input["projectHypothesis"],
): CanonicalRuntimeIntelligenceStateProviderV1 {
  return (input) => foldCanonicalRuntimeIntelligenceStateV1({ ...input, projectHypothesis }, deps);
}

const JUDGMENT_ORDER = { SUPPORTED: 0, CONTESTED: 1, WEAKENED: 2 } as const;

export async function foldCanonicalRuntimeIntelligenceStateV1(
  input: FoldCanonicalRuntimeIntelligenceStateV1Input,
  deps: CanonicalRuntimeIntelligenceFoldDepsV1,
): Promise<RuntimeKnowledgeAuthorityV1> {
  const snapshot = await deps.knowledgeSource.loadSnapshot(
    input.context,
    { symbol: input.symbol, regimeScope: input.regimeScope },
    input.asOf,
  );
  const rows = await deps.hypotheses.listHypotheses(input.context, "market_claim");
  if (rows.some((row) => row.organizationId !== input.context.organizationId)) {
    throw new Error("[canonical-runtime-fold] cross-organization hypothesis row");
  }

  const latest = new Map<string, MiHypothesis>();
  for (const row of rows) {
    if (row.schemaVersion !== MI_HYPOTHESIS_SCHEMA_VERSION) {
      throw new Error("[canonical-runtime-fold] unsupported hypothesis schema version");
    }
    if (row.createdAt.getTime() > input.asOf.getTime()) continue;
    const current = latest.get(row.hypothesisKey);
    if (!current || row.versionSeq > current.versionSeq || (row.versionSeq === current.versionSeq && row.id < current.id)) {
      latest.set(row.hypothesisKey, row);
    }
  }

  const candidates: RuntimeKnowledgeHypothesisV1[] = [];
  for (const hypothesis of latest.values()) {
    const definition = parseDefinition(hypothesis);
    const projection = input.projectHypothesis(hypothesis, definition);
    if (!projection) continue;
    const lifecycleEvents = await deps.hypotheses.listLifecycleEvents(input.context, hypothesis.hypothesisKey);
    const lifecycle = lifecycleEvents
      .filter((row) => row.organizationId === input.context.organizationId && row.createdAt.getTime() <= input.asOf.getTime())
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
      .at(-1);
    if (!lifecycle) {
      throw new Error(`[canonical-runtime-fold] missing lifecycle for ${hypothesis.id}`);
    }
    const evidence = (await deps.evidence.listEvidence(input.context, hypothesis.hypothesisKey))
      .filter((row) => row.eventTime.getTime() <= input.asOf.getTime() && row.ingestTime.getTime() <= input.asOf.getTime() && row.createdAt.getTime() <= input.asOf.getTime())
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    for (const row of evidence) {
      if (row.organizationId !== input.context.organizationId || row.hypothesisId !== hypothesis.id || row.hypothesisDefinitionDigest !== hypothesis.definitionDigest) {
        throw new Error(`[canonical-runtime-fold] evidence lineage mismatch for ${row.id}`);
      }
    }
    const supportingEvidence = evidence.filter((row) => row.direction === "FOR").map(toEvidenceRef);
    const contradictingEvidence = evidence.filter((row) => row.direction === "AGAINST").map(toEvidenceRef);
    const knowledgeRefs = snapshot.knowledgeEdges
      .filter((edge) => edge.hypothesisId === hypothesis.id && edge.updatedAt.getTime() <= input.asOf.getTime())
      .map((edge) => ({ knowledgeEdgeId: edge.id, knowledgeState: classifyKnowledgeEdgeState(edge, input.asOf) }))
      .filter((ref) => ref.knowledgeState !== "INELIGIBLE" && ref.knowledgeState !== "OBSERVATION_ONLY")
      .sort((a, b) => a.knowledgeEdgeId.localeCompare(b.knowledgeEdgeId));
    const hasVerified = knowledgeRefs.some((ref) => ref.knowledgeState === "RESOLVED_CORRECT");
    const ordinalJudgment = hasVerified && supportingEvidence.length > contradictingEvidence.length
      ? "SUPPORTED"
      : contradictingEvidence.length > 0
        ? "CONTESTED"
        : "WEAKENED";
    candidates.push({
      hypothesisId: hypothesis.id,
      hypothesisKey: hypothesis.hypothesisKey,
      definitionDigest: hypothesis.definitionDigest,
      createdAt: hypothesis.createdAt.toISOString(),
      hypothesisType: projection.hypothesisType,
      lifecycleState: lifecycle.lifecycleState,
      rankOrdinal: -1,
      ordinalJudgment,
      expectedPath: projection.expectedPath,
      invalidationConditions: definition.falsificationConditions,
      supportingEvidence,
      contradictingEvidence,
      knowledgeRefs,
      supersedesHypothesisIds: parseSupersedes(hypothesis.supersedesJson),
    });
  }

  const hypotheses = candidates
    .sort((a, b) =>
      JUDGMENT_ORDER[a.ordinalJudgment] - JUDGMENT_ORDER[b.ordinalJudgment] ||
      b.supportingEvidence.length - a.supportingEvidence.length ||
      a.contradictingEvidence.length - b.contradictingEvidence.length ||
      a.hypothesisKey.localeCompare(b.hypothesisKey) ||
      a.hypothesisId.localeCompare(b.hypothesisId),
    )
    .map((row, rankOrdinal) => ({ ...row, rankOrdinal }));

  return buildCanonicalRuntimeIntelligenceStateV1({
    organizationId: input.context.organizationId,
    symbol: input.symbol,
    pitAnchor: input.asOf.toISOString(),
    knowledgeSemanticDigest: snapshotDigest(
      snapshot,
      input.asOf,
      new Set(hypotheses.map((item) => item.hypothesisId)),
    ),
    hypotheses,
  });
}

function toEvidenceRef(row: Awaited<ReturnType<MiEvidenceRepository["listEvidence"]>>[number]) {
  return { evidenceId: row.id, contentDigest: row.contentDigest, direction: row.direction, eventTime: row.eventTime.toISOString(), ingestTime: row.ingestTime.toISOString() } as const;
}

function parseDefinition(hypothesis: MiHypothesis): HypothesisDefinition {
  try {
    return JSON.parse(hypothesis.definitionJson) as HypothesisDefinition;
  } catch {
    throw new Error(`[canonical-runtime-fold] invalid definition JSON for ${hypothesis.id}`);
  }
}

function parseSupersedes(value: string | null): readonly string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error();
    return [...parsed].sort();
  } catch {
    throw new Error("[canonical-runtime-fold] invalid supersession JSON");
  }
}

function snapshotDigest(
  snapshot: Awaited<ReturnType<MkbReadModelSource["loadSnapshot"]>>,
  asOf: Date,
  hypothesisIds: ReadonlySet<string>,
): string {
  const payload = JSON.stringify({
    asOf: asOf.toISOString(),
    knowledgeEdges: snapshot.knowledgeEdges
      .filter((edge) => edge.hypothesisId !== null && hypothesisIds.has(edge.hypothesisId) && edge.updatedAt.getTime() <= asOf.getTime())
      .map((edge) => ({ id: edge.id, hypothesisId: edge.hypothesisId, verified: edge.verified, createdAt: edge.createdAt.toISOString(), updatedAt: edge.updatedAt.toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
import { createHash } from "node:crypto";
