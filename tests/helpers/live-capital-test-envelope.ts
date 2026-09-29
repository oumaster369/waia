import { randomUUID } from "node:crypto";

import postgres from "postgres";

import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { produceLiveCapitalEnvelopeV2 } from "@/lib/trader/risk/v2/live-capital-envelope-postgres";

const POLICY = "ab".repeat(32);
const RELEASE = "cd".repeat(32);
const OPEN = {
  validFromUtc: "2020-01-01T00:00:00.000Z",
  validUntilUtc: "2099-01-01T00:00:00.000Z",
};

/**
 * Test-only publisher. Copies an existing exposure limit into capital and loss.
 * It does not choose a production capital amount.
 */
export async function publishMirroredLiveCapitalEnvelopeV2(input: {
  organizationId: string;
  accountId: string;
  exposureLimitNotional: string;
  lossLimitNotional?: string;
  sql?: postgres.Sql;
}): Promise<void> {
  const capitalNotional = formatDecimal(parseDecimal(input.exposureLimitNotional));
  const lossLimitNotional = formatDecimal(
    parseDecimal(input.lossLimitNotional ?? input.exposureLimitNotional),
  );
  const owned = input.sql === undefined;
  const url = process.env.DATABASE_URL_POSTGRES?.trim();
  if (owned && !url) {
    throw new Error("DATABASE_URL_POSTGRES is required to mirror a live capital envelope");
  }
  const sql = input.sql ?? postgres(url!, { max: 1 });
  try {
    const current = await sql<
      { capital_notional: string; loss_limit_notional: string; basis_digest: string | null }[]
    >`
      select e.capital_notional, e.loss_limit_notional, c.basis_digest
      from trader_live_capital_envelope_current_v2 c
      join trader_live_capital_envelopes_v2 e
        on e.organization_id = c.organization_id
       and e.account_id = c.account_id
       and e.content_digest = c.envelope_digest
      where c.organization_id = ${input.organizationId}::uuid
        and c.account_id = ${input.accountId}`;
    const row = current[0];
    if (
      row?.basis_digest &&
      formatDecimal(parseDecimal(row.capital_notional)) === capitalNotional &&
      formatDecimal(parseDecimal(row.loss_limit_notional)) === lossLimitNotional
    ) {
      return;
    }
    if (row) {
      await deleteLiveCapitalEnvelopeRows(sql, input.organizationId, input.accountId);
    }
    const result = await produceLiveCapitalEnvelopeV2(sql, {
      command: {
        commandId: randomUUID(),
        organizationId: input.organizationId,
        accountId: input.accountId,
        policyDigest: POLICY,
        releaseSha: RELEASE,
        capitalNotional,
        lossLimitNotional,
        ...OPEN,
      },
      boundOrganizationId: input.organizationId,
      observed: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        policyDigest: POLICY,
        releaseSha: RELEASE,
      },
    });
    if (result.decision !== "PUBLISHED") {
      throw new Error(`LIVE_CAPITAL_FIXTURE_REFUSED:${result.reason ?? "UNKNOWN"}`);
    }
  } finally {
    if (owned) await sql.end({ timeout: 5 });
  }
}

export async function deleteLiveCapitalEnvelopeRows(
  sql: postgres.Sql,
  organizationId: string,
  accountId?: string,
): Promise<void> {
  await sql.unsafe(
    "ALTER TABLE trader_live_capital_basis_bindings_v2 DISABLE TRIGGER live_capital_envelope_no_mutation",
  );
  await sql.unsafe(
    "ALTER TABLE trader_live_capital_envelopes_v2 DISABLE TRIGGER live_capital_envelope_no_mutation",
  );
  await sql.unsafe(
    "ALTER TABLE trader_live_capital_envelope_journal_v2 DISABLE TRIGGER live_capital_envelope_no_mutation",
  );
  try {
    if (accountId) {
      await sql`delete from trader_live_capital_envelope_current_v2
        where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
      await sql`delete from trader_live_capital_basis_bindings_v2
        where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
      await sql`delete from trader_live_capital_envelope_journal_v2
        where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
      await sql`delete from trader_live_capital_envelopes_v2
        where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
    } else {
      await sql`delete from trader_live_capital_envelope_current_v2
        where organization_id = ${organizationId}::uuid`;
      await sql`delete from trader_live_capital_basis_bindings_v2
        where organization_id = ${organizationId}::uuid`;
      await sql`delete from trader_live_capital_envelope_journal_v2
        where organization_id = ${organizationId}::uuid`;
      await sql`delete from trader_live_capital_envelopes_v2
        where organization_id = ${organizationId}::uuid`;
    }
  } finally {
    await sql.unsafe(
      "ALTER TABLE trader_live_capital_envelope_journal_v2 ENABLE TRIGGER live_capital_envelope_no_mutation",
    );
    await sql.unsafe(
      "ALTER TABLE trader_live_capital_envelopes_v2 ENABLE TRIGGER live_capital_envelope_no_mutation",
    );
    await sql.unsafe(
      "ALTER TABLE trader_live_capital_basis_bindings_v2 ENABLE TRIGGER live_capital_envelope_no_mutation",
    );
  }
}
