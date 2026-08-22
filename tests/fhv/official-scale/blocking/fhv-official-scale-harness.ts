import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

import { readReplayRunChainProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import {
  createExecutionPolicyBindingV2,
  deterministicExecutionUuidV2,
} from "@/lib/trader/execution/v2/contracts";
import { bindExecutionAuthorityV2Postgres } from "@/lib/trader/execution/v2/authority-postgres";
import { dispatchAndRecordExecutionAttemptV2 } from "@/lib/trader/execution/v2/recovery-postgres";
import type { SubmitOrderInput, SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import { resolveFhvDatasetManifestV2Path } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import {
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
  projectFhvGrowthAwareRuntime,
} from "@/lib/trader/observability/fhv-growth-law";
import type { FhvSourceFrontier } from "@/lib/trader/market-data/fhv-source-frontier";
import {
  FHV_CHECKPOINT_READY_MARKER,
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import type { FhvFullHistoricalLaunchInput } from "@/lib/trader/observability/fhv-full-historical-launch";
import { resolveFhvFullLaunchRunDirectory } from "@/lib/trader/observability/fhv-full-historical-launch";
import type { FhvHistoricalExecutionSession } from "@/lib/trader/observability/fhv-historical-execution-session";
import { readFhvLaunchJournal } from "@/lib/trader/observability/fhv-launch-journal";
import {
  buildFhvSyntheticScaleAuthority,
  FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME,
  writeFhvSyntheticScaleAuthorityAtomic,
  type FhvSyntheticScaleAuthorityV1,
} from "@/lib/trader/observability/fhv-synthetic-scale-authority";
import { measureBoundedDirectoryBytes } from "@/lib/trader/observability/fhv-telemetry-probes";
import { multiplyExecutionNotionalConservativelyV2 } from "@/lib/trader/execution/v2/contracts";
import {
  admitRiskAllowanceV2Postgres,
  initializeRiskAccountStateV2Postgres,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import {
  buildFhvOfficialV2ScaleDataset,
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  FHV_TEST_RELEASE_TAG,
  setupFhvOfficialV2MultiYearLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import {
  acquireFhvManagedDatasetRoot,
  releaseFhvManagedDatasetRoot,
} from "@/tests/helpers/fhv-temp-root-registry";

import {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
} from "./fhv-official-scale-constants";

export const FHV_OFFICIAL_SCALE_METRICS_FILENAME = "fhv-official-scale-metrics.v1.json";
/** Plan §8 canonical CI / full-corpus hard throughput floor (= 6_312_960 / 7200). */
export const MIN_THROUGHPUT_CPS = 877;
/**
 * Plan Phase 10 local feasibility headroom target (≥1000 bars/s).
 * Visible/reporting only — must not redefine blocking feasibilityTimePass.
 */
export const DEFAULT_PROBE_TARGET_CPS = 1000;
/** @deprecated Alias of {@link DEFAULT_PROBE_TARGET_CPS}; do not treat as blocking floor. */
export const DEFAULT_PROBE_MIN_THROUGHPUT_CPS = DEFAULT_PROBE_TARGET_CPS;
export const MAX_PROJECTED_FULL_CORPUS_RUNTIME_S = 7200;

export type FhvTestOnlyExecutionV2AuthorityMetrics = Readonly<{
  allowanceClaims: number;
  boundAttempts: number;
  modeledPlacements: number;
  venueAcceptedReports: number;
  legacySubmissions: 0;
}>;

let testOnlyV2Metrics: FhvTestOnlyExecutionV2AuthorityMetrics = Object.freeze({
  allowanceClaims: 0,
  boundAttempts: 0,
  modeledPlacements: 0,
  venueAcceptedReports: 0,
  legacySubmissions: 0,
});

function updateTestOnlyV2Metrics(
  values: Partial<Omit<FhvTestOnlyExecutionV2AuthorityMetrics, "legacySubmissions">>,
): void {
  testOnlyV2Metrics = Object.freeze({ ...testOnlyV2Metrics, ...values, legacySubmissions: 0 });
}

export function getFhvTestOnlyExecutionV2AuthorityMetrics(): FhvTestOnlyExecutionV2AuthorityMetrics {
  return testOnlyV2Metrics;
}

function resetFhvTestOnlyExecutionV2AuthorityMetrics(): void {
  testOnlyV2Metrics = Object.freeze({
    allowanceClaims: 0,
    boundAttempts: 0,
    modeledPlacements: 0,
    venueAcceptedReports: 0,
    legacySubmissions: 0,
  });
}

function digestHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireLoopbackTestOnlyPostgresUrl(): string {
  if (
    process.env.WAIA_PG_INTEGRATION !== "1" ||
    process.env.FHV_TEST_ONLY_EXECUTION_V2_AUTHORITY !== "1"
  ) {
    throw new Error("FHV_TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED");
  }
  const value = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!value) throw new Error("DATABASE_URL_POSTGRES is required for FHV TEST_ONLY Execution V2");
  const hostname = new URL(value).hostname;
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
    throw new Error("FHV TEST_ONLY Execution V2 requires loopback PostgreSQL");
  }
  return value;
}

async function seedFhvTestOnlyV2Tenant(
  sqlClient: postgres.Sql,
  db: WaiaPostgresDb,
  organizationId: string,
): Promise<void> {
  const ownerUserId = deterministicExecutionUuidV2("order", {
    purpose: "fhv-official-scale-test-only-owner",
    organizationId,
  });
  await sqlClient`insert into auth.users (id) values (${ownerUserId}::uuid) on conflict (id) do nothing`;
  await db.insert(pgSchema.users).values({
    id: ownerUserId,
    identityLabel: "DEE-651 FHV TEST_ONLY Execution V2",
    email: `${ownerUserId}@fhv-execution-v2.invalid`,
    passwordHash: null,
  }).onConflictDoNothing();
  await db.insert(pgSchema.organizations).values({
    id: organizationId,
    ownerUserId,
    kind: "personal",
    name: "DEE-651 FHV TEST_ONLY Execution V2",
  }).onConflictDoNothing();
  await db.insert(pgSchema.organizationMembers).values({
    id: deterministicExecutionUuidV2("order", {
      purpose: "fhv-official-scale-test-only-membership",
      organizationId,
    }),
    organizationId,
    userId: ownerUserId,
    memberRole: "owner",
  }).onConflictDoNothing();
}

async function transitionHistoricalProjection(
  seeded: FhvHistoricalExecutionSession,
  order: Awaited<ReturnType<FhvHistoricalExecutionSession["session"]["orderRepository"]["createOrder"]>>,
  toState: "RISK_APPROVED" | "SENT_TO_EXCHANGE" | "ACCEPTED",
  exchangeOrderId?: string,
) {
  return seeded.session.orderRepository.transitionOrder(seeded.context, {
    orderId: order.id,
    expectedStateVersion: order.stateVersion,
    toState,
    ...(exchangeOrderId ? { exchangeOrderId } : {}),
  });
}

/**
 * Authorized only for the two official-scale Vitest gates. The production runtime remains
 * fail-closed; this adapter binds genuine PostgreSQL V2 authority before exposing the existing
 * historical modeled placement to the SQLite evidence/accounting harness.
 */
export async function bindFhvTestOnlyExecutionV2HistoricalSession(
  seeded: FhvHistoricalExecutionSession,
): Promise<FhvHistoricalExecutionSession> {
  const url = requireLoopbackTestOnlyPostgresUrl();
  resetFhvTestOnlyExecutionV2AuthorityMetrics();
  const invocationId = randomUUID();
  const sqlClient = postgres(url, { max: 4 });
  const pgDb = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
  await seedFhvTestOnlyV2Tenant(sqlClient, pgDb, seeded.context.organizationId);
  const originalExecution = seeded.session.deps.execution;
  const submissions = new Map<string, Promise<SubmitOrderResult>>();

  const submitWithAuthority = async (input: SubmitOrderInput): Promise<SubmitOrderResult> => {
    if (input.executionMode !== "mock" || input.type !== "market") {
      throw new Error("FHV TEST_ONLY Execution V2 permits modeled mock market orders only");
    }
    const symbol = normalizeSymbolForHistoricalExecution(input.symbol);
    const baseAsset = symbol.slice(0, -4);
    const referencePrice = input.referencePrice;
    const identity = `${invocationId}:${input.idempotencyKey}`;
    const accountId = `fhv-v2-${digestHex(identity).slice(0, 24)}`;
    const instrumentDigest = digestHex(`${symbol}:SPOT`);
    const isEntry = input.side === "buy";
    const action = isEntry ? "ENTER_LONG" as const : "CLOSE" as const;
    const reservationNotional = isEntry
      ? multiplyExecutionNotionalConservativelyV2(input.quantity, referencePrice)
      : "0";
    const now = Date.now();
    const realitySnapshotId = `fhv-v2-reality-${digestHex(identity).slice(0, 24)}`;

    await initializeRiskAccountStateV2Postgres(pgDb, seeded.context, {
      accountId,
      posture: isEntry ? "NORMAL" : "CLOSE_ONLY",
      killState: "CLEAR",
      reconciliationStatus: "RECONCILED",
      realitySnapshotId,
      realityContentDigestHex: digestHex(`${identity}:reality`),
      reconciliationAuthorityDigestHex: digestHex(`${identity}:reconciliation`),
      reconciledInstrumentExposures: [{
        instrumentIdentityDigestHex: instrumentDigest,
        symbol,
        baseQuantity: isEntry ? "0" : input.quantity,
      }],
      accounting: {
        reconciledExposureNotional: isEntry ? "0" : multiplyExecutionNotionalConservativelyV2(
          input.quantity,
          referencePrice,
        ),
        worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0",
        exposureLimitNotional: "1000000000000",
      },
    });

    const decisionId = `fhv-test-only-decision-${digestHex(identity).slice(0, 24)}`;
    const admitted = await admitRiskAllowanceV2Postgres(pgDb, seeded.context, {
      accountId,
      riskVerdictId: deterministicExecutionUuidV2("order", { identity, purpose: "risk-verdict" }),
      riskAllowanceId: deterministicExecutionUuidV2("order", { identity, purpose: "allowance" }),
      issuanceEventId: deterministicExecutionUuidV2("risk-event", { identity, purpose: "issuance" }),
      nonce: deterministicExecutionUuidV2("order", { identity, purpose: "nonce" }),
      validForMs: 300_000,
      verdict: {
        venue: "HTX",
        market: "SPOT",
        symbol,
        baseAsset,
        quoteAsset: "USDT",
        instrumentIdentityDigestHex: instrumentDigest,
        decision: {
          decisionId,
          semanticDigestHex: digestHex(`${identity}:decision-semantic`),
          contentDigestHex: digestHex(`${identity}:decision-content`),
          action,
          economicSizeSetId: `fhv-test-only-size-${digestHex(identity).slice(0, 24)}`,
          economicSizeSetDigestHex: digestHex(`${identity}:economic-size-set`),
        },
        riskPolicyVersion: "dee-651-fhv-test-only-risk-v2",
        riskPolicyDigestHex: digestHex("dee-651-fhv-test-only-risk-v2"),
        limitVersions: [{
          layer: "L2",
          version: "fhv-test-only-position-v1",
          digestHex: digestHex("fhv-test-only-position-v1"),
        }],
        reality: {
          snapshotId: realitySnapshotId,
          contentDigestHex: digestHex(`${identity}:reality`),
          asOfUtc: new Date(now).toISOString(),
          reconciliationAuthorityDigestHex: digestHex(`${identity}:reconciliation`),
          reconciliationStatus: "RECONCILED",
        },
        referencePrice: {
          authorityId: "fhv-test-only-closed-bar",
          authorityVersion: "v1",
          contentDigestHex: digestHex(`${identity}:reference-price:${referencePrice}`),
          price: referencePrice,
        },
        verdict: isEntry ? "APPROVE_CLAMPED" : "CLOSE_ONLY",
        approvedQualifiedQuantity: input.quantity,
        bindingLayers: ["L2"],
        reasonCodes: ["POSITION_LIMIT_BINDING"],
      },
    });
    updateTestOnlyV2Metrics({ allowanceClaims: testOnlyV2Metrics.allowanceClaims + 1 });

    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: deterministicExecutionUuidV2("order", { identity, purpose: "policy" }),
      organizationId: seeded.context.organizationId,
      policyVersion: "dee-651-fhv-test-only-historical-v1",
      decisionId,
      decisionContentDigestHex: admitted.allowance.decision.contentDigestHex,
      decisionExecutionPolicyDigestHex: digestHex(`${identity}:execution-policy`),
      economicSizeSetDigestHex: admitted.allowance.decision.economicSizeSetDigestHex,
      venue: "HTX",
      market: "SPOT",
      instrumentIdentityDigestHex: instrumentDigest,
      allowedOrderTypes: ["market"],
      allowedTimeInForce: ["GTC"],
      allowedLiquidityRoles: ["TAKER"],
      priceCollar: {
        minimumPrice: referencePrice,
        maximumPrice: referencePrice,
        authorityDigestHex: digestHex(`${identity}:price-collar`),
      },
      quantityRules: {
        minimumQuantity: input.quantity,
        quantityStep: input.quantity,
        roundingMode: "EXACT",
        economicQualifiedQuantities: [input.quantity],
      },
      slicingPolicy: { maximumSlices: 1, completePlanRequired: true },
      retryPolicy: {
        maximumNetworkSubmissions: 1,
        sameIdentityRetryAllowed: false,
        venueIdempotencyProven: false,
      },
      cancelPolicy: {
        protectiveCancelAllowed: true,
        replacementRequiresPresealedOrFreshAuthority: true,
      },
      timeoutMs: 5_000,
      uncertaintyHandling: "RECONCILIATION_REQUIRED",
      effectiveFromUtc: new Date(now - 300_000).toISOString(),
      effectiveUntilUtc: new Date(now + 7_200_000).toISOString(),
    });
    const plan = {
      approvedNotionalCeiling: reservationNotional,
      plannedQuantity: input.quantity,
      orderType: "market" as const,
      liquidityRole: "TAKER" as const,
      limitPrice: null,
      timeInForce: "GTC" as const,
      timingWindow: {
        opensAtUtc: new Date(now - 60_000).toISOString(),
        closesAtUtc: new Date(now + 3_600_000).toISOString(),
      },
      childSlices: [{ sequence: 1, quantity: input.quantity, limitPrice: null }],
      sealedAtUtc: new Date(now - 120_000).toISOString(),
    };
    const authority = await bindExecutionAuthorityV2Postgres(pgDb, seeded.context, {
      allowance: admitted.allowance,
      policy,
      plan,
      executionMode: "mock",
      credentialId: null,
      strategySignalId: input.strategySignalId ?? null,
      allocationDecisionId: input.allocationDecisionId ?? null,
    });
    updateTestOnlyV2Metrics({ boundAttempts: testOnlyV2Metrics.boundAttempts + 1 });

    let modeledProjection: OrderRow | null = null;
    const outcome = await dispatchAndRecordExecutionAttemptV2(
      pgDb,
      seeded.context,
      authority.attempt.executionAttemptId,
      async (payload, submittedAuthority) => {
        if (
          submittedAuthority.executionAttemptId !== authority.attempt.executionAttemptId ||
          submittedAuthority.effectIdentityDigestHex !== authority.attempt.effectIdentityDigestHex
        ) {
          throw new Error("FHV TEST_ONLY Execution V2 dispatcher authority mismatch");
        }
        const created = await seeded.session.orderRepository.createOrder(seeded.context, {
          id: authority.order.id,
          venue: authority.order.venue,
          executionMode: "mock",
          symbol: input.symbol,
          side: payload.side,
          type: payload.type,
          price: payload.price,
          quantity: payload.quantity,
          clientOrderId: payload.clientOrderId,
          idempotencyKey: authority.order.idempotencyKey,
          riskDecisionId: authority.order.riskDecisionId,
          riskAllowanceId: authority.order.riskAllowanceId,
          riskAllowanceBindingDigest: authority.order.riskAllowanceBindingDigest,
          strategySignalId: authority.order.strategySignalId,
          allocationDecisionId: authority.order.allocationDecisionId,
          credentialId: null,
        });
        const approved = await transitionHistoricalProjection(seeded, created, "RISK_APPROVED");
        const sent = await transitionHistoricalProjection(seeded, approved, "SENT_TO_EXCHANGE");
        const venueOrderId = `fhv-model-${authority.attempt.effectIdentityDigestHex.slice(0, 24)}`;
        const accepted = await transitionHistoricalProjection(
          seeded,
          sent,
          "ACCEPTED",
          venueOrderId,
        );
        modeledProjection = accepted;
        seeded.session.historicalExecutionProfile.exchange.registerOrder(
          { ...accepted, symbol: normalizeSymbolForHistoricalExecution(accepted.symbol) },
          seeded.session.deps.researchReplayDeterminism?.getDecisionBarIndex?.() ?? 0,
          seeded.session.replayClock.nowMs(),
        );
        updateTestOnlyV2Metrics({ modeledPlacements: testOnlyV2Metrics.modeledPlacements + 1 });
        const createdAt = new Date(seeded.session.replayClock.nowMs()).toISOString();
        return Object.freeze({
          order: Object.freeze({
            orderId: venueOrderId,
            clientOrderId: payload.clientOrderId,
            symbol: payload.symbol,
            side: payload.side,
            type: payload.type,
            status: "open" as const,
            ...(payload.price === null ? {} : { price: payload.price }),
            quantity: payload.quantity,
            filledQuantity: "0",
            createdAt,
            updatedAt: createdAt,
          }),
          trades: Object.freeze([]),
          raw: Object.freeze({
            testOnlyHistoricalModel: true,
            executionAttemptId: authority.attempt.executionAttemptId,
            effectIdentityDigestHex: authority.attempt.effectIdentityDigestHex,
            venueOrderId,
          }),
        });
      },
    );
    if (outcome.status !== "VENUE_ACCEPTED") {
      throw new Error(`FHV TEST_ONLY Execution V2 modeled placement failed: ${outcome.status}`);
    }
    updateTestOnlyV2Metrics({ venueAcceptedReports: testOnlyV2Metrics.venueAcceptedReports + 1 });
    if (!modeledProjection) throw new Error("FHV TEST_ONLY Execution V2 projection missing");
    return { status: "submitted", order: modeledProjection };
  };

  const execution = {
    ...originalExecution,
    submitOrder: (context: Parameters<typeof originalExecution.submitOrder>[0], input: SubmitOrderInput) => {
      if (context.organizationId !== seeded.context.organizationId) {
        throw new Error("FHV TEST_ONLY Execution V2 tenant mismatch");
      }
      const existing = submissions.get(input.idempotencyKey);
      if (existing) return existing;
      const pending = submitWithAuthority(input);
      submissions.set(input.idempotencyKey, pending);
      return pending;
    },
  };
  return {
    ...seeded,
    session: {
      ...seeded.session,
      deps: { ...seeded.session.deps, execution },
    },
    cleanup: () => {
      seeded.cleanup();
      void sqlClient.end({ timeout: 5 });
    },
  };
}

/**
 * Resolve the visible Phase-10 probe headroom target.
 * Env `FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND` may adjust the reported target only; it must never
 * enter {@link evaluateFhvOfficialScaleTimeFeasibility} / `feasibilityTimePass`.
 */
export function resolveProbeTargetCps(): number {
  const raw = process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND;
  if (raw == null || raw === "") {
    return DEFAULT_PROBE_TARGET_CPS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROBE_TARGET_CPS;
  }
  return parsed;
}

/** @deprecated Use {@link resolveProbeTargetCps}; name historically implied a blocking floor. */
export function resolveProbeMinThroughputCps(): number {
  return resolveProbeTargetCps();
}
export const DISK_PROJECTED_MAX_FRACTION_OF_AVAILABLE = 0.7;
export const DISK_MIN_FREE_RESERVE_FRACTION = 0.3;
export const MIN_FILLS_AT_CHECKPOINT = 313;
export const MIN_ACCOUNTING_SEQUENCE_AT_CHECKPOINT = 4311;
export const MIN_WP17_OPEN_AT_CHECKPOINT = 1;

export type FhvOfficialScaleMetricsV1 = Readonly<{
  schemaVersion: "fhv-official-scale-metrics/v1";
  capturedAtUtc: string;
  cycleCount: number;
  barsProcessed: number;
  wallTimeMs: number;
  cps: number;
  projectedRuntimeS: number;
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
  classification: string;
  /**
   * Canonical absolute host result for this runner: cps≥877 and projectedRuntimeS≤7200
   * (plan §8). REPORTED, never merge-blocking on a hosted PR runner.
   */
  feasibilityTimePass: boolean;
  feasibilityDiskPass: boolean;
  /**
   * Absolute 877/7200 host observation. Synonym for `feasibilityTimePass`, named explicitly so a
   * reader never mistakes "the probe gate passed" for "this hosted VM met 877/7200". Non-blocking.
   */
  absoluteHostTimePass: boolean;
  absoluteHostClassification: "FHV_ABSOLUTE_HOST_877_7200_PASS" | "FHV_ABSOLUTE_HOST_877_7200_FAIL";
  /**
   * Merge-blocking software qualification. True iff the probe executed the production path with a
   * coherent workload classification and the disk feasibility bound held. Independent of the hosted
   * runner's absolute cps, which is a target-host qualification concern (Execution Server preflight),
   * not a software-correctness one.
   */
  ciSoftwareGatePass: boolean;
  ciGateClassification:
    | "FHV_CI_SOFTWARE_GATE_PASS"
    | "BLOCKED_BY_CI_SOFTWARE_CLASSIFICATION"
    | "BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY";
  /** Plan Phase 10 headroom target (default 1000); never the blocking CI floor. */
  probeTargetCps: number;
  /** Whether measured cps met the visible Phase-10 target (non-blocking). */
  probeTargetPass: boolean;
  probeGateClassification: string;
}>;

export type FhvOfficialScaleHarnessContext = Readonly<{
  datasetRoot: string;
  manifestPath: string;
  /** True when the dataset root is operator-pinned and must not be torn down. */
  externallyOwned: boolean;
  artifactRoot: string;
  releaseSha: string;
  releaseTag: string;
  organizationId: string;
  operatorId: string;
}>;

export type FhvOfficialScaleLaunchPaths = Readonly<{
  runId: string;
  runDir: string;
  artifactRoot: string;
  releaseSha: string;
  releaseTag: string;
  organizationId: string;
  operatorId: string;
  datasetRoot: string;
  manifestPath: string;
  qualificationReceiptPath: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  authorizationReceiptDigest: string;
  checkoutIdentityProofPath: string;
  controlReplayReceiptPath: string;
  syntheticScaleAuthorityPath: string;
}>;

export type FhvOfficialScaleParitySnapshot = Readonly<{
  semanticReproDigest: string;
  authoritativeEvidenceDigest: string;
  accountingStateDigest?: string;
  sourceFrontierDigest: string;
  globalEventSequence: number;
  sourceExhausted: boolean;
  accountingSequence: number;
  fillsCount: number;
  wp17OpenCount: number;
  identityFrontierDigest: string | null;
  classification: string;
}>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidCachedDatasetRoot(datasetRoot: string): boolean {
  if (!datasetRoot.trim() || !existsSync(datasetRoot)) {
    return false;
  }
  try {
    assertFhvDatasetSealed(datasetRoot);
    return existsSync(resolveFhvDatasetManifestV2Path(datasetRoot));
  } catch {
    return false;
  }
}

export function resolveFhvOfficialScaleArtifactRoot(): string {
  const configured = process.env.FHV_OFFICIAL_SCALE_ARTIFACT_ROOT?.trim();
  if (configured) {
    mkdirSync(configured, { recursive: true });
    return configured;
  }
  const root = join(process.cwd(), ".artifacts", "fhv-official-scale");
  mkdirSync(root, { recursive: true });
  return root;
}

export function resolveOrBuildFhvOfficialScaleDataset(): {
  datasetRoot: string;
  manifestPath: string;
  /** True when the root is operator-pinned and must never be torn down by this process. */
  externallyOwned: boolean;
} {
  const cached = process.env.FHV_OFFICIAL_SCALE_DATASET_ROOT?.trim();
  if (cached && isValidCachedDatasetRoot(cached)) {
    return {
      datasetRoot: cached,
      manifestPath: resolveFhvDatasetManifestV2Path(cached),
      externallyOwned: true,
    };
  }
  const { datasetRoot } = acquireFhvManagedDatasetRoot({
    prefix: "fhv-official-scale-dataset-",
    build: (root) => {
      buildFhvOfficialV2ScaleDataset(root);
    },
    releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  });
  return {
    datasetRoot,
    manifestPath: resolveFhvDatasetManifestV2Path(datasetRoot),
    externallyOwned: false,
  };
}

export function buildFhvOfficialScaleHarnessContext(): FhvOfficialScaleHarnessContext {
  const { datasetRoot, manifestPath, externallyOwned } = resolveOrBuildFhvOfficialScaleDataset();
  return {
    datasetRoot,
    manifestPath,
    externallyOwned,
    artifactRoot: resolveFhvOfficialScaleArtifactRoot(),
    releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId: FHV_TEST_ORG_ID,
    operatorId: FHV_TEST_OPERATOR_ID,
  };
}

/**
 * Release the harness dataset root. Safe to call from `afterAll` and from script `finally`
 * blocks; operator-pinned roots (`FHV_OFFICIAL_SCALE_DATASET_ROOT`) are never removed.
 */
export function teardownFhvOfficialScaleHarnessContext(
  harness: Pick<FhvOfficialScaleHarnessContext, "datasetRoot" | "externallyOwned">,
  outcome: "PASS" | "FAIL" = "PASS",
): void {
  if (harness.externallyOwned) {
    return;
  }
  releaseFhvManagedDatasetRoot(harness.datasetRoot, outcome);
}

export function writeFhvOfficialScaleSyntheticAuthority(input: {
  authorityDir: string;
  runId: string;
  organizationId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  maxCycles: number | null;
  targetCycleCount: number;
  checkpointEveryCycles?: number;
  technicalObservationMode?: boolean;
  overwrite?: boolean;
}): string {
  mkdirSync(input.authorityDir, { recursive: true });
  const authorityPath = join(input.authorityDir, FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME);
  if (existsSync(authorityPath) && !input.overwrite) {
    return authorityPath;
  }
  const authority = buildFhvSyntheticScaleAuthority({
    runId: input.runId,
    organizationId: input.organizationId,
    releaseSha: input.releaseSha,
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    maxCycles: input.maxCycles,
    targetCycleCount: input.targetCycleCount,
    checkpointEveryCycles: input.checkpointEveryCycles ?? CHECKPOINT_EVERY_CYCLES,
    technicalObservationMode: input.technicalObservationMode ?? false,
  });
  if (existsSync(authorityPath)) {
    writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
  } else {
    writeFhvSyntheticScaleAuthorityAtomic(authorityPath, authority);
  }
  return authorityPath;
}

export function setupFhvOfficialScaleLaunchPaths(input: {
  harness: FhvOfficialScaleHarnessContext;
  runId: string;
  maxCycles: number | null;
  targetCycleCount: number;
  technicalObservationMode?: boolean;
  checkpointEveryCycles?: number;
}): FhvOfficialScaleLaunchPaths {
  const prep = setupFhvOfficialV2MultiYearLaunchArtifacts({
    artifactRoot: input.harness.artifactRoot,
    runId: input.runId,
    datasetRoot: input.harness.datasetRoot,
    manifestPath: input.harness.manifestPath,
    releaseSha: input.harness.releaseSha,
    organizationId: input.harness.organizationId,
    operatorId: input.harness.operatorId,
    checkpointEveryCycles: input.checkpointEveryCycles ?? CHECKPOINT_EVERY_CYCLES,
  });
  const authorityDir = join(input.harness.artifactRoot, "prep", input.runId);
  const sealed = assertFhvDatasetSealed(input.harness.datasetRoot);
  const syntheticScaleAuthorityPath = writeFhvOfficialScaleSyntheticAuthority({
    authorityDir,
    runId: input.runId,
    organizationId: input.harness.organizationId,
    releaseSha: input.harness.releaseSha,
    datasetContentDigest: sealed.manifest.datasetContentDigest,
    manifestSemanticDigest: sealed.manifest.manifestSemanticDigest,
    maxCycles: input.maxCycles,
    targetCycleCount: input.targetCycleCount,
    checkpointEveryCycles: input.checkpointEveryCycles ?? CHECKPOINT_EVERY_CYCLES,
    technicalObservationMode: input.technicalObservationMode,
  });
  const runDir = resolveFhvFullLaunchRunDirectory(input.harness.artifactRoot, input.runId);
  return {
    runId: input.runId,
    runDir,
    artifactRoot: input.harness.artifactRoot,
    releaseSha: input.harness.releaseSha,
    releaseTag: input.harness.releaseTag,
    organizationId: input.harness.organizationId,
    operatorId: input.harness.operatorId,
    datasetRoot: input.harness.datasetRoot,
    manifestPath: input.harness.manifestPath,
    qualificationReceiptPath: prep.qualificationReceiptPath,
    configurationFreezePath: prep.configurationFreezePath,
    authorizationReceiptPath: prep.authorizationReceiptPath,
    authorizationReceiptDigest: prep.authorizationReceiptDigest,
    checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
    controlReplayReceiptPath: prep.controlReplayReceiptPath,
    syntheticScaleAuthorityPath,
  };
}

export function toFhvOfficialScaleLaunchInput(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean },
): FhvFullHistoricalLaunchInput & { resume?: boolean } {
  return {
    releaseSha: paths.releaseSha,
    releaseTag: paths.releaseTag,
    runId: paths.runId,
    organizationId: paths.organizationId,
    operatorId: paths.operatorId,
    artifactRoot: paths.artifactRoot,
    configurationFreezePath: paths.configurationFreezePath,
    authorizationReceiptPath: paths.authorizationReceiptPath,
    authorizationReceiptDigest: paths.authorizationReceiptDigest,
    datasetQualificationReceiptPath: paths.qualificationReceiptPath,
    datasetRoot: paths.datasetRoot,
    manifestPath: paths.manifestPath,
    checkoutIdentityProofPath: paths.checkoutIdentityProofPath,
    controlReplayReceiptPath: paths.controlReplayReceiptPath,
    syntheticScaleAuthorityPath: paths.syntheticScaleAuthorityPath,
    runDir: paths.runDir,
    boundedFixture: false,
    ...(input?.maxCycles != null ? { maxCycles: input.maxCycles } : {}),
    ...(input?.resume ? { resume: true } : {}),
  };
}

export function buildFhvOfficialScaleCliArgs(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean },
): string[] {
  const args = [
    "trader:fhv:run",
    "--",
    "--release-sha",
    paths.releaseSha,
    "--release-tag",
    paths.releaseTag,
    "--run-id",
    paths.runId,
    "--organization-id",
    paths.organizationId,
    "--operator-id",
    paths.operatorId,
    "--artifact-root",
    paths.artifactRoot,
    "--configuration-freeze-path",
    paths.configurationFreezePath,
    "--authorization-receipt-path",
    paths.authorizationReceiptPath,
    "--authorization-receipt-digest",
    paths.authorizationReceiptDigest,
    "--dataset-qualification-receipt-path",
    paths.qualificationReceiptPath,
    "--dataset-root",
    paths.datasetRoot,
    "--manifest-path",
    paths.manifestPath,
    "--checkout-identity-proof-path",
    paths.checkoutIdentityProofPath,
    "--control-replay-receipt-path",
    paths.controlReplayReceiptPath,
    "--synthetic-scale-authority-path",
    paths.syntheticScaleAuthorityPath,
    "--run-dir",
    paths.runDir,
  ];
  if (input?.maxCycles != null) {
    args.push("--max-cycles", String(input.maxCycles));
  }
  if (input?.resume) {
    args.push("--resume");
  }
  return args;
}

export type FhvOfficialScaleCliResult = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}>;

export function runFhvOfficialScaleCli(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean; env?: NodeJS.ProcessEnv },
): Promise<FhvOfficialScaleCliResult> {
  const args = buildFhvOfficialScaleCliArgs(paths, input);
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WAIA_TRADER_CLI: "1",
        NODE_ENV: "test",
        ...input?.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, stdout, stderr, signal });
    });
  });
}

export function spawnFhvOfficialScaleCli(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean; env?: NodeJS.ProcessEnv },
): { pid: number; promise: Promise<FhvOfficialScaleCliResult> } {
  const args = buildFhvOfficialScaleCliArgs(paths, input);
  const child = spawn("pnpm", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WAIA_TRADER_CLI: "1",
      NODE_ENV: "test",
      ...input?.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const promise = new Promise<FhvOfficialScaleCliResult>((resolve) => {
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, stdout, stderr, signal });
    });
  });
  return { pid: child.pid ?? -1, promise };
}

/** Raised when the child process dies before producing the checkpoint the caller is waiting for. */
export class FhvOfficialScaleChildExitedError extends Error {
  constructor(
    readonly detail: Readonly<{
      runId: string;
      expectedCycle: number;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      elapsedMs: number;
    }>,
  ) {
    super(
      `[fhv-official-scale] child exited before checkpoint: runId=${detail.runId} ` +
        `expectedCycle=${detail.expectedCycle} exitCode=${String(detail.exitCode)} ` +
        `signal=${String(detail.signal)} elapsedMs=${detail.elapsedMs}\n` +
        `--- stdout ---\n${detail.stdout}\n--- stderr ---\n${detail.stderr}`,
    );
    this.name = "FhvOfficialScaleChildExitedError";
  }
}

/**
 * Wait for a checkpoint, racing the child's own termination.
 *
 * Polling the filesystem alone cannot tell "still working" from "already dead", so a child that
 * crashed in its first second still burned the full 1,800,000 ms timeout and then reported only
 * `expected 1 to be 0`. Racing termination against checkpoint readiness surfaces the real exit
 * code, signal and output within the poll interval instead.
 */
export async function waitForFhvOfficialScaleCheckpoint(input: {
  runDir: string;
  lastCommittedCycle?: number;
  timeoutMs: number;
  /** When supplied, early child termination fails immediately instead of waiting for the timeout. */
  child?: { promise: Promise<FhvOfficialScaleCliResult> };
  runId?: string;
  /** Test seam so the timeout path can be exercised without a 30-minute wait. */
  pollIntervalMs?: number;
}): Promise<{ lastCommittedCycle: number; lastCommittedEpoch: number }> {
  const targetCycle = input.lastCommittedCycle ?? LAST_COMMITTED_CYCLE_INDEX;
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  const pollIntervalMs = input.pollIntervalMs ?? 500;

  let childResult: FhvOfficialScaleCliResult | undefined;
  // Attaching once avoids a listener leak across poll iterations. The child promise resolves on
  // close and never rejects, so this cannot produce an unhandled rejection.
  void input.child?.promise.then((result) => {
    childResult = result;
  });

  const probeCheckpoint = (): { lastCommittedCycle: number; lastCommittedEpoch: number } | null => {
    if (!existsSync(join(input.runDir, "fhv-launch-journal.v1.json"))) {
      return null;
    }
    const journal = readFhvLaunchJournal(input.runDir);
    if (journal.lastCommittedCycle < targetCycle) {
      return null;
    }
    const checkpointDir = resolveFhvEpochCheckpointDir(input.runDir, journal.lastCommittedEpoch);
    if (!existsSync(join(checkpointDir, FHV_CHECKPOINT_READY_MARKER))) {
      return null;
    }
    return {
      lastCommittedCycle: journal.lastCommittedCycle,
      lastCommittedEpoch: journal.lastCommittedEpoch,
    };
  };

  while (Date.now() < deadline) {
    const observed = probeCheckpoint();
    if (observed) {
      return observed;
    }

    const exited: FhvOfficialScaleCliResult | undefined = childResult;
    if (exited) {
      /*
       * A bounded child legitimately checkpoints and then exits PAUSED, and it can do both between
       * two polls. Re-probe once so that ordinary completion is not misreported as an early death.
       */
      const afterExit = probeCheckpoint();
      if (afterExit) {
        return afterExit;
      }
      throw new FhvOfficialScaleChildExitedError({
        runId: input.runId ?? "unknown",
        expectedCycle: targetCycle,
        exitCode: exited.exitCode,
        signal: exited.signal,
        stdout: exited.stdout,
        stderr: exited.stderr,
        elapsedMs: Date.now() - startedAt,
      });
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `[fhv-official-scale] timed out waiting for checkpoint lastCommittedCycle>=${targetCycle}`,
  );
}

export function readFhvOfficialScaleMetricsPath(artifactRoot: string): string {
  return join(artifactRoot, FHV_OFFICIAL_SCALE_METRICS_FILENAME);
}

export function readFhvOfficialScaleMetrics(
  artifactRoot: string,
): FhvOfficialScaleMetricsV1 | null {
  const metricsPath = readFhvOfficialScaleMetricsPath(artifactRoot);
  if (!existsSync(metricsPath)) {
    return null;
  }
  return JSON.parse(readFileSync(metricsPath, "utf8")) as FhvOfficialScaleMetricsV1;
}

export function writeFhvOfficialScaleMetrics(
  artifactRoot: string,
  metrics: FhvOfficialScaleMetricsV1,
): string {
  const metricsPath = readFhvOfficialScaleMetricsPath(artifactRoot);
  writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  return metricsPath;
}

export function resolveFhvOfficialScaleCheckpointBytes(runDir: string): {
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
} {
  if (!existsSync(join(runDir, "fhv-launch-journal.v1.json"))) {
    return { checkpointBytes: null, checkpointBackupDurationMs: null };
  }
  const journal = readFhvLaunchJournal(runDir);
  const checkpointDir = resolveFhvEpochCheckpointDir(runDir, journal.lastCommittedEpoch);
  try {
    const bundle = readFhvExecutionCheckpointBundle(checkpointDir);
    const checkpointBytes = bundle.manifest.files.reduce((sum, entry) => sum + entry.byteCount, 0);
    let checkpointBackupDurationMs: number | null = null;
    const metricsPath = join(checkpointDir, "idhps-checkpoint-metrics.v1.json");
    if (existsSync(metricsPath)) {
      const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as {
        checkpointBackupDurationMs?: number;
      };
      checkpointBackupDurationMs =
        typeof metrics.checkpointBackupDurationMs === "number"
          ? metrics.checkpointBackupDurationMs
          : null;
    }
    return { checkpointBytes, checkpointBackupDurationMs };
  } catch {
    return { checkpointBytes: null, checkpointBackupDurationMs: null };
  }
}

export function evaluateFhvOfficialScaleTimeFeasibility(input: {
  barsProcessed: number;
  wallTimeMs: number;
  /**
   * Blocking floor only. Defaults to {@link MIN_THROUGHPUT_CPS} (=877).
   * Callers must not pass the Phase-10 1000 target here.
   */
  minThroughputCps?: number;
  /**
   * Growth-aware inputs (WP-8). Supplying them adds a second projection that models checkpoint
   * cost rising with database size instead of assuming constant cost per bar. The legacy
   * projection and the blocking constants are unchanged.
   */
  growth?: {
    checkpointWallTimeMs: number;
    checkpointCount: number;
    sessionGrowthBytesPerCycle: number;
    checkpointInterceptMs: number;
    checkpointMsPerGigabyte: number;
    checkpointEveryCycles: number;
  };
}): {
  cps: number;
  projectedRuntimeS: number;
  pass: boolean;
  projectedRuntimeSecondsWithGrowth: number | null;
  prelaunchPass: boolean | null;
  prelaunchClassification: string;
  probeRepresentativenessWarning: string | null;
} {
  const wallTimeS = Math.max(input.wallTimeMs / 1000, 0.001);
  const cps = input.barsProcessed / wallTimeS;
  const projectedRuntimeS = FHV_OFFICIAL_TOTAL_BARS / Math.max(cps, Number.EPSILON);
  // Hard floor cannot be weakened below the canonical CI / full-corpus contract.
  const minThroughputCps = Math.max(
    input.minThroughputCps ?? MIN_THROUGHPUT_CPS,
    MIN_THROUGHPUT_CPS,
  );
  const pass = cps >= minThroughputCps && projectedRuntimeS <= MAX_PROJECTED_FULL_CORPUS_RUNTIME_S;

  if (!input.growth) {
    return {
      cps,
      projectedRuntimeS,
      pass,
      projectedRuntimeSecondsWithGrowth: null,
      prelaunchPass: null,
      prelaunchClassification: "FHV_PRELAUNCH_PROJECTION_UNAVAILABLE",
      probeRepresentativenessWarning:
        "growth-aware projection unavailable: probe supplied no checkpoint cost series",
    };
  }

  /*
   * `projectedRuntimeS` divides total bars by an average that already contains checkpoint time, so
   * it assumes cost per bar is constant. It is not: checkpoint cost is Θ(database size) and the
   * database grows with the run, which is why run 31011816726 over-predicted feasibility by 1.562x.
   * Model the two terms separately instead.
   */
  const hotPathWallTimeS = Math.max(
    (input.wallTimeMs - input.growth.checkpointWallTimeMs) / 1000,
    0.001,
  );
  const projection = projectFhvGrowthAwareRuntime({
    hotPathBarsPerSecond: input.barsProcessed / hotPathWallTimeS,
    sessionGrowthBytesPerCycle: input.growth.sessionGrowthBytesPerCycle,
    checkpointInterceptMs: input.growth.checkpointInterceptMs,
    checkpointMsPerGigabyte: input.growth.checkpointMsPerGigabyte,
    checkpointEveryCycles: input.growth.checkpointEveryCycles,
  });

  // A segment with fewer than two checkpoints cannot show how checkpoint cost grows, so its
  // growth term is an extrapolation from a single point.
  const probeRepresentativenessWarning =
    input.growth.checkpointCount < 2
      ? `probe segment contains ${input.growth.checkpointCount} checkpoint(s); growth term is extrapolated from too few points`
      : null;

  // Distinct from the canonical 7,200 s terminal acceptance: 6,480 s is the pre-launch margin.
  const prelaunchPass = projection.projectedRuntimeSeconds <= FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S;
  return {
    cps,
    projectedRuntimeS,
    pass,
    projectedRuntimeSecondsWithGrowth: projection.projectedRuntimeSeconds,
    prelaunchPass,
    prelaunchClassification: prelaunchPass
      ? "FHV_PRELAUNCH_PROJECTION_WITHIN_6480S"
      : "FHV_PRELAUNCH_PROJECTION_EXCEEDS_6480S",
    probeRepresentativenessWarning,
  };
}

export function evaluateFhvOfficialScaleDiskFeasibility(input: {
  artifactRoot: string;
  runDir: string;
  cycleCount: number;
}): { projectedAdditionalBytes: number; pass: boolean } {
  const stats = statfsSync(input.artifactRoot);
  const blockSize = stats.bsize;
  // Prefer bavail (unprivileged available); fall back to bfree.
  const diskFreeBytes = Number(stats.bavail ?? stats.bfree) * Number(blockSize);
  const runDirBytes = measureBoundedDirectoryBytes(input.runDir) ?? 0;
  const projectedAdditionalBytes = Math.ceil(
    (runDirBytes / Math.max(input.cycleCount, 1)) * FHV_OFFICIAL_TOTAL_BARS,
  );
  // Plan §9: peak ≤ 70% of availableBytes AND free-after-peak ≥ 30% of availableBytes
  // (equivalent inequalities when free-after = available − peak).
  const withinAvailable =
    projectedAdditionalBytes <= diskFreeBytes * DISK_PROJECTED_MAX_FRACTION_OF_AVAILABLE;
  const projectedFreeBytesAfterPeak = diskFreeBytes - projectedAdditionalBytes;
  const reserveAfter = projectedFreeBytesAfterPeak / Math.max(diskFreeBytes, Number.EPSILON);
  const pass = withinAvailable && reserveAfter >= DISK_MIN_FREE_RESERVE_FRACTION;
  return { projectedAdditionalBytes, pass };
}

export function assertFhvOfficialScaleTimeFeasibility(input: {
  barsProcessed: number;
  wallTimeMs: number;
}): { cps: number; projectedRuntimeS: number } {
  const result = evaluateFhvOfficialScaleTimeFeasibility(input);
  if (!result.pass) {
    throw new Error(
      `BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY: cps=${result.cps.toFixed(3)} projected_runtime_s=${result.projectedRuntimeS.toFixed(1)} (requires cps>=${MIN_THROUGHPUT_CPS} and projected_runtime_s<=${MAX_PROJECTED_FULL_CORPUS_RUNTIME_S})`,
    );
  }
  return { cps: result.cps, projectedRuntimeS: result.projectedRuntimeS };
}

export function assertFhvOfficialScaleDiskFeasibility(input: {
  artifactRoot: string;
  runDir: string;
  cycleCount: number;
}): void {
  const result = evaluateFhvOfficialScaleDiskFeasibility(input);
  if (!result.pass) {
    throw new Error(
      `BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY: projected_additional_bytes=${result.projectedAdditionalBytes}`,
    );
  }
}

/**
 * The classification a genuine synthetic scale-authority throughput probe must carry. Anything
 * else means the workload did not execute the intended production path, which is a software RED
 * independent of host speed.
 */
export const FHV_SYNTHETIC_PROBE_SOFTWARE_CLASSIFICATION = "FHV_SYNTHETIC_SCALE_PROBE_COMPLETED";

/**
 * Merge-blocking PR software qualification. The PR probe proves software/structural correctness —
 * correct production-path classification and the disk feasibility bound — never the absolute wall
 * speed of one hosted VM. Absolute 877/7200 is a target-host qualification concern enforced by the
 * fail-closed Execution Server throughput receipt, not by a GitHub runner's clock.
 */
export function evaluateFhvCiSoftwareGate(input: {
  classification: string;
  diskFeasibilityPass: boolean;
}): {
  pass: boolean;
  classification:
    | "FHV_CI_SOFTWARE_GATE_PASS"
    | "BLOCKED_BY_CI_SOFTWARE_CLASSIFICATION"
    | "BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY";
} {
  if (input.classification !== FHV_SYNTHETIC_PROBE_SOFTWARE_CLASSIFICATION) {
    return { pass: false, classification: "BLOCKED_BY_CI_SOFTWARE_CLASSIFICATION" };
  }
  if (!input.diskFeasibilityPass) {
    return { pass: false, classification: "BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY" };
  }
  return { pass: true, classification: "FHV_CI_SOFTWARE_GATE_PASS" };
}

export function extractFhvOfficialScaleParitySnapshot(input: {
  runDir: string;
  sourceFrontier?: FhvSourceFrontier;
  semanticReproDigest?: string;
  classification: string;
  accountingSequence?: number;
  fillsCount?: number;
  wp17OpenCount?: number;
}): FhvOfficialScaleParitySnapshot {
  const launchResultPath = join(input.runDir, "fhv-full-launch-result.v1.json");
  const launchResult = existsSync(launchResultPath)
    ? (JSON.parse(readFileSync(launchResultPath, "utf8")) as {
        semanticReproDigest?: string;
        accountingFrontierState?: { accountingSequence?: number; consumedFillIds?: string[] };
        evidenceChain?: {
          accountingStateDigest?: string;
          checkpointRef?: { manifest?: { chainDigest?: string } };
        };
        sourceFrontier?: FhvSourceFrontier;
      })
    : {};
  let authoritativeEvidenceDigest = "";
  try {
    authoritativeEvidenceDigest = readReplayRunChainProjections(input.runDir).semanticParityDigest;
  } catch {
    authoritativeEvidenceDigest =
      launchResult.evidenceChain?.checkpointRef?.manifest?.chainDigest ?? "";
  }
  const sourceFrontier = input.sourceFrontier ?? launchResult.sourceFrontier;
  let identityFrontierDigest: string | null = null;
  let sourceFrontierDigest = sourceFrontier?.terminalCursorDigest ?? "";
  if (existsSync(join(input.runDir, "fhv-launch-journal.v1.json"))) {
    const journal = readFhvLaunchJournal(input.runDir);
    try {
      const bundle = readFhvExecutionCheckpointBundle(
        resolveFhvEpochCheckpointDir(input.runDir, journal.lastCommittedEpoch),
      );
      identityFrontierDigest = bundle.manifest.identityFrontierDigest;
      if (!sourceFrontierDigest) {
        sourceFrontierDigest = bundle.manifest.sourceCursorDigest;
      }
    } catch {
      identityFrontierDigest = null;
    }
  }
  const accountingSequence =
    input.accountingSequence ?? launchResult.accountingFrontierState?.accountingSequence ?? 0;
  const fillsCount =
    input.fillsCount ?? launchResult.accountingFrontierState?.consumedFillIds?.length ?? 0;
  return {
    semanticReproDigest: input.semanticReproDigest ?? launchResult.semanticReproDigest ?? "",
    authoritativeEvidenceDigest,
    accountingStateDigest: launchResult.evidenceChain?.accountingStateDigest,
    sourceFrontierDigest,
    globalEventSequence: sourceFrontier?.globalEventSequence ?? 0,
    sourceExhausted: sourceFrontier?.sourceExhausted ?? false,
    accountingSequence,
    fillsCount,
    wp17OpenCount: input.wp17OpenCount ?? 0,
    identityFrontierDigest,
    classification: input.classification,
  };
}

export function assertFhvOfficialScaleParityMatch(
  control: FhvOfficialScaleParitySnapshot,
  candidate: FhvOfficialScaleParitySnapshot,
): void {
  const mismatches: string[] = [];
  if (candidate.semanticReproDigest !== control.semanticReproDigest) {
    mismatches.push("semanticReproDigest");
  }
  if (candidate.authoritativeEvidenceDigest !== control.authoritativeEvidenceDigest) {
    mismatches.push("authoritativeEvidenceDigest");
  }
  if (
    control.accountingStateDigest &&
    candidate.accountingStateDigest &&
    candidate.accountingStateDigest !== control.accountingStateDigest
  ) {
    mismatches.push("accountingStateDigest");
  }
  if (candidate.sourceFrontierDigest !== control.sourceFrontierDigest) {
    mismatches.push("sourceFrontierDigest");
  }
  if (candidate.globalEventSequence !== control.globalEventSequence) {
    mismatches.push("globalEventSequence");
  }
  if (candidate.sourceExhausted !== control.sourceExhausted) {
    mismatches.push("sourceExhausted");
  }
  if (candidate.accountingSequence !== control.accountingSequence) {
    mismatches.push("accountingSequence");
  }
  if (candidate.fillsCount !== control.fillsCount) {
    mismatches.push("fillsCount");
  }
  if (candidate.wp17OpenCount !== control.wp17OpenCount) {
    mismatches.push("wp17OpenCount");
  }
  if (
    control.identityFrontierDigest &&
    candidate.identityFrontierDigest &&
    candidate.identityFrontierDigest !== control.identityFrontierDigest
  ) {
    mismatches.push("identityFrontierDigest");
  }
  if (candidate.classification !== control.classification) {
    mismatches.push("classification");
  }
  if (mismatches.length > 0) {
    throw new Error(`[fhv-official-scale] parity mismatch fields: ${mismatches.join(", ")}`);
  }
}

export function assertFhvOfficialScaleProcessParityMatch(
  control: FhvOfficialScaleParitySnapshot,
  candidate: FhvOfficialScaleParitySnapshot,
): void {
  const mismatches: string[] = [];
  if (candidate.accountingSequence !== control.accountingSequence) {
    mismatches.push("accountingSequence");
  }
  if (candidate.fillsCount !== control.fillsCount) {
    mismatches.push("fillsCount");
  }
  if (candidate.wp17OpenCount !== control.wp17OpenCount) {
    mismatches.push("wp17OpenCount");
  }
  if (
    control.identityFrontierDigest &&
    candidate.identityFrontierDigest &&
    candidate.identityFrontierDigest !== control.identityFrontierDigest
  ) {
    mismatches.push("identityFrontierDigest");
  }
  if (mismatches.length > 0) {
    throw new Error(
      `[fhv-official-scale] process parity mismatch fields: ${mismatches.join(", ")}`,
    );
  }
}

export function assertFhvOfficialScaleProbeNonTrivialCheckpoint(input: {
  fillsCount: number;
  accountingSequence: number;
  wp17OpenCount?: number | null;
  reachedCheckpoint: boolean;
}): void {
  if (!input.reachedCheckpoint) {
    return;
  }
  if (input.fillsCount < MIN_FILLS_AT_CHECKPOINT) {
    throw new Error(`[fhv-official-scale] fills ${input.fillsCount} < ${MIN_FILLS_AT_CHECKPOINT}`);
  }
  if (input.accountingSequence < MIN_ACCOUNTING_SEQUENCE_AT_CHECKPOINT) {
    throw new Error(
      `[fhv-official-scale] accountingSequence ${input.accountingSequence} < ${MIN_ACCOUNTING_SEQUENCE_AT_CHECKPOINT}`,
    );
  }
  if (input.wp17OpenCount != null && input.wp17OpenCount < MIN_WP17_OPEN_AT_CHECKPOINT) {
    throw new Error(
      `[fhv-official-scale] wp17Open ${input.wp17OpenCount} < ${MIN_WP17_OPEN_AT_CHECKPOINT}`,
    );
  }
}

export function resolveWp17OpenCount(runDir: string): number | null {
  try {
    const checkpoint = readReplayCheckpoint(runDir);
    if (!checkpoint) {
      return null;
    }
    return checkpoint.executionState?.openOrders.length ?? null;
  } catch {
    return null;
  }
}

export function resolveBarsProcessed(input: {
  sourceFrontier?: FhvSourceFrontier;
  cycleCount?: number;
}): number {
  return input.sourceFrontier?.globalEventSequence ?? input.cycleCount ?? 0;
}

export function buildFhvOfficialScaleMetrics(input: {
  cycleCount: number;
  barsProcessed: number;
  wallTimeMs: number;
  classification: string;
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
  artifactRoot: string;
  runDir: string;
}): FhvOfficialScaleMetricsV1 {
  // Absolute host observation (877/7200): reported, never the hosted-runner software gate.
  const time = evaluateFhvOfficialScaleTimeFeasibility({
    barsProcessed: input.barsProcessed,
    wallTimeMs: input.wallTimeMs,
    minThroughputCps: MIN_THROUGHPUT_CPS,
  });
  const disk = evaluateFhvOfficialScaleDiskFeasibility({
    artifactRoot: input.artifactRoot,
    runDir: input.runDir,
    cycleCount: input.cycleCount,
  });
  const software = evaluateFhvCiSoftwareGate({
    classification: input.classification,
    diskFeasibilityPass: disk.pass,
  });
  const probeTargetCps = resolveProbeTargetCps();
  const probeTargetPass = time.cps >= probeTargetCps;
  const absoluteHostClassification = time.pass
    ? ("FHV_ABSOLUTE_HOST_877_7200_PASS" as const)
    : ("FHV_ABSOLUTE_HOST_877_7200_FAIL" as const);
  return {
    schemaVersion: "fhv-official-scale-metrics/v1",
    capturedAtUtc: new Date().toISOString(),
    cycleCount: input.cycleCount,
    barsProcessed: input.barsProcessed,
    wallTimeMs: input.wallTimeMs,
    cps: time.cps,
    projectedRuntimeS: time.projectedRuntimeS,
    checkpointBytes: input.checkpointBytes,
    checkpointBackupDurationMs: input.checkpointBackupDurationMs,
    classification: input.classification,
    feasibilityTimePass: time.pass,
    feasibilityDiskPass: disk.pass,
    absoluteHostTimePass: time.pass,
    absoluteHostClassification,
    ciSoftwareGatePass: software.pass,
    ciGateClassification: software.classification,
    probeTargetCps,
    probeTargetPass,
    /*
     * Gate classification now tracks the software gate (classification + disk), not absolute host
     * speed. A hosted runner measuring 874 cps reports that absolute value truthfully but no longer
     * turns the PR software gate RED on speed alone.
     */
    probeGateClassification: software.classification,
  };
}

export function readFhvOfficialScaleAuthority(authorityPath: string): FhvSyntheticScaleAuthorityV1 {
  return JSON.parse(readFileSync(authorityPath, "utf8")) as FhvSyntheticScaleAuthorityV1;
}

export function replaceFhvOfficialScaleAuthority(input: {
  authorityPath: string;
  authority: FhvSyntheticScaleAuthorityV1;
}): void {
  writeFileSync(input.authorityPath, `${JSON.stringify(input.authority, null, 2)}\n`);
}

export {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";
