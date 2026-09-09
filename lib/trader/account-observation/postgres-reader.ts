import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { observationBindingSchema, parseAccountObservation, sameObservationBinding } from "./validation";
import type { AccountObservation, ObservationBinding } from "./types";

export type ObservationReadScope = Pick<ObservationBinding,
  "organizationId" | "credentialId" | "exchangeAccountId">;
const scopeSchema = observationBindingSchema.pick({ organizationId: true, credentialId: true, exchangeAccountId: true });
export class ObservationReaderFailure extends Error {
  constructor() { super("ACCOUNT_OBSERVATION_READ_FAILED"); }
}

/** Inject a dedicated bounded pool. The caller authenticates and authorizes scope first.
 * No getDb/environment fallback, credential access, write grants or collector row locks.
 */
export function createPostgresObservationReader(sql: Sql) {
  async function scoped<T>(input: ObservationReadScope,
    fn: (tx: TransactionSql, scope: ObservationReadScope) => Promise<T>): Promise<T> {
    try {
      const scope = scopeSchema.parse({ organizationId: input.organizationId,
        credentialId: input.credentialId, exchangeAccountId: input.exchangeAccountId });
      return await sql.begin(async tx => {
        await tx.unsafe("SET TRANSACTION READ ONLY");
        await tx.unsafe("SET LOCAL ROLE waia_account_observation_reader");
        await tx.unsafe("SET LOCAL statement_timeout = '3000ms'");
        await tx.unsafe("SET LOCAL lock_timeout = '1000ms'");
        await tx.unsafe("SET LOCAL transaction_timeout = '5000ms'");
        await tx`SELECT set_config('waia.observation_org', ${scope.organizationId}, true),
          set_config('waia.observation_credential', ${scope.credentialId}, true),
          set_config('waia.observation_account', ${scope.exchangeAccountId}, true)`;
        return fn(tx, scope);
      }) as T;
    } catch { throw new ObservationReaderFailure(); }
  }
  return {
    /** Current database fence for an already authorized assignment, not authority
     * to discover accounts, decrypt keys or admit venue permissions. */
    async isCurrentAssignment(input: ObservationBinding, symbols: readonly string[]): Promise<boolean> {
      try {
        const binding = observationBindingSchema.parse(input);
        if (!symbols.length || symbols.length > 32 || new Set(symbols).size !== symbols.length ||
          symbols.some(s => !/^[A-Z0-9]{2,32}$/.test(s))) throw new ObservationReaderFailure();
        const expectedSymbols = JSON.stringify(symbols);
        return await scoped(binding, async (tx, s) => {
          const rows = await tx`SELECT state.symbols
            FROM public.exchange_credentials c JOIN public.trader_account_collection_state state
              ON state.organization_id=c.organization_id AND state.credential_id=c.id
              AND state.exchange_account_id=c.exchange_account_id
            WHERE c.organization_id=${s.organizationId} AND c.id=${s.credentialId}
              AND c.exchange_account_id=${s.exchangeAccountId} AND c.venue='htx' AND c.status='active'
              AND c.observation_revision::text=${binding.credentialRevision}
              AND state.configuration_revision=${binding.configurationRevision}`;
          return rows.length === 1 && JSON.stringify(rows[0].symbols) === expectedSymbols;
        });
      } catch { throw new ObservationReaderFailure(); }
    },
    resolveActiveBinding(scope: ObservationReadScope): Promise<ObservationBinding | null> {
      return scoped(scope, async (tx, s) => {
        const rows = await tx`SELECT c.observation_revision::text AS credential_revision,
          state.configuration_revision
          FROM public.exchange_credentials c JOIN public.trader_account_collection_state state
            ON state.organization_id=c.organization_id AND state.credential_id=c.id
            AND state.exchange_account_id=c.exchange_account_id
          WHERE c.organization_id=${s.organizationId} AND c.id=${s.credentialId}
            AND c.exchange_account_id=${s.exchangeAccountId} AND c.venue='htx' AND c.status='active'`;
        if (rows.length !== 1) return null;
        return observationBindingSchema.parse({ ...s, credentialRevision: rows[0].credential_revision,
          configurationRevision: rows[0].configuration_revision });
      });
    },
    async readLatest(input: ObservationBinding): Promise<AccountObservation | null> {
      // One joined statement binds data and active metadata to the same PostgreSQL snapshot.
      // Resolve followed by a later revoke/rotation/config change cannot return the old projection.
      try {
        const binding = observationBindingSchema.parse(input);
        return await scoped({ organizationId: binding.organizationId, credentialId: binding.credentialId,
          exchangeAccountId: binding.exchangeAccountId }, async (tx, s) => {
        const rows = await tx`SELECT o.observation_id, o.payload, state.symbols
          FROM public.exchange_credentials c JOIN public.trader_account_collection_state state
            ON state.organization_id=c.organization_id AND state.credential_id=c.id
            AND state.exchange_account_id=c.exchange_account_id
          JOIN public.trader_account_observations o
            ON o.organization_id=state.organization_id AND o.credential_id=state.credential_id
            AND o.exchange_account_id=state.exchange_account_id AND o.observation_id=state.last_observation_id
          WHERE c.organization_id=${s.organizationId} AND c.id=${s.credentialId}
            AND c.exchange_account_id=${s.exchangeAccountId} AND c.venue='htx' AND c.status='active'
            AND c.observation_revision::text=${binding.credentialRevision}
            AND state.configuration_revision=${binding.configurationRevision}
            AND o.credential_revision=c.observation_revision
            AND o.configuration_revision=state.configuration_revision`;
        if (rows.length !== 1) return null;
        const o = parseAccountObservation(rows[0].payload);
        if (!sameObservationBinding(o.binding, binding) || o.observationId !== rows[0].observation_id ||
          JSON.stringify(o.trades.map(t => t.symbol)) !== JSON.stringify(rows[0].symbols)) {
          throw new ObservationReaderFailure();
        }
        return o;
        });
      } catch { throw new ObservationReaderFailure(); }
    },
  };
}
