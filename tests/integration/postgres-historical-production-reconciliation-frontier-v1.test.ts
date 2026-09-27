/** Controlled source/constraint proof; these fixtures are NOT ratified historical authority.
 * Actual canonical public-owner coverage is retained separately in the first-cycle companion.
 * No provider call, SQL guard disable, source deletion or migration-history repair.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import { createInitialAccountingState, advanceAccountingFrontier, computeAccountingSemanticDigest } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { createAccountingFrontierRepositoryPostgres } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_SIMULATION_ATOMIC_STAGES_V2, commitHistoricalSimulationCycleAtomicallyV2,
  createHistoricalSimulationAtomicStageBundleV2, createHistoricalSimulationDurableStateSnapshotV2,
  type HistoricalSimulationAtomicScopeV2, type HistoricalSimulationAtomicStageBundlesV2 }
  from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import { prepareHistoricalSimulationProductionPortsV2, createHistoricalSimulationCommitRequestV2 }
  from "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import { createHistoricalSimulationReasonLedgerV2 } from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";
import { createHistoricalReconciliationGenesisV1, advanceHistoricalReconciliationV1,
  projectHistoricalReconciliationAccountingV1, observeHistoricalReconciliationV1, sealHistoricalReconciliationCycleV1,
  HISTORICAL_RECONCILIATION_PROFILE_V1, projectHistoricalReconciliationSourceValueV1 } from "@/lib/trader/historical-simulation-v2/production-reconciliation-frontier-v1";
import { createHistoricalReconciliationRepositoryV1 } from "@/lib/trader/historical-simulation-v2/production-reconciliation-repository-postgres-v1";

const enabled = process.env.WAIA_PG_INTEGRATION === "1", url = process.env.DATABASE_URL_POSTGRES;
const organizationId = "00000000-0000-4000-8000-000000002222";
const userId = "00000000-0000-4000-8000-000000002223";
const D = "a".repeat(64);
/** Same disposable historical namespace as the actual first-cycle companion;
 * local access is additionally fixed to the coordinated validation port/user.
 */
function assertTestDatabase() {
  if (!url) throw new Error("DEE1130_ISOLATED_LOOPBACK_REQUIRED");
  const u = new URL(url);
  const local = u.port === "54329" && u.username === "waia_validate" && /^\/waia_hsv2_it(?:_[a-z0-9]+)*$/.test(u.pathname);
  const ci = process.env.CI === "true" && process.env.WAIA_POSTGRES_CLI === "1" &&
    u.port === "5432" && u.username === "waia_it" && u.pathname === "/waia_it";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || (!local && !ci)) {
    throw new Error("DEE1130_ISOLATED_LOOPBACK_REQUIRED");
  }
}
function fixture(runId: string, mark: AccountingFrontierV1) {
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
    portfolio: { status: "NO_PROPOSAL", action: "CASH", reasonCodes: ["CASH"], proposalContentDigestHex: D },
    risk: { status: "NOT_EVALUATED", reasonCodes: ["CASH"], verdictContentDigestHex: null,
      allowanceContentDigestHex: null },
    execution: { status: "NOT_DISPATCHED", reasonCodes: ["CASH"], planContentDigestHex: null,
      attemptContentDigestHex: null, reportContentDigestHex: null, fillContentDigestHexes: [] },
    observedExecutionEffects: [], accounting: { status: "UNCHANGED", reasonCodes: [], frontierContentDigestHex: mark.semanticContentDigest },
    guardian: { status: "NONE", reasonCodes: [], assessmentContentDigestHex: D },
    learning: { status: "NO_UPDATE", reasonCodes: ["NOT_MATURE"], calibrationObservationContentDigestHex: null,
      knowledgeUpdateContentDigestHex: null, eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null } });
  const artifactKind = { FORECAST_LIFECYCLE: "FORECAST_ISSUANCE", CANONICAL_VERIFICATION: "CANONICAL_VERIFICATION_RECEIPT",
    MODELED_RISK: "MODELED_RISK_VERDICT", MODELED_EXECUTION: "MODELED_EXECUTION_SUBMISSION",
    OBSERVED_EXECUTION_EFFECTS: "MODELED_EXECUTION_EFFECT",
    HISTORICAL_MODELED_REALITY: "HISTORICAL_MODELED_REALITY", ACCOUNTING: "ACCOUNTING_FRONTIER",
    GUARDIAN: "GUARDIAN_ASSESSMENT", KNOWLEDGE: "KNOWLEDGE_CHECKPOINT", LEARNING: "LEARNING_UPDATE" } as const;
  const bundles: HistoricalSimulationAtomicStageBundlesV2 = Object.fromEntries(
    HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => [stage,
    createHistoricalSimulationAtomicStageBundleV2({ ...scope, cycleId, stage,
      ledgerEntryContentDigestHex: entry.contentDigestHex, artifacts: [{ artifactKind: artifactKind[stage],
        artifactId: stage === "ACCOUNTING" ? mark.id : `${cycleId}:${stage}`, contentDigestHex: stage === "KNOWLEDGE" ? "b".repeat(64) : stage === "ACCOUNTING" ? mark.semanticContentDigest : D }] })]),
  ) as HistoricalSimulationAtomicStageBundlesV2;
  const identity = { ...scope, cycleId };
  const snapshots = {
    knowledgeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity, stateKind: "KNOWLEDGE",
      state: { checkpointSequence: 0, checkpointContentDigestHex: "b".repeat(64),
        knowledgeContentDigestHex: "c".repeat(64), visibleThroughPitAnchor: entry.replayBarClosedAtUtc } }),
    modeledExecutionRegistrySnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "MODELED_EXECUTION_REGISTRY", state: { receipts: [] } }),
    modeledExchangeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity, stateKind: "MODELED_EXCHANGE",
      state: { checkpoint: { schemaVersion: "htr-wp17-execution-checkpoint/v1", openOrders: [],
        simulatorVersion: "1.0.1",
        executionModelSchemaVersion: "waia.trader.historical-execution-model.v1" }, openOrders: [] } }),
    accountingFrontierSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "ACCOUNTING_FRONTIER", state: mark }),
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
      [stage, bundles[stage].contentDigestHex])) as Record<(typeof HISTORICAL_SIMULATION_ATOMIC_STAGES_V2)[number], string>,
    snapshotContentDigestHexByKind: { KNOWLEDGE: snapshots.knowledgeSnapshot.contentDigestHex,
      MODELED_EXECUTION_REGISTRY: snapshots.modeledExecutionRegistrySnapshot.contentDigestHex,
      MODELED_EXCHANGE: snapshots.modeledExchangeSnapshot.contentDigestHex,
      ACCOUNTING_FRONTIER: snapshots.accountingFrontierSnapshot.contentDigestHex,
      GUARDIAN: snapshots.guardianSnapshot.contentDigestHex, LEARNING: snapshots.learningSnapshot.contentDigestHex } });
  return { scope, entry, bundles, snapshots, request };
}

function input() {
  const runId = `reconciliation-${randomUUID()}`;
  const initial = createInitialAccountingState({ organizationId, accountKey: `account:${runId}`, runId,
    startingCash: "1000", frontierAsOf: "2023-11-14T22:12:20.000Z" });
  const inception: AccountingFrontierV1 = { ...initial, id: randomUUID(), sourceFillId: null,
    sourceEconomicsDigest: D, semanticContentDigest: computeAccountingSemanticDigest(initial), idempotencyKey: `initial:${runId}` };
  const mark = advanceAccountingFrontier({ state: inception, frontierAsOf: "2023-11-14T22:13:20.000Z",
    marks: { BTCUSDT: { price: "100", barCloseTime: "2023-11-14T22:13:20.000Z" } }, frontierId: randomUUID() });
  const f = fixture(runId, mark);
  const genesis = createHistoricalReconciliationGenesisV1({ scope: f.scope, symbol: "BTCUSDT", inception,
    authorityId: randomUUID(), authorityDigest: D, modelDigest: D, releaseSha: "9".repeat(40), initialRecordIndex: 0 });
  return { ...f, inception, mark, genesis };
}
type Input = ReturnType<typeof input>;
/** Fixture-only driver binding. TransactionSql/savepoint handles intentionally lack
 * options. Drizzle receives the actual originating pool's codec maps (as on its
 * normal pool construction); every callable/query helper stays on the supplied
 * held handle. No fabricated codecs, reservation or transaction ownership.
 */
function accountingExecutor(pool: postgres.Sql, held: postgres.Sql) {
  const options = pool.options;
  if (!options?.parsers || !options.serializers) throw new Error("FIXTURE_POOL_CODECS_REQUIRED");
  const client = new Proxy(held, {
    apply(target, _thisArg, args) { return Reflect.apply(target, target, args); },
    get(target, property) {
      if (property === "options") return options;
      if (["begin", "reserve", "end", "close", "listen", "subscribe", "notify"].includes(String(property))) return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return drizzle(client, { schema });
}
const appendAccounting = (pool: postgres.Sql, tx: postgres.Sql, state: AccountingFrontierV1) =>
  createAccountingFrontierRepositoryPostgres(accountingExecutor(pool, tx)).append({ organizationId }, state);
/** Low-level fully resealed malformed inputs exercise the native boundary, not
 * qualified producer authority. Native source/owner positives remain separate. */
function resealedRawBody(value: Record<string, unknown>) {
  const body = { ...value }; delete body.id; delete body.contentDigest;
  const contentDigest = computeSemanticSha256Hex(body);
  const id = deterministicExecutionUuidV2("report", { kind: "waia.trader.historical_reconciliation.v1", contentDigest });
  return { ...body, id, contentDigest };
}
function insertRawCompanion(tx: postgres.Sql, f: Input, bodyText: string | null, id = f.genesis.id, contentDigest = f.genesis.contentDigest) {
  return tx`INSERT INTO trader_historical_reconciliation_frontier_v1
    (id,organization_id,account_id,run_id,cycle_sequence,partition,profile,symbol,previous_id,genesis_id,
      checkpoint_digest,content_digest,body_text)
    VALUES (${id}::uuid,${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},-1,'DEVELOPMENT',
      ${f.genesis.profile},'BTCUSDT',NULL,NULL,NULL,${contentDigest},${bodyText})`;
}
async function canonicalCalls(tx: postgres.Sql): Promise<bigint> {
  const [row] = await tx`SELECT COALESCE((SELECT calls FROM pg_stat_xact_user_functions
    WHERE funcid='public.waia_canonical_jsonb_v1(jsonb)'::regprocedure),0)::text AS calls`;
  return BigInt(row!.calls as string);
}
function accountingNestedBody(f: Input, leafDepth: number, leaf: unknown) {
  let value = leaf;
  for (let n = 2; n < leafDepth; n++) value = { nested: value };
  return resealedRawBody({ ...f.genesis, accounting: { ...f.genesis.accounting, fixtureNested: value } });
}
async function mode(tx: postgres.Sql, f: Input) {
  await tx`INSERT INTO trader_historical_reconciliation_scope_mode_v1
    (organization_id,account_id,run_id,mode,profile,partition,symbol,genesis_id)
    VALUES (${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},'PROFILE',
      ${HISTORICAL_RECONCILIATION_PROFILE_V1},'DEVELOPMENT','BTCUSDT',${f.genesis.id}::uuid)
    ON CONFLICT (organization_id,account_id,run_id) DO NOTHING`;
}
async function profile(pool: postgres.Sql, tx: postgres.Sql, f: Input, fault?: "after-mode" | "after-genesis" | "after-mark" | "after-checkpoint" | "after-companion", omitProjection = false, checkpointMembershipSibling?: string) {
  await appendAccounting(pool, tx, f.inception);
  await mode(tx, f);
  if (fault === "after-mode") throw new Error("CONTROLLED_FAULT");
  const repository = createHistoricalReconciliationRepositoryV1(tx, f.scope);
  // Deliberately low-level native fixture, not repository.enroll's source-preregistration admission.
  await repository.append(f.genesis);
  if (fault === "after-genesis") throw new Error("CONTROLLED_FAULT");
  await appendAccounting(pool, tx, f.mark);
  if (fault === "after-mark") throw new Error("CONTROLLED_FAULT");
  const held = await prepareHistoricalSimulationProductionPortsV2({ tx, request: f.request, scope: f.scope, createPorts: () => null });
  // Controlled lower-level fixture writes candidates in the original INSERTs.
  // The actual public owner is separately exercised by the 35-cycle companion;
  // its private bound factory has no injectable projection/admission collaborator.
  const fixtureTransaction: typeof held.transaction = { ...held.transaction,
    async persistStageBundle(bundle) {
      const value = omitProjection ? null : projectHistoricalReconciliationSourceValueV1(bundle.stage, bundle.artifacts);
      const rows = await tx`INSERT INTO trader_historical_simulation_atomic_stage_v2
        (organization_id,account_id,run_id,cycle_sequence,cycle_id,stage,ledger_entry_id,ledger_entry_content_digest_hex,
          artifacts_json,bundle_content_digest_hex,schema_version,reconciliation_projection_v1)
        SELECT ${bundle.organizationId}::uuid,${bundle.accountId},${bundle.runId},l.cycle_sequence,${bundle.cycleId},
          ${bundle.stage},l.entry_id,${bundle.ledgerEntryContentDigestHex},${JSON.stringify(bundle.artifacts)}::jsonb,
          ${bundle.contentDigestHex},${bundle.schemaVersion},
          CASE WHEN ${value === null} THEN NULL ELSE jsonb_build_object('schemaVersion',1,
            'organizationId',l.organization_id::text,'accountId',l.account_id,'runId',l.run_id,'cycleSequence',l.cycle_sequence,
            'cycleId',l.cycle_id,'kind',${bundle.stage},'ledgerEntryId',l.entry_id,'ledgerDigest',l.content_digest_hex,
            'sourceSchema',${bundle.schemaVersion},'sourceDigest',${bundle.contentDigestHex},'value',${JSON.stringify(value)}::jsonb) END
        FROM trader_historical_simulation_reason_ledger_v2 l WHERE l.organization_id=${organizationId}::uuid
          AND l.account_id=${f.scope.accountId} AND l.run_id=${f.scope.runId} AND l.cycle_id=${bundle.cycleId}
          AND l.content_digest_hex=${bundle.ledgerEntryContentDigestHex} RETURNING stage`;
      expect(rows).toHaveLength(1);
    },
    async saveResumeCursor(cursor) {
      const snapshots = { KNOWLEDGE: cursor.knowledgeSnapshot, MODELED_EXECUTION_REGISTRY: cursor.modeledExecutionRegistrySnapshot,
        MODELED_EXCHANGE: cursor.modeledExchangeSnapshot, ACCOUNTING_FRONTIER: cursor.accountingFrontierSnapshot,
        GUARDIAN: cursor.guardianSnapshot, LEARNING: cursor.learningSnapshot };
      for (const [kind, snapshot] of Object.entries(snapshots)) {
        const value = omitProjection ? null : projectHistoricalReconciliationSourceValueV1(kind, snapshot.state);
        const rows = await tx`INSERT INTO trader_historical_simulation_durable_snapshot_v2
          (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,ledger_entry_content_digest_hex,
            state_json,snapshot_content_digest_hex,schema_version,reconciliation_projection_v1)
          SELECT ${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},l.cycle_sequence,${cursor.committedCycleId},
            ${kind},l.entry_id,${cursor.ledgerHeadContentDigestHex},${JSON.stringify(snapshot.state)}::jsonb,
            ${snapshot.contentDigestHex},${snapshot.schemaVersion},
            CASE WHEN ${value === null} THEN NULL ELSE jsonb_build_object('schemaVersion',1,
              'organizationId',l.organization_id::text,'accountId',l.account_id,'runId',l.run_id,'cycleSequence',l.cycle_sequence,
              'cycleId',l.cycle_id,'kind',${kind},'ledgerEntryId',l.entry_id,'ledgerDigest',l.content_digest_hex,
              'sourceSchema',${snapshot.schemaVersion},'sourceDigest',${snapshot.contentDigestHex},'value',${JSON.stringify(value)}::jsonb) END
          FROM trader_historical_simulation_reason_ledger_v2 l WHERE l.organization_id=${organizationId}::uuid
            AND l.account_id=${f.scope.accountId} AND l.run_id=${f.scope.runId} AND l.cycle_id=${cursor.committedCycleId}
            AND l.content_digest_hex=${cursor.ledgerHeadContentDigestHex} RETURNING state_kind`;
        expect(rows).toHaveLength(1);
      }
      // Only the explicit low-level wide-sibling control changes this source body.
      // It retains all selected identities; it is not a qualified owner request.
      const persistedRequest = checkpointMembershipSibling === undefined ? f.request : {
        ...f.request, datasetMembership: { ...f.request.datasetMembership, unrelatedFixtureSibling: checkpointMembershipSibling },
      };
      await tx`INSERT INTO trader_historical_simulation_resume_checkpoint_v2
        (organization_id,account_id,run_id,split,committed_cycle_sequence,committed_cycle_id,ledger_entry_id,ledger_head_content_digest_hex,
          next_record_index,next_cycle_sequence,dataset_authority_json,stage_digest_json,snapshot_digest_json,checkpoint_json,
          checkpoint_content_digest_hex,commit_request_digest_hex,commit_request_json,schema_version)
        SELECT ${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},${cursor.split},${cursor.nextCycleSequence - 1},
          ${cursor.committedCycleId},l.entry_id,${cursor.ledgerHeadContentDigestHex},${cursor.nextRecordIndex},${cursor.nextCycleSequence},
          ${JSON.stringify(cursor.datasetAuthority)}::jsonb,${JSON.stringify(cursor.cycleStageBundleDigestHexByStage)}::jsonb,
          ${JSON.stringify(Object.fromEntries(Object.entries(snapshots).map(([kind, snapshot]) => [kind, snapshot.contentDigestHex])))}::jsonb,
          ${JSON.stringify(cursor)}::jsonb,${cursor.contentDigestHex},${f.request.contentDigestHex},${JSON.stringify(persistedRequest)}::jsonb,${cursor.schemaVersion}
        FROM trader_historical_simulation_reason_ledger_v2 l WHERE l.organization_id=${organizationId}::uuid
          AND l.account_id=${f.scope.accountId} AND l.run_id=${f.scope.runId} AND l.cycle_id=${cursor.committedCycleId}`;
      for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) await tx`INSERT INTO trader_historical_simulation_resume_stage_link_v2
        VALUES (${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},${cursor.nextCycleSequence - 1},${stage},${cursor.cycleStageBundleDigestHexByStage[stage]})`;
      for (const [kind, snapshot] of Object.entries(snapshots)) await tx`INSERT INTO trader_historical_simulation_resume_snapshot_link_v2
        VALUES (${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},${cursor.nextCycleSequence - 1},${kind},${snapshot.contentDigestHex})`;
    },
  };
  const cursor = await commitHistoricalSimulationCycleAtomicallyV2({
    repository: { transaction: async fn => fn(fixtureTransaction) }, scope: f.scope, ledgerEntry: f.entry,
    stageBundles: f.bundles, knowledgeCheckpointSequence: 0, knowledgeCheckpointContentDigestHex: "b".repeat(64), ...f.snapshots });
  if (fault === "after-checkpoint") throw new Error("CONTROLLED_FAULT");
  const delta = advanceHistoricalReconciliationV1({ previous: f.genesis, cycleId: f.entry.cycleId,
    cycleSequence: 0, recordIndex: 0, membershipDigest: f.entry.datasetMembership.contentDigestHex,
    marketDigest: f.entry.datasetMembership.sealedCycleContentDigestHex, releaseSha: "9".repeat(40),
    steps: [projectHistoricalReconciliationAccountingV1(f.mark)], fills: [], economics: [], consumed: [] });
  const observations: ReturnType<typeof observeHistoricalReconciliationV1>[] = [];
  for (const phase of ["frontier_mutation", "before_guardian", "before_cycle_complete"] as const) {
    observations.push(observeHistoricalReconciliationV1({ delta, phase, state: f.mark,
      accounting: delta.accounting, activeParent: null, touchedParents: [], previousObservations: observations }));
  }
  const frontier = sealHistoricalReconciliationCycleV1({ delta, checkpointDigest: cursor.contentDigestHex,
    observations, activeParent: null, touchedParents: [] });
  await repository.append(frontier);
  if (fault === "after-companion") throw new Error("CONTROLLED_FAULT");
  return { cursor, frontier };
}
type ProjectedKind = "ACCOUNTING_FRONTIER" | "MODELED_EXCHANGE" | "ACCOUNTING" | "OBSERVED_EXECUTION_EFFECTS";
type ProjectedFixture = { source: unknown; candidate: Record<string, unknown> | null; sourceText?: string; candidateText?: string };
async function writeProjectedSource(tx: postgres.Sql, f: Input, kind: ProjectedKind,
  change?: (input: ProjectedFixture) => void | Promise<void>) {
  const held = await prepareHistoricalSimulationProductionPortsV2({ tx, request: f.request, scope: f.scope, createPorts: () => null });
  await held.transaction.appendLedger(f.entry);
  const snapshot = kind === "ACCOUNTING_FRONTIER" ? f.snapshots.accountingFrontierSnapshot :
    kind === "MODELED_EXCHANGE" ? f.snapshots.modeledExchangeSnapshot : null;
  const bundle = snapshot ? null : f.bundles[kind as "ACCOUNTING" | "OBSERVED_EXECUTION_EFFECTS"];
  const source = snapshot?.state ?? bundle!.artifacts;
  const schemaVersion = snapshot?.schemaVersion ?? bundle!.schemaVersion;
  const digest = snapshot?.contentDigestHex ?? bundle!.contentDigestHex;
  const data: ProjectedFixture = { source: structuredClone(source) as unknown, candidate: {
    schemaVersion: 1, organizationId, accountId: f.scope.accountId, runId: f.scope.runId, cycleSequence: 0,
    cycleId: f.entry.cycleId, kind, ledgerEntryId: f.entry.entryId, ledgerDigest: f.entry.contentDigestHex,
    sourceSchema: schemaVersion, sourceDigest: digest, value: projectHistoricalReconciliationSourceValueV1(kind, source),
  } as Record<string, unknown> | null };
  await change?.(data); // Fixture-only adversarial input; no production collaborator exists.
  if (snapshot) await tx`INSERT INTO trader_historical_simulation_durable_snapshot_v2
    (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,ledger_entry_content_digest_hex,
      state_json,snapshot_content_digest_hex,schema_version,reconciliation_projection_v1)
    VALUES (${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},0,${f.entry.cycleId},${kind},${f.entry.entryId},
      ${f.entry.contentDigestHex},${data.sourceText ?? JSON.stringify(data.source)}::jsonb,${digest},${schemaVersion},${data.candidate === null ? null : data.candidateText ?? JSON.stringify(data.candidate)}::jsonb)`;
  else await tx`INSERT INTO trader_historical_simulation_atomic_stage_v2
    (organization_id,account_id,run_id,cycle_sequence,cycle_id,stage,ledger_entry_id,ledger_entry_content_digest_hex,
      artifacts_json,bundle_content_digest_hex,schema_version,reconciliation_projection_v1)
    VALUES (${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},0,${f.entry.cycleId},${kind},${f.entry.entryId},
      ${f.entry.contentDigestHex},${data.sourceText ?? JSON.stringify(data.source)}::jsonb,${digest},${schemaVersion},${data.candidate === null ? null : data.candidateText ?? JSON.stringify(data.candidate)}::jsonb)`;
}

/** These parents must genuinely predate0222. The coordinated migration runner
 * seeds them with the original222 migrations/guards intact; this suite never
 * removes a latch or disables a trigger to emulate historical compatibility. */
type RetainedParent = Readonly<{ entry_id: string; account_id: string; run_id: string;
  cycle_id: string; content_digest_hex: string }>;
async function insertRetainedParentTarget(tx: postgres.Sql, parent: RetainedParent,
  target: "stage" | "snapshot" | "checkpoint") {
  if (target === "stage") {
    await tx`INSERT INTO trader_historical_simulation_atomic_stage_v2
      (organization_id,account_id,run_id,cycle_sequence,cycle_id,stage,ledger_entry_id,
        ledger_entry_content_digest_hex,artifacts_json,bundle_content_digest_hex,schema_version)
      VALUES (${organizationId}::uuid,${parent.account_id},${parent.run_id},0,${parent.cycle_id},'GUARDIAN',
        ${parent.entry_id},${parent.content_digest_hex},${JSON.stringify([{ artifactKind: "GUARDIAN_ASSESSMENT",
          artifactId: `${parent.cycle_id}:guard`, contentDigestHex: D }])}::jsonb,${D},
        'waia.trader.historical_simulation_atomic_stage_bundle.v2')`;
  } else if (target === "snapshot") {
    await tx`INSERT INTO trader_historical_simulation_durable_snapshot_v2
      (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,
        ledger_entry_content_digest_hex,state_json,snapshot_content_digest_hex,schema_version)
      VALUES (${organizationId}::uuid,${parent.account_id},${parent.run_id},0,${parent.cycle_id},'GUARDIAN',
        ${parent.entry_id},${parent.content_digest_hex},'{"posture":"NONE"}'::jsonb,${D},
        'waia.trader.historical_simulation_durable_state_snapshot.v2')`;
  } else {
    const request = { schemaVersion: "waia.trader.historical_simulation_commit_request.v2",
      contentDigestHex: D, organizationId, accountId: parent.account_id, runId: parent.run_id,
      cycleSequence: 0, cycleId: parent.cycle_id };
    await tx`INSERT INTO trader_historical_simulation_resume_checkpoint_v2
      (organization_id,account_id,run_id,split,committed_cycle_sequence,committed_cycle_id,
        ledger_entry_id,ledger_head_content_digest_hex,next_record_index,next_cycle_sequence,
        dataset_authority_json,stage_digest_json,snapshot_digest_json,checkpoint_json,
        checkpoint_content_digest_hex,commit_request_digest_hex,commit_request_json,schema_version)
      VALUES (${organizationId}::uuid,${parent.account_id},${parent.run_id},'DEVELOPMENT',0,${parent.cycle_id},
        ${parent.entry_id},${parent.content_digest_hex},1,1,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,
        ${D},${D},${JSON.stringify(request)}::jsonb,'waia.trader.historical_simulation_resume_cursor.v2')`;
  }
}

async function counts(sql: postgres.Sql, f: Input) {
  const rows = await sql`SELECT
    (SELECT count(*)::int FROM trader_historical_reconciliation_scope_mode_v1 WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId}) modes,
    (SELECT count(*)::int FROM trader_historical_reconciliation_frontier_v1 WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId}) companions,
    (SELECT count(*)::int FROM trader_accounting_frontier WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId}) accounting,
    (SELECT count(*)::int FROM trader_historical_simulation_resume_checkpoint_v2 WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId}) checkpoints`;
  return rows[0];
}
function next(f: Input) { return advanceAccountingFrontier({ state: f.mark, frontierId: randomUUID(),
  marks: { BTCUSDT: { price: "100", barCloseTime: "2023-11-14T22:14:20.000Z" } }, frontierAsOf: "2023-11-14T22:14:20.000Z" }); }
async function reason(work: Promise<unknown>) {
  try { await work; return "UNEXPECTED_SUCCESS"; } catch (error) {
    const result: string[] = []; let current: unknown = error;
    for (let i = 0; i < 8 && current instanceof Error; i++) {
      result.push(`${(current as Error & { code?: string }).code ?? ""}:${current.message}`); current = current.cause;
    }
    return result.join("|");
  }
}
async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`TEST_BARRIER_TIMEOUT:${label}`)), 10_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

describe.skipIf(!enabled)("bounded historical native reconciliation and legacy privilege", () => {
  let sql: postgres.Sql;
  let roleCreated = false;
  const role = `dee1130_generic_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const originalSourceTables = ["trader_accounting_frontier", "trader_historical_simulation_reason_ledger_v2",
    "trader_historical_simulation_atomic_stage_v2", "trader_historical_simulation_durable_snapshot_v2",
    "trader_historical_simulation_resume_checkpoint_v2", "trader_historical_simulation_resume_stage_link_v2",
    "trader_historical_simulation_resume_snapshot_link_v2"] as const;
  beforeAll(async () => {
    assertTestDatabase();
    sql = postgres(url!, { max: 6 });
    await sql`INSERT INTO auth.users(id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO users(id,identity_label,email) VALUES (${userId}::uuid,'DEE1130 fixture','dee1130@invalid.local') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO organizations(id,owner_user_id,kind,name) VALUES (${organizationId}::uuid,${userId}::uuid,'personal','DEE1130 fixture') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000002225'::uuid) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO users(id,identity_label,email)
      VALUES ('00000000-0000-4000-8000-000000002225'::uuid,'DEE1130 denied fixture','dee1130-denied@invalid.local') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO organizations(id,owner_user_id,kind,name)
      VALUES ('00000000-0000-4000-8000-000000002224'::uuid,'00000000-0000-4000-8000-000000002225'::uuid,'personal','DEE1130 denied fixture') ON CONFLICT DO NOTHING`;
    await sql.unsafe(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
    roleCreated = true;
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    for (const table of originalSourceTables) {
      // Disposable role receives only the original source capabilities. No mode/frontier/EXECUTE grant.
      await sql.unsafe(`GRANT SELECT, INSERT ON TABLE public.${table} TO ${role}`);
      await sql.unsafe(`CREATE POLICY ${role} ON public.${table} FOR ALL TO ${role}
        USING (organization_id='${organizationId}'::uuid) WITH CHECK (organization_id='${organizationId}'::uuid)`);
    }
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      if (roleCreated) {
        for (const table of originalSourceTables) {
          await sql.unsafe(`DROP POLICY IF EXISTS ${role} ON public.${table}`);
          await sql.unsafe(`REVOKE ALL ON TABLE public.${table} FROM ${role}`);
        }
        await sql.unsafe(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
        await sql.unsafe(`DROP ROLE ${role}`);
      }
    } finally { await sql.end({ timeout: 5 }); }
  });
  it("commits the real held0188 graph and three-phase companion, then reloads exact immutable bytes", async () => {
    const f = input();
    const result = await sql.begin("isolation level serializable", tx => profile(sql, tx as unknown as postgres.Sql, f));
    expect(await counts(sql, f)).toEqual({ modes: 1, companions: 2, accounting: 2, checkpoints: 1 });
    const saved = await createHistoricalReconciliationRepositoryV1(sql, f.scope).loadFrontier(0);
    expect(saved).toEqual(result.frontier);
    const row = await sql`SELECT writer_xid FROM trader_historical_reconciliation_frontier_v1 WHERE id=${saved.id}::uuid`;
    expect(row[0]!.writer_xid).toMatch(/^\d+$/);
  });
  it("uses fixed checkpoint leaf reads with a wide unrelated membership sibling", async () => {
    const [installed] = await sql`SELECT pg_get_functiondef('public.waia_historical_reconciliation_verify_v1()'::regprocedure) AS body`;
    expect(installed!.body).not.toMatch(/commit_request_json\s*->\s*'datasetMembership'/);
    expect(installed!.body.match(/commit_request_json\s*#>>\s*'\{datasetMembership,sealedCycleContentDigestHex\}'/g)).toHaveLength(2);
    const f = input();
    // Guarded lower-level0188 source fixture, not a valid qualified/public-owner
    // request or an execution/resource measurement. The nested sibling exceeds
    // the new body's cap but is outside the selected checkpoint header.
    const result = await sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f,
      undefined, false, "ø".repeat(1048576)));
    expect((await createHistoricalReconciliationRepositoryV1(sql, f.scope).loadFrontier(0))).toEqual(result.frontier);
    const [saved] = await sql`SELECT
      octet_length(commit_request_json#>>'{datasetMembership,unrelatedFixtureSibling}') AS sibling_bytes,
      commit_request_json#>>'{datasetMembership,sealedCycleContentDigestHex}' AS selected,
      commit_request_digest_hex AS digest
      FROM trader_historical_simulation_resume_checkpoint_v2
      WHERE organization_id=${organizationId}::uuid AND account_id=${f.scope.accountId} AND run_id=${f.scope.runId}`;
    expect(saved).toEqual({ sibling_bytes: 2097152,
      selected: f.entry.datasetMembership.sealedCycleContentDigestHex, digest: f.request.contentDigestHex });
    expect(await counts(sql, f)).toEqual({ modes: 1, companions: 2, accounting: 2, checkpoints: 1 });
  });
  it.each(["after-mode", "after-genesis", "after-mark", "after-checkpoint", "after-companion"] as const)(
    "rolls back every new source/mode/companion after controlled %s fault", async fault => {
      const f = input();
      await expect(sql.begin("isolation level serializable", tx => profile(sql, tx as unknown as postgres.Sql, f, fault))).rejects.toThrow("CONTROLLED_FAULT");
      expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 0, checkpoints: 0 });
    });
  it("preserves already committed mode-neutral inception through each later cycle fault", async () => {
    for (const fault of ["after-mode", "after-genesis", "after-mark", "after-checkpoint", "after-companion"] as const) {
      const f = input(); await appendAccounting(sql, sql, f.inception);
      await expect(sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f, fault))).rejects.toThrow("CONTROLLED_FAULT");
      expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 1, checkpoints: 0 });
    }
  });
  it("rejects mode-only commit and forced-immediate incomplete registration", async () => {
    for (const immediate of [false, true]) {
      const f = input();
      await expect(sql.begin(async tx => {
        await appendAccounting(sql, tx as unknown as postgres.Sql, f.inception);
        await mode(tx as unknown as postgres.Sql, f);
        if (immediate) await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      })).rejects.toThrow(/CURRENT_TRANSACTION_CLOSURE|foreign key/);
      expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 0, checkpoints: 0 });
    }
  });
  it("preserves generic nonhistorical Accounting with no feature grants or direct helper capability", async () => {
    const f = input();
    await sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      const rights = await tx`SELECT has_table_privilege(current_user,'public.trader_historical_reconciliation_scope_mode_v1','SELECT') modes,
        has_table_privilege(current_user,'public.trader_historical_reconciliation_frontier_v1','INSERT') frontier,
        has_function_privilege(current_user,'public.waia_historical_reconciliation_verify_v1()','EXECUTE') verifier`;
      expect(rights[0]).toEqual({ modes: false, frontier: false, verifier: false });
      await appendAccounting(sql, tx as unknown as postgres.Sql, f.inception);
      expect(await appendAccounting(sql, tx as unknown as postgres.Sql, f.mark)).toEqual(f.mark);
      expect(await appendAccounting(sql, tx as unknown as postgres.Sql, f.mark)).toEqual(f.mark);
      await appendAccounting(sql, tx as unknown as postgres.Sql, next(f));
    });
    expect(await counts(sql, f)).toEqual({ modes: 1, companions: 0, accounting: 3, checkpoints: 0 });
    expect((await sql`SELECT mode FROM trader_historical_reconciliation_scope_mode_v1 WHERE run_id=${f.scope.runId}`)[0]!.mode).toBe("LEGACY");
  });
  it.each(["read committed", "repeatable read", "serializable"])(
    "keeps all three AFTER paths usable under restricted LEGACY %s and immediate constraints", async isolation => {
      for (const rollback of [false, true]) {
        const f = input();
        const work = sql.begin(`isolation level ${isolation}`, async tx => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`); await tx`SET CONSTRAINTS ALL IMMEDIATE`;
          await appendAccounting(sql, tx as unknown as postgres.Sql, f.inception);
          await appendAccounting(sql, tx as unknown as postgres.Sql, f.mark);
          const held = await prepareHistoricalSimulationProductionPortsV2({ tx: tx as unknown as postgres.Sql,
            request: f.request, scope: f.scope, createPorts: () => null });
          await commitHistoricalSimulationCycleAtomicallyV2({ repository: { transaction: async fn => fn(held.transaction) },
            scope: f.scope, ledgerEntry: f.entry, stageBundles: f.bundles,
            knowledgeCheckpointSequence: 0, knowledgeCheckpointContentDigestHex: "b".repeat(64), ...f.snapshots });
          const rows = await tx`SELECT count(*)::int n FROM trader_historical_simulation_durable_snapshot_v2
            WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId} AND reconciliation_projection_v1 IS NULL`;
          expect(rows[0]!.n).toBe(6);
          if (rollback) throw new Error("CONTROLLED_AFTER_ALL_THREE");
        });
        if (rollback) await expect(work).rejects.toThrow("CONTROLLED_AFTER_ALL_THREE"); else await work;
        expect(await counts(sql, f)).toEqual(rollback ? { modes: 0, companions: 0, accounting: 0, checkpoints: 0 }
          : { modes: 1, companions: 0, accounting: 2, checkpoints: 1 });
      }
    });
  for (const target of ["stage", "snapshot", "checkpoint"] as const) {
    for (const [short, isolation] of [["rc", "read committed"], ["rr", "repeatable read"], ["ssi", "serializable"]] as const) {
      it(`retained pre0222 ${target}: first LEGACY registration and rollback under ${short}`, async () => {
        for (const action of ["commit", "rollback"] as const) {
          const runId = `dee1130-pre222-${target}-${short}-${action}`;
          const parents = await sql<RetainedParent[]>`SELECT entry_id,account_id,run_id,cycle_id,content_digest_hex
            FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${organizationId}::uuid
              AND account_id=${`account:${runId}`} AND run_id=${runId} AND cycle_sequence=0`;
          expect(parents, "MIGRATION_BOUNDARY_FIXTURE_REQUIRED: seed before0222, never emulate after it").toHaveLength(1);
          const parent = parents[0]!;
          const modes = () => sql`SELECT mode FROM trader_historical_reconciliation_scope_mode_v1
            WHERE organization_id=${organizationId}::uuid AND account_id=${parent.account_id} AND run_id=${runId}`;
          expect(await modes()).toEqual([]);
          const work = sql.begin(`isolation level ${isolation}`, async tx => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`); await tx`SET CONSTRAINTS ALL IMMEDIATE`;
            await insertRetainedParentTarget(tx as unknown as postgres.Sql, parent, target);
            if (action === "rollback") throw new Error("CONTROLLED_RETAINED_PARENT_ROLLBACK");
          });
          if (action === "rollback") await expect(work).rejects.toThrow("CONTROLLED_RETAINED_PARENT_ROLLBACK");
          else await work;
          expect(await modes()).toEqual(action === "rollback" ? [] : [{ mode: "LEGACY" }]);
          expect(await sql<RetainedParent[]>`SELECT entry_id,account_id,run_id,cycle_id,content_digest_hex
            FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${organizationId}::uuid
              AND account_id=${parent.account_id} AND run_id=${runId} AND cycle_sequence=0`).toEqual(parents);
        }
      });
      it(`retained pre0222 ${target}: competing PROFILE refuses old prefix under ${short}`, async () => {
        const runId = `dee1130-pre222-${target}-${short}-profile_race`;
        const parents = await sql<RetainedParent[]>`SELECT entry_id,account_id,run_id,cycle_id,content_digest_hex
          FROM trader_historical_simulation_reason_ledger_v2 WHERE organization_id=${organizationId}::uuid
            AND account_id=${`account:${runId}`} AND run_id=${runId} AND cycle_sequence=0`;
        expect(parents, "MIGRATION_BOUNDARY_FIXTURE_REQUIRED").toHaveLength(1);
        const parent = parents[0]!;
        expect(await sql`SELECT mode FROM trader_historical_reconciliation_scope_mode_v1
          WHERE organization_id=${organizationId}::uuid AND account_id=${parent.account_id} AND run_id=${runId}`).toEqual([]);
        let signal!: () => void; const inserted = new Promise<void>(resolve => { signal = resolve; });
        let release!: () => void; const finish = new Promise<void>(resolve => { release = resolve; });
        const writer = sql.begin(`isolation level ${isolation}`, async tx => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`); await tx`SET CONSTRAINTS ALL IMMEDIATE`;
          await insertRetainedParentTarget(tx as unknown as postgres.Sql, parent, target);
          signal(); await finish;
        });
        try {
          await bounded(Promise.race([inserted, writer.then(() => { throw new Error("EARLY_RETAINED_WRITER"); })]), "retained-parent-insert");
          // Old source already exists independently of the uncommitted LEGACY latch.
          // A PROFILE failure here is a prefix refusal, not proof of a lock wait.
          expect(await reason(sql.begin(`isolation level ${isolation}`, async tx => {
            await tx`INSERT INTO trader_historical_reconciliation_scope_mode_v1
              (organization_id,account_id,run_id,mode,profile,partition,symbol,genesis_id)
              VALUES (${organizationId}::uuid,${parent.account_id},${runId},'PROFILE',
                ${HISTORICAL_RECONCILIATION_PROFILE_V1},'DEVELOPMENT','BTCUSDT',${randomUUID()}::uuid)`;
          }))).toContain("LEGACY_PREFIX_UNSUPPORTED");
        } finally { release(); await bounded(writer, "retained-parent-commit"); }
        expect(await sql`SELECT mode FROM trader_historical_reconciliation_scope_mode_v1
          WHERE organization_id=${organizationId}::uuid AND account_id=${parent.account_id} AND run_id=${runId}`).toEqual([{ mode: "LEGACY" }]);
      });
    }
  }
  it("requires the current transaction's companion for a generic direct write to enrolled scope", async () => {
    const f = input(); await sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f));
    const before = await counts(sql, f);
    const error = await reason(sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await appendAccounting(sql, tx as unknown as postgres.Sql, next(f));
    }));
    expect(error).toContain("CURRENT_TRANSACTION_CLOSURE");
    expect(await counts(sql, f)).toEqual(before);
  });
  it("cannot reuse a validated current companion for an uncovered write after SET CONSTRAINTS", async () => {
    const f = input();
    const error = await reason(sql.begin(async tx => {
      await profile(sql, tx as unknown as postgres.Sql, f);
      await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      await appendAccounting(sql, tx as unknown as postgres.Sql, next(f));
    }));
    expect(error).toContain("UNCOVERED_ACCOUNTING");
    expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 0, checkpoints: 0 });
  });
  it.each(["read committed", "repeatable read", "serializable"])("closes a real old %s snapshot after enrollment commits", async isolation => {
    const f = input(); await appendAccounting(sql, sql, f.inception);
    let ready!: () => void; const snapshot = new Promise<void>(resolve => { ready = resolve; });
    let resume!: () => void; const continueWriter = new Promise<void>(resolve => { resume = resolve; });
    const writer = reason(sql.begin(`isolation level ${isolation}`, async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx`SELECT id FROM trader_accounting_frontier WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId}`;
      ready(); await continueWriter;
      await appendAccounting(sql, tx as unknown as postgres.Sql, next(f));
    }));
    try {
      await bounded(Promise.race([snapshot, writer.then(error => { throw new Error(`EARLY_WRITER:${error}`); })]), "old-snapshot");
      await sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f));
    } finally { resume(); }
    expect(await bounded(writer, "writer-refusal")).toMatch(/40001|MODE_WINNER_NOT_VISIBLE|CURRENT_TRANSACTION_CLOSURE/);
    expect(await counts(sql, f)).toEqual({ modes: 1, companions: 2, accounting: 2, checkpoints: 1 });
  });
  it("refuses enrollment after a legitimate legacy first write and across another split", async () => {
    const f = input(); await appendAccounting(sql, sql, f.inception); await appendAccounting(sql, sql, f.mark);
    const original = await counts(sql, f);
    await expect(sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f))).rejects.toThrow(/LEGACY_PREFIX_UNSUPPORTED/);
    await expect(sql`INSERT INTO trader_historical_reconciliation_scope_mode_v1
      (organization_id,account_id,run_id,mode,profile,partition,symbol,genesis_id)
      VALUES (${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},'PROFILE',${HISTORICAL_RECONCILIATION_PROFILE_V1},
        'WALK_FORWARD','BTCUSDT',${f.genesis.id}::uuid)`).rejects.toThrow(/LEGACY_PREFIX_UNSUPPORTED/);
    expect(await counts(sql, f)).toEqual(original);
  });
  it("does not leak automatic LEGACY bookkeeping through a caught source-statement failure", async () => {
    const f = input(); await appendAccounting(sql, sql, f.inception);
    await sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await expect(tx.savepoint(async save => {
        await appendAccounting(sql, save as unknown as postgres.Sql, { ...f.mark, sourceFillId: randomUUID() });
      })).rejects.toThrow(/foreign key/);
      const rows = await tx`SELECT id FROM trader_accounting_frontier WHERE organization_id=${organizationId}::uuid AND run_id=${f.scope.runId}`;
      expect(rows).toHaveLength(1);
    });
    expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 1, checkpoints: 0 });
  });
  it("installs nullable ordinary projections and exactly three ordinary AFTER mode hooks", async () => {
    const columns = await sql`SELECT c.relname,a.attname,a.attnotnull,a.attgenerated,a.atthasdef,a.atthasmissing
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND a.attname='reconciliation_projection_v1' ORDER BY c.relname`;
    expect(columns).toHaveLength(2);
    for (const row of columns) expect(row).toMatchObject({ attnotnull: false, attgenerated: "", atthasdef: false, atthasmissing: false });
    const constraints = await sql`SELECT conname,convalidated FROM pg_constraint
      WHERE conname IN ('historical_reconciliation_atomic_stage_projection_v1','historical_reconciliation_durable_snapshot_projection_v1') ORDER BY conname`;
    expect(constraints).toHaveLength(2);
    expect(constraints.every(row => row.convalidated === false)).toBe(true);
    const hooks = await sql`SELECT c.relname,t.tgname,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgoldtable,t.tgnewtable
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN (
        'trader_historical_simulation_atomic_stage_v2','trader_historical_simulation_durable_snapshot_v2',
        'trader_historical_simulation_resume_checkpoint_v2') ORDER BY c.relname,t.tgname`;
    for (const table of ["trader_historical_simulation_atomic_stage_v2", "trader_historical_simulation_durable_snapshot_v2", "trader_historical_simulation_resume_checkpoint_v2"]) {
      const relevant = hooks.filter(row => row.relname === table);
      expect(relevant.filter(row => (row.tgtype & 4) !== 0 && (row.tgtype & 2) !== 0)).toEqual([]);
      const legacy = relevant.find(row => row.tgname === "aa_historical_reconciliation_mode")!;
      expect(legacy).toMatchObject({ tgtype: 5, tgdeferrable: false, tginitdeferred: false, tgoldtable: null, tgnewtable: null });
      expect(relevant.findIndex(row => row.tgname === legacy.tgname)).toBeLessThan(relevant.findIndex(row => row.tgname === "historical_reconciliation_closure"));
    }
  });
  for (const kind of ["ACCOUNTING_FRONTIER", "MODELED_EXCHANGE", "ACCOUNTING", "OBSERVED_EXECUTION_EFFECTS"] as const) {
    it(`${kind}: independently accepts its exact candidate; NULL keeps legitimate LEGACY behavior`, async () => {
      for (const omit of [false, true]) await sql.begin(async tx => {
        await tx`SET CONSTRAINTS ALL IMMEDIATE`;
        await writeProjectedSource(tx as unknown as postgres.Sql, input(), kind, data => { if (omit) data.candidate = null; });
      });
    });
    for (const field of ["schemaVersion", "accountId", "cycleId", "ledgerEntryId", "sourceDigest", "value"] as const) {
      it(`${kind}: refuses forged or UNKNOWN ${field} before commit`, async () => {
        for (const omit of [false, true]) await expect(sql.begin(tx => writeProjectedSource(tx as unknown as postgres.Sql, input(), kind, data => {
          if (omit) delete data.candidate![field]; else data.candidate![field] = field === "value" ? null : "wrong";
        }))).rejects.toThrow(/historical_reconciliation_(atomic_stage|durable_snapshot)_projection_v1/);
      });
    }
  }
  it("PROFILE refuses omitted source projections without committed effects", async () => {
    const f = input();
    await expect(sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f, undefined, true)))
      .rejects.toThrow("SOURCE_PROJECTION_REQUIRED");
    expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 0, checkpoints: 0 });
  });
  it("enforces native14B aggregate and1MiB body boundaries using actual UTF-8 server bytes", async () => {
    for (const bytes of [594505, 594506, 1048576, 1048577]) {
      const run = sql.begin(async tx => {
        await writeProjectedSource(tx as unknown as postgres.Sql, input(), "ACCOUNTING", async data => {
          const artifact = (data.source as Array<Record<string, unknown>>)[0]!;
          const value = data.candidate!.value as { artifact: Record<string, unknown> };
          artifact.artifactId = ""; value.artifact.artifactId = "";
          const [base] = await tx`SELECT octet_length(${JSON.stringify(data.candidate)}::jsonb::text)::int AS bytes`;
          const missing = bytes - base!.bytes;
          const text = "ø".repeat(Math.floor(missing / 2)) + (missing % 2 ? "x" : "");
          artifact.artifactId = text; value.artifact.artifactId = text;
          const [measured] = await tx`SELECT octet_length(${JSON.stringify(data.candidate)}::jsonb::text)::int AS bytes`;
          expect(measured!.bytes).toBe(bytes);
        });
      });
      if (bytes === 594505) await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toThrow("historical_reconciliation_atomic_stage_projection_v1");
    }
  });
  for (const kind of ["ACCOUNTING_FRONTIER", "ACCOUNTING"] as const) {
    it(`${kind}: rejects equal numeric values with unequal source/candidate representations`, async () => {
      for (const [sourceNumber, candidateNumber] of [["1", "1.0000"], ["1.0000", "1"],
        ["0", "0.0000"], ["0.0000", "0"], ["1." + "0".repeat(4000), "1"], ["1", "1." + "0".repeat(4000)]]) {
        const semantic = await sql`SELECT ${sourceNumber}::jsonb=${candidateNumber}::jsonb AS same,
          octet_length(${sourceNumber}::jsonb::text)<>octet_length(${candidateNumber}::jsonb::text) AS different_bytes`;
        expect(semantic[0]).toEqual({ same: true, different_bytes: true });
        await expect(sql.begin(tx => writeProjectedSource(tx as unknown as postgres.Sql, input(), kind, data => {
          // Deliberately low-level projection controls, not canonical financial snapshots.
          // Raw JSON is test-only so numeric scale survives JavaScript serialization.
          const marker = "DEE1130_NUMERIC_LEAF";
          const value = data.candidate!.value as Record<string, Record<string, unknown>>;
          if (kind === "ACCOUNTING_FRONTIER") {
            (data.source as Record<string, unknown>).cash = marker; value.accounting!.cash = marker;
          } else {
            (data.source as Array<Record<string, unknown>>)[0]!.artifactId = marker;
            value.artifact!.artifactId = marker;
          }
          data.sourceText = JSON.stringify(data.source).replace(JSON.stringify(marker), sourceNumber);
          data.candidateText = JSON.stringify(data.candidate).replace(JSON.stringify(marker), candidateNumber);
        }))).rejects.toThrow(/historical_reconciliation_(atomic_stage|durable_snapshot)_projection_v1/);
      }
    });
    it(`${kind}: retains exact numeric representation positives, including scaled zero`, async () => {
      for (const number of ["1", "1.0000", "0", "0.0000"]) {
        await sql.begin(tx => writeProjectedSource(tx as unknown as postgres.Sql, input(), kind, data => {
          const marker = "DEE1130_NUMERIC_LEAF";
          const value = data.candidate!.value as Record<string, Record<string, unknown>>;
          if (kind === "ACCOUNTING_FRONTIER") {
            (data.source as Record<string, unknown>).cash = marker; value.accounting!.cash = marker;
          } else {
            (data.source as Array<Record<string, unknown>>)[0]!.artifactId = marker;
            value.artifact!.artifactId = marker;
          }
          data.sourceText = JSON.stringify(data.source).replace(JSON.stringify(marker), number);
          data.candidateText = JSON.stringify(data.candidate).replace(JSON.stringify(marker), number);
        }));
      }
    });
  }
  it("installs each corrected CHECK with one expected header, two C-text outputs and exact caps", async () => {
    const rows = await sql`SELECT conname,pg_get_constraintdef(oid,true) AS body FROM pg_constraint
      WHERE conname IN ('historical_reconciliation_atomic_stage_projection_v1','historical_reconciliation_durable_snapshot_projection_v1')
      ORDER BY conname`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const body = row.body as string;
      expect(body.match(/COLLATE (?:pg_catalog\.)?"C"/g)).toHaveLength(2);
      // Only the one independently built header contains this literal key.
      expect(body.match(/'sourceSchema'/g)).toHaveLength(1);
      expect(body).toMatch(/14[^*]*\*[^)]*octet_length/);
      expect(body).toContain("1048576"); expect(body).toContain("65536"); expect(body).toContain("8388608");
      expect(body).toMatch(/IS TRUE/); expect(body).toMatch(/reconciliation_projection_v1 IS NULL/);
    }
  });
  it("snapshot CHECK catches consumed-ID count/tail drift without trusting the candidate", async () => {
    for (const change of ["count", "tail", "symbol"]) await expect(sql.begin(tx => writeProjectedSource(tx as unknown as postgres.Sql,
      input(), "ACCOUNTING_FRONTIER", data => {
        const state = data.source as AccountingFrontierV1;
        if (change === "count") state.consumedFillIds = [randomUUID()];
        else if (change === "tail") state.consumedFillIds = [randomUUID(), randomUUID()];
        else state.positions.OTHER = { quantity: "0", grossPositionBasis: "0", netPositionBasis: "0" };
      }))).rejects.toThrow("historical_reconciliation_durable_snapshot_projection_v1");
  });
  it("installs every independent recursive charge before its exact canonical invocation", async () => {
    const rows = await sql`SELECT proname,prosrc FROM pg_proc
      WHERE oid IN ('public.waia_historical_reconciliation_stamp_v1()'::regprocedure,
        'public.waia_historical_reconciliation_verify_v1()'::regprocedure) ORDER BY proname`;
    expect(rows).toHaveLength(2);
    const definitions = rows.map(r => String(r.prosrc)).join("\n");
    const depths = [5, 5, 2, 5, 5, 5, 5, 5, 4, 1, 1, 1, 2];
    expect(definitions.match(/public\.waia_canonical_jsonb_v1\(/g)).toHaveLength(13);
    for (const [i, depth] of depths.entries()) {
      const label = `C${String(i + 1).padStart(2, "0")}`;
      const block = definitions.split(`-- CANONICAL-CALL ${label}:`)[1]?.split(`-- END CANONICAL-CALL ${label}`)[0];
      expect(block).toBeDefined();
      expect(block!.match(/canonical_argument :=/g)).toHaveLength(1);
      const tokens = ["canonical_argument :=", "canonical_argument IS NULL", "octet_length(canonical_argument::text)",
        "canonical_argument_bytes>1048576", `strict $.**{${depth + 1}}`,
        `(20::bigint*(${depth}+1)+8)*canonical_argument_bytes`, "total_bytes>8388608",
        "public.waia_canonical_jsonb_v1(canonical_argument)"];
      const offsets = tokens.map(t => block!.indexOf(t));
      expect(offsets.every(n => n >= 0)).toBe(true); expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
    for (const row of rows) {
      const body = String(row.prosrc);
      expect(body).toContain("16::bigint*guard_bytes");
      expect(body.indexOf("CANONICAL_BODY_CARDINALITY")).toBeLessThan(body.indexOf("-- CANONICAL-CALL"));
    }
    // Pin the old helper body to its original immutable migration, never replace it.
    const old = readFileSync("db/migrations_postgres/0161_trader_mi_canonical_pit_lineage_v1.sql", "utf8");
    const declared = old.match(/CREATE OR REPLACE FUNCTION public\.waia_canonical_jsonb_v1\(value jsonb\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/)?.[1];
    const [canonical] = await sql`SELECT prosrc FROM pg_proc WHERE oid='public.waia_canonical_jsonb_v1(jsonb)'::regprocedure`;
    expect(declared).toBeDefined(); expect(String(canonical!.prosrc).trim()).toBe(declared!.trim());
  });
  it.each(["sql-null", "json-null", "array-root", "unknown-key", "missing-key", "null-steps", "steps-limit",
    "observations-limit", "parents-limit", "null-parent", "reference-limit", "null-reference", "depth-six", "deep-empty-object", "deep-empty-array"])(
    "refuses %s before any recursive canonical call", async kind => {
      const f = input(); let body: Record<string, unknown> = { ...f.genesis };
      let reasonCode = "CANONICAL_BODY_SHAPE";
      if (kind === "unknown-key") { body.extra = "unadmitted"; reasonCode = "CANONICAL_BODY_KEYS"; }
      if (kind === "missing-key") { delete body.modelDigest; reasonCode = "CANONICAL_BODY_KEYS"; }
      if (kind === "null-steps") body.steps = null;
      if (kind === "steps-limit") { body.steps = [{}, {}, {}]; reasonCode = "CANONICAL_BODY_CARDINALITY"; }
      if (kind === "observations-limit") { body.observations = [{}, {}, {}, {}]; reasonCode = "CANONICAL_BODY_CARDINALITY"; }
      if (kind === "parents-limit") { body.touchedParentsAfter = [{}, {}, {}]; reasonCode = "CANONICAL_BODY_CARDINALITY"; }
      if (kind === "null-parent") body.touchedParentsAfter = [null];
      if (kind === "reference-limit") { body.touchedParentsAfter = [{ fillReferences: [{}, {}, {}, {}] }]; reasonCode = "CANONICAL_BODY_CARDINALITY"; }
      if (kind === "null-reference") body.touchedParentsAfter = [{ fillReferences: [null] }];
      if (["depth-six", "deep-empty-object", "deep-empty-array"].includes(kind)) {
        body = accountingNestedBody(f, 6, kind === "depth-six" ? "leaf" : kind === "deep-empty-object" ? {} : []);
        reasonCode = "CANONICAL_BODY_DEPTH";
      }
      const sealed = resealedRawBody(body);
      let text: string | null = canonicalizeSemanticJsonString(sealed);
      if (kind === "sql-null") { text = null; reasonCode = "RESOURCE_ENVELOPE"; }
      if (kind === "json-null") text = "null";
      if (kind === "array-root") text = "[]";
      await sql.begin(async held => {
        const tx = held as unknown as postgres.Sql;
        await tx`SET LOCAL track_functions='all'`;
        const before = await canonicalCalls(tx);
        await expect(held.savepoint(inner => insertRawCompanion(inner as unknown as postgres.Sql, f, text,
          sealed.id, sealed.contentDigest))).rejects.toThrow(reasonCode);
        expect(await canonicalCalls(tx)).toBe(before);
        // Prove this same-session counter observes a real completed recursive call.
        // The ordinary canonical-text refusal occurs after C01; no row commits.
        await expect(held.savepoint(inner => insertRawCompanion(inner as unknown as postgres.Sql, f,
          canonicalizeSemanticJsonString(f.genesis) + " "))).rejects.toThrow("CANONICAL_TEXT");
        expect(await canonicalCalls(tx)).toBeGreaterThan(before);
      });
    });
  it("confirms literal JSONPath depth boundaries, including empty prohibited containers", async () => {
    const f = input();
    for (const leaf of ["leaf", {}, []]) {
      for (const depth of [5, 6]) {
        const body = accountingNestedBody(f, depth, leaf);
        const [row] = await sql`SELECT pg_catalog.jsonb_path_exists(${JSON.stringify(body)}::jsonb,
          'strict $.**{6}'::jsonpath,'{}'::jsonb,false) AS too_deep`;
        expect(row!.too_deep).toBe(depth === 6);
      }
    }
    await sql.begin(async held => {
      const tx = held as unknown as postgres.Sql; await tx`SET LOCAL track_functions='all'`;
      const body = accountingNestedBody(f, 5, "leaf"); const before = await canonicalCalls(tx);
      await expect(held.savepoint(inner => insertRawCompanion(inner as unknown as postgres.Sql, f,
        canonicalizeSemanticJsonString(body) + " ", body.id, body.contentDigest))).rejects.toThrow("CANONICAL_TEXT");
      expect(await canonicalCalls(tx)).toBeGreaterThan(before);
    });
  });
  it("keeps JSON-looking physical event payload text scalar and economics at depth two", async () => {
    const [column] = await sql`SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute
      WHERE attrelid='public.trader_order_events'::regclass AND attname='payload' AND NOT attisdropped`;
    expect(column!.type).toBe("text");
    const event = '{"nested":{"deeper":[{"ignored":"still text"}]}}';
    const [row] = await sql`SELECT
      jsonb_typeof(jsonb_build_object('payload',${event}::text)->'payload') AS event_kind,
      pg_catalog.jsonb_path_exists(jsonb_build_object('payload',${event}::text),
        'strict $.**{2}'::jsonpath,'{}'::jsonb,false) AS event_too_deep,
      pg_catalog.jsonb_path_exists(jsonb_build_object('sourceEconomics',jsonb_build_object('quantity','1.000')),
        'strict $.**{3}'::jsonpath,'{}'::jsonb,false) AS economics_too_deep`;
    expect(row).toEqual({ event_kind: "string", event_too_deep: false, economics_too_deep: false });
  });
  it("uses actual JSONB widths for recursive aggregate refusal below one MiB", async () => {
    const f = input();
    function text(padding: number) {
      return canonicalizeSemanticJsonString(resealedRawBody({ ...f.genesis,
        accounting: { ...f.genesis.accounting, fixturePadding: 'é\n"' + "x".repeat(padding) } }));
    }
    async function firstCallCost(tx: postgres.Sql, bodyText: string) {
      const [row] = await tx`SELECT octet_length(${bodyText})::bigint AS raw,
        octet_length(${bodyText}::jsonb::text)::bigint AS body`;
      return { raw: BigInt(row!.raw as string), body: BigInt(row!.body as string),
        cost: 65536n + 16n * BigInt(row!.raw as string) + (16n + 128n) * BigInt(row!.body as string) };
    }
    await sql.begin(async held => {
      const tx = held as unknown as postgres.Sql; await tx`SET LOCAL track_functions='all'`;
      const zero = await firstCallCost(tx, text(0));
      // ASCII padding adds one byte to each ACTUAL text spelling. Verify both
      // sides, never substitute JS object length for PostgreSQL representation.
      const max = Number((8388608n - zero.cost) / 160n);
      const lower = text(max), upper = text(max + 1);
      const a = await firstCallCost(tx, lower), b = await firstCallCost(tx, upper);
      expect(a.cost).toBeLessThanOrEqual(8388608n); expect(b.cost).toBeGreaterThan(8388608n);
      expect(b.cost - a.cost).toBe(160n); expect(b.raw).toBeLessThan(1048576n); expect(b.body).toBeLessThan(1048576n);
      const scaled = lower.replace('"sourceEventCount":0', '"sourceEventCount":0.000000');
      expect(scaled).not.toBe(lower);
      const [same] = await tx`SELECT ${scaled}::jsonb = ${lower}::jsonb AS equal_value`;
      expect(same!.equal_value).toBe(true);
      const numeric = await firstCallCost(tx, scaled);
      expect(numeric.body).toBeGreaterThan(a.body); expect(numeric.cost).toBeGreaterThan(8388608n);
      let before = await canonicalCalls(tx);
      await expect(held.savepoint(inner => insertRawCompanion(inner as unknown as postgres.Sql, f, scaled)))
        .rejects.toThrow("RESOURCE_ENVELOPE");
      expect(await canonicalCalls(tx)).toBe(before);
      before = await canonicalCalls(tx);
      await expect(held.savepoint(inner => insertRawCompanion(inner as unknown as postgres.Sql, f, upper)))
        .rejects.toThrow("RESOURCE_ENVELOPE");
      expect(await canonicalCalls(tx)).toBe(before);
      before = await canonicalCalls(tx);
      // The lower boundary executes C01 then refuses the independently charged
      // C02. It is NOT a positive commit or an exact-total-eight-MiB assertion.
      await expect(held.savepoint(inner => insertRawCompanion(inner as unknown as postgres.Sql, f, lower)))
        .rejects.toThrow("RESOURCE_ENVELOPE");
      expect(await canonicalCalls(tx)).toBeGreaterThan(before);
    });
  });
  it("refuses noncanonical text and supplied derived JSON independently of semantic hashes", async () => {
    const f = input(); const body = canonicalizeSemanticJsonString(f.genesis);
    for (const data of [{ text: body + " ", supplied: null }, { text: body, supplied: JSON.stringify(f.genesis) }]) {
      await expect(sql`INSERT INTO trader_historical_reconciliation_frontier_v1
        (id,organization_id,account_id,run_id,cycle_sequence,partition,profile,symbol,previous_id,genesis_id,
          checkpoint_digest,content_digest,body_text,body_json)
        VALUES (${f.genesis.id}::uuid,${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},-1,'DEVELOPMENT',
          ${f.genesis.profile},'BTCUSDT',NULL,NULL,NULL,${f.genesis.contentDigest},${data.text},${data.supplied}::jsonb)`)
        .rejects.toThrow(data.supplied ? "CALLER_BODY_JSON" : "CANONICAL_TEXT");
    }
  });
  it("refuses forged transaction stamps and changed immutable frontier bodies", async () => {
    const f = input();
    await expect(sql`INSERT INTO trader_historical_reconciliation_scope_mode_v1(organization_id,account_id,run_id,mode,writer_xid)
      VALUES(${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},'LEGACY','1')`).rejects.toThrow("WRITER_STAMP");
    const result = await sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f));
    await expect(sql`UPDATE trader_historical_reconciliation_frontier_v1 SET body_json=body_json||'{"expectedCashAfter":"0"}'::jsonb
      WHERE id=${result.frontier.id}::uuid`).rejects.toThrow("APPEND_ONLY");
    await expect(sql`DELETE FROM trader_historical_reconciliation_scope_mode_v1 WHERE organization_id=${organizationId}::uuid
      AND run_id=${f.scope.runId}`).rejects.toThrow("APPEND_ONLY");
  });
  it("rejects body/column, content and capacity mismatch before a new frontier can commit", async () => {
    const f = input(); const result = await sql.begin(tx => profile(sql, tx as unknown as postgres.Sql, f));
    const before = await counts(sql, f);
    for (const expression of [
      "body_json||jsonb_build_object('symbol','ETHUSDT')",
      "body_json||jsonb_build_object('contentDigest',repeat('0',64))",
      "body_json||jsonb_build_object('oversized',repeat('x',1048577))",
    ]) {
      // Deliberately bypass the application's pure validator to exercise the native boundary.
      await expect(sql.unsafe(`INSERT INTO trader_historical_reconciliation_frontier_v1
        (id,organization_id,account_id,run_id,cycle_sequence,partition,profile,symbol,previous_id,genesis_id,
          checkpoint_digest,content_digest,body_text)
        SELECT id,organization_id,account_id,run_id,cycle_sequence,partition,profile,symbol,previous_id,genesis_id,
          checkpoint_digest,content_digest,public.waia_canonical_jsonb_v1(${expression})
        FROM trader_historical_reconciliation_frontier_v1 WHERE id=$1::uuid`, [result.frontier.id]))
        .rejects.toThrow(/BODY_COLUMNS|RESOURCE_ENVELOPE/);
    }
    expect(await counts(sql, f)).toEqual(before);
  });
  it("keeps original source RLS refusal atomic with automatic LEGACY bookkeeping", async () => {
    const f = input();
    const denied = { ...f.mark, organizationId: "00000000-0000-4000-8000-000000002224" };
    // Existing source policy admits only organizationId, even when the caller has INSERT.
    const error = await reason(sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await createAccountingFrontierRepositoryPostgres(accountingExecutor(sql, tx as unknown as postgres.Sql))
        .append({ organizationId: denied.organizationId }, denied);
    }));
    expect(error).toMatch(/42501|row-level security/);
    expect((await sql`SELECT count(*)::int n FROM trader_historical_reconciliation_scope_mode_v1
      WHERE run_id=${f.scope.runId}`)[0]!.n).toBe(0);
  });
  it.each(["missing-table-right", "row-security"])("refuses %s in the verifier instead of treating filtered rows as LEGACY", async condition => {
    const f = input();
    const owner = await sql`SELECT proowner FROM pg_proc WHERE oid='public.waia_historical_reconciliation_verify_v1()'::regprocedure`;
    const error = await reason(sql.begin(async tx => {
      // Transactional fault only: no source-table ownership, source policy or guard is disabled.
      await tx.unsafe(`ALTER FUNCTION public.waia_historical_reconciliation_verify_v1() OWNER TO ${role}`);
      if (condition === "row-security") {
        await tx.unsafe(`GRANT SELECT ON public.trader_historical_reconciliation_scope_mode_v1 TO ${role}`);
      }
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await appendAccounting(sql, tx as unknown as postgres.Sql, f.mark);
    }));
    expect(error).toMatch(/42501|permission denied|row-level security/);
    expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 0, checkpoints: 0 });
    expect(await sql`SELECT proowner FROM pg_proc WHERE oid='public.waia_historical_reconciliation_verify_v1()'::regprocedure`).toEqual(owner);
    expect((await sql`SELECT has_table_privilege(${role},'public.trader_historical_reconciliation_scope_mode_v1','SELECT') allowed`)[0]!.allowed).toBe(false);
  });
  it.each(["anon", "authenticated", "waia_historical_runner"])("does not grant %s a direct mode/certification escape", async principal => {
    const f = input();
    for (const statement of [
      "SELECT public.waia_historical_reconciliation_legacy_v1()",
      "SELECT public.waia_historical_reconciliation_verify_v1()",
    ]) {
      expect(await reason(sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${principal}`); await tx.unsafe(statement);
      }))).toMatch(/42501|permission denied/);
    }
    expect(await reason(sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${principal}`);
      await tx`INSERT INTO trader_historical_reconciliation_scope_mode_v1(organization_id,account_id,run_id,mode)
        VALUES(${organizationId}::uuid,${f.scope.accountId},${f.scope.runId},'LEGACY')`;
    }))).toMatch(/42501|permission denied|row-level security/);
    expect(await counts(sql, f)).toEqual({ modes: 0, companions: 0, accounting: 0, checkpoints: 0 });
  });
  it("installs only the fixed trigger-only privileges and fourteen mandatory closure targets", async () => {
    const rows = await sql`SELECT p.proname,p.prosecdef,p.proconfig,
      has_function_privilege(${role},p.oid,'EXECUTE') generic,
      has_function_privilege('waia_historical_runner',p.oid,'EXECUTE') runner,
      has_function_privilege('anon',p.oid,'EXECUTE') browser
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('waia_historical_reconciliation_legacy_v1','waia_historical_reconciliation_verify_v1')`;
    expect(rows).toHaveLength(2);
    for (const row of rows) { expect(row.prosecdef).toBe(true); expect(row.proconfig).toEqual(expect.arrayContaining(["search_path=pg_catalog", "row_security=off"]));
      expect([row.generic, row.runner, row.browser]).toEqual([false, false, false]); }
    const triggers = await sql`SELECT c.relname,t.tgdeferrable,t.tginitdeferred FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE t.tgname='historical_reconciliation_closure' AND NOT t.tgisinternal ORDER BY c.relname`;
    expect(triggers).toHaveLength(14); expect(triggers.every(t => t.tgdeferrable && t.tginitdeferred)).toBe(true);
  });
});
