import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { observationBindingSchema, parseAccountObservation, sameObservationBinding } from "./validation";
import type { AccountObservation, ObservationBinding, ObservationLease, ObservationRepository } from "./types";

type Collection = {
  configuration_revision: string; symbols: string[];
  lease_token: string | null; lease_owner: string | null;
  lease_expires_ms: number | null; consecutive_failures: number;
  next_due_ms: number; now_ms: number; last_observation_id: string | null;
};
export class ObservationStorageFailure extends Error {
  constructor() { super("ACCOUNT_OBSERVATION_STORAGE_FAILED"); }
}
/**
 * Explicit dedicated connection, never getDb()/environment fallback. Caller must supply a
 * bounded pool (connect_timeout, max_lifetime, max); transactions enforce PG17 timeouts.
 * Context is server-authorized scope, NOT arbitrary browser authority. Role has no secrets.
 */
export function createPostgresObservationRepository(sql: Sql): ObservationRepository & {
  readLatest(binding: ObservationBinding): Promise<AccountObservation | null>;
} {
  async function scoped<T>(input: ObservationBinding, fn: (tx: TransactionSql, binding: ObservationBinding) => Promise<T>): Promise<T> {
    const b = observationBindingSchema.parse(input);
    try {
      return await sql.begin(async tx => {
        await tx.unsafe("SET LOCAL ROLE waia_account_observer");
        await tx.unsafe("SET LOCAL statement_timeout = '3000ms'");
        await tx.unsafe("SET LOCAL lock_timeout = '1000ms'");
        await tx.unsafe("SET LOCAL transaction_timeout = '5000ms'");
        await tx`SELECT set_config('waia.observation_org', ${b.organizationId}, true),
          set_config('waia.observation_credential', ${b.credentialId}, true),
          set_config('waia.observation_account', ${b.exchangeAccountId}, true)`;
        return fn(tx, b);
      }) as T;
    } catch { throw new ObservationStorageFailure(); }
  }
  async function lock(tx: TransactionSql, b: ObservationBinding): Promise<Collection | null> {
    // Same lock order as credential lifecycle: credential first, then collection state.
    const credentials = await tx`SELECT id, status, observation_revision::text AS revision
      FROM public.exchange_credentials
      WHERE id = ${b.credentialId} AND organization_id = ${b.organizationId}
        AND exchange_account_id = ${b.exchangeAccountId} AND venue = 'htx'
      FOR UPDATE`;
    if (credentials.length !== 1 || credentials[0].status !== "active" ||
      credentials[0].revision !== b.credentialRevision) return null;
    const rows = await tx<Collection[]>`SELECT configuration_revision, symbols,
      lease_token, lease_owner, extract(epoch from lease_expires_at) * 1000 AS lease_expires_ms,
      consecutive_failures, extract(epoch from next_due_at) * 1000 AS next_due_ms,
      extract(epoch from clock_timestamp()) * 1000 AS now_ms, last_observation_id
      FROM public.trader_account_collection_state
      WHERE organization_id = ${b.organizationId} AND credential_id = ${b.credentialId}
        AND exchange_account_id = ${b.exchangeAccountId} FOR UPDATE`;
    if (rows.length !== 1 || rows[0].configuration_revision !== b.configurationRevision) return null;
    return rows[0];
  }
  const owns = (s: Collection, l: Pick<ObservationLease, "token" | "ownerId">) =>
    s.lease_token === l.token && s.lease_owner === l.ownerId &&
    s.lease_expires_ms !== null && Number(s.lease_expires_ms) > Number(s.now_ms);
  return {
    claimDue: (b, ownerId, _nowMs, ttlMs) => scoped(b, async (tx, binding) => {
      if (!ownerId.trim() || ownerId.length > 256 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 3600000)
        throw new Error("INVALID_LEASE");
      const s = await lock(tx, binding);
      if (!s || Number(s.next_due_ms) > Number(s.now_ms) ||
        (s.lease_token && Number(s.lease_expires_ms) > Number(s.now_ms))) return null;
      const token = randomUUID();
      const rows = await tx`UPDATE public.trader_account_collection_state
        SET lease_token = ${token}, lease_owner = ${ownerId},
          lease_expires_at = clock_timestamp() + ${ttlMs} * interval '1 millisecond'
        WHERE organization_id = ${binding.organizationId} AND credential_id = ${binding.credentialId}
          AND exchange_account_id = ${binding.exchangeAccountId}
        RETURNING extract(epoch from lease_expires_at) * 1000 AS expires_ms`;
      return { binding, token, ownerId, expiresAtMs: Math.floor(Number(rows[0].expires_ms)),
        consecutiveFailures: s.consecutive_failures };
    }),
    isCurrent: lease => scoped(lease.binding, async (tx, b) => {
      const s = await lock(tx, b); return !!s && owns(s, lease);
    }),
    commitIfCurrent: input => scoped(input.lease.binding, async (tx, b) => {
      const o = parseAccountObservation(input.observation);
      if (!sameObservationBinding(b, o.binding)) return false;
      const payload = JSON.stringify(o);
      if (Buffer.byteLength(payload, "utf8") > 1000000) throw new Error("PAYLOAD_TOO_LARGE");
      const delay = input.nextDueAtMs - input.nowMs;
      if (!Number.isSafeInteger(delay) || delay < 1 || delay > 86400000 ||
        !Number.isInteger(input.consecutiveFailures) || input.consecutiveFailures < 0 || input.consecutiveFailures > 30)
        throw new Error("INVALID_CADENCE");
      const s = await lock(tx, b);
      if (!s) return false;
      // Retry after an ambiguous acknowledgement only recognizes the EXACT previously committed record.
      const old = await tx`SELECT payload, lease_token FROM public.trader_account_observations
        WHERE organization_id = ${b.organizationId} AND credential_id = ${b.credentialId}
          AND exchange_account_id = ${b.exchangeAccountId} AND observation_id = ${o.observationId}`;
      if (old.length) return old[0].lease_token === input.lease.token &&
        sameObservationBinding(parseAccountObservation(old[0].payload).binding, b) &&
        JSON.stringify(parseAccountObservation(old[0].payload)) === JSON.stringify(o);
      if (!owns(s, input.lease) || JSON.stringify(s.symbols) !== JSON.stringify(o.trades.map(t => t.symbol))) return false;
      await tx`INSERT INTO public.trader_account_observations
        (organization_id, credential_id, exchange_account_id, observation_id,
          credential_revision, configuration_revision, lease_token, payload)
        VALUES (${b.organizationId}, ${b.credentialId}, ${b.exchangeAccountId}, ${o.observationId},
          ${b.credentialRevision}, ${b.configurationRevision}, ${input.lease.token}, ${tx.json(JSON.parse(payload))})`;
      const committed = await tx`UPDATE public.trader_account_collection_state
        SET next_due_at = clock_timestamp() + ${delay} * interval '1 millisecond',
          consecutive_failures = ${input.consecutiveFailures}, last_observation_id = ${o.observationId},
          lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
        WHERE organization_id = ${b.organizationId} AND credential_id = ${b.credentialId}
          AND exchange_account_id = ${b.exchangeAccountId}
          AND lease_token = ${input.lease.token} AND lease_owner = ${input.lease.ownerId}
          AND lease_expires_at > clock_timestamp()
        RETURNING last_observation_id`;
      if (committed.length !== 1) throw new Error("LEASE_EXPIRED_DURING_COMMIT");
      return true;
    }),
    release: lease => scoped(lease.binding, async (tx, b) => {
      // Failed/abandoned attempt persists a bounded backoff even across worker restarts.
      // No credential mutation, and cleanup after revocation must remain possible.
      await tx`UPDATE public.trader_account_collection_state
        SET lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
          next_due_at = greatest(next_due_at, clock_timestamp() +
            least(300000, 10000 * power(2, least(consecutive_failures, 5))) * interval '1 millisecond'),
          consecutive_failures = least(30, consecutive_failures + 1)
        WHERE organization_id = ${b.organizationId} AND credential_id = ${b.credentialId}
          AND exchange_account_id = ${b.exchangeAccountId}
          AND lease_token = ${lease.token} AND lease_owner = ${lease.ownerId}`;
    }),
    readLatest: b => scoped(b, async (tx, binding) => {
      const s = await lock(tx, binding);
      if (!s?.last_observation_id) return null;
      const rows = await tx`SELECT payload FROM public.trader_account_observations
        WHERE organization_id = ${binding.organizationId} AND credential_id = ${binding.credentialId}
          AND exchange_account_id = ${binding.exchangeAccountId}
          AND observation_id = ${s.last_observation_id}`;
      if (!rows.length) return null;
      const o = parseAccountObservation(rows[0].payload);
      return sameObservationBinding(o.binding, binding) ? o : null;
    }),
  };
}
