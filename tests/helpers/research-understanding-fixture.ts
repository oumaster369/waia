import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { normalizeOhlcvBarsObservation, normalizeQuoteObservation, normalizeOrderBookSnapshotObservation,
  normalizeMarketTradesSnapshotObservation } from "@/lib/trader/market-data/normalization/normalize-observation";
import { intervalDurationMs } from "@/lib/trader/market-data/mtf/bar-interval-duration";
import { normalizeMandatory } from "@/lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1";
import { captureSession, digest, seal, copy, ANALYSIS_CONTRACT, type CapturedMandatory, type AnalysisPacket } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import { computeSourceTrustDigest } from "@/lib/trader/mi/serialize-source-trust";
import { pitChronologyV1 } from "@/lib/trader/mi/pit-chronology-v1";
import { resolveTrustAsOfV1 } from "@/lib/trader/mi/trust-as-of-v1";
import { buildCanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { captureProfileDefinition, captureAssignmentConfig, buildResearchAssignment, RESEARCH_SERVICE_ACTOR } from "@/lib/trader/paper/research-understanding-v1/contract";
import type { ResearchTrustRevision } from "@/lib/trader/paper/research-understanding-v1/admission";

export const RESEARCH_FIXTURE_ORG = "11111111-1111-4111-8111-111111111111";
export function researchProfileDefinition() {
  return { organizationId: RESEARCH_FIXTURE_ORG, accountId: "saved-account", symbol: "BTC/USDT", profileVersion: "research-recorded-what/v1/fixture-explicit",
    purpose: "RESEARCH_NON_CAPITAL", venue: "htx", analyticalTimeframe: "1m", horizon: "explicit-fixture-horizon", forecastPackageId: null,
    forecastPackageContentDigest: null, inputContractContentDigest: null, aggregateQualityContract: null,
    requirements: ["1m", "4h"].map(lane => ({ id: `research_what_price_${lane}_v1`, questionId: "Q_WHAT_HAPPENING", classification: "MANDATORY",
      contextTriggerKey: null, satisfiers: [{ evidenceFamily: `research_recorded_price_${lane}_v1`, providerIds: ["htx_spot"], substitutionRuleId: null }],
      allowedObservationKinds: ["ohlcv_bar"], allowedObservationSchemaVersions: ["mi-canonical-pit-observation-v1"], allowedMeasurementDefinitionDigests: [],
      maxStalenessMs: null, minimumTrustScore: null, minimumIndependentGroups: 1, contradictionPolicy: "FAIL_UNRESOLVED",
      requirePitQualified: true, requireReplayEligible: true, inquiryBounds: { maxDepth: 0, maxDurationMs: 0, maxProviderFanout: 0 } })) };
}
export function researchCapturedFixture(): CapturedMandatory {
  const event = "2026-09-26T12:00:00.000Z"; const ingest = "2026-09-26T12:00:01.000Z";
  const symbol = "BTC/USDT"; const evaluatedAt = "2026-09-26T12:00:02.000Z";
  const provenance = (kind: string) => ({ providerId: "htx_spot" as const, venue: "htx", feedKind: kind, symbol, eventTimeUtc: event, ingestTimeUtc: ingest });
  const bars: Partial<Record<BarInterval, Bar[]>> = {};
  for (const interval of ["1m", "15m", "1h", "4h", "1d"] as const) {
    const duration = intervalDurationMs(interval); const end = Math.floor(Date.parse(event) / duration) * duration;
    bars[interval] = Array.from({ length: 25 }, (_, i) => ({ symbol, interval,
      open: String(100 + i), close: String(101 + i), high: String(102 + i), low: String(99 + i), volume: "10",
      barOpenTime: new Date(end - (25 - i) * duration).toISOString(), barCloseTime: new Date(end - (24 - i) * duration).toISOString() }));
  }
  const quote = { symbol, bid: "124", ask: "126", last: "125", timestamp: event };
  const observations = Object.values(bars).map(lane => normalizeOhlcvBarsObservation({ bars: lane,
    provenance: { ...provenance("ohlcv_bar"), eventTimeUtc: lane.at(-1)!.barCloseTime }, latencyMs: 1, evaluatedAt }));
  observations.push(normalizeQuoteObservation({ quote, provenance: provenance("quote_l1"), latencyMs: 1, evaluatedAt }),
    normalizeOrderBookSnapshotObservation({ symbol, bidLevels: [[124, 1]], askLevels: [[126, 1]], eventTimeUtc: event,
      provenance: provenance("order_book_snapshot"), latencyMs: 1, evaluatedAt }),
    normalizeMarketTradesSnapshotObservation({ symbol, trades: [{ id: 1, price: 125, amount: 1, direction: "buy", ts: Date.parse(event) }], eventTimeUtc: event,
      provenance: provenance("market_trades_snapshot"), latencyMs: 1, evaluatedAt }));
  return copy({ bars, quote, observations });
}

/** Synthetic pure data + real normalizers/sealers; this does not prove persistence or source authority. */
export function researchPureFixture(options: { captured?: CapturedMandatory; score?: string; unknownTrust?: boolean } = {}) {
  const session = captureSession({ organizationId: RESEARCH_FIXTURE_ORG, accountId: "saved-account", symbol: "BTC/USDT", sessionId: "saved-source",
    releaseSha: "a".repeat(40), maxPacketBytes: 2_000_000, maxBarsPerInterval: 1000, maxCycles: 2, leaseDurationMs: 120000 });
  const analysisPitAnchor = "2026-09-26T12:00:02.000Z";
  const normalized = normalizeMandatory(options.captured ?? researchCapturedFixture(), session, analysisPitAnchor);
  const revisions: ResearchTrustRevision[] = [];
  const sources = normalized.observations.map((o, index) => {
    const attempt = prepareCanonicalPitAttemptV1(o, { pitCutoffUtc: analysisPitAnchor });
    const kindIndex = ["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"].indexOf(o.kind);
    const sourceId = `22222222-2222-4222-8222-${String(kindIndex + 1).padStart(12, "0")}`;
    const source = { id: sourceId, organizationId: session.organizationId, venue: "htx", feedKind: o.kind, symbol: session.symbol };
    if (attempt.status !== "AVAILABLE") return { source, trust: null, observation: null,
      receipt: buildCanonicalGatewayPitReceiptV1({ organizationId: session.organizationId, providerId: attempt.providerId,
        gatewayKind: attempt.gatewayKind, sourceId, trustAsOfReceiptId: null, normalizedInputDigest: attempt.normalizedInputDigest,
        status: attempt.status, reason: attempt.reason, observationId: null, observationContentDigest: null }) };
    let revision = revisions.find(r => r.sourceId === sourceId);
    if (!revision) {
      const input = { schemaVersion: "mi-source-trust-v1" as const, organizationId: session.organizationId, sourceId, trustScore: options.score ?? "0.8",
        rationale: "synthetic explicit research control", recordedBy: "service:fixture", eventTime: "2026-01-01T00:00:00.000Z",
        availableAt: "2026-01-01T00:00:00.000Z", ingestTime: "2026-01-01T00:00:00.000Z", revisionOf: null, revisionSeq: 1 };
      revision = { ...input, id: `33333333-3333-4333-8333-${String(kindIndex + 1).padStart(12, "0")}`,
        contentDigest: computeSourceTrustDigest({ ...input, eventTime: new Date(input.eventTime), ingestTime: new Date(input.ingestTime) }) };
      revisions.push(revision);
    }
    const trust = resolveTrustAsOfV1({ organizationId: session.organizationId, sourceId, anchorTime: new Date(attempt.availableAtUtc!),
      history: options.unknownTrust ? [] : [{ ...revision, chronology: pitChronologyV1({ eventTime: new Date(revision.eventTime), availableAt: new Date(revision.availableAt!), ingestTime: new Date(revision.ingestTime) }) }] });
    const base = { organizationId: session.organizationId, providerId: attempt.providerId, gatewayKind: attempt.gatewayKind, sourceId,
      trustAsOfReceiptId: trust.id, normalizedInputDigest: attempt.normalizedInputDigest };
    if (trust.status !== "RESOLVED") return { source, trust, observation: null,
      receipt: buildCanonicalGatewayPitReceiptV1({ ...base, status: "UNAVAILABLE", reason: "TRUST_AS_OF_UNKNOWN", observationId: null, observationContentDigest: null }) };
    const observation = { id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`, organizationId: session.organizationId,
      sourceId, observationKind: attempt.kind, schemaVersion: "mi-canonical-pit-observation-v1", subjectRef: attempt.subjectRef,
      canonicalProviderId: attempt.providerId, payloadJson: JSON.stringify(attempt.payloadCanonical), eventTime: attempt.eventTimeUtc,
      availableAt: attempt.availableAtUtc, ingestTime: attempt.ingestTimeUtc, sourceTrustRevisionId: revision.id,
      sourceTrustContentDigest: revision.contentDigest, trustAsOfReceiptId: trust.id, normalizedInputDigest: attempt.normalizedInputDigest,
      contentDigest: digest({ fixtureObservation: index, attempt, trust: trust.id }) };
    return { source, trust, observation, receipt: buildCanonicalGatewayPitReceiptV1({ ...base, status: "AVAILABLE", reason: null,
      observationId: observation.id, observationContentDigest: observation.contentDigest }) };
  });
  const previousState = createEmptyHypothesisSessionState();
  const packet: AnalysisPacket = seal({ schemaVersion: ANALYSIS_CONTRACT, session, sequence: 0, analysisPitAnchor, normalized, sources,
    previousState, previousStateDigest: digest(previousState), previousCompletionDigest: null });
  const profileDefinition = researchProfileDefinition(); const profile = captureProfileDefinition(profileDefinition);
  const config = captureAssignmentConfig({ organizationId: session.organizationId, accountId: session.accountId, symbol: session.symbol,
    researchSessionId: "research-session", sourceSessionId: session.sessionId, sourceConfigDigest: session.configDigest,
    firstSourceSequence: 0, releaseSha: "b".repeat(40), admissions: ["1m", "4h"].map(lane => ({ lane,
      sourceId: revisions[0]!.sourceId, revisionDigests: [revisions[0]!.contentDigest] })) });
  const assignment = buildResearchAssignment(config, profile, { kind: "SERVICE", id: RESEARCH_SERVICE_ACTOR }, "2026-09-27T00:00:00.000Z");
  return { session, packet, revisions, profileDefinition, profile, config, assignment };
}

/** Native setup owns broader source/old-analysis capabilities; the research process never imports this helper. */
export async function seedResearchNativeFixture(client: import("postgres").Sql, organizationId: string, userId: string,
  options: { count?: number; missing4h?: boolean; flat4h?: boolean } = {}) {
  const { drizzle } = await import("drizzle-orm/postgres-js"); const schema = await import("@/db/schema.postgres");
  const { createPostgresMiSourceProvenanceService } = await import("@/lib/trader/mi/source-provenance-service");
  const { claimRuntimeControlLeaseAtDatabaseTimeV2 } = await import("@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2");
  const { publishRecordedAnalysis } = await import("@/lib/trader/paper/durable-noncapital/repository-postgres-v1");
  const { completeRecordedAnalysisPostgresV1 } = await import("@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2");
  const db = drizzle(client, { schema }); const service = createPostgresMiSourceProvenanceService(db);
  const admitted: Array<{ sourceId: string; contentDigest: string }> = [];
  for (const feedKind of ["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"]) {
    const source = await service.createSource({ organizationId, userId }, { venue: "htx", feedKind, symbol: "BTC/USDT", status: "active" });
    const revision = await service.appendTrustRevision({ organizationId, userId }, { sourceId: source.id, trustScore: "0.8",
      rationale: "synthetic native research input", recordedBy: "fixture", eventTime: new Date("2026-01-01T00:00:00.000Z"), ingestTime: new Date("2026-01-01T00:00:00.000Z") });
    admitted.push({ sourceId: source.id, contentDigest: revision.contentDigest });
  }
  const session = captureSession({ organizationId, accountId: "saved-account", symbol: "BTC/USDT", sessionId: "native-source",
    releaseSha: "a".repeat(40), maxPacketBytes: 2_000_000, maxBarsPerInterval: 1000, maxCycles: 2, leaseDurationMs: 3000 });
  const holder = await claimRuntimeControlLeaseAtDatabaseTimeV2(db, { organizationId, runtimeInstanceId: "native-source-fixture", durationMs: 3000 });
  if (!holder) throw new Error("FIXTURE_SOURCE_LEASE_BUSY");
  const packets: AnalysisPacket[] = [];
  for (let sequence = 0; sequence < (options.count ?? 2); sequence++) {
    const captured = researchCapturedFixture(); const shift = sequence * 60000;
    if (options.flat4h) captured.bars["4h"]!.forEach(b => Object.assign(b, { open: "100", close: "100", high: "102", low: "99" }));
    if (options.missing4h) { delete captured.bars["4h"]; captured.observations = captured.observations.filter(o => o.interval !== "4h"); }
    for (const b of captured.bars["1m"]!) { b.barOpenTime = new Date(Date.parse(b.barOpenTime) + shift).toISOString(); b.barCloseTime = new Date(Date.parse(b.barCloseTime) + shift).toISOString(); }
    captured.quote.timestamp = new Date(Date.parse(captured.quote.timestamp) + shift).toISOString();
    for (const o of captured.observations) {
      o.provenance.ingestTimeUtc = new Date(Date.parse(o.provenance.ingestTimeUtc) + shift).toISOString();
      if (o.kind !== "ohlcv_bar" || o.interval === "1m") o.provenance.eventTimeUtc = new Date(Date.parse(o.provenance.eventTimeUtc) + shift).toISOString();
      if (o.kind === "quote_l1") o.payload.timestamp = captured.quote.timestamp;
      if (o.kind === "order_book_snapshot" || o.kind === "market_trades_snapshot") o.payload.eventTimeUtc = o.provenance.eventTimeUtc;
    }
    const pit = new Date(Date.parse("2026-09-26T12:00:02.000Z") + shift).toISOString();
    const packet = await publishRecordedAnalysis(client, session, holder, sequence, pit, normalizeMandatory(captured, session, pit));
    await completeRecordedAnalysisPostgresV1(client, session, holder, sequence); packets.push(packet);
  }
  // Observe the actual existing lease expiry; do not change a clock or bypass/alter a holder.
  await client`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM valid_until_utc - clock_timestamp())) + 0.02)
    FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`;
  const profileDefinition = { ...researchProfileDefinition(), organizationId };
  const profile = captureProfileDefinition(profileDefinition);
  const config = captureAssignmentConfig({ organizationId, accountId: session.accountId, symbol: session.symbol,
    researchSessionId: "native-research", sourceSessionId: session.sessionId, sourceConfigDigest: session.configDigest,
    firstSourceSequence: 0, releaseSha: "b".repeat(40), admissions: ["1m", "4h"].map(lane => ({ lane,
      sourceId: admitted[0]!.sourceId, revisionDigests: [admitted[0]!.contentDigest] })) });
  return { session, packets, profile, profileDefinition, config,
    request: { assignment: config, profile: { definition: profileDefinition }, range: { startSequence: 0, count: options.count ?? 2, leaseDurationMs: 10000 } } };
}
