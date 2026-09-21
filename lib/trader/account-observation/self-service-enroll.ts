import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

import {
  ACCOUNT_OBSERVATION_SELF_SERVICE_MAX_ASSIGNMENTS,
  ACCOUNT_OBSERVATION_SELF_SERVICE_SYMBOLS,
  createAccountObservationSelfServiceConfiguration,
} from "./self-service-envelope";

export class AccountObservationSelfServiceEnrollError extends Error {
  constructor(readonly code: "CREDENTIAL" | "CAPACITY") {
    super(`ACCOUNT_OBSERVATION_SELF_SERVICE_ENROLL_REFUSED:${code}`);
    this.name = "AccountObservationSelfServiceEnrollError";
  }
}

export type AccountObservationSelfServiceEnrollResult = "PROVISIONED" | "ALREADY_PROVISIONED";

function countFromExecute(result: unknown): number {
  const row = Array.isArray(result)
    ? result[0]
    : result && typeof result === "object" && "rows" in result
      ? (result as { rows: unknown[] }).rows[0]
      : undefined;
  if (!row || typeof row !== "object") return 0;
  const n = (row as { n?: unknown }).n;
  return typeof n === "number" ? n : Number(n);
}

/** Insert collection-state for the exact credential Connect just stored.
 * Idempotent on an exact existing row. Does not grant the collector INSERT. */
export async function enrollSelfServiceAccountObservation(
  db: WaiaPostgresDb,
  input: Readonly<{
    organizationId: string;
    credentialId: string;
    exchangeAccountId: string;
  }>,
): Promise<AccountObservationSelfServiceEnrollResult> {
  const config = createAccountObservationSelfServiceConfiguration();
  const symbols = [...ACCOUNT_OBSERVATION_SELF_SERVICE_SYMBOLS];

  return db.transaction(async (tx) => {
    const [credential] = await tx
      .select({
        organizationId: pgSchema.exchangeCredentials.organizationId,
        venue: pgSchema.exchangeCredentials.venue,
        exchangeAccountId: pgSchema.exchangeCredentials.exchangeAccountId,
        status: pgSchema.exchangeCredentials.status,
      })
      .from(pgSchema.exchangeCredentials)
      .where(eq(pgSchema.exchangeCredentials.id, input.credentialId))
      .limit(1);
    if (
      !credential ||
      credential.organizationId !== input.organizationId ||
      credential.exchangeAccountId !== input.exchangeAccountId ||
      credential.venue !== "htx" ||
      credential.status !== "active"
    ) {
      throw new AccountObservationSelfServiceEnrollError("CREDENTIAL");
    }

    const [existing] = await tx
      .select({
        configurationRevision: pgSchema.traderAccountCollectionState.configurationRevision,
        symbols: pgSchema.traderAccountCollectionState.symbols,
      })
      .from(pgSchema.traderAccountCollectionState)
      .where(
        and(
          eq(pgSchema.traderAccountCollectionState.organizationId, input.organizationId),
          eq(pgSchema.traderAccountCollectionState.credentialId, input.credentialId),
          eq(pgSchema.traderAccountCollectionState.exchangeAccountId, input.exchangeAccountId),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.configurationRevision === config.revision &&
        JSON.stringify(existing.symbols) === JSON.stringify(symbols)
      ) {
        return "ALREADY_PROVISIONED";
      }
      await tx
        .update(pgSchema.traderAccountCollectionState)
        .set({
          configurationRevision: config.revision,
          symbols,
        })
        .where(
          and(
            eq(pgSchema.traderAccountCollectionState.organizationId, input.organizationId),
            eq(pgSchema.traderAccountCollectionState.credentialId, input.credentialId),
            eq(pgSchema.traderAccountCollectionState.exchangeAccountId, input.exchangeAccountId),
          ),
        );
      return "PROVISIONED";
    }

    await tx.execute(
      sql`lock table public.trader_account_collection_state in share row exclusive mode`,
    );
    const counted = await tx.execute(
      sql`select count(*)::int as n
          from public.trader_account_collection_state s
          join public.exchange_credentials c
            on c.id = s.credential_id
           and c.organization_id = s.organization_id
           and c.exchange_account_id = s.exchange_account_id
          where c.venue = 'htx' and c.status = 'active'`,
    );
    if (countFromExecute(counted) >= ACCOUNT_OBSERVATION_SELF_SERVICE_MAX_ASSIGNMENTS) {
      throw new AccountObservationSelfServiceEnrollError("CAPACITY");
    }

    await tx.insert(pgSchema.traderAccountCollectionState).values({
      organizationId: input.organizationId,
      credentialId: input.credentialId,
      exchangeAccountId: input.exchangeAccountId,
      configurationRevision: config.revision,
      symbols,
    });
    return "PROVISIONED";
  });
}
