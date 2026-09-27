/** Native proof setup is deliberately outside the production command capability closure. */
import type postgres from "postgres";
import type { SavedApplicationRequest } from "@/lib/trader/paper/research-application-v1/repository-postgres";
import { pathToFileURL } from "node:url";

export async function seedApplicationNative(client: postgres.Sql, organizationId: string, userId: string,
  options: { against?: boolean; missing4h?: boolean; userAssignment?: boolean } = {}) {
  const { drizzle } = await import("drizzle-orm/postgres-js"); const schema = await import("@/db/schema.postgres");
  const { createPostgresMiMeasurementService } = await import("@/lib/trader/mi/measurement-service");
  const { createPostgresMiHypothesisService } = await import("@/lib/trader/mi/hypothesis-service");
  const { createPostgresMiSourceProvenanceService } = await import("@/lib/trader/mi/source-provenance-service");
  const specification = await import("@/lib/trader/paper/research-application-v1/specification");
  const contract = await import("@/lib/trader/paper/research-application-v1/contract");
  const { APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } = await import("@/lib/trader/paper/research-application-v1/computation-manifest");
  const research = await import("@/lib/trader/paper/research-understanding-v1/contract");
  const { createSavedResearchOwner } = await import("@/lib/trader/paper/research-understanding-v1/repository-postgres");
  const { runSavedResearchLoop } = await import("@/lib/trader/paper/research-understanding-v1/run-saved-research-loop");
  const { researchProfileDefinition } = await import("./research-understanding-fixture");
  const { captureSession } = await import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1");
  const { normalizeMandatory } = await import("@/lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1");
  const normalization = await import("@/lib/trader/market-data/normalization/normalize-observation");
  const { intervalDurationMs } = await import("@/lib/trader/market-data/mtf/bar-interval-duration");
  const { publishRecordedAnalysis } = await import("@/lib/trader/paper/durable-noncapital/repository-postgres-v1");
  const { completeRecordedAnalysisPostgresV1 } = await import("@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2");
  const { claimRuntimeControlLeaseAtDatabaseTimeV2, readRuntimeDatabaseClockV2 } = await import("@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2");
  const db = drizzle(client, { schema }); const context = { organizationId, userId };
  const researchContext = options.userAssignment ? context : { organizationId };
  const now = () => readRuntimeDatabaseClockV2(db);
  async function observedAfter(time: string) {
    const start = performance.now();
    for (;;) { const value = await now(); if (value > time) return value;
      if (performance.now() - start > 5000) throw new Error("FIXTURE_OBSERVED_CLOCK_DEADLINE"); }
  }
  async function expiry() { await client`select pg_sleep(greatest(0,extract(epoch from valid_until_utc-clock_timestamp()))+0.02)
    from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`; }
  const sourceService = createPostgresMiSourceProvenanceService(db);
  const admissions: Array<{ sourceId: string; contentDigest: string }> = [];
  for (const feedKind of ["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"]) {
    const source = await sourceService.createSource(context, { venue: "htx", feedKind, symbol: "BTC/USDT", status: "active" });
    const time = new Date(await now());
    const revision = await sourceService.appendTrustRevision(context, { sourceId: source.id, trustScore: "0.8",
      rationale: "explicit synthetic admission, not production source trust", recordedBy: userId, eventTime: time, ingestTime: time });
    admissions.push({ sourceId: source.id, contentDigest: revision.contentDigest });
  }
  const session = captureSession({ organizationId, accountId: "saved-account", symbol: "BTC/USDT", sessionId: "application-source",
    releaseSha: "a".repeat(40), maxPacketBytes: 2_000_000, maxBarsPerInterval: 1000, maxCycles: 8, leaseDurationMs: 3000 });
  const config = research.captureAssignmentConfig({ organizationId, accountId: session.accountId, symbol: session.symbol,
    researchSessionId: "application-research", sourceSessionId: session.sessionId, sourceConfigDigest: session.configDigest, firstSourceSequence: 0,
    releaseSha: "b".repeat(40), admissions: ["1m", "4h"].map(lane => ({ lane, sourceId: admissions[0]!.sourceId, revisionDigests: [admissions[0]!.contentDigest] })) });
  const profileDefinition = { ...researchProfileDefinition(), organizationId };
  const profile = research.captureProfileDefinition(profileDefinition);
  const measurement = await createPostgresMiMeasurementService(db).measurement.registerMeasurement(context, {
    measurementKind: "feature_transform", name: specification.CATEGORICAL_MEASUREMENT_NAME,
    definition: specification.categoricalMeasurementDefinitionV1(), authoredBy: userId });
  const partial = { symbol: session.symbol, computation: research.DECLARATIONS.computation,
    computationManifestDigest: research.DECLARATIONS.computationManifestDigest, measurementKey: measurement.measurementKey,
    measurementDefinitionDigest: measurement.definitionDigest };
  const definition = specification.categoricalHypothesisDefinitionV1(partial,
    { ordinal: "low", band: "wide" }, ["always-flat-cash", "simple-trend-baseline", "buy-and-hold"]);
  const hypothesisService = createPostgresMiHypothesisService(db).hypothesis;
  const hypothesis = await hypothesisService.registerHypothesis(context, { hypothesisKind: "market_claim",
    name: specification.categoricalHypothesisNameV1(session.symbol), definition, authoredBy: userId });
  const registeredAt = await observedAfter(new Date(Math.max(hypothesis.createdAt.getTime(), measurement.createdAt.getTime())).toISOString());
  // Closed synthetic market events may precede registration; only the actual saved
  // knowledge/PIT cutoffs follow registration. Quote/acquisition clocks are observed now.
  const firstBar = Math.floor(Date.parse(registeredAt) / 60000) * 60000 - 180000;
  const packets: import("@/lib/trader/paper/durable-noncapital/recorded-analysis-v1").AnalysisPacket[] = [];
  let lastPit = registeredAt;
  const request = { assignment: config, profile: { definition: profileDefinition }, range: { startSequence: 0, count: 2, leaseDurationMs: 1500 } };
  async function appendThrough(last: number) {
    await expiry();
    const holder = await claimRuntimeControlLeaseAtDatabaseTimeV2(db, { organizationId, runtimeInstanceId: `application-source-${packets.length}`, durationMs: 3000 });
    if (!holder) throw new Error("FIXTURE_SOURCE_LEASE_BUSY");
    const first = packets.length;
    for (let sequence = first; sequence <= last; sequence++) {
      const observed = await observedAfter(lastPit); const event = observed;
      const schedule = firstBar + sequence * 60000;
      if (schedule > Date.parse(observed)) throw new Error("FIXTURE_CLOSED_SCHEDULE_NOT_YET_AVAILABLE");
      const bars: Partial<Record<import("@/lib/trader/intelligence/types").BarInterval, import("@/lib/trader/intelligence/types").Bar[]>> = {};
      for (const interval of ["1m", "15m", "1h", "4h", "1d"] as const) {
        if (interval === "4h" && options.missing4h) continue;
        const duration = intervalDurationMs(interval), end = interval === "1m" ? schedule : Math.floor(Date.parse(observed) / duration) * duration;
        bars[interval] = Array.from({ length: 25 }, (_, i) => { const down = interval === "4h" && options.against && sequence === 1;
          const base = down ? 200 - i * 3 : 100 + i;
          return { symbol: session.symbol, interval, open: String(base), close: String(base + (down ? -1 : 1)), high: String(base + 2), low: String(base - 2), volume: "10",
            barOpenTime: new Date(end - (25 - i) * duration).toISOString(), barCloseTime: new Date(end - (24 - i) * duration).toISOString() }; });
      }
      const quote = { symbol: session.symbol, bid: "124", ask: "126", last: "125", timestamp: event };
      const ingest = new Date().toISOString();
      const provenance = (feedKind: string, eventTimeUtc = event) => ({ providerId: "htx_spot" as const, venue: "htx", symbol: session.symbol, feedKind, eventTimeUtc, ingestTimeUtc: ingest });
      const evaluatedAt = await observedAfter([ingest, observed].sort().at(-1)!);
      const observations = Object.values(bars).map(lane => normalization.normalizeOhlcvBarsObservation({ bars: lane, provenance: provenance("ohlcv_bar", lane.at(-1)!.barCloseTime), latencyMs: 1, evaluatedAt }));
      observations.push(normalization.normalizeQuoteObservation({ quote, provenance: provenance("quote_l1"), latencyMs: 1, evaluatedAt }),
        normalization.normalizeOrderBookSnapshotObservation({ symbol: session.symbol, bidLevels: [[124, 1]], askLevels: [[126, 1]], eventTimeUtc: event, provenance: provenance("order_book_snapshot"), latencyMs: 1, evaluatedAt }),
        normalization.normalizeMarketTradesSnapshotObservation({ symbol: session.symbol, trades: [{ id: sequence, price: 125, amount: 1, direction: "buy", ts: Date.parse(event) }], eventTimeUtc: event, provenance: provenance("market_trades_snapshot"), latencyMs: 1, evaluatedAt }));
      const pit = await observedAfter(evaluatedAt); lastPit = pit;
      const packet = await publishRecordedAnalysis(client, session, holder, sequence, pit, normalizeMandatory({ bars, quote, observations }, session, pit));
      await completeRecordedAnalysisPostgresV1(client, session, holder, sequence); packets.push(packet);
    }
    await expiry();
    const range = { ...request.range, startSequence: first, count: last - first + 1 };
    const result = await runSavedResearchLoop(client, researchContext, { ...request, range });
    if (result.status !== "COMPLETE") throw new Error(`FIXTURE_RESEARCH_REFUSED:${result.status}`);
    await expiry(); return result;
  }
  await appendThrough(1);
  const completion = (await createSavedResearchOwner(client, researchContext, request).replay(1))!.completion;
  const configuration = contract.captureApplicationConfigurationV1({ ...partial, organizationId, accountId: session.accountId,
    researchAssignmentDigest: completion.assignmentDigest, researchSessionId: config.researchSessionId,
    sourceSessionId: session.sessionId, sourceConfigDigest: session.configDigest, profileId: profile.id, profileContentDigest: profile.contentDigest,
    applicationComputationManifestDigest: APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST,
    hypothesisId: hypothesis.id, hypothesisKey: hypothesis.hypothesisKey, hypothesisVersion: hypothesis.versionSeq,
    hypothesisDefinitionDigest: hypothesis.definitionDigest, measurementId: measurement.id, measurementVersion: measurement.versionSeq,
    specification: contract.APPLICATION_SPECIFICATION, bridge: contract.APPLICATION_BRIDGE, questionMap: contract.APPLICATION_QUESTION_MAP,
    maxAgeMs: 600000 });
  const application: SavedApplicationRequest = { configuration, research: request, operation: "apply", previousSourceSequence: 0, currentSourceSequence: 1 };
  return { application, packets, appendThrough, expiry, hypothesis, measurement, hypothesisService, context, researchContext, db };
}

// Direct child execution imports only the actual CLI, never fixture producers.
async function main() {
  const { assertRecordedAnalysisTestDatabase } = await import("./recorded-paper-public-transport");
  assertRecordedAnalysisTestDatabase(process.env.DATABASE_URL_POSTGRES);
  const payload = JSON.parse(process.env.WAIA_APPLICATION_TEST_PAYLOAD!);
  let fetches = 0;
  globalThis.fetch = (async () => { fetches++; throw new Error("APPLICATION_TRANSPORT_FORBIDDEN"); }) as typeof fetch;
  try {
    const { createRequire } = await import("node:module");
    const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
    const result = await runPaperBarCloseCli(payload.args);
    const forbidden = Object.keys(createRequire(import.meta.url).cache).filter(file => /market-data-gateway|htx-bar-poll-source|evaluate-recorded-analysis|evaluation-cycle|paper-bar-close-loop-legacy|mock-exchange|\/execution\/|\/forecast\/|hypothesis-service|measurement-service/.test(file));
    console.info(JSON.stringify({ event: "result", result, forbidden, fetches }));
    if (result?.status !== "COMPLETE") process.exitCode = 1;
    if (payload.holdAfterResult) await new Promise(() => { setInterval(() => {}, 1000); });
  } catch (error) {
    console.info(JSON.stringify({ event: "error", message: error instanceof Error ? error.message : String(error), fetches })); process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(error => { console.error(error); process.exitCode = 1; });
