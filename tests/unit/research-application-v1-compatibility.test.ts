import { describe, expect, it, vi } from "vitest";
import { foldCanonicalRuntimeIntelligenceStateV1, sealHistoricalKnowledgeEdgeV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { selectKnowledgeForQuestionV2, type KnowledgeNavigatorCandidateV2 } from
  "@/lib/trader/knowledge/navigator/knowledge-navigator-v2";
import type { CanonicalRuntimeIntelligenceFoldDepsV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import type { MiHypothesis, MiHypothesisLifecycleEvent } from "@/lib/trader/mi/hypothesis.types";
import type { MiEvidence } from "@/lib/trader/mi/evidence.types";
import type { KnowledgeEdge } from "@/lib/trader/knowledge/knowledge.types";

const at = new Date("2026-01-01T12:00:00.000Z");
const createdAt = new Date("2026-01-01T10:00:00.000Z");
const hypothesis: MiHypothesis = { id: "h", organizationId: "org", hypothesisKind: "market_claim", hypothesisKey: "key", name: "claim",
  schemaVersion: "mi-hypothesis-v1", definitionJson: JSON.stringify({ claimShape: { relationshipType: "predictive", isDirectional: false, isTrendEdge: true, isTimingEdge: false },
    prior: { ordinal: "low", band: "wide" }, falsificationConditions: ["break"], requiredNulls: ["always-flat-cash", "simple-trend-baseline"], patternRefs: [], measurementRefs: [], regimeScope: { description: "trend" } }),
  definitionDigest: "definition", supersedesJson: null, versionSeq: 1, revisionOf: null, authoredBy: "fixture", createdAt };
const lifecycle: MiHypothesisLifecycleEvent = { id: "l", organizationId: "org", hypothesisId: "h", hypothesisKey: "key", lifecycleState: "VALIDATED",
  rationale: "fixture", recordedBy: "fixture", seq: 1, contentDigest: "l-digest", createdAt };
const evidence: MiEvidence = { id: "e", organizationId: "org", evidenceKind: "observed", direction: "FOR", hypothesisId: "h", hypothesisKey: "key",
  hypothesisDefinitionDigest: "definition", measurementRefsJson: "[]", observationRefsJson: "[]", eventTime: createdAt, ingestTime: createdAt,
  recordedBy: "fixture", seq: 1, contentDigest: "e-digest", nullComparatorRef: null, regimeContextRef: null, trialRegistrationRef: null, createdAt };
const edge: KnowledgeEdge = { id: "k", organizationId: "org", fromRef: "evidence:e", toRef: "hypothesis:h", relationKind: "supports",
  confidence: "0.8000", strength: "1.0000", regimeScope: "trend", failureCasesJson: "[]", hypothesisId: "h", verified: true, createdAt, updatedAt: createdAt };
function fold(edges: KnowledgeEdge[] = [edge], rows: MiEvidence[] = [evidence]) {
  const deps = { hypotheses: { listHypotheses: () => [hypothesis], listLifecycleEvents: () => [lifecycle] },
    evidence: { listEvidence: () => rows }, knowledgeSource: { loadSnapshot: () => ({ knowledgeEdges: edges, marketPredictions: [] }) } };
  return foldCanonicalRuntimeIntelligenceStateV1({ context: { organizationId: "org" }, symbol: "BTC/USDT", asOf: at,
    projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "higher" }) }, deps as unknown as CanonicalRuntimeIntelligenceFoldDepsV1);
}
const candidate: KnowledgeNavigatorCandidateV2 = { knowledgeEdgeId: "edge-a", version: 1, contentDigestHex: "a".repeat(64), organizationId: "org",
  symbol: "BTC/USDT", questionId: "WHAT", pitEventAt: createdAt.toISOString(), lifecycleState: "ACTIVE", verified: true,
  fromRef: "one", toRef: "two", relationKind: "supports" };
const selection = (candidates: KnowledgeNavigatorCandidateV2[]) => selectKnowledgeForQuestionV2({ organizationId: "org", runId: "run", symbol: "BTC/USDT", purpose: "NEW_OPPORTUNITY_SEARCH",
  questionId: "WHAT", pitAnchor: at.toISOString(), informationNeedPlanDigestHex: "b".repeat(64), evidenceBudget: 1, maxStalenessMs: 7_200_000, candidates });

describe("DEE1132 legacy wrappers preserve accepted semantics", () => {
  it("retains ACTIVE and legacy digest bytes while RETIRED withdraws support", async () => {
    const legacy = await fold();
    expect(await fold([{ ...edge, lifecycleState: "ACTIVE" }])).toEqual(legacy);
    expect(legacy.hypotheses[0]?.ordinalJudgment).toBe("SUPPORTED");
    const retired = await fold([{ ...edge, lifecycleState: "RETIRED" }]);
    expect(retired.hypotheses[0]?.ordinalJudgment).toBe("WEAKENED");
    expect(retired.knowledgeSemanticDigest).not.toBe(legacy.knowledgeSemanticDigest);
    expect(sealHistoricalKnowledgeEdgeV1({ ...edge, lifecycleState: "ACTIVE" })).toBe(sealHistoricalKnowledgeEdgeV1(edge));
    expect(legacy.semanticDigest).toBe("80c6254b29cd58213e3ee6c91fefe32f2f799a6c12de19cc43a244b821636b60");
    expect(legacy.knowledgeSemanticDigest).toBe("082dfaa80d8b7ae142e411e55354e8f85e03be3e85dcca8ff5cb63f8312df6c5");
    expect(selection([candidate]).contentDigestHex).toBe("0d812d2a017f610cb0dda3255ad82d551d11f5d5a0dcccfc73cb2b6cd40d2732");
    expect(sealHistoricalKnowledgeEdgeV1(edge)).toBe("f5ec59f3e4b9e8e483fe735caa65e39784408cc2f4f350d70e784aa73f3e1ca7");
  });
  it("does not change direction partition or the existing verified support precedence", async () => {
    const against = { ...evidence, id: "against", direction: "AGAINST" as const, contentDigest: "against" };
    const state = await fold([edge], [evidence, { ...evidence, id: "e2" }, against]);
    expect(state.hypotheses[0]?.ordinalJudgment).toBe("SUPPORTED");
    expect(state.hypotheses[0]?.supportingEvidence.map(r => r.evidenceId)).toEqual(["e", "e2"]);
    expect(state.hypotheses[0]?.contradictingEvidence.map(r => r.evidenceId)).toEqual(["against"]);
  });
  it("preserves shuffled duplicate and contradictory Navigator outcomes", () => {
    const duplicate = { ...candidate, knowledgeEdgeId: "z", fromRef: "other" };
    expect(selection([duplicate, candidate])).toEqual(selection([candidate, duplicate]));
    expect(selection([candidate, { ...candidate, knowledgeEdgeId: "against", relationKind: "against", contentDigestHex: "c".repeat(64) }]).outcome).toBe("UNKNOWN_UNRESOLVED");
  });
  it("refuses an explicit research evidence marker in an injected ordinary repository", async () => {
    await expect(fold([edge], [{ ...evidence, authority: "RESEARCH_APPLICATION_ONLY" } as MiEvidence])).rejects.toThrow("RESEARCH_APPLICATION_BOUNDARY");
  });
  it("refuses an explicit research relation marker before ordinary Knowledge classification", async () => {
    await expect(fold([{ ...edge, schemaVersion: "waia.trader.research_application_relation.v1" } as KnowledgeEdge])).rejects.toThrow("RESEARCH_APPLICATION_BOUNDARY");
  });
  it("refuses a research relation cast into the old Navigator receipt path", () => {
    expect(() => selection([{ ...candidate, authority: "RESEARCH_APPLICATION_ONLY" } as KnowledgeNavigatorCandidateV2])).toThrow("RESEARCH_APPLICATION_BOUNDARY");
  });
});

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableColumns } from "drizzle-orm";
import * as pg from "@/db/schema.postgres";
import { defineCanonicalMeasurementV1, identifyCanonicalMeasurementValueV1 } from "@/lib/trader/mi/measurement-lineage-v1";
import { persistCanonicalMeasurementDefinitionV1Postgres, persistCanonicalMeasurementValueLineageV1Postgres,
  persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres, persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres } from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { prepareHeldResearchReplay, HeldResearchAccounting } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

/** Actual ORM/writer execution with inert SQL transport; no native rollback claim. */
function canonicalFixture(driverJson: "text" | "objects" = "text", wireRoot?: postgres.Sql) {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const definition = defineCanonicalMeasurementV1({ organizationId, category: "feature_transform", name: "explicit synthetic quote identity",
    inputContracts: [{ observationKind: "quote_l1", observationSchemaVersion: "mi-canonical-pit-observation-v1" }], outputSchemaVersion: "fixture-output/v1" });
  const value = identifyCanonicalMeasurementValueV1({ organizationId, definition, outputContentDigest: "a".repeat(64), inputs: [{
    observationId: "22222222-2222-4222-8222-222222222222", observationKind: "quote_l1", observationSchemaVersion: "mi-canonical-pit-observation-v1",
    observationContentDigest: "b".repeat(64), sourceId: "33333333-3333-4333-8333-333333333333", trustAsOfReceiptId: "c".repeat(64),
    trustRevisionId: "44444444-4444-4444-8444-444444444444", trustRevisionContentDigest: "d".repeat(64),
  }] });
  const rows = new Map<string, Record<string, unknown>>(); const trace: Array<{ sql: string; params: unknown[] }> = [];
  const tables = { trader_mi_canonical_measurement_definition_v1: pg.traderMiCanonicalMeasurementDefinitionV1,
    trader_mi_canonical_measurement_value_v1: pg.traderMiCanonicalMeasurementValueV1,
    trader_mi_canonical_measurement_value_input_v1: pg.traderMiCanonicalMeasurementValueInputV1 };
  let failInputs = false; let transactions = 0;
  const unsafe = (sql: string, params: unknown[] = []) => {
    trace.push({ sql, params });
    const table = /(?:into|from) "([a-z0-9_]+)"/.exec(sql)![1]! as keyof typeof tables;
    const columnEntries = Object.entries(getTableColumns(tables[table]));
    const names = new Map(columnEntries.map(([key, column]) => [column.name, key]));
    const jsonbColumns = new Set(columnEntries.filter(([, column]) => column.getSQLType() === "jsonb").map(([key]) => key));
    let result: unknown[][] = [];
    if (sql.startsWith("insert")) {
      if (failInputs && table === "trader_mi_canonical_measurement_value_input_v1") throw new Error("INERT_INPUT_INSERT_FAILURE");
      const columns = /into "[^"]+" \(([^)]+)\)/.exec(sql)![1]!.split(", ").map(c => c.replaceAll('"', ""));
      const terms = / values \(([^)]+)\)/.exec(sql)![1]!.split(", ");
      const row = Object.fromEntries(columns.map((column, i) => [names.get(column)!, terms[i]!.startsWith("$") ? params[Number(terms[i]!.slice(1)) - 1] : null]));
      // Explicit synthetic server-OID inference from the actual schema. Apply
      // the actual originating driver's serializer, then the server's one JSON
      // decode. Assert these logical stored types before any incoming mapper.
      if (wireRoot) for (const key of jsonbColumns) {
        row[key] = JSON.parse(String(wireRoot.options.serializers[3802]!(row[key])));
      }
      const old = rows.get(table); if (!old) { rows.set(table, row); if (sql.includes("returning")) result = [[row.id]]; }
    } else {
      const row = rows.get(table);
      if (row && params.includes(row.organizationId) && params.includes(row.id)) {
        const columns = /select (.+?) from/.exec(sql)![1]!.split(", ").map(c => c.replaceAll('"', ""));
        result = [columns.map(column => {
          const name = names.get(column)!; const value = row[name];
          if (wireRoot && jsonbColumns.has(name)) return wireRoot.options.parsers[3802]!(JSON.stringify(value));
          return driverJson === "objects" && ["definition_json", "input_contracts_json", "input_lineage_json"].includes(column) && typeof value === "string" ? JSON.parse(value) : value;
        })];
      }
    }
    return Object.assign(Promise.resolve([]), { values: async () => result });
  };
  const held = { unsafe, savepoint() { throw new Error("NO_SAVEPOINT"); } } as unknown as postgres.TransactionSql;
  const pool = { unsafe, options: { parsers: {}, serializers: {} }, begin: async (fn: (client: postgres.TransactionSql) => Promise<unknown>) => { transactions++; return fn(held); } } as unknown as postgres.Sql;
  return { definition, value, context: { organizationId }, rows, trace, held, pool: wireRoot ?? pool,
    transactionCount: () => transactions, failInputInsert() { failInputs = true; } };
}
describe("canonical public/held bodies and SQL compatibility", () => {
  it("preserves definition/value/inputs and exact no-op replay through actual shared writer logic", async () => {
    const a = canonicalFixture(); const b = canonicalFixture(); const oldDb = drizzle(a.pool, { schema: pg });
    const accounting = new HeldResearchAccounting(); const tx = prepareHeldResearchReplay(b.pool, accounting).bindHeld(b.held).executor;
    const oldFirst = [await persistCanonicalMeasurementDefinitionV1Postgres(oldDb, a.context, a.definition),
      await persistCanonicalMeasurementValueLineageV1Postgres(oldDb, a.context, a.value)];
    const heldFirst = [await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(tx, b.context, b.definition),
      await persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(tx, b.context, b.value)];
    expect(heldFirst).toEqual(oldFirst); expect(heldFirst.every(x => x.insertedNew)).toBe(true);
    expect(await persistCanonicalMeasurementDefinitionV1Postgres(oldDb, a.context, a.definition)).toEqual(await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(tx, b.context, b.definition));
    expect(await persistCanonicalMeasurementValueLineageV1Postgres(oldDb, a.context, a.value)).toEqual(await persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(tx, b.context, b.value));
    expect(a.transactionCount()).toBe(4); expect(b.transactionCount()).toBe(0); expect(b.trace).toEqual(a.trace);
    expect(accounting.statements).toBe(b.trace.length); expect([...b.rows]).toEqual([...a.rows]);
    expect(canonicalJsonString(heldFirst)).toBe(canonicalJsonString(oldFirst));
  });
  it("retains actual JSONB object versus text parser representations in held canonical results", async () => {
    const a = canonicalFixture("text"); const b = canonicalFixture("objects");
    const txA = prepareHeldResearchReplay(a.pool, new HeldResearchAccounting()).bindHeld(Object.freeze(a.held)).executor;
    const txB = prepareHeldResearchReplay(b.pool, new HeldResearchAccounting()).bindHeld(Object.freeze(b.held)).executor;
    expect(await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(txA, a.context, a.definition))
      .toEqual(await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(txB, b.context, b.definition));
    for (let i = 0; i < 2; i++) expect(await persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(txA, a.context, a.value))
      .toEqual(await persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(txB, b.context, b.value));
  });
  it("retains invalid scope/definition errors before any SQL or public transaction", async () => {
    const f = canonicalFixture(); const db = drizzle(f.pool, { schema: pg }); const held = prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.held).executor;
    for (const writer of [() => persistCanonicalMeasurementDefinitionV1Postgres(db, f.context, { ...f.definition, name: "altered" }),
      () => persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(held, f.context, { ...f.definition, name: "altered" }),
      () => persistCanonicalMeasurementValueLineageV1Postgres(db, { organizationId: "other" }, f.value),
      () => persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(held, { organizationId: "other" }, f.value)]) await expect(writer()).rejects.toThrow();
    expect(f.trace).toEqual([]); expect(f.transactionCount()).toBe(0);
  });
  it("propagates actual input insert failure after value SQL, with no claimed inert rollback", async () => {
    const f = canonicalFixture(); const held = prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.held).executor;
    await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(held, f.context, f.definition); f.failInputInsert();
    await expect(persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(held, f.context, f.value)).rejects.toThrow();
    expect(f.trace.at(-1)!.sql).toContain('insert into "trader_mi_canonical_measurement_value_input_v1"');
    expect(f.rows.has("trader_mi_canonical_measurement_value_v1")).toBe(true); expect(f.transactionCount()).toBe(0);
  });
  it("retains missing definition and stored-content conflict, without alternate authority", async () => {
    const f = canonicalFixture(); const held = prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.held).executor;
    await expect(persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(held, f.context, f.value)).rejects.toThrow("CANONICAL_MEASUREMENT_DEFINITION_NOT_FOUND");
    await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(held, f.context, f.definition);
    const row = f.rows.get("trader_mi_canonical_measurement_definition_v1")!; row.definitionJson = JSON.stringify({ ...f.definition, name: "conflicting-stored-body" });
    await expect(persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(held, f.context, f.definition)).rejects.toThrow("CANONICAL_MEASUREMENT_DEFINITION_CONFLICT");
  });
});


describe("actual canonical JSONB wire codec", () => {
  it("stores logical canonical objects and arrays before the incoming mapper", async () => {
    let networkAttempts = 0;
    const root = postgres({ host: "127.0.0.1", port: 1, user: "waia_codec_fixture", password: "waia_codec_fixture", database: "waia_codec_fixture", max: 1,
      socket: () => { networkAttempts++; throw new Error("NO_NETWORK"); } });
    const rootUnsafe = vi.spyOn(root, "unsafe"); const rootBegin = vi.spyOn(root, "begin");
    try {
      const f = canonicalFixture("objects", root); const originalOptions = root.options;
      const mapped = pg.traderMiCanonicalMeasurementDefinitionV1.definitionJson.mapToDriverValue(f.definition);
      const originalSerializers = [114, 3802].map(oid => originalOptions.serializers[oid]!);
      // Actual original driver codecs demonstrate the genuine double-encoding
      // counterexample. The OIDs are explicitly inferred by this inert fixture.
      for (const serialize of originalSerializers) expect(typeof JSON.parse(String(serialize(mapped)))).toBe("string");
      const pending = prepareHeldResearchReplay(f.pool, new HeldResearchAccounting());
      expect(root.options).toBe(originalOptions);
      for (const oid of [114, 3802]) expect(JSON.parse(String(root.options.serializers[oid]!(mapped)))).toEqual(f.definition);
      const timestamp = "2026-01-01T12:00:00.000Z";
      expect(root.options.parsers[1184]!(timestamp)).toBe(timestamp); expect(root.options.serializers[1184]!(timestamp)).toBe(timestamp);
      const initializedSerializer = root.options.serializers[3802];
      const tx = pending.bindHeld(Object.freeze(f.held)).executor;
      expect(root.options.serializers[3802]).toBe(initializedSerializer);
      await persistCanonicalMeasurementDefinitionWithinTransactionV1Postgres(tx, f.context, f.definition);
      await persistCanonicalMeasurementValueLineageWithinTransactionV1Postgres(tx, f.context, f.value);
      expect(rootUnsafe).not.toHaveBeenCalled(); expect(rootBegin).not.toHaveBeenCalled(); expect(networkAttempts).toBe(0);
      expect({ definition: f.rows.get("trader_mi_canonical_measurement_definition_v1")!.definitionJson,
        contracts: f.rows.get("trader_mi_canonical_measurement_definition_v1")!.inputContractsJson,
        lineage: f.rows.get("trader_mi_canonical_measurement_value_v1")!.inputLineageJson })
        .toEqual({ definition: f.definition, contracts: f.definition.inputContracts, lineage: f.value.inputs });
    } finally { rootUnsafe.mockRestore(); rootBegin.mockRestore(); await root.end({ timeout: 0 }); }
  });
});
