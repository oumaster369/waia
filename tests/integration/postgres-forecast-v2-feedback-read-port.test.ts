import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { createForecastFeedbackFixture } from "@/tests/helpers/forecast-v2-feedback-native-fixture";
import { readForecastV2FeedbackPostgres, type ForecastV2FeedbackReference } from
  "@/lib/trader/intelligence/outcome-resolution/forecast-v2-feedback-read-port-postgres";
import { persistForecastV2TerminalClosurePostgres } from
  "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { FORECAST_CALIBRATION_SCHEMA_VERSION, persistForecastCalibrationObservationV2, persistObjectiveForecastOutcomeResolutionV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { schemaVersionTextToInt2 } from "@/lib/trader/intelligence/forecast-v2/schema-version-storage-v1";
import { createKnowledgeConfidenceUpdateRepositoryPostgres } from
  "@/lib/trader/knowledge/knowledge-confidence-update-repository-postgres";
import { computeKnowledgeConfidenceUpdateContentDigest, type KnowledgeConfidenceUpdateRecord } from
  "@/lib/trader/knowledge/knowledge-confidence-update";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import * as schema from "@/db/schema.postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL_POSTGRES;
type Fixture = Awaited<ReturnType<Awaited<ReturnType<typeof createForecastFeedbackFixture>>["pending"]>>;

// Instrument the actual transaction, without substituting any SQL results or
// adding an observer callback to the production API.
function afterFirstBundleRead(pool: postgres.Sql, hook: (tx: postgres.Sql) => Promise<void>): postgres.Sql {
  return new Proxy(pool, {
    get(target, property) {
      if (property !== "begin") return Reflect.get(target, property);
      return (options: string, callback: (tx: postgres.Sql) => Promise<unknown>) =>
        target.begin(options, async (tx) => {
          let called = false;
          const wrapped = new Proxy(tx, {
            apply(tag, thisArg, args) {
              const queryResult = Reflect.apply(tag, thisArg, args);
              const query = Array.isArray(args[0]) ? args[0].join(" ") : "";
              if (!called && query.includes("FROM trader_forecast_bundle_v2")) {
                called = true;
                return (async () => {
                  const result = await queryResult;
                  await hook(tx as unknown as postgres.Sql);
                  return result;
                })();
              }
              return queryResult;
            },
          });
          return callback(wrapped as unknown as postgres.Sql);
        });
    },
  });
}

describe.skipIf(!enabled)("DEE-1110 durable Forecast feedback read port (native Postgres)", () => {
  let sql: postgres.Sql;
  let orgId: string;
  let factory: Awaited<ReturnType<typeof createForecastFeedbackFixture>>;
  const context = () => ({ organizationId: orgId });

  beforeAll(async () => {
    if (!databaseUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) {
      throw new Error("DEE1110_NATIVE_TESTS_REQUIRE_LOOPBACK_POSTGRES");
    }
    sql = postgres(databaseUrl, { max: 3 });
    orgId = await seedWp13User(databaseUrl, randomUUID(), "DEE-1110 synthetic feedback fixture");
    factory = await createForecastFeedbackFixture(sql, orgId);
  }, 120_000);
  afterAll(async () => {
    // Append-only synthetic rows are retained in this disposable local/CI DB.
    // No shared trigger is disabled and no other suite's rows are deleted.
    await sql?.end({ timeout: 5 });
  });

  async function writeOutcome(fixture: Fixture, legacy = false) {
    const { input } = fixture;
    await persistObjectiveForecastOutcomeResolutionV2(sql, {
      organizationId: orgId, bundleId: input.bundleId, forecastId: input.forecastId,
      targetRoleId: "TERMINAL_RETURN", resolvedAtIso: input.objectiveEvidence.resolvedAt,
      anchorClosedBarEpochMs: input.objectiveEvidence.anchorClosedBarEpochMs,
      primaryHorizonMinutes: input.objectiveEvidence.primaryHorizonMinutes,
      observedOutcomeDigestHex: input.objectiveEvidence.observedOutcomeDigestHex,
      contentDigestHex: input.objectiveOutcomeContentDigestHex,
      pitMeasurementIdentityDigestHex: input.objectiveEvidence.pitMeasurementIdentityDigestHex,
      ...(legacy ? {} : { feedbackPayload: {
        authorizedOutcome: input.authorizedOutcome, objectiveEvidence: input.objectiveEvidence,
      } }),
    });
  }
  async function writeCalibration(fixture: Fixture) {
    await persistForecastCalibrationObservationV2(sql, {
      organizationId: orgId, bundleId: fixture.input.bundleId, forecastId: fixture.input.forecastId,
      targetRoleId: "TERMINAL_RETURN", contentDigestHex: fixture.closure.calibrationObservation.contentDigest,
      scoringEligible: true, observation: fixture.closure.calibrationObservation,
    });
  }
  async function writeKnowledge(record: KnowledgeConfidenceUpdateRecord) {
    await drizzle(sql, { schema }).transaction(async (tx) => {
      const repository = createKnowledgeConfidenceUpdateRepositoryPostgres(tx);
      await repository.insert(context(), record);
    });
  }
  async function complete() {
    const fixture = await factory.pending();
    await persistForecastV2TerminalClosurePostgres(sql, fixture.input);
    return fixture;
  }
  const read = (reference: ForecastV2FeedbackReference) => readForecastV2FeedbackPostgres(sql, context(), reference);

  it("replays committed production-writer content through a fresh connection and a new native process", async () => {
    const fixture = await complete();
    const result = await read(fixture.reference);
    expect(result).toMatchObject({ status: "ok", capitalAuthority: "NONE", authorityClass: "EVIDENCE_ONLY",
      knowledgeUpdate: fixture.closure.knowledgeUpdate, calibrationObservation: fixture.closure.calibrationObservation,
      objectiveEvidence: fixture.input.objectiveEvidence });
    const restartedConnection = postgres(databaseUrl!, { max: 1 });
    try {
      expect(await readForecastV2FeedbackPostgres(restartedConnection, context(), fixture.reference)).toEqual(result);
    } finally { await restartedConnection.end({ timeout: 5 }); }
    const serialized = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server",
        "tests/helpers/forecast-v2-feedback-reader-process.ts"], {
        cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test" }, stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let errors = "";
      const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 20_000);
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(output);
        else reject(new Error(`Child reader exited ${code}: ${errors}`));
      });
      child.stdin.end(JSON.stringify({ organizationId: orgId, reference: fixture.reference }));
    });
    expect(JSON.parse(serialized)).toEqual(result);
  }, 30_000);

  it("refuses tenant, exact references, symbol and future destination mismatches", async () => {
    const { reference, bundle } = await complete();
    expect(await readForecastV2FeedbackPostgres(sql, { organizationId: randomUUID() }, reference))
      .toMatchObject({ status: "unavailable", reason: "MISSING_SOURCE", source: "bundle" });
    for (const changed of [
      { bundleId: randomUUID() }, { forecastId: randomUUID() }, { packageId: randomUUID() },
      { forecastId: bundle.executionForecastId }, { symbol: "ETHUSDT" },
      { futureRunId: "foreign-run" }, { futureCycleId: "foreign-cycle" },
      { knowledgeUpdateIdempotencyKey: `${reference.knowledgeUpdateIdempotencyKey}-foreign` },
    ]) {
      expect(await read({ ...reference, ...changed })).toMatchObject({ status: "unavailable" });
    }
    const another = await complete();
    expect(await read({ ...reference, forecastId: another.reference.forecastId }))
      .toMatchObject({ reason: "IDENTITY_MISMATCH", source: "forecast" });
  });

  it("accepts only the exact saved future anchor, after objective resolution", async () => {
    const { reference } = await complete();
    expect(await read({ ...reference, futureCyclePitAnchor: "2024-01-01T00:33:59.999Z" }))
      .toMatchObject({ reason: "NOT_YET_VISIBLE" });
    expect(await read({ ...reference, futureCyclePitAnchor: "2024-01-01T00:34:00.001Z" }))
      .toMatchObject({ reason: "IDENTITY_MISMATCH" });
    expect(await read(reference)).toMatchObject({ status: "ok" });
    expect(await read({ ...reference, futureCyclePitAnchor: "2024-01-01T00:34:00Z" }))
      .toMatchObject({ reason: "INVALID_REFERENCE" });
    const impossible = await factory.pending();
    await expect(persistForecastV2TerminalClosurePostgres(sql, {
      ...impossible.input, futureCyclePitAnchor: impossible.input.objectiveEvidence.resolvedAt,
    })).rejects.toThrow(/future-cycle only/);
  });

  it("refuses a persisted historical-package graft before it can be treated as ordinary feedback", async () => {
    const fixture = await complete();
    const historical = await factory.historicalPackage();
    const bundleId = randomUUID();
    const forecastId = randomUUID();
    // Malformed INSERT-only fixture: valid persisted historical package attached
    // to a general outcome. No genuine historical qualification is asserted.
    await sql`INSERT INTO trader_forecast_bundle_v2 (
      id, organization_id, predictive_package_id, run_id, cycle_id, symbol, anchor_closed_bar_epoch_ms,
      completeness_state, bundle_content_digest, schema_version, forecast_runtime_authorized_outcome_json,
      forecast_runtime_issuance_sequence
    ) SELECT ${bundleId}::uuid, organization_id, ${historical.packageId}::uuid, 'dee1110-graft',
      ${bundleId}, symbol, anchor_closed_bar_epoch_ms, completeness_state, bundle_content_digest, schema_version,
      forecast_runtime_authorized_outcome_json, forecast_runtime_issuance_sequence
      FROM trader_forecast_bundle_v2 WHERE organization_id = ${orgId}::uuid AND id = ${fixture.input.bundleId}::uuid`;
    await sql`INSERT INTO trader_forecast_v2 (
      id, organization_id, bundle_id, target_role_id, forecast_generation_identity_digest,
      forecast_content_digest, distribution_semantic_digest, k_config_dec, m_config_dec, s_dec, schema_version
    ) SELECT ${forecastId}::uuid, organization_id, ${bundleId}::uuid, target_role_id,
      forecast_generation_identity_digest, forecast_content_digest, distribution_semantic_digest,
      k_config_dec, m_config_dec, s_dec, schema_version FROM trader_forecast_v2
      WHERE organization_id = ${orgId}::uuid AND id = ${fixture.input.forecastId}::uuid`;
    expect(await read({ ...fixture.reference, bundleId, forecastId, packageId: historical.packageId }))
      .toMatchObject({ reason: "NAMESPACE_MISMATCH", source: "package" });
  });

  it("reports absent outcome/calibration/Knowledge individually and legacy payload explicitly", async () => {
    const pending = await factory.pending();
    expect(await read(pending.reference)).toMatchObject({ reason: "MISSING_SOURCE", source: "outcome" });
    await writeOutcome(pending);
    expect(await read(pending.reference)).toMatchObject({ reason: "MISSING_SOURCE", source: "calibration" });
    await writeCalibration(pending);
    expect(await read(pending.reference)).toMatchObject({ reason: "MISSING_SOURCE", source: "knowledge" });
    await writeKnowledge(pending.closure.knowledgeUpdate);
    expect(await read(pending.reference)).toMatchObject({ status: "ok" });
    const legacy = await factory.pending();
    await writeOutcome(legacy, true);
    expect(await read(legacy.reference)).toMatchObject({ reason: "LEGACY_PAYLOAD_UNAVAILABLE", source: "outcome" });
    const oldCalibration = await factory.pending();
    await writeOutcome(oldCalibration);
    await persistForecastCalibrationObservationV2(sql, {
      organizationId: orgId, bundleId: oldCalibration.input.bundleId, forecastId: oldCalibration.input.forecastId,
      targetRoleId: "TERMINAL_RETURN", contentDigestHex: oldCalibration.closure.calibrationObservation.contentDigest,
      scoringEligible: true,
    });
    expect(await read(oldCalibration.reference)).toMatchObject({ reason: "LEGACY_PAYLOAD_UNAVAILABLE", source: "calibration" });
  });

  it("refuses the generic writer's supported alternate outcome digest convention without changing the writer", async () => {
    const fixture = await factory.pending();
    await persistForecastV2TerminalClosurePostgres(sql, { ...fixture.input,
      objectiveOutcomeContentDigestHex: "9".repeat(64) });
    expect(await read(fixture.reference)).toMatchObject({ reason: "UNSUPPORTED_OUTCOME_DIGEST_LAYOUT", source: "outcome" });
  });

  it("reconstructs nested Knowledge identities and separately verifies its unhashed ID/key", async () => {
    for (const attack of ["nested", "id", "sequence"] as const) {
      const fixture = await factory.pending();
      await writeOutcome(fixture);
      await writeCalibration(fixture);
      const valid = fixture.closure.knowledgeUpdate;
      const sources = JSON.parse(valid.sourceRecordIdsJson);
      const corrupt = { ...valid,
        ...(attack === "nested" ? { sourceRecordIdsJson: canonicalizeSemanticJsonString({ ...sources,
          forecast_outcome_content_digest_hex: fixture.input.objectiveOutcomeContentDigestHex }) } : {}),
        ...(attack === "id" ? { id: randomUUID() } : {}),
        ...(attack === "sequence" ? { idempotencyKey: valid.idempotencyKey.replace(/\|\d+$/, "|01") } : {}),
      };
      corrupt.contentDigest = computeKnowledgeConfidenceUpdateContentDigest(corrupt);
      await writeKnowledge(corrupt);
      expect(await read({ ...fixture.reference, knowledgeUpdateIdempotencyKey: corrupt.idempotencyKey }))
        .toMatchObject({ reason: "CORRUPT_SOURCE", source: "knowledge" });
    }
  });

  it("replays nested calibration content instead of trusting its stored digest", async () => {
    const fixture = await factory.pending();
    await writeOutcome(fixture);
    const valid = fixture.closure.calibrationObservation;
    // Deliberately inconsistent INSERT fixture; append-only guards stay enabled.
    await sql`INSERT INTO trader_forecast_calibration_observation_v2 (
      organization_id, bundle_id, forecast_id, target_role_id, scoring_eligible, content_digest, schema_version,
      scoring_version, observed_bucket_ordinal, probability_vector_json, normalized_brier_score, log_loss_score,
      calibration_payload_json
    ) VALUES (${orgId}::uuid, ${fixture.input.bundleId}::uuid, ${fixture.input.forecastId}::uuid,
      'TERMINAL_RETURN', true, ${Buffer.from(valid.contentDigest, "hex")},
      ${schemaVersionTextToInt2(FORECAST_CALIBRATION_SCHEMA_VERSION)}, ${valid.schemaVersion},
      ${valid.observedBucketOrdinal}, ${JSON.stringify(valid.probabilities)}::text::jsonb,
      ${Number(valid.normalizedBrierScore)}, ${Number(valid.logLossScore)},
      ${JSON.stringify({ ...valid, probabilities: [1, 0, 0, 0, 0, 0, 0] })}::text::jsonb)`;
    expect(await read(fixture.reference)).toMatchObject({ reason: "CORRUPT_SOURCE", source: "calibration" });
  });

  it("uses one actual read-only repeatable snapshot across a concurrent atomic writer", async () => {
    const fixture = await factory.pending();
    const writer = postgres(databaseUrl!, { max: 1 });
    try {
      const snapshot = afterFirstBundleRead(sql, async (tx) => {
        expect((await tx`SHOW transaction_isolation`)[0]?.transaction_isolation).toBe("repeatable read");
        expect((await tx`SHOW transaction_read_only`)[0]?.transaction_read_only).toBe("on");
        await persistForecastV2TerminalClosurePostgres(writer, fixture.input);
      });
      expect(await readForecastV2FeedbackPostgres(snapshot, context(), fixture.reference))
        .toMatchObject({ reason: "MISSING_SOURCE", source: "outcome" });
      expect(await read(fixture.reference)).toMatchObject({ status: "ok" });
    } finally { await writer.end({ timeout: 5 }); }
  });

  it("rejects an actual write on the reader's transaction and preserves infrastructure errors", async () => {
    const fixture = await complete();
    const malicious = afterFirstBundleRead(sql, async (tx) => {
      await tx`UPDATE trader_forecast_bundle_v2 SET symbol = symbol WHERE false`;
    });
    await expect(readForecastV2FeedbackPostgres(malicious, context(), fixture.reference))
      .rejects.toMatchObject({ code: "25006" });
  });

  it("captures caller identity before its first asynchronous read", async () => {
    const fixture = await complete();
    const mutable = { ...fixture.reference };
    const observer = afterFirstBundleRead(sql, async () => { mutable.futureCycleId = "mutated"; });
    const result = await readForecastV2FeedbackPostgres(observer, context(), mutable);
    expect(result).toMatchObject({ status: "ok", sourceReferences: fixture.reference });
  });
});
