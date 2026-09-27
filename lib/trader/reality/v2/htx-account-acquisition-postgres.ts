import { enforceServerOnly } from "@/lib/enforce-server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb, type WaiaPostgresTransactionCallback } from "@/db/waia-postgres-transaction";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { sameObservationBinding } from "@/lib/trader/account-observation/validation";
import type { HtxAccountAcquisitionGetTransport } from "@/lib/trader/account-observation/htx-get-transport";
import { decodeHtxReferenceJsonV1, type PrivateRawObjectStoreV1 } from "@/lib/trader/mi/htx-reference-quote-collector-v1";
import { attestRawSecretScanV1, defineRawCapturePolicyV1, digestRawBytesV1,
  prepareRawCaptureV1 } from "@/lib/trader/mi/raw-capture-v1";
import { persistPreparedRawCaptureV1Postgres,
  recordRawValidationV1Postgres } from "@/lib/trader/mi/raw-capture-repository-postgres";
import { riskAccountDigestV1,
  sealRiskAccountRecordV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import { decodeHtxAccountAcquisitionPageV1, htxAccountAcquisitionLanesV1, htxAccountAcquisitionRequestV1,
  htxAccountAcquisitionSpecSchemaV1, parseHtxAccountAcquisitionSpecV1, HtxAccountAcquisitionRefusedV1,
  htxAccountAcquisitionJournalEntrySchemaV1, validateHtxAccountAcquisitionJournalV1,
  HTX_ACQUISITION_JOURNAL_BYTES_V1, HTX_ACQUISITION_JOURNAL_ENTRY_BYTES_V1, HTX_ACQUISITION_DB_READ_BYTES_V1,
  type HtxAccountAcquisitionJournalBodyV1,
  type HtxAccountAcquisitionPageV1 } from "./htx-account-acquisition-v1";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

enforceServerOnly();
const digest = z.string().regex(/^[0-9a-f]{64}$/), identity = z.string().min(1).max(256);
const jobSchema = z.object({ schemaVersion: z.literal("risk-account-acquisition-job/v1"),
  organizationId: z.string().uuid(), accountId: identity, id: z.string().uuid(),
  profileDigest: digest, referenceDigest: digest, spec: htxAccountAcquisitionSpecSchemaV1,
  expected: z.object({ currentRevision: z.string().regex(/^[1-9]\d*$/), riskStateVersion: z.string().regex(/^\d+$/),
    riskEventHeadDigest: digest.nullable(), realityProjectionId: identity, realityFrontierHeadDigest: digest.nullable() }).strict(),
}).strict();
export type HtxAccountAcquisitionJobV1 = Readonly<z.infer<typeof jobSchema> & { contentDigest: string }>;
const entrySchema = htxAccountAcquisitionJournalEntrySchemaV1;
export type HtxAccountAcquisitionJournalEntryV1 = Readonly<HtxAccountAcquisitionJournalBodyV1 & { contentDigest: string }>;
type Executor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;
function fail(reason: string): never { throw new HtxAccountAcquisitionRefusedV1(reason); }
function journalBody(entry: HtxAccountAcquisitionJournalEntryV1): HtxAccountAcquisitionJournalBodyV1 {
  const { contentDigest, ...body } = entry;
  if (riskAccountDigestV1(body) !== contentDigest) fail("JOURNAL_SEAL_OR_CHAIN");
  return body;
}
class AcquisitionWorkBudget {
  private readonly deadline = performance.now() + 300000;
  private bytes = 0;
  private phases = 0;
  maxPhases = 2052;
  constructor(private readonly signal?: AbortSignal) {}
  check() {
    if (this.signal?.aborted) fail("ABORTED");
    if (performance.now() >= this.deadline) fail("OWNER_DEADLINE");
  }
  phase() { this.check(); if (++this.phases > this.maxPhases) fail("DATABASE_PHASE_BUDGET"); }
  read(bytes: number) {
    this.check();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > HTX_ACQUISITION_DB_READ_BYTES_V1 - this.bytes)
      fail("DATABASE_READ_BUDGET");
    this.bytes += bytes;
  }
}
async function databasePhase<T>(db: WaiaPostgresDb, budget: AcquisitionWorkBudget, action: WaiaPostgresTransactionCallback<T>) {
  budget.phase();
  const value = await runWaiaPostgresTransaction(db, async tx => {
    await tx.execute(sql`SELECT set_config('statement_timeout','30s',true), set_config('lock_timeout','5s',true)`);
    budget.check();
    const result = await action(tx);
    budget.check(); // Throws inside this transaction; already committed earlier phases remain retained.
    return result;
  });
  budget.check(); // A late abort cannot undo a commit, but cannot return successful owner completion.
  return value;
}
async function admitRawReceiptReads(ex: Executor, context: OrgContext, budget: AcquisitionWorkBudget,
  selection: { bindingDigest: string } | { captureDigest: string }) {
  // Existing raw-owner primitives read immutable receipt bodies up to twice per phase.
  // Admit their exact predicates first, then conservatively debit future inserts/readbacks as well.
  const predicates = "bindingDigest" in selection ? [
    sql`SELECT count(*)::text AS count, coalesce(max(octet_length(binding_json)),0) AS bytes
      FROM trader_mi_raw_storage_binding_v1 WHERE organization_id=${context.organizationId} AND id=${selection.bindingDigest}`,
    sql`SELECT count(*)::text AS count, coalesce(max(octet_length(receipt_json)),0) AS bytes
      FROM trader_mi_raw_capture_receipt_v1 WHERE organization_id=${context.organizationId} AND storage_binding_digest=${selection.bindingDigest}`,
  ] : [
    sql`SELECT count(*)::text AS count, coalesce(max(octet_length(receipt_json)),0) AS bytes
      FROM trader_mi_raw_capture_receipt_v1 WHERE organization_id=${context.organizationId} AND id=${selection.captureDigest}`,
    sql`SELECT count(*)::text AS count, coalesce(max(octet_length(receipt_json)),0) AS bytes
      FROM trader_mi_raw_validation_receipt_v1 WHERE organization_id=${context.organizationId}
      AND capture_receipt_digest=${selection.captureDigest} AND validator_id='htx-account-acquisition' AND validator_version='v1'`,
  ];
  for (const query of predicates) {
    const rows = await ex.execute<{ count: string; bytes: number }>(query); budget.check();
    const count = Number(rows[0]!.count), bytes = rows[0]!.bytes;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1 || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 65536)
      fail("RAW_RECEIPT_BODY_BOUND");
    budget.read(2 * 65536);
  }
}
function parseJob(row: typeof schema.traderRiskAccountAcquisitionJobsV1.$inferSelect): HtxAccountAcquisitionJobV1 {
  const body = jobSchema.parse(JSON.parse(row.bodyText)), spec = parseHtxAccountAcquisitionSpecV1(body.spec);
  if (canonicalJsonString(body) !== row.bodyText || riskAccountDigestV1(body) !== row.contentDigest ||
      body.organizationId !== row.organizationId || body.accountId !== row.accountId || body.id !== row.id ||
      body.profileDigest !== row.profileDigest || body.referenceDigest !== row.referenceDigest ||
      spec.acquisitionId !== body.id || spec.accountId !== body.accountId ||
      spec.binding.organizationId !== body.organizationId || spec.profileDigest !== body.profileDigest ||
      spec.referenceDigest !== body.referenceDigest) fail("JOB_SEAL_OR_SCOPE");
  return sealRiskAccountRecordV1(body);
}
/** Integrity-only draft constructor. Persistence/current authority belongs to the capital service. */
export function createHtxAccountAcquisitionJobV1(body: z.infer<typeof jobSchema>): HtxAccountAcquisitionJobV1 {
  const parsed = jobSchema.parse(body); parseHtxAccountAcquisitionSpecV1(parsed.spec);
  if (parsed.id !== parsed.spec.acquisitionId || parsed.accountId !== parsed.spec.accountId ||
      parsed.organizationId !== parsed.spec.binding.organizationId || parsed.profileDigest !== parsed.spec.profileDigest ||
      parsed.referenceDigest !== parsed.spec.referenceDigest) fail("JOB_SEAL_OR_SCOPE");
  return sealRiskAccountRecordV1(parsed);
}
function scope(context: OrgContext, accountId: string, acquisitionId: string) {
  return and(eq(schema.traderHtxAccountAcquisitionsV1.organizationId, context.organizationId),
    eq(schema.traderHtxAccountAcquisitionsV1.accountId, accountId),
    eq(schema.traderHtxAccountAcquisitionsV1.acquisitionId, acquisitionId));
}
async function readJob(ex: Executor, context: OrgContext, accountId: string, acquisitionId: string,
  budget: AcquisitionWorkBudget, lock: "share" | "update") {
  const predicate = and(
    eq(schema.traderRiskAccountAcquisitionJobsV1.organizationId, context.organizationId),
    eq(schema.traderRiskAccountAcquisitionJobsV1.accountId, accountId),
    eq(schema.traderRiskAccountAcquisitionJobsV1.id, acquisitionId));
  const metadata = await ex.select({ bytes: sql<number>`octet_length(${schema.traderRiskAccountAcquisitionJobsV1.bodyText})` })
    .from(schema.traderRiskAccountAcquisitionJobsV1).where(predicate).limit(1).for(lock);
  budget.check();
  if (!metadata[0]) fail("JOB_MISSING");
  if (!Number.isSafeInteger(metadata[0].bytes) || metadata[0].bytes > 4194304) fail("JOB_BODY_BOUND");
  budget.read(metadata[0].bytes);
  const rows = await ex.select().from(schema.traderRiskAccountAcquisitionJobsV1).where(predicate).limit(1);
  budget.check();
  if (!rows[0]) fail("JOB_MISSING");
  return parseJob(rows[0]);
}
async function readJournal(ex: Executor, context: OrgContext, job: HtxAccountAcquisitionJobV1, budget: AcquisitionWorkBudget) {
  // The caller holds the immutable job's SHARE/UPDATE lock; every appender takes UPDATE first.
  // Return only scalar metadata before admitting any body read, including cumulative repeated reads.
  const metadata = await ex.select({ count: sql<string>`count(*)::text`,
    bytes: sql<string>`coalesce(sum(octet_length(${schema.traderHtxAccountAcquisitionsV1.bodyText})),0)::text`,
    largest: sql<number>`coalesce(max(octet_length(${schema.traderHtxAccountAcquisitionsV1.bodyText})),0)` })
    .from(schema.traderHtxAccountAcquisitionsV1).where(scope(context, job.accountId, job.id));
  budget.check();
  const count = Number(metadata[0]!.count), bytes = Number(metadata[0]!.bytes), largest = metadata[0]!.largest;
  if (!Number.isSafeInteger(count) || count < 0 || count > job.spec.maxPages * 2 + 2 || !Number.isSafeInteger(bytes) || bytes < 0 ||
      bytes > HTX_ACQUISITION_JOURNAL_BYTES_V1 || !Number.isSafeInteger(largest) || largest < 0 ||
      largest > HTX_ACQUISITION_JOURNAL_ENTRY_BYTES_V1) fail("JOURNAL_BOUND");
  budget.read(bytes);
  const rows = await ex.select().from(schema.traderHtxAccountAcquisitionsV1)
    .where(scope(context, job.accountId, job.id)).orderBy(asc(schema.traderHtxAccountAcquisitionsV1.sequence))
    .limit(job.spec.maxPages * 2 + 3);
  budget.check();
  if (rows.length !== count || rows.reduce((sum, row) => sum + Buffer.byteLength(row.bodyText), 0) !== bytes) fail("JOURNAL_READ_RACE");
  let previous: string | null = null; const keys = new Set<string>();
  const entries = rows.map((row, index) => {
    const body = entrySchema.parse(JSON.parse(row.bodyText));
    if (canonicalJsonString(body) !== row.bodyText || riskAccountDigestV1(body) !== row.contentDigest ||
        body.organizationId !== context.organizationId || body.accountId !== job.accountId || body.acquisitionId !== job.id ||
        body.jobDigest !== job.contentDigest || body.sequence !== index || row.sequence !== index ||
        body.previousDigest !== previous || row.previousDigest !== previous || body.kind !== row.kind ||
        body.replayKey !== row.replayKey || keys.has(body.replayKey) ||
        index < rows.length - 1 && body.kind === "TERMINAL") fail("JOURNAL_SEAL_OR_CHAIN");
    keys.add(body.replayKey); previous = row.contentDigest;
    return sealRiskAccountRecordV1(body);
  });
  validateHtxAccountAcquisitionJournalV1(job.spec, entries.map(journalBody));
  return entries;
}
async function appendJournal(db: WaiaPostgresDb, context: OrgContext, job: HtxAccountAcquisitionJobV1,
  kind: HtxAccountAcquisitionJournalEntryV1["kind"], replayKey: string, payload: Record<string, unknown>,
  budget: AcquisitionWorkBudget,
) {
  // Short root transaction, serializing this immutable job only. No network, byte-store or key I/O here.
  return databasePhase(db, budget, async tx => {
    const actual = await readJob(tx, context, job.accountId, job.id, budget, "update");
    if (actual.contentDigest !== job.contentDigest) fail("JOB_CHANGED");
    const rows = await readJournal(tx, context, job, budget), existing = rows.find(row => row.replayKey === replayKey);
    if (existing) {
      if (existing.kind !== kind || canonicalJsonString(existing.payload) !== canonicalJsonString(payload)) fail("JOURNAL_REPLAY_CONFLICT");
      return existing;
    }
    if (rows.at(-1)?.kind === "TERMINAL" || rows.length > job.spec.maxPages * 2 + 1) fail("JOURNAL_CLOSED_OR_BOUND");
    const times = await tx.execute<{ actual_at: Date | string }>(sql`SELECT date_trunc('milliseconds',clock_timestamp()) AS actual_at`);
    const date = new Date(times[0]!.actual_at); if (!Number.isFinite(date.getTime())) fail("DURABLE_TIME");
    const entry = sealRiskAccountRecordV1(entrySchema.parse({ schemaVersion: "htx-account-acquisition/v1",
      organizationId: context.organizationId, accountId: job.accountId, acquisitionId: job.id, jobDigest: job.contentDigest,
      sequence: rows.length, previousDigest: rows.at(-1)?.contentDigest ?? null, kind, replayKey, payload,
      recordedAtUtc: date.toISOString() }));
    const { contentDigest, ...body } = entry; const bodyText = canonicalJsonString(body);
    if (Buffer.byteLength(bodyText) > HTX_ACQUISITION_JOURNAL_ENTRY_BYTES_V1) fail("JOURNAL_BODY_BOUND");
    validateHtxAccountAcquisitionJournalV1(job.spec, [...rows.map(journalBody), body]);
    await tx.insert(schema.traderHtxAccountAcquisitionsV1).values({ organizationId: context.organizationId,
      accountId: job.accountId, acquisitionId: job.id, contentDigest, bodyText, sequence: entry.sequence,
      previousDigest: entry.previousDigest, kind, replayKey });
    const after = await readJournal(tx, context, job, budget);
    if (after.at(-1)?.contentDigest !== entry.contentDigest) fail("JOURNAL_READBACK");
    return after.at(-1)!;
  });
}

export async function readHtxAccountAcquisitionV1Postgres(db: WaiaPostgresDb, context: OrgContext,
  input: { accountId: string; acquisitionId: string; signal?: AbortSignal }) {
  context = requireOrgContext(context.organizationId);
  return readAcquisition(db, context, input, new AcquisitionWorkBudget(input.signal));
}
async function readAcquisition(db: WaiaPostgresDb, context: OrgContext,
  input: { accountId: string; acquisitionId: string }, budget: AcquisitionWorkBudget) {
  return databasePhase(db, budget, async tx => {
    const job = await readJob(tx, context, identity.parse(input.accountId), z.string().uuid().parse(input.acquisitionId), budget, "share");
    budget.maxPhases = 4 * job.spec.maxPages + 4;
    return { job, journal: await readJournal(tx, context, job, budget) };
  });
}
/** A single retained observational job; this never publishes a Risk basis or a Reality valid-time assertion.
 * Production composition supplies the concrete protected opener/store, not request JSON or approval callbacks.
 * A PREPARED prefix without PAGE refuses automatic retry; exact body digest/request identity is durable for recovery.
 */
export async function acquireHtxAccountV1Postgres(input: {
  db: WaiaPostgresDb; context: OrgContext; accountId: string; acquisitionId: string;
  transport: HtxAccountAcquisitionGetTransport; store: PrivateRawObjectStoreV1; signal: AbortSignal;
}) {
  try {
  const context = requireOrgContext(input.context.organizationId);
  const budget = new AcquisitionWorkBudget(input.signal);
  const { job, journal } = await readAcquisition(input.db, context, input, budget);
  if (!sameObservationBinding(job.spec.binding, input.transport.binding)) fail("TRANSPORT_SCOPE");
  const terminal = journal.at(-1); if (terminal?.kind === "TERMINAL") return terminal;
  if (journal.length !== 0) fail("RETAINED_PREFIX_REQUIRES_RECOVERY");
  // One invocation owns the job. A second process cannot reuse an active or crashed prefix.
  // A lost START commit is read back through this journal; it is never automatically stolen.
  await appendJournal(input.db, context, job, "START", "START", { attemptId: randomUUID() }, budget);
  const spec = job.spec, lanes = htxAccountAcquisitionLanesV1(spec);
  const policy = defineRawCapturePolicyV1({ maxPayloadBytes: spec.maxRawBytes, retentionSeconds: spec.retentionSeconds });
  const current = () => budget.check();
  let pages = 0, members = 0; const seen = new Set<string>();
  try {
    for (const lane of lanes) {
      let cursor: string | null = null; const cursors = new Set<string>();
      do {
        current();
        if (pages >= spec.maxPages) fail("PAGE_BUDGET");
        const key = `${lane.laneId}:${cursor ?? "FIRST"}`;
        if (cursors.has(key)) fail("CURSOR_CYCLE"); cursors.add(key);
        const preparedKey = `PREPARED:${key}`, pageKey = `PAGE:${key}`;
        const request = htxAccountAcquisitionRequestV1(spec, lane, cursor, input.signal);
        const requestStartedAtUtc = new Date().toISOString();
        const response = await input.transport.signedGet(request); current();
        if (!sameObservationBinding(response.binding, spec.binding) || response.httpStatus !== 200) fail("HTTP_OR_SCOPE");
        const acquiredAtUtc = new Date().toISOString(), bytes = new TextEncoder().encode(response.body);
        // The fixed transport rejects opened-key echoes; the lossless scanner rejects secret-shaped keys/ambiguity.
        decodeHtxReferenceJsonV1(bytes, spec.maxRawBytes);
        await appendJournal(input.db, context, job, "PREPARED", preparedKey, { lane, cursor,
          path: request.path, query: request.query, requestStartedAtUtc, acquiredAtUtc,
          rawBytesDigest: digestRawBytesV1(bytes), payloadBytes: bytes.length, policyDigest: policy.policyDigest }, budget);
        current();
        const prepared = prepareRawCaptureV1({ organizationId: context.organizationId, sourceId: spec.sourceId,
          bodyBytes: bytes, policy, secretScanReceipt: attestRawSecretScanV1({ status: "PASS", bodyBytes: bytes,
            scannerId: "fixed-htx-private-response-key-and-shape-scan", scannerVersion: "v1", completedAt: new Date(acquiredAtUtc) }) });
        const binding = await input.store.put({ organizationId: context.organizationId, sourceId: spec.sourceId,
          bytes, retentionSeconds: spec.retentionSeconds, signal: input.signal }); current();
        const stored = await input.store.read(binding, spec.maxRawBytes); current();
        if (digestRawBytesV1(stored) !== prepared.rawBytesDigest) fail("RAW_READBACK");
        const capture = await databasePhase(input.db, budget, async tx => {
          await admitRawReceiptReads(tx, context, budget, { bindingDigest: binding.contentDigest });
          return persistPreparedRawCaptureV1Postgres(tx, context, { prepared, storageBinding: binding });
        }); current();
        let page: HtxAccountAcquisitionPageV1;
        try { page = decodeHtxAccountAcquisitionPageV1({ spec, lane, cursor, bytes: stored, acquiredAtUtc }); }
        catch (error) {
          await databasePhase(input.db, budget, async tx => {
            await admitRawReceiptReads(tx, context, budget, { captureDigest: capture.receipt.contentDigest });
            return recordRawValidationV1Postgres(tx, context, { captureReceiptDigest: capture.receipt.contentDigest,
            validatorId: "htx-account-acquisition", validatorVersion: "v1", outcome: { status: "REJECTED",
              reasonCodes: [error instanceof HtxAccountAcquisitionRefusedV1 ? error.reason : "RESPONSE_SHAPE"] } });
          });
          throw error;
        }
        const validation = await databasePhase(input.db, budget, async tx => {
          await admitRawReceiptReads(tx, context, budget, { captureDigest: capture.receipt.contentDigest });
          return recordRawValidationV1Postgres(tx, context, {
          captureReceiptDigest: capture.receipt.contentDigest, validatorId: "htx-account-acquisition", validatorVersion: "v1",
          outcome: { status: "VALID", reasonCodes: [] } });
        }); current();
        const retained = { page, binding, capture: capture.receipt, validation: validation.receipt, requestStartedAtUtc };
        await appendJournal(input.db, context, job, "PAGE", pageKey, retained, budget); current();
        pages += 1; members += retained.page.members.length;
        if (members > spec.maxMembers) fail("MEMBER_BUDGET");
        for (const member of retained.page.members) {
          // A conditional order changing state between component requests remains a race, not silently deduplicated truth.
          if (seen.has(member.identity)) fail("DUPLICATE_OR_MOVING_MEMBER"); seen.add(member.identity);
        }
        cursor = retained.page.nextCursor;
      } while (cursor !== null);
    }
    current();
    const result = await appendJournal(input.db, context, job, "TERMINAL", "TERMINAL", {
      recordingStatus: "RECORDED", reason: null, pages, members, coverage: "PARTIAL", stateValidTime: "UNKNOWN",
      declaredLaneIds: lanes.map(lane => lane.laneId) }, budget);
    current(); return result;
  } catch (error) {
    // Classification contains no transport error/body/key text. Already committed prefixes remain intact.
    const reason = error instanceof HtxAccountAcquisitionRefusedV1 ? error.reason : "ACQUISITION_OWNER_FAILURE";
    // No recovery is attempted after abort, exhaustion or unavailable DB. Preserve the immutable prefix.
    try {
      current();
      const actual = await readAcquisition(input.db, context, input, budget);
      if (actual.job.contentDigest !== job.contentDigest) fail("JOB_CHANGED");
      if (actual.journal.at(-1)?.kind !== "TERMINAL") {
        const counts = validateHtxAccountAcquisitionJournalV1(spec, actual.journal.map(journalBody));
        await appendJournal(input.db, context, job, "TERMINAL", "TERMINAL", { recordingStatus: "PARTIAL", reason,
          pages: counts.pages, members: counts.members, coverage: "PARTIAL", stateValidTime: "UNKNOWN",
          declaredLaneIds: lanes.map(lane => lane.laneId) }, budget);
      }
    } catch {
      // Failed/unknown commit is observable by a separate bounded inspection. Never invent closure.
    }
    throw error;
  }
  } finally { input.transport.dispose(); }
}
