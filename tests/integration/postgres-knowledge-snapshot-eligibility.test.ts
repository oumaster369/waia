import { randomUUID } from "node:crypto";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import { foldCanonicalRuntimeIntelligenceStateV1, type FoldCanonicalRuntimeIntelligenceStateV1Input } from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { insertKnowledgeEdgePostgres } from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { appendKnowledgeEdgeVersionPostgres, getLatestKnowledgeEdgeVersionPostgres } from "@/lib/trader/knowledge/knowledge-edge-version-repository-postgres";
import { computeKnowledgeEdgeVersionContentDigestHex } from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import type { KnowledgeEdge } from "@/lib/trader/knowledge/knowledge.types";
import { createMkbReadModelSourcePostgres } from "@/lib/trader/knowledge/mkb-read-model-postgres";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import { createPostgresMiHypothesisRepository } from "@/lib/trader/mi/hypothesis-repository-adapters";
import { createPostgresMiEvidenceRepository } from "@/lib/trader/mi/evidence-repository-adapters";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const at = (time: string) => new Date(`2026-01-01T${time}.000Z`);
const PRIOR = at("12:00:00"), KNOWN = at("13:00:00"), LATER = at("14:00:00");
const organizationId = randomUUID(), foreignOrg = randomUUID(), userId = randomUUID();
const edgeId = randomUUID(), futureId = randomUUID(), lateRetirementId = randomUUID();
const foreignEdgeId = randomUUID(), legacyId = randomUUID(), hypothesisId = randomUUID(), lateHypothesisId = randomUUID();
const context = { organizationId };

function assertFixtureDatabase(connection: string): void {
  const parsed = new URL(connection);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  const local = parsed.port === "54329" && parsed.username === "waia_validate" &&
    /^\/waia_dee1121(?:_[a-z0-9]+)*$/.test(parsed.pathname);
  const ci = process.env.CI === "true" && process.env.WAIA_POSTGRES_CLI === "1" &&
    parsed.port === "5432" && parsed.username === "waia_it" && parsed.pathname === "/waia_it";
  if (!loopback || (!local && !ci)) throw new Error("ISOLATED_LOOPBACK_REQUIRED");
}

// Synthetic research fixtures only. VALIDATED/FOR is input to a fold test, not scientific authority.
const definition = {
  claimShape: { relationshipType: "predictive", isDirectional: true, isTrendEdge: true, isTimingEdge: false },
  prior: { ordinal: "low", band: "wide" }, falsificationConditions: ["break"],
  requiredNulls: ["always-flat-cash"], patternRefs: [], measurementRefs: [],
  regimeScope: { description: "synthetic DEE-1131 native fixture" },
};
const definitionDigest = computeSemanticSha256Hex(definition);

function edgeRow(id: string, regimeScope = "probe", verified = false) {
  return { id, fromRef: "pattern:synthetic", toRef: `hypothesis:${hypothesisId}`,
    relationKind: "pattern_associated_with_close", confidence: "0.2000", strength: "1.0000",
    regimeScope, failureCasesJson: "[]", hypothesisId, verified,
    createdAt: at("10:00:00"), updatedAt: at("10:00:00") };
}

describe.skipIf(!enabled)("DEE-1131 PostgreSQL Knowledge snapshot eligibility", () => {
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let source: ReturnType<typeof createMkbReadModelSourcePostgres>;
  let hypotheses: ReturnType<typeof createPostgresMiHypothesisRepository>;
  let evidence: ReturnType<typeof createPostgresMiEvidenceRepository>;
  let posture: unknown;
  let mainEdge: KnowledgeEdge;

  async function readPosture() {
    return {
      roles: await sql`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles ORDER BY rolname`,
      triggers: await sql`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY 1,2`,
      rls: await sql`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
        WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') ORDER BY relname`,
    };
  }

  async function seedHypothesis(id: string, ingest: Date) {
    const hypothesisKey = `synthetic:${id}`;
    await hypotheses.insertHypothesisVersion(context, { id, hypothesisKind: "market_claim", hypothesisKey,
      name: hypothesisKey, schemaVersion: "mi-hypothesis-v1", definitionJson: JSON.stringify(definition),
      definitionDigest, supersedesJson: null, versionSeq: 1, revisionOf: null,
      authoredBy: "synthetic-test", createdAt: at("10:00:00") });
    await hypotheses.insertLifecycleEvent(context, { id: randomUUID(), hypothesisId: id, hypothesisKey,
      lifecycleState: "VALIDATED", rationale: "Synthetic fold input, not qualification", recordedBy: "test",
      seq: 1, contentDigest: computeSemanticSha256Hex({ synthetic: "lifecycle", id }), createdAt: at("10:01:00") });
    await evidence.insertEvidence(context, { id: randomUUID(), evidenceKind: "observed", direction: "FOR",
      hypothesisId: id, hypothesisKey, hypothesisDefinitionDigest: definitionDigest,
      measurementRefsJson: "[]", observationRefsJson: "[]", eventTime: at("11:00:00"), ingestTime: ingest,
      recordedBy: "synthetic-test", seq: 1, contentDigest: computeSemanticSha256Hex({ synthetic: "evidence", id }),
      nullComparatorRef: null, regimeContextRef: null, trialRegistrationRef: null, createdAt: ingest });
  }

  async function append(edge: KnowledgeEdge, scope: { organizationId: string },
    lifecycleState: "ACTIVE" | "RETIRED", pitEventAt: Date, recordedAt: Date, confidence = "0.8000") {
    const current = (await getLatestKnowledgeEdgeVersionPostgres(db, scope, edge.id))!;
    return appendKnowledgeEdgeVersionPostgres(db, scope, { edge,
      reasonClass: lifecycleState === "RETIRED" ? "RETIRED" : "OPERATOR_GOVERNED_CORRECTION",
      producedByReceiptDigestHex: computeSemanticSha256Hex({ synthetic: "writer-input", id: edge.id, lifecycleState }),
      expectedVersion: current.version,
      nextContent: { ...current.content, confidence, verified: true, lifecycleState }, pitEventAt, recordedAt });
  }

  const foldAt = (asOf: Date, extra: Partial<FoldCanonicalRuntimeIntelligenceStateV1Input> = {}) =>
    foldCanonicalRuntimeIntelligenceStateV1({ context, symbol: "BTC/USDT", asOf,
      projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "synthetic-only" }),
      ...extra }, { knowledgeSource: source, hypotheses, evidence });

  beforeAll(async () => {
    assertFixtureDatabase(url!);
    sql = postgres(url!, { max: 1 });
    db = drizzle(sql, { schema });
    source = createMkbReadModelSourcePostgres(db);
    hypotheses = createPostgresMiHypothesisRepository(db);
    evidence = createPostgresMiEvidenceRepository(db);
    posture = await readPosture();
    await sql`INSERT INTO auth.users(id) VALUES (${userId}::uuid)`;
    await db.insert(schema.users).values({ id: userId, identityLabel: "DEE-1131 synthetic", email: `${userId}@invalid.local` });
    await db.insert(schema.organizations).values([
      { id: organizationId, ownerUserId: userId, kind: "personal", name: "DEE-1131 A" },
      { id: foreignOrg, ownerUserId: userId, kind: "personal", name: "DEE-1131 B" },
    ]);
    await seedHypothesis(hypothesisId, at("11:00:00"));
    await seedHypothesis(lateHypothesisId, at("13:00:00"));
    mainEdge = await insertKnowledgeEdgePostgres(db, context, edgeRow(edgeId));
    await append(mainEdge, context, "ACTIVE", at("11:00:00"), KNOWN);
    await append(mainEdge, context, "RETIRED", at("13:05:00"), at("13:05:00"));
    const future = await insertKnowledgeEdgePostgres(db, context, { ...edgeRow(futureId, "future"), hypothesisId: null });
    await append(future, context, "ACTIVE", at("12:01:00"), at("12:01:00"), "0.9000");
    const late = await insertKnowledgeEdgePostgres(db, context, { ...edgeRow(lateRetirementId, "late-retirement", true), hypothesisId: null });
    await append(late, context, "RETIRED", at("11:45:00"), at("13:05:00"), "0.2000");
    const foreign = await insertKnowledgeEdgePostgres(db, { organizationId: foreignOrg }, { ...edgeRow(foreignEdgeId), hypothesisId: null });
    await append(foreign, { organizationId: foreignOrg }, "ACTIVE", at("11:00:00"), at("11:00:00"), "0.9900");
    // Legitimate unversioned compatibility row; no UPDATE/DELETE or fabricated version digest.
    await db.insert(schema.traderKnowledgeEdges).values({ ...edgeRow(legacyId, "legacy", true), organizationId, hypothesisId: null });
  }, 30_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      if (posture) expect(await readPosture()).toEqual(posture);
    } finally {
      // Preserve all append-only fixtures. Do not use broad cleanup/trigger-disabling helpers.
      await sql.end({ timeout: 5 });
    }
  });

  it("excludes a later-recorded old-event correction at the ordinary earlier cutoff", async () => {
    const snapshot = await source.loadSnapshot(context, { regimeScope: "probe" }, PRIOR);
    expect(snapshot.knowledgeEdges.find((edge) => edge.id === edgeId)).toMatchObject({ confidence: "0.2000", verified: false, lifecycleState: "ACTIVE" });
  });

  it("does not promote the inadmissible correction into public verified Knowledge", async () => {
    const result = await queryMkbReadModel(context, { regimeScope: "probe" }, PRIOR, { source });
    expect(result.verifiedKnowledge.some((entry) => entry.subjectId === edgeId)).toBe(false);
  });

  it("does not create ordinary SUPPORTED fold state from that correction", async () => {
    const state = await foldAt(PRIOR);
    expect(state.hypotheses.find((row) => row.hypothesisId === hypothesisId)?.ordinalJudgment).toBe("WEAKENED");
  });

  it("includes the correction at exact known-at, but not one millisecond before", async () => {
    const prior = await source.loadSnapshot(context, {}, new Date(KNOWN.getTime() - 1));
    const known = await source.loadSnapshot(context, {}, KNOWN);
    expect(prior.knowledgeEdges.find((edge) => edge.id === edgeId)?.confidence).toBe("0.2000");
    expect(known.knowledgeEdges.find((edge) => edge.id === edgeId)).toMatchObject({ confidence: "0.8000", verified: true, lifecycleState: "ACTIVE" });
    expect((await foldAt(KNOWN)).hypotheses.find((row) => row.hypothesisId === hypothesisId)?.ordinalJudgment).toBe("SUPPORTED");
  });

  it("excludes future-event versions and admits equality independently of known-at", async () => {
    const early = await source.loadSnapshot(context, { regimeScope: "future" }, PRIOR);
    const exact = await source.loadSnapshot(context, { regimeScope: "future" }, at("12:01:00"));
    expect(early.knowledgeEdges[0]?.confidence).toBe("0.2000");
    expect(exact.knowledgeEdges[0]?.confidence).toBe("0.9000");
  });

  it("does not apply late-recorded retirement retroactively", async () => {
    const prior = await queryMkbReadModel(context, { regimeScope: "late-retirement" }, PRIOR, { source });
    const known = await queryMkbReadModel(context, { regimeScope: "late-retirement" }, at("13:05:00"), { source });
    expect(prior.verifiedKnowledge.map((entry) => entry.subjectId)).toContain(lateRetirementId);
    expect(known.entries.find((entry) => entry.subjectId === lateRetirementId)?.knowledgeState).toBe("INELIGIBLE");
  });

  it("retains RETIRED history but excludes it from verified Knowledge", async () => {
    const result = await queryMkbReadModel(context, { regimeScope: "probe" }, LATER, { source });
    expect(result.entries.find((entry) => entry.subjectId === edgeId)?.knowledgeState).toBe("INELIGIBLE");
    expect(result.verifiedKnowledge.some((entry) => entry.subjectId === edgeId)).toBe(false);
  });

  it("removes RETIRED resolved-correct support from the real canonical fold", async () => {
    const state = await foldAt(LATER);
    const hypothesis = state.hypotheses.find((row) => row.hypothesisId === hypothesisId)!;
    expect(hypothesis.knowledgeRefs.some((edge) => edge.knowledgeEdgeId === edgeId)).toBe(false);
    expect(hypothesis.ordinalJudgment).toBe("WEAKENED");
    expect(await foldAt(LATER)).toEqual(state);
  });

  it("keeps actual tenant predicates and version ordering", async () => {
    const own = await source.loadSnapshot(context, {}, LATER);
    const foreign = await source.loadSnapshot({ organizationId: foreignOrg }, {}, LATER);
    expect(own.knowledgeEdges.every((edge) => edge.organizationId === organizationId)).toBe(true);
    expect(own.knowledgeEdges.some((edge) => edge.id === foreignEdgeId)).toBe(false);
    expect(foreign.knowledgeEdges.map((edge) => edge.id)).toEqual([foreignEdgeId]);
    const latest = await getLatestKnowledgeEdgeVersionPostgres(db, context, edgeId);
    expect(latest).toMatchObject({ version: 3, content: { lifecycleState: "RETIRED" } });
  });

  it("retains current-version idempotency and stale-version refusal without extra rows", async () => {
    const current = (await getLatestKnowledgeEdgeVersionPostgres(db, context, edgeId))!;
    const request = { edge: mainEdge, reasonClass: "RETIRED", producedByReceiptDigestHex: "c".repeat(64),
      expectedVersion: current.version, nextContent: current.content, pitEventAt: at("13:05:00"), recordedAt: at("13:05:00") };
    expect((await appendKnowledgeEdgeVersionPostgres(db, context, request)).idempotent).toBe(true);
    await expect(appendKnowledgeEdgeVersionPostgres(db, context, { ...request, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "STALE_VERSION" });
    const rows = await sql`SELECT version FROM trader_knowledge_edge_version_v2 WHERE knowledge_edge_id=${edgeId}::uuid ORDER BY version`;
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3]);
  });

  it("preserves actual-writer full body seals without imposing that convention on legacy rows", async () => {
    const rows = await sql`SELECT * FROM trader_knowledge_edge_version_v2 WHERE organization_id=${organizationId}::uuid`;
    expect(rows.length).toBe(7);
    for (const row of rows) {
      expect(computeKnowledgeEdgeVersionContentDigestHex({ fromRef: row.from_ref, toRef: row.to_ref,
        relationKind: row.relation_kind, confidence: row.confidence, strength: row.strength,
        regimeScope: row.regime_scope, failureCasesJson: row.failure_cases_json,
        hypothesisId: row.hypothesis_id, verified: row.verified, lifecycleState: row.lifecycle_state }))
        .toBe(row.content_digest_hex);
    }
    const legacy = await queryMkbReadModel(context, { regimeScope: "legacy" }, PRIOR, { source });
    expect(legacy.verifiedKnowledge.map((entry) => entry.subjectId)).toEqual([legacyId]);
  });

  it("preserves separate ordinary and explicitly bound historical MI record cutoffs", async () => {
    const ordinary = await foldAt(PRIOR);
    expect(ordinary.hypotheses.find((row) => row.hypothesisId === lateHypothesisId)?.supportingEvidence).toEqual([]);
    const historical = await foldAt(PRIOR, { epistemicRecordCutoff: KNOWN, epistemicAuthority: {
      schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2",
      ratifiedAdmissionId: randomUUID(), authorityContentDigestHex: "d".repeat(64), createdAt: KNOWN,
    } });
    expect(historical.hypotheses.find((row) => row.hypothesisId === lateHypothesisId)?.supportingEvidence).toHaveLength(1);
    expect(historical.hypotheses.find((row) => row.hypothesisId === hypothesisId)?.ordinalJudgment).toBe("SUPPORTED");
    await expect(foldAt(PRIOR, { epistemicRecordCutoff: KNOWN })).rejects.toThrow(/invalid dual-time cutoff/);
  });
});
