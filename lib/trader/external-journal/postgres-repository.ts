import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  externalJournalDigest,
  externalJournalParserSource,
  isPreparedExternalJournalBatch,
  snapshotExternalJournalLease,
  snapshotExternalJournalStorage,
  type ExternalJournalSourceBinding,
  type ExternalJournalStorageLease,
  type ExternalJournalStorageSnapshot,
  type PreparedExternalJournalBatch,
} from "./storage-contract";

export type ExternalJournalStorageRefusal = "UNAVAILABLE" | "INACTIVE" | "LEASE_BUSY" |
  "STALE_LEASE" | "STALE_CURSOR" | "BINDING_CHANGED" | "STALE_EVIDENCE" |
  "INTEGRITY_CONFLICT" | "REPLAY_UNRESOLVED" | "INVALID_INPUT";
type Refused = { status: "REFUSED"; reason: ExternalJournalStorageRefusal; generationSuspended?: boolean };
export type ExternalJournalClaimResult = { status: "CLAIMED"; lease: ExternalJournalStorageLease } | Refused;
export type ExternalJournalCommitResult = { status: "COMMITTED" | "REPLAYED" } | Refused;
export type ExternalJournalSuspensionReason = "SOURCE_CHANGED" | "SOURCE_TRUNCATED" | "INTEGRITY_CONFLICT";
/** A connection/transaction error can include a lost COMMIT acknowledgement. Never
 * infer rollback or retry with a different batch: reconcile the same prepared batch. */
export class ExternalJournalStorageFailure extends Error {
  readonly outcome = "UNKNOWN" as const;
  constructor() { super("EXTERNAL_JOURNAL_STORAGE_OUTCOME_UNKNOWN"); }
}
class IntegrityConflict extends Error {}

type SourceRow = {
  source_id: string; organization_id: string; credential_id: string; exchange_account_id: string;
  credential_revision: string; binding_revision: string; external_uid: string;
  market: "spot" | "futures" | "unknown"; api_mode: string; writer_discriminator: string;
  source_fingerprint: string; verification_receipt: string | null; binding_state: string;
  verified_ms: string | null; expires_ms: string | null; now_ms: string;
};
type GenerationRow = {
  generation_id: string; generation_fingerprint: string; source_binding_revision: string;
  state: "ACTIVE" | "CLOSED" | "SUSPENDED"; cursor_version: string;
  next_offset: string; pending_offset: string; pending_bytes: Buffer;
  discard_line_offset: string | null; discard_bytes_seen: string | null;
  lease_token: string | null; lease_owner: string | null; claimed_ms: string | null;
  expires_ms: string | null; now_ms: string; last_commit_token: string | null;
  last_commit_digest: string | null; last_commit_from_version: string | null;
  last_commit_to_version: string | null; last_commit_from_offset: string | null; last_commit_to_offset: string | null;
};
type Locked = { snapshot: ExternalJournalStorageSnapshot; row: GenerationRow };
const refuse = (reason: ExternalJournalStorageRefusal): Refused => ({ status: "REFUSED", reason });
const validScope = (sourceId: string, generationId: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sourceId) &&
  typeof generationId === "string" && generationId.length > 0 && generationId.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(generationId);
const owns = (row: GenerationRow, lease: ExternalJournalStorageLease) =>
  row.lease_token === lease.token && row.lease_owner === lease.ownerId &&
  row.expires_ms !== null && Number(row.expires_ms) > Number(row.now_ms);

/** Local storage boundary only. The caller supplies a bounded dedicated connection;
 * no environment lookup, source reader, credential resolver or runtime startup exists. */
export function createPostgresExternalJournalRepository(sql: Sql) {
  async function scoped<T>(sourceId: string, generationId: string,
    fn: (tx: TransactionSql) => Promise<T>, lease?: ExternalJournalStorageLease): Promise<T> {
    if (!validScope(sourceId, generationId)) throw new ExternalJournalStorageFailure();
    try {
      return await sql.begin(async tx => {
        // A genuine restricted LOGIN is mandatory; SET ROLE on an owner connection
        // would leave session_user powerful and would not prove assignment isolation.
        const posture = await tx`SELECT current_user = session_user AS original_session,
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolcanlogin
            AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
            AND NOT rolreplication AND NOT rolinherit) AS restricted_login,
          pg_has_role(session_user, 'waia_external_journal_importer', 'SET') AS can_set,
          NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname NOT IN (session_user, 'waia_external_journal_importer')
            AND pg_has_role(session_user, oid, 'SET')) AS exclusive_role,
          NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN ('exchange_credentials',
              'trader_external_journal_sources', 'trader_external_journal_generations', 'trader_external_journal_records')
            AND r.rolname IN (session_user, 'waia_external_journal_importer')) AS not_owner`;
        if (!posture[0]?.original_session || !posture[0]?.restricted_login ||
          !posture[0]?.can_set || !posture[0]?.exclusive_role || !posture[0]?.not_owner)
          throw new Error("UNSAFE_JOURNAL_CONNECTION");
        await tx.unsafe("SET LOCAL ROLE waia_external_journal_importer");
        await tx.unsafe("SET LOCAL statement_timeout = '3000ms'");
        await tx.unsafe("SET LOCAL lock_timeout = '1000ms'");
        await tx.unsafe("SET LOCAL transaction_timeout = '5000ms'");
        await tx`SELECT set_config('waia.journal_source', ${sourceId}, true),
          set_config('waia.journal_generation', ${generationId}, true),
          set_config('waia.journal_lease', ${lease?.token ?? ""}, true),
          set_config('waia.journal_owner', ${lease?.ownerId ?? ""}, true),
          set_config('waia.journal_cursor_version', ${String(lease?.cursorVersion ?? "")}, true)`;
        return fn(tx);
      }) as T;
    } catch (error) {
      if (error instanceof IntegrityConflict) throw error;
      throw new ExternalJournalStorageFailure();
    }
  }

  async function sourceRow(tx: TransactionSql, sourceId: string, lock = false): Promise<SourceRow | null> {
    const rows = await tx<SourceRow[]>`SELECT source_id, organization_id, credential_id, exchange_account_id,
      credential_revision::text, binding_revision::text, external_uid, market, api_mode, writer_discriminator,
      source_fingerprint, verification_receipt, binding_state,
      floor(extract(epoch FROM verified_at) * 1000)::text AS verified_ms,
      floor(extract(epoch FROM verification_expires_at) * 1000)::text AS expires_ms,
      floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now_ms
      FROM public.trader_external_journal_sources WHERE source_id = ${sourceId}
      ${lock ? tx`FOR UPDATE` : tx``}`;
    return rows[0] ?? null;
  }
  async function lock(tx: TransactionSql, sourceId: string, generationId: string): Promise<Locked | null> {
    const before = await sourceRow(tx, sourceId);
    if (!before) return null;
    // Uniform lifecycle lock order: credential -> source -> generation. Enrollment
    // changes after the first read are observed again under the source row lock.
    const credentials = await tx`SELECT id, status, observation_revision::text AS revision
      FROM public.exchange_credentials WHERE id = ${before.credential_id}
        AND organization_id = ${before.organization_id} AND exchange_account_id = ${before.exchange_account_id}
        AND venue = 'htx' FOR UPDATE`;
    if (credentials.length !== 1 || credentials[0].status !== "active") return null;
    const s = await sourceRow(tx, sourceId, true);
    if (!s || s.binding_state !== "VERIFIED" || !s.verification_receipt || s.verified_ms === null ||
      s.expires_ms === null || Number(s.verified_ms) > Number(s.now_ms) || Number(s.expires_ms) <= Number(s.now_ms) ||
      credentials[0].revision !== s.credential_revision) return null;
    const rows = await tx<GenerationRow[]>`SELECT generation_id, generation_fingerprint, source_binding_revision::text,
      state, cursor_version::text, next_offset::text, pending_offset::text, pending_bytes,
      discard_line_offset::text, discard_bytes_seen::text, lease_token, lease_owner,
      floor(extract(epoch FROM lease_claimed_at) * 1000)::text AS claimed_ms,
      floor(extract(epoch FROM lease_expires_at) * 1000)::text AS expires_ms,
      floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now_ms,
      last_commit_token, last_commit_digest, last_commit_from_version::text, last_commit_to_version::text,
      last_commit_from_offset::text, last_commit_to_offset::text
      FROM public.trader_external_journal_generations WHERE source_id = ${sourceId}
        AND generation_id = ${generationId} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.source_binding_revision !== s.binding_revision) return null;
    const source: ExternalJournalSourceBinding = { sourceId: s.source_id, organizationId: s.organization_id,
      credentialId: s.credential_id, accountId: s.exchange_account_id, credentialRevision: s.credential_revision,
      bindingRevision: s.binding_revision, externalUid: s.external_uid, market: s.market, apiMode: s.api_mode,
      writerDiscriminator: s.writer_discriminator, sourceFingerprint: s.source_fingerprint,
      verificationReceipt: s.verification_receipt, verifiedAtMs: Number(s.verified_ms), verificationExpiresAtMs: Number(s.expires_ms) };
    const snapshot = snapshotExternalJournalStorage({ source, generationId: row.generation_id,
      generationFingerprint: row.generation_fingerprint, cursorVersion: Number(row.cursor_version), state: row.state,
      cursor: { nextOffset: Number(row.next_offset), pendingOffset: Number(row.pending_offset),
        pendingBytes: Array.from(row.pending_bytes), boundSource: externalJournalParserSource(source), generationId,
        ...(row.discard_line_offset === null ? {} : { discardUntilLf: {
          lineOffset: Number(row.discard_line_offset), bytesSeen: Number(row.discard_bytes_seen) } }) } });
    return { snapshot, row };
  }
  async function claimLocked(tx: TransactionSql, current: Locked, ownerId: string, ttlMs: number) {
    const token = randomUUID();
    const rows = await tx`WITH moment AS (SELECT clock_timestamp() AS now)
      UPDATE public.trader_external_journal_generations g SET lease_token = ${token}, lease_owner = ${ownerId},
        lease_claimed_at = moment.now, lease_expires_at = moment.now + ${ttlMs} * interval '1 millisecond'
      FROM moment WHERE g.source_id = ${current.snapshot.source.sourceId} AND g.generation_id = ${current.snapshot.generationId}
        AND g.state = 'ACTIVE' AND (g.lease_token IS NULL OR g.lease_expires_at <= moment.now)
        AND moment.now < to_timestamp(${current.snapshot.source.verificationExpiresAtMs} / 1000.0)
      RETURNING floor(extract(epoch FROM g.lease_claimed_at) * 1000)::text AS claimed_ms,
        floor(extract(epoch FROM g.lease_expires_at) * 1000)::text AS expires_ms`;
    if (rows.length !== 1) return null;
    return snapshotExternalJournalLease({ ...current.snapshot, token, ownerId,
      claimedAtMs: Number(rows[0].claimed_ms), expiresAtMs: Number(rows[0].expires_ms) });
  }
  async function suspendLocked(tx: TransactionSql, lease: ExternalJournalStorageLease, reason: ExternalJournalSuspensionReason) {
    await tx`SELECT set_config('waia.journal_lease', ${lease.token}, true), set_config('waia.journal_owner', ${lease.ownerId}, true)`;
    const rows = await tx`UPDATE public.trader_external_journal_generations SET state = 'SUSPENDED',
      suspension_reason = ${reason}, lease_token = NULL, lease_owner = NULL, lease_claimed_at = NULL, lease_expires_at = NULL
      WHERE source_id = ${lease.source.sourceId} AND generation_id = ${lease.generationId}
        AND cursor_version = ${lease.cursorVersion} AND lease_token = ${lease.token} AND lease_owner = ${lease.ownerId}
        AND lease_expires_at > clock_timestamp() AND state = 'ACTIVE' RETURNING generation_id`;
    return rows.length === 1;
  }
  async function suspendConflict(batch: PreparedExternalJournalBatch): Promise<boolean> {
    const lease = batch.lease;
    return scoped(lease.source.sourceId, lease.generationId, async tx => {
      const current = await lock(tx, lease.source.sourceId, lease.generationId);
      if (!current || current.snapshot.state !== "ACTIVE" ||
        externalJournalDigest(current.snapshot.source) !== externalJournalDigest(lease.source) ||
        current.snapshot.generationFingerprint !== lease.generationFingerprint) return false;
      if (current.snapshot.cursorVersion === lease.cursorVersion && owns(current.row, lease))
        return suspendLocked(tx, lease, "INTEGRITY_CONFLICT");
      // A conflicting retry after a acknowledged-or-ambiguous commit has no live
      // old lease. Acquire a new lease only while its exact receipt is still latest;
      // a successor worker/commit prevents this transition rather than being killed.
      if (current.row.last_commit_token !== lease.token ||
        current.row.last_commit_from_version !== String(lease.cursorVersion) ||
        current.snapshot.cursorVersion !== lease.cursorVersion + 1 ||
        (current.row.lease_token && Number(current.row.expires_ms) > Number(current.row.now_ms))) return false;
      const guardLease = await claimLocked(tx, current, lease.ownerId, 5000);
      return guardLease ? suspendLocked(tx, guardLease, "INTEGRITY_CONFLICT") : false;
    }, lease);
  }

  return {
    load: (sourceId: string, generationId: string): Promise<ExternalJournalStorageSnapshot | null> =>
      scoped(sourceId, generationId, async tx => (await lock(tx, sourceId, generationId))?.snapshot ?? null),
    claim: async (input: { sourceId: string; generationId: string; ownerId: string; ttlMs: number }): Promise<ExternalJournalClaimResult> => {
      const { sourceId, generationId, ownerId, ttlMs } = input;
      if (!validScope(sourceId, generationId) || typeof ownerId !== "string" ||
        !ownerId.length || ownerId.length > 128 || /[\u0000-\u001f\u007f]/.test(ownerId) ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60000) return refuse("INVALID_INPUT");
      return scoped(sourceId, generationId, async tx => {
        const current = await lock(tx, sourceId, generationId);
        if (!current) return refuse("UNAVAILABLE");
        if (current.snapshot.state !== "ACTIVE") return refuse("INACTIVE");
        if (current.row.lease_token && Number(current.row.expires_ms) > Number(current.row.now_ms)) return refuse("LEASE_BUSY");
        const lease = await claimLocked(tx, current, ownerId, ttlMs);
        return lease ? { status: "CLAIMED", lease } : refuse("LEASE_BUSY");
      });
    },
    suspend: async (input: ExternalJournalStorageLease, reason: ExternalJournalSuspensionReason): Promise<boolean> => {
      const lease = snapshotExternalJournalLease(input);
      if (!["SOURCE_CHANGED", "SOURCE_TRUNCATED", "INTEGRITY_CONFLICT"].includes(reason)) return false;
      return scoped(lease.source.sourceId, lease.generationId, async tx => {
        const current = await lock(tx, lease.source.sourceId, lease.generationId);
        if (!current || externalJournalDigest(current.snapshot.source) !== externalJournalDigest(lease.source) ||
          current.snapshot.generationFingerprint !== lease.generationFingerprint ||
          current.snapshot.cursorVersion !== lease.cursorVersion || !owns(current.row, lease)) return false;
        return suspendLocked(tx, lease, reason);
      }, lease);
    },
    commit: async (batch: PreparedExternalJournalBatch): Promise<ExternalJournalCommitResult> => {
      if (!isPreparedExternalJournalBatch(batch)) return refuse("INVALID_INPUT");
      const lease = batch.lease;
      try {
        return await scoped(lease.source.sourceId, lease.generationId, async tx => {
          const current = await lock(tx, lease.source.sourceId, lease.generationId);
          if (!current) return refuse("UNAVAILABLE");
          if (externalJournalDigest(current.snapshot.source) !== externalJournalDigest(lease.source) ||
            current.snapshot.generationFingerprint !== lease.generationFingerprint) return refuse("BINDING_CHANGED");
          const oldReceipt = current.row.last_commit_token === lease.token &&
            current.row.last_commit_from_version === String(lease.cursorVersion);
          if (oldReceipt && current.row.last_commit_digest !== batch.digest) throw new IntegrityConflict();
          if (oldReceipt) {
            if (current.snapshot.cursorVersion !== lease.cursorVersion + 1 ||
              externalJournalDigest(current.snapshot.cursor) !== externalJournalDigest(batch.cursor)) throw new IntegrityConflict();
            const stored = await tx`SELECT byte_offset::text, byte_length::text, raw_sha256, normalizer_version,
              record_kind, code, payload, record_digest FROM public.trader_external_journal_records
              WHERE source_id = ${lease.source.sourceId} AND generation_id = ${lease.generationId}
                AND batch_digest = ${batch.digest} ORDER BY byte_offset`;
            if (stored.length !== batch.records.length || stored.some((r, index) => {
              const expected = batch.records[index]!;
              return r.byte_offset !== String(expected.byteOffset) || r.byte_length !== String(expected.byteLength) ||
                r.raw_sha256 !== expected.rawSha256 || r.normalizer_version !== expected.normalizerVersion ||
                r.record_kind !== expected.recordKind || r.code !== expected.code || r.record_digest !== expected.recordDigest ||
                externalJournalDigest(r.payload) !== externalJournalDigest(expected.payload);
            })) throw new IntegrityConflict();
            return { status: "REPLAYED" };
          }
          if (current.snapshot.cursorVersion > lease.cursorVersion) return refuse("REPLAY_UNRESOLVED");
          if (current.snapshot.state !== "ACTIVE") return refuse("INACTIVE");
          if (current.snapshot.cursorVersion !== lease.cursorVersion ||
            externalJournalDigest(current.snapshot.cursor) !== externalJournalDigest(lease.cursor)) return refuse("STALE_CURSOR");
          if (!owns(current.row, lease)) return refuse("STALE_LEASE");
          if (batch.sourceEvidence.observedAtMs > Number(current.row.now_ms) ||
            Number(current.row.now_ms) - batch.sourceEvidence.observedAtMs > 60000) return refuse("STALE_EVIDENCE");
          for (const record of batch.records) {
            const old = await tx`SELECT record_digest, batch_digest FROM public.trader_external_journal_records
              WHERE source_id = ${lease.source.sourceId} AND generation_id = ${lease.generationId}
                AND byte_offset = ${record.byteOffset}`;
            if (old.length) throw new IntegrityConflict();
            await tx`INSERT INTO public.trader_external_journal_records
              (source_id, generation_id, organization_id, credential_id, exchange_account_id,
                byte_offset, byte_length, raw_sha256, normalizer_version, record_kind, code, payload, record_digest, batch_digest)
              VALUES (${lease.source.sourceId}, ${lease.generationId}, ${lease.source.organizationId}, ${lease.source.credentialId},
                ${lease.source.accountId}, ${record.byteOffset}, ${record.byteLength}, ${record.rawSha256}, ${record.normalizerVersion},
                ${record.recordKind}, ${record.code}, ${record.payload === null ? null : tx.json(JSON.parse(JSON.stringify(record.payload)))},
                ${record.recordDigest}, ${batch.digest})`;
          }
          const c = batch.cursor;
          const committed = await tx`UPDATE public.trader_external_journal_generations SET
            state = ${batch.endOfSource ? "CLOSED" : "ACTIVE"}, cursor_version = cursor_version + 1,
            next_offset = ${c.nextOffset}, pending_offset = ${c.pendingOffset}, pending_bytes = ${Buffer.from(c.pendingBytes)},
            discard_line_offset = ${c.discardUntilLf?.lineOffset ?? null}, discard_bytes_seen = ${c.discardUntilLf?.bytesSeen ?? null},
            last_commit_token = ${lease.token}, last_commit_digest = ${batch.digest},
            last_commit_from_version = ${lease.cursorVersion}, last_commit_to_version = ${lease.cursorVersion + 1},
            last_commit_from_offset = ${lease.cursor.nextOffset}, last_commit_to_offset = ${c.nextOffset},
            lease_token = NULL, lease_owner = NULL, lease_claimed_at = NULL, lease_expires_at = NULL
            WHERE source_id = ${lease.source.sourceId} AND generation_id = ${lease.generationId}
              AND cursor_version = ${lease.cursorVersion} AND next_offset = ${lease.cursor.nextOffset}
              AND lease_token = ${lease.token} AND lease_owner = ${lease.ownerId} AND lease_expires_at > clock_timestamp()
              AND clock_timestamp() < to_timestamp(${lease.source.verificationExpiresAtMs} / 1000.0)
            RETURNING generation_id`;
          if (committed.length !== 1) throw new Error("EXTERNAL_JOURNAL_FINAL_CAS_REFUSED");
          return { status: "COMMITTED" };
        }, lease);
      } catch (error) {
        if (!(error instanceof IntegrityConflict)) throw error;
        return { ...refuse("INTEGRITY_CONFLICT"), generationSuspended: await suspendConflict(batch) };
      }
    },
  };
}
