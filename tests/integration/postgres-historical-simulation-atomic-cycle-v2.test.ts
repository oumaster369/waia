import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_SIMULATION_ATOMIC_STAGES_V2, commitHistoricalSimulationCycleAtomicallyV2,
  createHistoricalSimulationAtomicStageBundleV2, createHistoricalSimulationDurableStateSnapshotV2,
  type HistoricalSimulationAtomicScopeV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import { createHistoricalSimulationAtomicCyclePostgresRepositoryV2, createHistoricalSimulationCommitRequestV2 }
  from "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import { createHistoricalSimulationReasonLedgerV2 } from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const organizationId = "00000000-0000-4000-8000-000000001888";
const userId = "00000000-0000-4000-8000-000000001889";
const D = "a".repeat(64);

function fixture(runId: string) {
  const scope: HistoricalSimulationAtomicScopeV2 = { organizationId, accountId: `account:${runId}`, runId,
    split: "DEVELOPMENT" };
  const cycleId = `${runId}:cycle:0`;
  const membershipBody = { schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2, organizationId, cycleId,
    datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1" as const,
    datasetAuthorityDigestHex: "2".repeat(64), qualificationReceiptDigestHex: "2".repeat(64),
    partitionDigestHex: "3".repeat(64), partitionRawSha256Hex: "4".repeat(64), partition: "DEVELOPMENT" as const,
    symbol: "BTCUSDT" as const, recordIndex: 0, barContentDigestHex: "5".repeat(64),
    sealedCycleContentDigestHex: "6".repeat(64) };
  const membership = { ...membershipBody, contentDigestHex: computeSemanticSha256Hex(membershipBody) };
  const entry = createHistoricalSimulationReasonLedgerV2({ organizationId, accountId: scope.accountId, runId,
    cycleId, cycleSequence: 0, symbol: "BTC/USDT",
    partition: "DEVELOPMENT", replayBarClosedAtUtc: "2023-11-14T22:13:20.000Z", datasetMembership: membership,
    previousContentDigestHex: null,
    forecast: { status: "NON_ACTIONABLE", reasonCodes: ["NO_EDGE"], authorityContentDigestHex: null },
    decision: { status: "CASH", reasonCodes: ["NO_EDGE"], decisionContentDigestHex: D,
      whyNotCashReceiptDigestHex: D, evLower: null, evBase: null, evUpper: null },
    portfolio: { status: "NO_PROPOSAL", reasonCodes: ["CASH"], proposalContentDigestHex: D },
    risk: { status: "NOT_EVALUATED", reasonCodes: ["CASH"], verdictContentDigestHex: null,
      allowanceContentDigestHex: null },
    execution: { status: "NOT_DISPATCHED", reasonCodes: ["CASH"], planContentDigestHex: null,
      attemptContentDigestHex: null, reportContentDigestHex: null, fillContentDigestHexes: [] },
    observedExecutionEffects: [], accounting: { status: "UNCHANGED", reasonCodes: [], frontierContentDigestHex: D },
    guardian: { status: "NONE", reasonCodes: [], assessmentContentDigestHex: D },
    learning: { status: "NO_UPDATE", reasonCodes: ["NOT_MATURE"], calibrationObservationContentDigestHex: null,
      knowledgeUpdateContentDigestHex: null, eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null } });
  const artifactKind = { FORECAST_LIFECYCLE: "FORECAST_ISSUANCE", CANONICAL_VERIFICATION: "CANONICAL_VERIFICATION_RECEIPT",
    MODELED_RISK: "MODELED_RISK_VERDICT", MODELED_EXECUTION: "MODELED_EXECUTION_SUBMISSION",
    OBSERVED_EXECUTION_EFFECTS: "MODELED_EXECUTION_EFFECT", ACCOUNTING: "ACCOUNTING_FRONTIER",
    GUARDIAN: "GUARDIAN_ASSESSMENT", KNOWLEDGE: "KNOWLEDGE_CHECKPOINT", LEARNING: "LEARNING_UPDATE" } as const;
  const bundles = Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => [stage,
    createHistoricalSimulationAtomicStageBundleV2({ ...scope, cycleId, stage,
      ledgerEntryContentDigestHex: entry.contentDigestHex, artifacts: [{ artifactKind: artifactKind[stage],
        artifactId: `${cycleId}:${stage}`, contentDigestHex: stage === "KNOWLEDGE" ? "b".repeat(64) : D }] })])) as any;
  const identity = { ...scope, cycleId };
  const accountingBody = { schemaVersion: "htr-accounting-frontier/v1" as const,
    engineId: "CANONICAL_CROSS_BACKEND_ACCOUNTING_ENGINE_V1" as const,
    basisMethod: "DUAL_GROSS_NET_WEIGHTED_AVERAGE_BASIS_V1" as const, organizationId,
    accountKey: scope.accountId, runId, accountingSequence: 0, frontierAsOf: entry.replayBarClosedAtUtc,
    monthKey: "2023-11", cash: "1000.00000000", positions: {}, grossRealizedPnl: "0.00000000",
    netRealizedPnl: "0.00000000", marks: {}, markedPositionValue: "0.00000000", equity: "1000.00000000",
    equityHwm: "1000.00000000", accountDrawdownBps: 0, consumedFillIds: [], id: `${runId}:frontier:0`,
    sourceFillId: null, sourceEconomicsDigest: D, idempotencyKey: `${runId}:frontier:0` };
  const snapshots = {
    knowledgeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity, stateKind: "KNOWLEDGE",
      state: { checkpointSequence: 0, checkpointContentDigestHex: "b".repeat(64),
        knowledgeContentDigestHex: "c".repeat(64), visibleThroughPitAnchor: entry.replayBarClosedAtUtc } }),
    modeledExecutionRegistrySnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "MODELED_EXECUTION_REGISTRY", state: { receipts: [] } }),
    modeledExchangeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity, stateKind: "MODELED_EXCHANGE",
      state: { checkpoint: { schemaVersion: "htr-wp17-execution-checkpoint/v1", openOrders: [],
        executionModelSchemaVersion: "waia.trader.historical-execution-model.v1" }, openOrders: [] } }),
    accountingFrontierSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "ACCOUNTING_FRONTIER", state: { ...accountingBody,
        semanticContentDigest: computeAccountingSemanticDigest(accountingBody) } }),
    guardianSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity, stateKind: "GUARDIAN",
      state: { posture: "NONE", assessmentContentDigestHex: D, assessedAt: entry.replayBarClosedAtUtc } }),
    learningSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity, stateKind: "LEARNING",
      state: { appliedClosureWatermarkUtc: null, pendingForecastAuthorityContentDigestHexes: [] } }),
  };
  const request = createHistoricalSimulationCommitRequestV2({ ...scope, cycleSequence: 0, cycleId,
    replayBarClosedAtUtc: entry.replayBarClosedAtUtc, datasetMembership: membership,
    datasetMembershipContentDigestHex: membership.contentDigestHex, forecastInputAuthorityContentDigestHex: "7".repeat(64),
    policyConfigContentDigestHex: "8".repeat(64), codeSha: "9".repeat(40),
    ledgerEntryContentDigestHex: entry.contentDigestHex,
    stageBundleDigestHexByStage: Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) =>
      [stage, bundles[stage].contentDigestHex])) as any,
    snapshotContentDigestHexByKind: { KNOWLEDGE: snapshots.knowledgeSnapshot.contentDigestHex,
      MODELED_EXECUTION_REGISTRY: snapshots.modeledExecutionRegistrySnapshot.contentDigestHex,
      MODELED_EXCHANGE: snapshots.modeledExchangeSnapshot.contentDigestHex,
      ACCOUNTING_FRONTIER: snapshots.accountingFrontierSnapshot.contentDigestHex,
      GUARDIAN: snapshots.guardianSnapshot.contentDigestHex, LEARNING: snapshots.learningSnapshot.contentDigestHex } });
  return { scope, entry, bundles, snapshots, request };
}

async function commit(sql: postgres.Sql, runId: string) {
  const value = fixture(runId);
  return commitHistoricalSimulationCycleAtomicallyV2({ repository:
    createHistoricalSimulationAtomicCyclePostgresRepositoryV2({ sql, request: value.request }), scope: value.scope,
    ledgerEntry: value.entry, stageBundles: value.bundles, knowledgeCheckpointSequence: 0,
    knowledgeCheckpointContentDigestHex: "b".repeat(64), ...value.snapshots });
}

describe.skipIf(!enabled || !url)("Historical Simulation V2 atomic resume PostgreSQL", () => {
  const sql = postgres(url!, { max: 8 });
  beforeAll(async () => {
    await sql`INSERT INTO auth.users(id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO users(id,identity_label,email) VALUES
      (${userId}::uuid,'0188 integration','0188-integration@invalid.local') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO organizations(id,owner_user_id,kind,name) VALUES
      (${organizationId}::uuid,${userId}::uuid,'personal','0188 integration') ON CONFLICT DO NOTHING`;
  });
  afterAll(async () => { await sql.end({ timeout: 5 }); });

  it("installs the owner-only append-only 0188 graph", async () => {
    const names = ["trader_historical_simulation_atomic_stage_v2", "trader_historical_simulation_durable_snapshot_v2",
      "trader_historical_simulation_resume_checkpoint_v2", "trader_historical_simulation_resume_stage_link_v2",
      "trader_historical_simulation_resume_snapshot_link_v2"];
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ${sql(names)}`;
    expect(rows.map((row) => row.relname).sort()).toEqual([...names].sort());
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it.each(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2)("rolls back every row after a crash at stage %s", async (stage) => {
    const runId = `pg-crash-${stage.toLowerCase()}`;
    const trigger = `waia_0188_fail_${stage.toLowerCase()}`;
    await sql.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON trader_historical_simulation_atomic_stage_v2
      FOR EACH ROW WHEN (NEW.stage='${stage}') EXECUTE FUNCTION trader_historical_simulation_v2_append_only()`);
    try {
      await expect(commit(sql, runId)).rejects.toThrow("append-only");
      const counts = await sql<{ ledger: number; evidence: number; stages: number; snapshots: number;
        checkpoints: number; stageLinks: number; snapshotLinks: number }[]>`
        SELECT (SELECT count(*)::int FROM trader_historical_simulation_reason_ledger_v2 WHERE run_id=${runId}) ledger,
          (SELECT count(*)::int FROM trader_historical_simulation_modeled_evidence_v2 e JOIN
            trader_historical_simulation_reason_ledger_v2 l ON l.entry_id=e.reason_ledger_entry_id
            WHERE l.run_id=${runId}) evidence,
          (SELECT count(*)::int FROM trader_historical_simulation_atomic_stage_v2 WHERE run_id=${runId}) stages,
          (SELECT count(*)::int FROM trader_historical_simulation_durable_snapshot_v2 WHERE run_id=${runId}) snapshots,
          (SELECT count(*)::int FROM trader_historical_simulation_resume_checkpoint_v2 WHERE run_id=${runId}) checkpoints,
          (SELECT count(*)::int FROM trader_historical_simulation_resume_stage_link_v2 WHERE run_id=${runId}) "stageLinks",
          (SELECT count(*)::int FROM trader_historical_simulation_resume_snapshot_link_v2 WHERE run_id=${runId}) "snapshotLinks"`;
      expect(counts[0]).toEqual({ ledger: 0, evidence: 0, stages: 0, snapshots: 0, checkpoints: 0,
        stageLinks: 0, snapshotLinks: 0 });
    } finally { await sql.unsafe(`DROP TRIGGER ${trigger} ON trader_historical_simulation_atomic_stage_v2`); }
  });

  it("serializes two initial writers, returns an exact retry, and reloads byte-identical durable state", async () => {
    const runId = `pg-concurrent-and-retry-${randomUUID()}`;
    const [left, right] = await Promise.all([commit(sql, runId), commit(sql, runId)]);
    expect(right).toEqual(left);
    const retry = await commit(sql, runId);
    expect(retry).toEqual(left);
    const counts = await sql<{ ledger: number; stages: number; snapshots: number; checkpoints: number;
      stageLinks: number; snapshotLinks: number }[]>`
      SELECT (SELECT count(*)::int FROM trader_historical_simulation_reason_ledger_v2 WHERE run_id=${runId}) ledger,
        (SELECT count(*)::int FROM trader_historical_simulation_atomic_stage_v2 WHERE run_id=${runId}) stages,
        (SELECT count(*)::int FROM trader_historical_simulation_durable_snapshot_v2 WHERE run_id=${runId}) snapshots,
        (SELECT count(*)::int FROM trader_historical_simulation_resume_checkpoint_v2 WHERE run_id=${runId}) checkpoints,
        (SELECT count(*)::int FROM trader_historical_simulation_resume_stage_link_v2 WHERE run_id=${runId}) "stageLinks",
        (SELECT count(*)::int FROM trader_historical_simulation_resume_snapshot_link_v2 WHERE run_id=${runId}) "snapshotLinks"`;
    expect(counts[0]).toEqual({ ledger: 1, stages: 9, snapshots: 6, checkpoints: 1,
      stageLinks: 9, snapshotLinks: 6 });
    expect(retry.contentDigestHex).toBe(left.contentDigestHex);
  });
});
