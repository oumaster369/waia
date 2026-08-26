/**
 * DEE-415 / HTR-WP15 — MKB read-model Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import { getPostgresDrizzle } from "@/db/postgres-client";
import { foldCanonicalRuntimeIntelligenceStateV1 } from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { createMkbReadModelSourcePostgres } from "@/lib/trader/knowledge/mkb-read-model-postgres";
import { createPostgresMiHypothesisRepository } from "@/lib/trader/mi/hypothesis-repository-adapters";
import { createPostgresMiEvidenceRepository } from "@/lib/trader/mi/evidence-repository-adapters";
import { cleanupWp14Org } from "./wp14-forecast-decision-test-helpers";
import {
  cleanupWp15AllRows,
  cleanupWp15KnowledgeRows,
  queryWp15InMemoryReadModel,
  queryWp15PostgresReadModel,
  seedWp15KnowledgeRows,
  seedWp15FutureUpdatedKnowledgeEdge,
  seedWp15User,
  WP15_PG_USER_A,
} from "./wp15-mkb-read-model-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader mkb read-model parity (DEE-415 / HTR-WP15)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp14Org(url!, WP15_PG_USER_A);
      orgA = await seedWp15User(url!, WP15_PG_USER_A, "WP15 MKB Read Model Parity");
    });

    beforeEach(async () => {
      await cleanupWp15AllRows(url!, orgA);
      await cleanupWp15KnowledgeRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp14Org(url!, WP15_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("returns tenant-scoped entries from postgres source", async () => {
      await seedWp15KnowledgeRows(orgA, "wp15-parity-run", "0");
      const result = await queryWp15PostgresReadModel(orgA, "wp15-parity-run");

      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries.every((entry) => entry.organizationId === orgA)).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "forecast")).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "market_prediction")).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "market_event")).toBe(true);
      expect(result.entries.some((entry) => entry.subjectKind === "knowledge_edge")).toBe(true);
    });

    it("matches in-memory semantic digest for the same seeded cycle", async () => {
      await seedWp15KnowledgeRows(orgA, "wp15-digest-run", "0");

      const postgresResult = await queryWp15PostgresReadModel(orgA, "wp15-digest-run");
      const memoryResult = await queryWp15InMemoryReadModel(orgA, "wp15-digest-run", "0");

      const postgresForecastStates = postgresResult.entries
        .filter((entry) => entry.subjectKind === "forecast")
        .map((entry) => entry.knowledgeState)
        .sort();
      const memoryForecastStates = memoryResult.entries
        .filter((entry) => entry.subjectKind === "forecast")
        .map((entry) => entry.knowledgeState)
        .sort();

      expect(postgresForecastStates).toEqual(memoryForecastStates);
      expect(postgresResult.verifiedKnowledge.length).toBe(memoryResult.verifiedKnowledge.length);
    });

    it("excludes a Knowledge edge whose mutable state was updated after asOf", async () => {
      await seedWp15KnowledgeRows(orgA, "wp15-pit-update-run", "0");
      const futureEdgeId = await seedWp15FutureUpdatedKnowledgeEdge(orgA);
      const result = await queryWp15PostgresReadModel(orgA, "wp15-pit-update-run");
      expect(result.entries.some((entry) => entry.subjectKind === "knowledge_edge" && entry.subjectId === futureEdgeId)).toBe(false);
    });

    it("folds canonical state through actual PostgreSQL MI and MKB adapters", async () => {
      const db = getPostgresDrizzle();
      const context = { organizationId: orgA };
      const hypotheses = createPostgresMiHypothesisRepository(db);
      const evidence = createPostgresMiEvidenceRepository(db);
      const createdAt = new Date("2026-01-01T10:00:00.000Z");
      const definitionJson = JSON.stringify({ claimShape: { relationshipType: "predictive", isDirectional: true, isTrendEdge: true, isTimingEdge: false }, prior: { ordinal: "low", band: "wide" }, falsificationConditions: ["break"], requiredNulls: ["always-flat-cash"], patternRefs: [], measurementRefs: [], regimeScope: { description: "trend" } });
      await hypotheses.insertHypothesisVersion(context, { id: "dee629-pg-hyp", hypothesisKind: "market_claim", hypothesisKey: "dee629-pg-key", name: "DEE629 PG", schemaVersion: "mi-hypothesis-v1", definitionJson, definitionDigest: "dee629-definition", supersedesJson: null, versionSeq: 1, revisionOf: null, authoredBy: "test", createdAt });
      await hypotheses.insertLifecycleEvent(context, { id: "dee629-pg-life", hypothesisId: "dee629-pg-hyp", hypothesisKey: "dee629-pg-key", lifecycleState: "VALIDATED", rationale: "test", recordedBy: "test", seq: 1, contentDigest: "dee629-life-digest", createdAt });
      await evidence.insertEvidence(context, { id: "dee629-pg-evidence", evidenceKind: "observed", direction: "FOR", hypothesisId: "dee629-pg-hyp", hypothesisKey: "dee629-pg-key", hypothesisDefinitionDigest: "dee629-definition", measurementRefsJson: "[]", observationRefsJson: "[]", eventTime: createdAt, ingestTime: createdAt, recordedBy: "test", seq: 1, contentDigest: "dee629-evidence-digest", nullComparatorRef: null, regimeContextRef: null, trialRegistrationRef: null, createdAt });
      const foldInput = { context, symbol: "BTC/USDT", asOf: new Date("2026-01-01T12:00:00.000Z"), projectHypothesis: () => ({ hypothesisType: "trend_continuation" as const, expectedPath: "higher" }) };
      const foldDeps = { hypotheses, evidence, knowledgeSource: createMkbReadModelSourcePostgres(db) };
      const state = await foldCanonicalRuntimeIntelligenceStateV1(foldInput, foldDeps);
      const replay = await foldCanonicalRuntimeIntelligenceStateV1(foldInput, foldDeps);
      expect(replay).toEqual(state);
      expect(state.hypotheses.map((row) => row.hypothesisId)).toEqual(["dee629-pg-hyp"]);
      expect(state.hypotheses[0]?.supportingEvidence.map((row) => row.evidenceId)).toEqual(["dee629-pg-evidence"]);
      expect(state.semanticDigest).toMatch(/^[0-9a-f]{64}$/);
    });
  },
);
