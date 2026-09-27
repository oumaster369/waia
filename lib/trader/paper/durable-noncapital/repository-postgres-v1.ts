import { encodeBody, decodeBody, validateRecordedPacket, validateRecordedSourcePair } from "./recorded-source-read-validation-v1";
export { encodeBody, decodeBody } from "./recorded-source-read-validation-v1";
import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { hasCanonicalGatewayPitReceiptContentV1, readCanonicalPitObservationWithinHeldTransactionV1Postgres,
  processCanonicalPitObservationV1Postgres, type CanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-service-postgres";
import { readTrustAsOfReceiptV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";
import { assertRuntimeDatabaseClockHolderV2, lockRuntimeOrganizationV2,
  type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { assertEnvironment, assertPacketSize, assertSeal, assertSession, copy, digest, seal, requireCondition as check,
  ANALYSIS_CONTRACT, type AnalysisSession, type AnalysisPacket, type AnalysisCompanion, type NormalizedMandatory } from "./recorded-analysis-v1";
import { normalizeMandatory } from "./normalize-mandatory-packet-v1";

const sessions = schema.traderRecordedAnalysisSessionsV1;
const packets = schema.traderRecordedAnalysisPacketsV1;
const companions = schema.traderRecordedAnalysisCompanionsV1;
export function requireAnalysisPool(pool: postgres.Sql): void {
  check(typeof pool.begin === "function" && typeof (pool as unknown as { savepoint?: unknown }).savepoint !== "function", "POOL_REQUIRED");
}
export function holderColumns(holder: DatabaseClockRuntimeHolderV2) {
  return { runtimeInstanceId: holder.runtimeInstanceId, leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest };
}
function sessionBody(session: AnalysisSession) {
  const body = { ...session } as Partial<AnalysisSession>; delete body.configDigest; return body;
}
function scope(session: AnalysisSession, sequence: number) {
  check(Number.isSafeInteger(sequence) && sequence >= 0); assertSession(session);
  return and(eq(packets.organizationId, session.organizationId), eq(packets.sessionId, session.sessionId), eq(packets.sequence, sequence));
}
/** Internal read composition only: this helper grants neither ownership nor a write bypass. */
export async function readAnalysisWithinTransaction(db: WaiaPostgresDb, session: AnalysisSession, sequence: number) {
  scope(session, sequence);
  const header = (await db.select().from(sessions).where(and(eq(sessions.organizationId, session.organizationId), eq(sessions.sessionId, session.sessionId))))[0];
  if (header) check(header.contentDigest === session.configDigest && header.bodyJson === canonicalJsonString(sessionBody(session)), "SESSION_CONFIG_CONFLICT");
  const row = (await db.select().from(packets).where(scope(session, sequence)))[0];
  const c = (await db.select().from(companions).where(and(eq(companions.organizationId, session.organizationId), eq(companions.sessionId, session.sessionId), eq(companions.sequence, sequence))))[0];
  check(!row || header, "PACKET_HEADER_MISSING"); check(!c || row, "COMPANION_PACKET_MISSING");
  const packet = row ? decodeBody<AnalysisPacket>(row) : null;
  const companion = c ? decodeBody<AnalysisCompanion>(c) : null;
  if (packet) {
    validateRecordedPacket(session, sequence, row!, packet);
  }
  if (companion) {
    assertSeal(companion.output);
    check(companion.organizationId === session.organizationId && companion.sessionId === session.sessionId && companion.sequence === sequence &&
      companion.packetDigest === packet!.contentDigest && c!.packetDigest === packet!.contentDigest &&
      c!.accountId === session.accountId && c!.symbol === session.symbol && c!.barInterval === "1m" &&
      Date.parse(c!.scheduledBarCloseTime) === Date.parse(packet!.normalized.scheduledBarCloseTime) &&
      companion.output.packetDigest === packet!.contentDigest && companion.output.authority === "OBSERVATIONAL_ONLY" &&
      digest(companion.output.nextState) === companion.output.nextStateDigest, "COMPANION_BINDING_CONFLICT");
  }
  return { packet, companion };
}
export async function readRecordedAnalysis(pool: postgres.Sql, session: AnalysisSession, sequence: number) {
  requireAnalysisPool(pool); session = copy(session); scope(session, sequence);
  return drizzle(pool, { schema }).transaction(tx => readAnalysisWithinTransaction(tx, session, sequence),
    { isolationLevel: "read committed", accessMode: "read only" });
}
/** Complete persisted outcome bodies; no current trust/source-status fallback during replay. */
async function readSourceEvidence(db: WaiaPostgresDb, session: AnalysisSession, receipt: CanonicalGatewayPitReceiptV1) {
  check(receipt.organizationId === session.organizationId && hasCanonicalGatewayPitReceiptContentV1(receipt), "SOURCE_RECEIPT_CONFLICT");
  const rows = await db.select().from(schema.traderMiGatewayPitReceiptV1).where(and(
    eq(schema.traderMiGatewayPitReceiptV1.id, receipt.id), eq(schema.traderMiGatewayPitReceiptV1.organizationId, session.organizationId)));
  check(rows.length === 1 && digest(rows[0]!.receiptJson) === digest(receipt) && rows[0]!.contentDigest === receipt.contentDigest, "SOURCE_RECEIPT_CONFLICT");
  const context = { organizationId: session.organizationId };
  const observation = receipt.observationId ? await readCanonicalPitObservationWithinHeldTransactionV1Postgres(db, context, receipt.observationId) : null;
  const trust = receipt.trustAsOfReceiptId ? await readTrustAsOfReceiptV1Postgres(db, context, receipt.trustAsOfReceiptId) : null;
  check(!receipt.trustAsOfReceiptId || trust, "SOURCE_TRUST_MISSING");
  check(!receipt.observationId || observation, "SOURCE_OBSERVATION_MISSING");
  if (observation) check(observation.contentDigest === receipt.observationContentDigest && observation.normalizedInputDigest === receipt.normalizedInputDigest &&
    observation.sourceId === receipt.sourceId && observation.trustAsOfReceiptId === receipt.trustAsOfReceiptId, "SOURCE_OBSERVATION_CONFLICT");
  const source = receipt.sourceId ? (await db.select({ id: schema.traderMiSource.id, organizationId: schema.traderMiSource.organizationId,
    venue: schema.traderMiSource.venue, feedKind: schema.traderMiSource.feedKind, symbol: schema.traderMiSource.symbol }).from(schema.traderMiSource)
    .where(and(eq(schema.traderMiSource.id, receipt.sourceId), eq(schema.traderMiSource.organizationId, session.organizationId))))[0] : null;
  check(!receipt.sourceId || source, "SOURCE_IDENTITY_MISSING");
  if (source) check(source.venue === "htx" && source.symbol === session.symbol && source.feedKind === receipt.gatewayKind, "SOURCE_SCOPE_CONFLICT");
  // Date conversion is explicit at this persistence boundary; payload remains canonical JSON.
  return JSON.parse(JSON.stringify({ receipt, observation, trust, source })) as AnalysisPacket["sources"][number];
}
export async function verifyRecordedSources(db: WaiaPostgresDb, packet: AnalysisPacket): Promise<void> {
  check(packet.sources.length === packet.normalized.observations.length, "SOURCE_SET_CONFLICT");
  for (let i = 0; i < packet.sources.length; i++) {
    const evidence = packet.sources[i]!;
    const saved = await readSourceEvidence(db, packet.session, evidence.receipt);
    validateRecordedSourcePair(packet, i, saved);
  }
}
export async function precedingAnalysis(db: WaiaPostgresDb, session: AnalysisSession, sequence: number) {
  if (sequence === 0) return { digest: null, state: createEmptyHypothesisSessionState(), scheduledBarCloseTime: null };
  const previous = await readAnalysisWithinTransaction(db, session, sequence - 1);
  check(previous.packet && previous.companion, "PREDECESSOR_MISSING");
  return { digest: previous.companion.contentDigest, state: previous.companion.output.nextState,
    scheduledBarCloseTime: previous.packet.normalized.scheduledBarCloseTime };
}

/** Source writes intentionally precede packet publication; leftovers are never a completed prefix. */
export async function publishRecordedAnalysis(pool: postgres.Sql, session: AnalysisSession, holder: DatabaseClockRuntimeHolderV2,
  sequence: number, analysisPitAnchor: string, normalized: NormalizedMandatory): Promise<AnalysisPacket> {
  requireAnalysisPool(pool); assertEnvironment(); session = copy(session); holder = copy(holder); normalized = copy(normalized); scope(session, sequence);
  check(holder.organizationId === session.organizationId, "TENANT_MISMATCH");
  check(digest(normalizeMandatory(normalized.captured, session, analysisPitAnchor)) === digest(normalized), "NORMALIZATION_CONTENT_CONFLICT");
  assertPacketSize(session, normalized);
  const db = drizzle(pool, { schema }); const receipts: CanonicalGatewayPitReceiptV1[] = [];
  for (const observation of normalized.observations) receipts.push((await processCanonicalPitObservationV1Postgres(db,
    { organizationId: session.organizationId }, observation, { pitCutoffUtc: analysisPitAnchor })).receipt);
  return db.transaction(async tx => {
    const db = tx;
    await lockRuntimeOrganizationV2(tx, session.organizationId);
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    const current = await readAnalysisWithinTransaction(db, session, sequence);
    const previous = await precedingAnalysis(db, session, sequence);
    check(previous.scheduledBarCloseTime === null || previous.scheduledBarCloseTime < normalized.scheduledBarCloseTime, "SOURCE_NOT_ADVANCED");
    const sources: AnalysisPacket["sources"] = [];
    for (const receipt of receipts) sources.push(await readSourceEvidence(db, session, receipt));
    const packet = seal({ schemaVersion: ANALYSIS_CONTRACT, session, sequence, analysisPitAnchor, normalized,
      previousCompletionDigest: previous.digest, previousState: previous.state, previousStateDigest: digest(previous.state), sources });
    assertPacketSize(session, packet);
    if (current.packet) { check(current.packet.contentDigest === packet.contentDigest, "PACKET_CONFLICT"); return current.packet; }
    const { configDigest, ...sessionBody } = session;
    await db.insert(sessions).values({ organizationId: session.organizationId, sessionId: session.sessionId, contentDigest: configDigest,
      bodyJson: canonicalJsonString(sessionBody), ...holderColumns(holder) }).onConflictDoNothing();
    await db.insert(packets).values({ organizationId: session.organizationId, sessionId: session.sessionId, sequence,
      configDigest, analysisPitAnchor, contentDigest: packet.contentDigest, bodyJson: encodeBody(packet), ...holderColumns(holder) });
    await verifyRecordedSources(db, packet);
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    return packet;
  }, { isolationLevel: "read committed" });
}
