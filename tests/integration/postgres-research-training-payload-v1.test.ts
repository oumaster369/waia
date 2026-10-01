/** Synthetic DEVELOPMENT-only test of the bound DEE-1159 training payload reader. */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { sealHistoricalMarketCycleV2, type HistoricalSealedMarketCycleV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { Bar } from "@/lib/trader/intelligence/types";
import { insertMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { registerResearchAttemptPostgresV1 } from "@/lib/trader/research/research-attempt-registry-postgres-v1";
import { loadRegisteredResearchTrainingBarsPostgresV1, loadRegisteredResearchTrainingExecutionInputPostgresV1 } from "@/lib/trader/research/research-training-payload-postgres-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const BAR_MS = 60_000;
const DEFAULT_LIMITS = Object.freeze({ maxBars: 10, maxBytes: 1_000_000 });

describe.skipIf(!enabled || !url)("DEE-1159 bound research training payload PostgreSQL", () => {
  let ownerSql: postgres.Sql;
  let db: WaiaPostgresDb;
  const queryLog: string[] = [];
  const queryParameters: unknown[][] = [];

  function makeBars(startMs: number, count = 10): Bar[] {
    return Array.from({ length: count }, (_unused, index) => {
      const openMs = startMs + index * BAR_MS;
      const open = String(100 + index);
      const close = String(100.5 + index);
      return {
        symbol: "BTC/USDT",
        interval: "1m",
        barOpenTime: new Date(openMs).toISOString(),
        barCloseTime: new Date(openMs + BAR_MS).toISOString(),
        open,
        high: String(101 + index),
        low: String(99 + index),
        close,
        volume: "10",
      };
    });
  }

  async function seedOrganization(label: string): Promise<string> {
    const userId = randomUUID();
    await ownerSql`INSERT INTO auth.users (id) VALUES (${userId}::uuid) ON CONFLICT (id) DO NOTHING`;
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: label,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
    return ensureUserCoreSeedPostgres(db, { userId, displayName: label });
  }

  async function seedSyntheticDevelopmentAuthority(input: {
    label: string;
    marketBars?: readonly Bar[];
    authorityBars?: readonly Bar[];
    corruptMembershipBarDigestIndex?: number;
    extraClosedBarIndex?: number;
    proposalTrain?: { firstOpenMs: number; lastCloseMs: number; barCount: number; contentSha256: string };
    duplicateAuthorityRun?: boolean;
    transformCycle?: (cycle: HistoricalSealedMarketCycleV2, index: number) => HistoricalSealedMarketCycleV2;
    requestedVolumeDigest?: string;
  }) {
    const orgId = await seedOrganization(input.label);
    const context = requireOrgContext(orgId);
    const development = resolveFhvCanonicalPartitionInterval("development");
    const startMs = Date.parse(development.startUtc);
    const authorityBars = input.authorityBars ? [...input.authorityBars] : makeBars(startMs);
    const marketBars = input.marketBars ? [...input.marketBars] : [...authorityBars];
    const sourceRunId = `dee1159-training-test-${randomUUID()}`;
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      qualifiedAtUtc: development.startUtc,
      // Synthetic-only authority fixture; this does not assert any live or
      // production HTX qualification and is never used as strategy evidence.
      rows: [{ id: 1, open: 100, high: 102, low: 99, close: 101, amount: 10, vol: 1010, count: 1 }],
    });
    expect(receipt.verdict).toBe("HTX_VOLUME_AUTHORITY_QUALIFIED");
    const partitionDigestHex = "4".repeat(64);
    const partitionRawSha256Hex = "5".repeat(64);

    const authorityRunIds = input.duplicateAuthorityRun ? [sourceRunId, `${sourceRunId}-duplicate`] : [sourceRunId];
    for (const runId of authorityRunIds) for (const [index, bar] of authorityBars.entries()) {
      const cycleId = `${runId}:DEVELOPMENT:BTCUSDT:${index}`;
      const closedBar = index === input.extraClosedBarIndex
        ? { ...bar, extraOpaquePayload: "unexpected synthetic field" } as Bar
        : bar;
      let cycle = sealHistoricalMarketCycleV2({
        cycleId,
        barIndex: index,
        closedBar,
        htxVolumeAuthorityReceipt: receipt,
        htxVolumeRaw: { amount: 10, vol: 1010 },
      });
      cycle = input.transformCycle?.(cycle, index) ?? cycle;
      const membershipBody = {
        schemaVersion: "waia.trader.historical_dataset_membership.v2",
        organizationId: orgId,
        cycleId,
        datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1",
        datasetAuthorityDigestHex: receipt.qualificationReceiptDigest,
        qualificationReceiptDigestHex: receipt.qualificationReceiptDigest,
        partitionDigestHex,
        partitionRawSha256Hex,
        partition: "DEVELOPMENT",
        symbol: "BTCUSDT",
        recordIndex: index,
        barContentDigestHex: index === input.corruptMembershipBarDigestIndex
          ? "f".repeat(64)
          : computeBarContentDigest(closedBar),
        sealedCycleContentDigestHex: cycle.contentDigestHex,
      } as const;
      const membership = Object.freeze({
        ...membershipBody,
        contentDigestHex: computeSemanticSha256Hex(membershipBody),
      });
      const authorityContentDigestHex = computeStableAuthorityDigest({ orgId, sourceRunId: runId, membership, cycle });
      await ownerSql`
        INSERT INTO trader_historical_dataset_authority_v2 (
          organization_id, run_id, cycle_id, dataset_authority_class,
          dataset_authority_digest_hex, membership_content_digest_hex,
          sealed_cycle_content_digest_hex, membership_json, sealed_cycle_json,
          authority_content_digest_hex, schema_version
        ) VALUES (
          ${orgId}::uuid, ${runId}, ${cycleId}, 'PRE_HOLDOUT_QUALIFICATION_V1',
          ${receipt.qualificationReceiptDigest}, ${membership.contentDigestHex},
          ${cycle.contentDigestHex}, ${JSON.stringify(membership)}::text::jsonb,
          ${JSON.stringify(cycle)}::text::jsonb, ${authorityContentDigestHex},
          'waia.trader.historical_dataset_authority.v2'
        )
      `;
    }

    await insertMarketBarsPostgres(db, context, marketBars.map(bar => ({ bar })));

    const trainBars = authorityBars;
    const firstOpenMs = Date.parse(trainBars[0]!.barOpenTime);
    const lastCloseMs = Date.parse(trainBars.at(-1)!.barCloseTime);
    const validationFirstMs = input.proposalTrain?.lastCloseMs ?? lastCloseMs;
    const validationLastMs = validationFirstMs + 6 * BAR_MS;
    const blindFirstMs = validationLastMs;
    const blindLastMs = blindFirstMs + 6 * BAR_MS;
    const proposal = buildResearchExperimentProposalV1(orgId, input.label);
    proposal.replay.volumeQualificationSha256 = input.requestedVolumeDigest ?? receipt.qualificationReceiptDigest;
    proposal.universe.symbol = "BTCUSDT";
    proposal.universe.datasetSourceSha256 = receipt.qualificationReceiptDigest;
    proposal.partitions.train = input.proposalTrain ?? {
      contentSha256: computeBarSetDigest(trainBars), firstOpenMs, lastCloseMs, barCount: trainBars.length,
    };
    proposal.partitions.validation = {
      contentSha256: "6".repeat(64), firstOpenMs: validationFirstMs, lastCloseMs: validationLastMs, barCount: 6,
    };
    proposal.partitions.blind = {
      contentSha256: "7".repeat(64), firstOpenMs: blindFirstMs, lastCloseMs: blindLastMs, barCount: 6,
    };
    proposal.partitions.walkForward = [
      { contentSha256: "8".repeat(64), firstOpenMs: validationFirstMs, lastCloseMs: validationFirstMs + 3 * BAR_MS, barCount: 3 },
      { contentSha256: "9".repeat(64), firstOpenMs: validationFirstMs + 3 * BAR_MS, lastCloseMs: validationLastMs, barCount: 3 },
    ];
    const registered = await registerResearchExperimentPostgresV1(db, context, proposal);
    const attempt = await registerResearchAttemptPostgresV1(db, context, {
      specSha256: registered.specSha256,
      sourceRunId,
      commandId: `training-${randomUUID()}`,
    });
    return { orgId, context, sourceRunId, bars: trainBars, receipt, proposal, registered, attempt };
  }

  function computeStableAuthorityDigest(input: {
    orgId: string;
    sourceRunId: string;
    membership: unknown;
    cycle: unknown;
  }): string {
    // Keep this identical to the existing durable authority row validator.
    return computeStableJsonDigest({
      organizationId: input.orgId,
      runId: input.sourceRunId,
      membership: input.membership,
      sealedCycle: input.cycle,
    });
  }

  function isPayloadPacketQuery(query: string): boolean {
    return /^\s*select\s+jsonb_build_object/i.test(query);
  }

  function marketAuthorityQueries(): string[] {
    return queryLog.filter(query => /from\s+public\.trader_historical_dataset_authority_v2/i.test(query));
  }

  beforeAll(async () => {
    ownerSql = postgres(url!, { max: 6, prepare: false, debug: (_connection, query, parameters) => {
      queryLog.push(query);
      queryParameters.push(parameters);
    } });
    db = drizzle(ownerSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
  }, 15_000);

  afterAll(async () => {
    await ownerSql?.end({ timeout: 5 });
  }, 15_000);

  it("loads exactly the registered DEVELOPMENT train interval from durable authority rows", async () => {
    const rawBarsPoison = makeBars(Date.parse("2025-01-01T00:00:00.000Z"), 1);
    const fixture = await seedSyntheticDevelopmentAuthority({
      label: "training-exact-range",
      // Even a stored raw-market-bars row in blind-holdout time is not a
      // fallback source for this DEVELOPMENT authority-bound reader.
      marketBars: [...makeBars(Date.parse(resolveFhvCanonicalPartitionInterval("development").startUtc)), ...rawBarsPoison],
    });
    queryLog.length = 0;
    const result = await loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: DEFAULT_LIMITS,
    });

    expect(result.authority).toBe("TRAINING_PAYLOAD_INTEGRITY_ONLY");
    expect(result.source).toBe("PRE_HOLDOUT_DEVELOPMENT_AUTHORITY_V2");
    expect(result.scope.identity.attemptId).toBe(fixture.attempt.id);
    expect(result.scope.identity.trialIndex).toBe(0);
    expect(result.scope.identity.sourceRunId).toBe(fixture.sourceRunId);
    expect(result.partition).toEqual(fixture.registered.spec.partitions.train);
    expect(result.bars).toEqual(fixture.bars);
    expect(Object.isFrozen(result.bars)).toBe(true);
    expect(result.bars.every(bar => Object.isFrozen(bar))).toBe(true);
    const packetReads = queryLog.filter(isPayloadPacketQuery);
    expect(packetReads).toHaveLength(1);
    expect(packetReads[0]).toContain("closedBar");
    expect(queryLog.some(query => /from\s+public\.trader_market_bars/i.test(query))).toBe(false);
    expect(queryLog.some(query => /validation|blind-holdout/i.test(query))).toBe(false);
  });

  it("preserves source volume cycles in a deeply frozen execution input bound to the declared volume receipt", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({ label: "training-execution-input" });
    const result = await loadRegisteredResearchTrainingExecutionInputPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id, trialIndex: 1, limits: DEFAULT_LIMITS,
    });
    expect(result.authority).toBe("TRAINING_EXECUTION_INPUT_INTEGRITY_ONLY");
    expect(result.scope.identity.parameters.lookbackBars).toBe(16);
    expect(result.volumeQualificationSha256).toBe(fixture.receipt.qualificationReceiptDigest);
    expect(result.cycles).toHaveLength(10);
    expect(result.cycles[0]!.cycleId).toBe(`${fixture.sourceRunId}:DEVELOPMENT:BTCUSDT:0`);
    expect(result.cycles.map(cycle => cycle.closedBar)).toEqual(fixture.bars);
    for (const cycle of result.cycles) {
      expect(cycle.htxVolumeAuthorityReceipt).toEqual(fixture.receipt);
      expect(cycle.htxVolumeRaw).toEqual({ amount: 10, vol: 1010 });
      for (const value of [cycle, cycle.closedBar, cycle.htxVolumeAuthorityReceipt, cycle.htxVolumeRaw]) {
        expect(Object.isFrozen(value)).toBe(true);
      }
    }
    expect(Object.isFrozen(result.cycles)).toBe(true);
    expect(() => Reflect.set(result.cycles[0]!.htxVolumeRaw, "amount", 999)).not.toThrow();
    expect(result.cycles[0]!.htxVolumeRaw.amount).toBe(10);
  });

  it("refuses a valid volume receipt that differs from the immutable experiment commitment", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({
      label: "training-execution-volume-commitment", requestedVolumeDigest: "0".repeat(64),
    });
    await expect(loadRegisteredResearchTrainingExecutionInputPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id, trialIndex: 0, limits: DEFAULT_LIMITS,
    })).rejects.toThrow("RESEARCH_TRAINING_VOLUME_COMMITMENT_MISMATCH");
  });

  it.each([
    ["inner receipt digest", (cycle: HistoricalSealedMarketCycleV2) => ({ ...cycle,
      htxVolumeAuthorityReceipt: { ...cycle.htxVolumeAuthorityReceipt, sampleCount: 2 } }),
      "QUALIFICATION_RECEIPT_DIGEST_MISMATCH"],
    ["quote as base", (cycle: HistoricalSealedMarketCycleV2) => ({ ...cycle,
      htxVolumeRaw: { amount: 1010, vol: 1010 } }), "RESEARCH_TRAINING_VOLUME_BASE_MISMATCH"],
    ["negative quote", (cycle: HistoricalSealedMarketCycleV2) => ({ ...cycle,
      htxVolumeRaw: { amount: 10, vol: -1 } }), ""],
    ["opaque receipt payload", (cycle: HistoricalSealedMarketCycleV2) => ({ ...cycle,
      htxVolumeAuthorityReceipt: { ...cycle.htxVolumeAuthorityReceipt, opaquePayload: "unexpected" } }), ""],
    ["opaque cycle payload", (cycle: HistoricalSealedMarketCycleV2) => ({ ...cycle,
      opaquePayload: "unexpected" }), ""],
  ] as const)("refuses %s even when source and outer cycle seals are recomputed", async (label, transform, errorCode) => {
    const fixture = await seedSyntheticDevelopmentAuthority({
      label: `training-volume-${label.replaceAll(" ", "-")}`,
      transformCycle(cycle, index) {
        if (index !== 5) return cycle;
        const { contentDigestHex: _digest, schemaVersion: _schema, ...body } = transform(cycle);
        return sealHistoricalMarketCycleV2(body);
      },
    });
    // The old bars-only contract proves exactly its narrower integrity scope.
    const bars = await loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id, trialIndex: 0, limits: DEFAULT_LIMITS,
    });
    expect(bars.bars).toEqual(fixture.bars);
    const run = loadRegisteredResearchTrainingExecutionInputPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id, trialIndex: 0, limits: DEFAULT_LIMITS,
    });
    if (errorCode) await expect(run).rejects.toThrow(errorCode === "QUALIFICATION_RECEIPT_DIGEST_MISMATCH"
      ? "HTX volume qualification receipt digest mismatch" : errorCode);
    else await expect(run).rejects.toThrow();
  });

  it("reads only the authority run committed to the attempt when another run has identical bars and digest", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({
      label: "training-source-run-isolation",
      duplicateAuthorityRun: true,
    });
    queryLog.length = 0;
    queryParameters.length = 0;
    const result = await loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: DEFAULT_LIMITS,
    });
    expect(result.sourceRunId).toBe(fixture.sourceRunId);
    expect(result.scope.identity.sourceRunId).toBe(fixture.sourceRunId);
    expect(result.bars).toEqual(fixture.bars);
    const selectedRuns = queryParameters.flat().filter(value =>
      typeof value === "string" && (value === fixture.sourceRunId || value === `${fixture.sourceRunId}-duplicate`));
    expect(selectedRuns).toEqual([fixture.sourceRunId, fixture.sourceRunId]);
  });

  it("rejects missing attempt, wrong tenant, and undeclared trial before payload retrieval", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({ label: "training-prerequisite-fences" });
    const base = { trialIndex: 0, limits: DEFAULT_LIMITS };
    queryLog.length = 0;
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      ...base, attemptId: randomUUID(),
    })).rejects.toThrow("RESEARCH_ATTEMPT_NOT_REGISTERED");
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, requireOrgContext(randomUUID()), {
      ...base, attemptId: fixture.attempt.id,
    })).rejects.toThrow("RESEARCH_ATTEMPT_NOT_REGISTERED");
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      ...base, attemptId: fixture.attempt.id, trialIndex: fixture.registered.spec.orderedTrials.length,
    })).rejects.toThrow("RESEARCH_TRIAL_NOT_DECLARED");
    expect(queryLog.filter(isPayloadPacketQuery)).toEqual([]);
  });

  it("refuses caller-labeled 2025 blind-holdout time as a DEVELOPMENT training interval", async () => {
    const development = resolveFhvCanonicalPartitionInterval("development");
    const blindStart = Date.parse("2025-01-01T00:00:00.000Z");
    const forgedTrain = {
      contentSha256: "a".repeat(64),
      firstOpenMs: blindStart,
      lastCloseMs: blindStart + 10 * BAR_MS,
      barCount: 10,
    };
    const fixture = await seedSyntheticDevelopmentAuthority({
      label: "training-blind-relabel-refused",
      proposalTrain: forgedTrain,
    });
    expect(forgedTrain.firstOpenMs).toBeGreaterThan(Date.parse(development.endUtc));
    queryLog.length = 0;
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: DEFAULT_LIMITS,
    })).rejects.toThrow("RESEARCH_TRAINING_DEVELOPMENT_BOUNDARY_REQUIRED");
    expect(queryLog.filter(isPayloadPacketQuery)).toEqual([]);
  });

  it("checks row authority, contiguous count, and train digest against exact source bars", async () => {
    const cases = [
      { label: "short-source", authorityCount: 9, proposal: "full-ten", error: "RESEARCH_TRAINING_PAYLOAD_COUNT_MISMATCH" },
      { label: "wrong-authority-bar-digest", authorityCount: 10, proposal: "valid", corruptMembershipBarDigestIndex: 4, error: "HISTORICAL_PRODUCTION_NEXT_CYCLE_REFUSED:DATASET_AUTHORITY" },
      { label: "wrong-train-digest", authorityCount: 10, proposal: "wrong-digest", error: "HTR_WP12_INGRESS_DIGEST_MISMATCH" },
      { label: "wrong-train-end", authorityCount: 10, proposal: "wrong-end", error: "RESEARCH_TRAINING_PAYLOAD_INTERVAL_MISMATCH" },
      { label: "extra-closed-bar-field", authorityCount: 10, proposal: "valid", extraClosedBarIndex: 4, error: "RESEARCH_TRAINING_BAR_FIELDS_INVALID" },
    ] as const;
    for (const testCase of cases) {
      const fullBars = makeBars(Date.parse(resolveFhvCanonicalPartitionInterval("development").startUtc), 10);
      const authorityBars = fullBars.slice(0, testCase.authorityCount);
      const proposalTrain = testCase.proposal === "full-ten"
        ? {
          contentSha256: computeBarSetDigest(fullBars),
          firstOpenMs: Date.parse(fullBars[0]!.barOpenTime),
          lastCloseMs: Date.parse(fullBars.at(-1)!.barCloseTime),
          barCount: fullBars.length,
        }
        : testCase.proposal === "wrong-digest"
          ? {
            contentSha256: "a".repeat(64),
            firstOpenMs: Date.parse(fullBars[0]!.barOpenTime),
            lastCloseMs: Date.parse(fullBars.at(-1)!.barCloseTime),
            barCount: fullBars.length,
          }
          : testCase.proposal === "wrong-end"
            ? {
              contentSha256: computeBarSetDigest(fullBars),
              firstOpenMs: Date.parse(fullBars[0]!.barOpenTime),
              lastCloseMs: Date.parse(fullBars.at(-1)!.barCloseTime) + BAR_MS,
              barCount: fullBars.length,
            }
            : undefined;
      const fixture = await seedSyntheticDevelopmentAuthority({
        label: `training-${testCase.label}`,
        authorityBars,
        corruptMembershipBarDigestIndex: "corruptMembershipBarDigestIndex" in testCase ? testCase.corruptMembershipBarDigestIndex : undefined,
        extraClosedBarIndex: "extraClosedBarIndex" in testCase ? testCase.extraClosedBarIndex : undefined,
        proposalTrain,
      });
      queryLog.length = 0;
      await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
        attemptId: fixture.attempt.id,
          trialIndex: 0,
        limits: DEFAULT_LIMITS,
      })).rejects.toThrow(testCase.error);
    }
  });

  it("refuses operational bar and byte limits before returning any payload packet", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({ label: "training-read-limits" });
    queryLog.length = 0;
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: { maxBars: 9, maxBytes: DEFAULT_LIMITS.maxBytes },
    })).rejects.toThrow("RESEARCH_TRAINING_READ_BAR_LIMIT");
    expect(marketAuthorityQueries()).toEqual([]);

    queryLog.length = 0;
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: { maxBars: DEFAULT_LIMITS.maxBars, maxBytes: 1 },
    })).rejects.toThrow("RESEARCH_TRAINING_READ_BYTE_LIMIT");
    expect(queryLog.filter(isPayloadPacketQuery)).toEqual([]);
    expect(marketAuthorityQueries().some(query => /select\s+count\(/i.test(query))).toBe(true);
  });

  it("captures request, limits, and tenant before awaiting database reads", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({ label: "training-input-capture" });
    const supplied: {
      attemptId: string; trialIndex: number; limits: { maxBars: number; maxBytes: number };
    } = {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: { ...DEFAULT_LIMITS },
    };
    const mutableContext = { organizationId: fixture.orgId } as OrgContext;
    const pending = loadRegisteredResearchTrainingBarsPostgresV1(db, mutableContext, supplied);
    supplied.attemptId = randomUUID();
    supplied.trialIndex = 2;
    supplied.limits.maxBars = 1;
    (mutableContext as unknown as { organizationId: string }).organizationId = randomUUID();
    const loaded = await pending;
    expect(loaded.sourceRunId).toBe(fixture.sourceRunId);
    expect(loaded.scope.identity.attemptId).toBe(fixture.attempt.id);
    expect(loaded.scope.identity.trialIndex).toBe(0);
    expect(loaded.bars).toEqual(fixture.bars);
  });

  it("rejects a caller-supplied source override before any database query", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({ label: "training-source-override-refused" });
    queryLog.length = 0;
    queryParameters.length = 0;
    await expect(loadRegisteredResearchTrainingBarsPostgresV1(db, fixture.context, {
      attemptId: fixture.attempt.id,
      trialIndex: 0,
      limits: DEFAULT_LIMITS,
      sourceRunId: `${fixture.sourceRunId}-attacker`,
    } as unknown as Parameters<typeof loadRegisteredResearchTrainingBarsPostgresV1>[2])).rejects.toThrow();
    expect(queryLog).toEqual([]);
    expect(queryParameters).toEqual([]);
  });

  it("refuses nested/savepoint adapters without querying durable or market payload rows", async () => {
    const fixture = await seedSyntheticDevelopmentAuthority({ label: "training-root-database-only" });
    queryLog.length = 0;
    await db.transaction(async tx => {
      await expect(loadRegisteredResearchTrainingBarsPostgresV1(tx as unknown as WaiaPostgresDb,
        fixture.context, {
          attemptId: fixture.attempt.id,
          trialIndex: 0,
          limits: DEFAULT_LIMITS,
        })).rejects.toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
    });
    expect(marketAuthorityQueries()).toEqual([]);
  });
});
