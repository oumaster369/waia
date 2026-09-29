import { sql } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import type { KillSwitchTarget } from "@/lib/trader/risk/kill-switch/types";

type ProjectDb = WaiaPostgresDb;

/**
 * Copies an enforcing kill switch onto trader_risk_account_state_v2.
 * lock_timeout is local to this transaction so a platform update fails closed
 * instead of waiting. Account rows created after the trip are still refused
 * by the switch-table read on admit.
 */
export async function projectKillSwitchOntoRiskAccountsV2(
  db: ProjectDb,
  target: KillSwitchTarget,
  state: "ACTIVE" | "CLEARING" | "INACTIVE",
): Promise<void> {
  await runWaiaPostgresTransaction(db, async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
    if (state === "ACTIVE" || state === "CLEARING") {
      if (target.scopeType === "platform") {
        await tx.execute(sql`
          update trader_risk_account_state_v2
          set kill_state = 'TRIPPED',
              posture = 'KILLED',
              state_version = state_version + 1,
              updated_at = clock_timestamp()
        `);
        return;
      }
      await tx.execute(sql`
        update trader_risk_account_state_v2
        set kill_state = 'TRIPPED',
            posture = 'KILLED',
            state_version = state_version + 1,
            updated_at = clock_timestamp()
        where organization_id = ${target.organizationId}::uuid
      `);
      return;
    }

    if (target.scopeType === "platform") {
      await tx.execute(sql`
        update trader_risk_account_state_v2 as account
        set kill_state = 'CLEAR',
            posture = case when account.posture = 'KILLED' then 'NORMAL' else account.posture end,
            state_version = account.state_version + 1,
            updated_at = clock_timestamp()
        where account.kill_state = 'TRIPPED'
          and not exists (
            select 1 from trader_kill_switches switch
            where switch.state in ('ACTIVE', 'CLEARING')
              and (
                switch.organization_id is null
                or switch.organization_id = account.organization_id
              )
          )
      `);
      return;
    }

    await tx.execute(sql`
      update trader_risk_account_state_v2 as account
      set kill_state = 'CLEAR',
          posture = case when account.posture = 'KILLED' then 'NORMAL' else account.posture end,
          state_version = account.state_version + 1,
          updated_at = clock_timestamp()
      where account.organization_id = ${target.organizationId}::uuid
        and account.kill_state = 'TRIPPED'
        and not exists (
          select 1 from trader_kill_switches switch
          where switch.state in ('ACTIVE', 'CLEARING')
            and (
              switch.organization_id is null
              or switch.organization_id = account.organization_id
            )
        )
    `);
  });
}

export async function enforcingKillSwitchCoversAccountV2(
  tx: Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0],
  organizationId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ present: number }>(sql`
    select 1 as present
    from trader_kill_switches
    where state in ('ACTIVE', 'CLEARING')
      and (organization_id is null or organization_id = ${organizationId}::uuid)
    limit 1
  `);
  return Boolean(rows[0]);
}
