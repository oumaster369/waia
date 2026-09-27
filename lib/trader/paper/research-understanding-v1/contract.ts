import { z } from "zod";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { copy, digest, seal, assertSeal } from "../durable-noncapital/recorded-analysis-v1";
import { assertRequiredInformationProfileV2, defineRequiredInformationProfileV2,
  type RequiredInformationProfileV2 } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import { COMPUTATION_SOURCE_MANIFEST_DIGEST } from "./computation-manifest";

export const RESEARCH_CONTRACT = "waia.trader.saved_research_understanding.v1" as const;
export const RESEARCH_SERVICE_ACTOR = "service:trader-research-understanding-v1" as const;
export const RESEARCH_PREDICATE = "RESEARCH_INPUT_ADMITTED_V1" as const;
export const RESEARCH_DEPENDENCY_MAP = "recorded-research-what-dependencies/v1" as const;
export const RESEARCH_COMPUTATION = "recorded-research-understanding-computation/v1" as const;
export const LANES = ["1m", "4h"] as const;
export const LIMITS = Object.freeze({ profile: 65_536, assignment: 131_072, session: 131_072,
  packet: 16_777_216, inputAggregate: 16_777_216, companion: 4_096, source: 4_096,
  externalRow: 1_048_576, sourceCount: 8, completion: 2_097_152, informationReceipt: 2_097_152,
  predecessor: 4_096, replayAggregate: 4_198_400, text: 1_024, barsPerLane: 10_000, barsTotal: 50_000,
  count: 32, revisions: 32, durationMs: 120_000, lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 });
export class ResearchRefusal extends Error {
  constructor(readonly code: string) { super(code); this.name = "ResearchRefusal"; }
}
export function check(value: unknown, code: string): asserts value { if (!value) throw new ResearchRefusal(code); }
export function bytes(value: unknown): number { return Buffer.byteLength(canonicalJsonString(value), "utf8"); }
export function bounded(value: unknown, maximum: number, code: string): void { check(bytes(value) <= maximum, code); }
const text = z.string().min(1).refine(v => v === v.trim() && Buffer.byteLength(v, "utf8") <= LIMITS.text);
export const orgSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const sequence = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const admissionSchema = z.object({ lane: z.enum(LANES), sourceId: text,
  revisionDigests: z.array(digestSchema).min(1).max(LIMITS.revisions).refine(v => new Set(v).size === v.length) }).strict();
export const assignmentConfigSchema = z.object({ organizationId: orgSchema, accountId: text, symbol: text,
  researchSessionId: text, sourceSessionId: text, sourceConfigDigest: digestSchema, firstSourceSequence: sequence,
  releaseSha: z.string().regex(/^[0-9a-f]{40}$/), admissions: z.array(admissionSchema).length(2)
    .refine(v => v[0]?.lane === "1m" && v[1]?.lane === "4h") }).strict();
export type ResearchAssignmentConfig = z.infer<typeof assignmentConfigSchema>;
export const rangeSchema = z.object({ startSequence: sequence, count: z.number().int().min(1).max(LIMITS.count),
  leaseDurationMs: z.number().int().min(1).max(LIMITS.durationMs) }).strict()
  .refine(v => v.startSequence <= Number.MAX_SAFE_INTEGER - (v.count - 1));
export type ResearchRange = z.infer<typeof rangeSchema>;
export function parseStrict<T>(schema: z.ZodType<T>, input: unknown, code: string): T {
  const parsed = schema.safeParse(input); check(parsed.success, code); return copy(parsed.data);
}
export function captureAssignmentConfig(input: unknown): ResearchAssignmentConfig {
  bounded(input, LIMITS.assignment, "ASSIGNMENT_LIMIT_EXCEEDED");
  return parseStrict(assignmentConfigSchema, input, "INVALID_ASSIGNMENT_CONFIG");
}
const requirementSchema = z.object({ id: text, questionId: z.literal("Q_WHAT_HAPPENING"), classification: z.literal("MANDATORY"),
  contextTriggerKey: z.null(), satisfiers: z.array(z.object({ evidenceFamily: text, providerIds: z.tuple([z.literal("htx_spot")]),
    substitutionRuleId: z.null() }).strict()).length(1), allowedObservationKinds: z.tuple([z.literal("ohlcv_bar")]),
  allowedObservationSchemaVersions: z.tuple([z.literal("mi-canonical-pit-observation-v1")]),
  allowedMeasurementDefinitionDigests: z.array(z.never()).length(0), maxStalenessMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  minimumTrustScore: z.number().finite().min(0).max(1).nullable(), minimumIndependentGroups: z.literal(1),
  contradictionPolicy: z.literal("FAIL_UNRESOLVED"), requirePitQualified: z.literal(true), requireReplayEligible: z.literal(true),
  inquiryBounds: z.object({ maxDepth: z.literal(0), maxDurationMs: z.literal(0), maxProviderFanout: z.literal(0) }).strict() }).strict();
const profileDefinitionSchema = z.object({ organizationId: orgSchema, accountId: text,
  profileVersion: z.string().regex(/^research-recorded-what\/v1\/[a-z0-9][a-z0-9._-]{0,63}$/),
  purpose: z.literal("RESEARCH_NON_CAPITAL"), symbol: text, venue: z.literal("htx"), analyticalTimeframe: z.literal("1m"), horizon: text,
  forecastPackageId: z.null(), forecastPackageContentDigest: z.null(), inputContractContentDigest: z.null(),
  aggregateQualityContract: z.null(), requirements: z.array(requirementSchema).length(2) }).strict();
export function captureProfileDefinition(value: unknown): RequiredInformationProfileV2 {
  bounded(value, LIMITS.profile, "PROFILE_LIMIT_EXCEEDED");
  const input = parseStrict(profileDefinitionSchema, value, "UNSUPPORTED_RESEARCH_PROFILE");
  for (const lane of LANES) {
    const requirements = input.requirements.filter(r => r.id === `research_what_price_${lane}_v1`);
    check(requirements.length === 1 && requirements[0]!.satisfiers[0]!.evidenceFamily === `research_recorded_price_${lane}_v1`, "UNSUPPORTED_RESEARCH_PROFILE");
  }
  return defineRequiredInformationProfileV2(input);
}
export function assertResearchProfile(value: RequiredInformationProfileV2): void {
  bounded(value, LIMITS.profile, "PROFILE_LIMIT_EXCEEDED"); assertRequiredInformationProfileV2(value);
  const definition = Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "schemaVersion", "authority", "contentDigest"].includes(key)));
  check(digest(captureProfileDefinition(definition)) === digest(value), "UNSUPPORTED_RESEARCH_PROFILE");
}
// Explicit bounded engineering meanings; these declarations do not attest a running binary.
export const DECLARATIONS = Object.freeze({ predicate: RESEARCH_PREDICATE,
  predicateDigest: digest({ predicate: RESEARCH_PREDICATE, meaning: "EXACT_ASSIGNED_RECORDED_RESEARCH_INPUT_ONLY", lanes: LANES }),
  dependencyMap: RESEARCH_DEPENDENCY_MAP,
  dependencyMapDigest: digest({ version: RESEARCH_DEPENDENCY_MAP, support: { "1m": "FULL_HISTORY_AND_LTF", "4h": "NORMALIZED_MTF_ALIGNMENT" },
    retained: ["15m", "1h", "1d", "quote", "book", "trades"], absentOptional: ["fearGreed", "globalMarket", "crossVenue", "macro", "news", "blockchain", "regulatory", "protocol"] }),
  computation: RESEARCH_COMPUTATION, computationManifestDigest: COMPUTATION_SOURCE_MANIFEST_DIGEST });
export type ResearchActor = { kind: "SERVICE"; id: typeof RESEARCH_SERVICE_ACTOR } | { kind: "USER"; id: string };
export type ResearchAssignment = ResearchAssignmentConfig & { schemaVersion: typeof RESEARCH_CONTRACT;
  profileId: string; profileContentDigest: string; declarations: typeof DECLARATIONS; limits: typeof LIMITS;
  actor: ResearchActor; assignedAt: string; configurationDigest: string; contentDigest: string };
export function assignmentConfigurationDigest(config: ResearchAssignmentConfig, profile: RequiredInformationProfileV2, actor: ResearchActor) {
  return digest({ config, profileId: profile.id, profileContentDigest: profile.contentDigest, actor, declarations: DECLARATIONS, limits: LIMITS });
}
export function buildResearchAssignment(config: ResearchAssignmentConfig, profile: RequiredInformationProfileV2, actor: ResearchActor, assignedAt: string): ResearchAssignment {
  check(digestSchema.safeParse(COMPUTATION_SOURCE_MANIFEST_DIGEST).success, "COMPUTATION_MANIFEST_UNAVAILABLE");
  config = captureAssignmentConfig(config); assertResearchProfile(profile);
  check(profile.organizationId === config.organizationId && profile.accountId === config.accountId && profile.symbol === config.symbol, "PROFILE_SCOPE_CONFLICT");
  check(typeof assignedAt === "string" && Number.isFinite(Date.parse(assignedAt)) && new Date(assignedAt).toISOString() === assignedAt, "INVALID_ASSIGNMENT_TIME");
  check(actor.kind === "SERVICE" ? actor.id === RESEARCH_SERVICE_ACTOR : actor.kind === "USER" && text.safeParse(actor.id).success, "INVALID_ACTOR");
  const result = seal({ ...config, schemaVersion: RESEARCH_CONTRACT, profileId: profile.id, profileContentDigest: profile.contentDigest,
    actor, assignedAt, declarations: DECLARATIONS, limits: LIMITS, configurationDigest: assignmentConfigurationDigest(config, profile, actor) });
  bounded(result, LIMITS.assignment, "ASSIGNMENT_LIMIT_EXCEEDED"); return result;
}
export function assertResearchAssignment(assignment: ResearchAssignment, profile: RequiredInformationProfileV2): void {
  assertSeal(assignment); assertResearchProfile(profile);
  const { actor, assignedAt } = assignment;
  const config = captureAssignmentConfig(Object.fromEntries(Object.entries(assignment).filter(([key]) =>
    !["schemaVersion", "profileId", "profileContentDigest", "declarations", "limits", "actor", "assignedAt", "configurationDigest", "contentDigest"].includes(key))));
  check(digest(buildResearchAssignment(config, profile, actor, assignedAt)) === digest(assignment), "ASSIGNMENT_IDENTITY_CONFLICT");
}
