import { APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } from "./computation-manifest";
import { z } from "zod";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { ResearchEvaluation } from "../research-understanding-v1/evaluate";

export const APPLICATION_SPECIFICATION = "categorical-trending-persistence/v1" as const;
export const APPLICATION_BRIDGE = "saved-what-to-regime-hint/v1" as const;
export const APPLICATION_QUESTION_MAP = "local-categorical-antecedent-analogue/v1" as const;
export const APPLICATION_AUTHORITY = "RESEARCH_APPLICATION_ONLY" as const;
export const APPLICATION_PURPOSE = "RESEARCH_NON_CAPITAL" as const;
export const APPLICATION_SERVICE_ACTOR = "service:trader-research-application-v1" as const;
export const APPLICATION_LIMITS = Object.freeze({ packets: 3, selectedHistory: 32, metadataScan: 33,
  registration: 65_536, measurement: 65_536, assignment: 65_536, projection: 4_096,
  featureWitness: 262_144, application: 524_288, consumption: 524_288, additionalAggregate: 4_000_000,
  uniqueInputAggregate: 67_108_864, queries: 512, durationMs: 120_000, lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 });
export class ResearchApplicationRefusal extends Error {
  constructor(readonly code: string) { super(code); this.name = "ResearchApplicationRefusal"; }
}
export function requireApplication(value: unknown, code: string): asserts value {
  if (!value) throw new ResearchApplicationRefusal(code);
}
export function applicationBytes(value: unknown): number { return Buffer.byteLength(canonicalizeSemanticJsonString(value), "utf8"); }
export function applicationDigest(value: unknown): string { return computeSemanticSha256Hex(value); }
export function applicationTime(value: string): number {
  const time = Date.parse(value);
  requireApplication(Number.isFinite(time) && new Date(time).toISOString() === value, "APPLICATION_TIME_INVALID");
  return time;
}
export const applicationDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(1_024).refine(v => v === v.trim() && Buffer.byteLength(v) <= 1_024);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const applicationConfigurationSchema = z.object({
  organizationId: z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/), accountId: text, symbol: text,
  researchAssignmentDigest: applicationDigestSchema, researchSessionId: text, sourceSessionId: text, sourceConfigDigest: applicationDigestSchema,
  profileId: text, profileContentDigest: applicationDigestSchema,
  computation: z.literal("recorded-research-understanding-computation/v1"), computationManifestDigest: applicationDigestSchema,
  applicationComputationManifestDigest: z.literal(APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST),
  hypothesisId: text, hypothesisKey: applicationDigestSchema, hypothesisVersion: version, hypothesisDefinitionDigest: applicationDigestSchema,
  measurementId: text, measurementKey: applicationDigestSchema, measurementVersion: version, measurementDefinitionDigest: applicationDigestSchema,
  specification: z.literal(APPLICATION_SPECIFICATION), bridge: z.literal(APPLICATION_BRIDGE), questionMap: z.literal(APPLICATION_QUESTION_MAP),
  maxAgeMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ResearchApplicationConfigurationV1 = z.infer<typeof applicationConfigurationSchema>;
export function captureApplicationConfigurationV1(value: unknown): ResearchApplicationConfigurationV1 {
  requireApplication(applicationBytes(value) <= APPLICATION_LIMITS.assignment, "APPLICATION_CONFIGURATION_LIMIT");
  const parsed = applicationConfigurationSchema.safeParse(value);
  requireApplication(parsed.success, "APPLICATION_CONFIGURATION_INVALID");
  return structuredClone(parsed.data);
}
export type ResearchApplicationDispositionV1 = "OBSERVED_FOR" | "OBSERVED_AGAINST" | "UNASSESSED_ANTECEDENT" | "UNASSESSED_INPUT" | "UNASSESSED_LINEAGE";
export type ResearchApplicationDirectionV1 = "FOR" | "AGAINST";
export type ResearchApplicationRelationKindV1 = "observed_categorical_persistence_for/v1" | "observed_categorical_persistence_against/v1";
/** A pure policy projection of fixed-owner replay, never proof of persistence or source admission. */
export type ResearchApplicationMeaningV1 = Readonly<{
  schemaVersion: "waia.trader.research_application_meaning.v1";
  authority: typeof APPLICATION_AUTHORITY; purpose: typeof APPLICATION_PURPOSE;
  specification: typeof APPLICATION_SPECIFICATION; bridge: typeof APPLICATION_BRIDGE;
  previousEvaluationDigest: string; currentEvaluationDigest: string;
  disposition: ResearchApplicationDispositionV1; direction: ResearchApplicationDirectionV1 | null;
  relationKind: ResearchApplicationRelationKindV1 | null;
}>;
/** Owner-only data dependency: the later held reader must fully recompute and compare these bodies. */
export type ReplayedApplicationPairV1 = Readonly<{ previous: ResearchEvaluation; current: ResearchEvaluation }>;
export type ResearchApplicationRelationV1 = Readonly<{
  schemaVersion: "waia.trader.research_application_relation.v1";
  authority: typeof APPLICATION_AUTHORITY; purpose: typeof APPLICATION_PURPOSE;
  id: string; organizationId: string; symbol: string; applicationId: string; evidenceId: string;
  hypothesisId: string; hypothesisKey: string; hypothesisDefinitionDigest: string;
  assignmentDigest: string; version: 1; contentDigest: string; eventTime: string; recordedTime: string;
  verified: false; confidenceState: "NOT_ASSESSED"; relationKind: ResearchApplicationRelationKindV1;
}>;
export type ResearchApplicationFoldV1 = Readonly<{
  schemaVersion: "waia.trader.research_application_fold.v1";
  authority: typeof APPLICATION_AUTHORITY; purpose: typeof APPLICATION_PURPOSE;
  researchJudgments: readonly Readonly<{ hypothesisId: string; hypothesisKey: string; definitionDigest: string;
    lifecycleState: "PROPOSED"; rankOrdinal: number; ordinalJudgment: "WEAKENED" | "CONTESTED";
    supportingEvidence: readonly string[]; contradictingEvidence: readonly string[] }>[];
}>;
