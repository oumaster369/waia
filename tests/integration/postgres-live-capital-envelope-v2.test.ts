import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import {
  LIVE_CAPITAL_ENVELOPE_STAGES_V2,
  type LiveCapitalEnvelopeCommandV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-v2";
import {
  advanceLiveCapitalEnvelopeStageV2,
  gateLiveCapitalIssueV2,
  gateLiveCapitalStartV2,
  invalidateLiveCapitalEnvelopeV2,
  produceLiveCapitalEnvelopeV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-postgres";
import { gateCurrentAccountExecutionBindV1 } from "@/lib/trader/risk/v2/risk-account-profile-command-v1";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
/** Synthetic operator amounts. They exist only inside this test. */
const CAPITAL = "10";
const LOSS_LIMIT = "1";
const OPEN = {
  validFromUtc: "2020-01-01T00:00:00.000Z",
  validUntilUtc: "2099-01-01T00:00:00.000Z",
};
const STALE = {
  validFromUtc: "2019-01-01T00:00:00.000Z",
  validUntilUtc: "2020-01-01T00:00:00.000Z",
};
const POLICY = "ab".repeat(32);
const RELEASE = "cd".repeat(32);

let client: postgres.Sql;
let database: ReturnType<typeof drizzle>;

function command(
  organizationId: string,
  accountId: string,
  patch: Partial<LiveCapitalEnvelopeCommandV2> = {},
): LiveCapitalEnvelopeCommandV2 {
  return {
    commandId: randomUUID(),
    organizationId,
    accountId,
    policyDigest: POLICY,
    releaseSha: RELEASE,
    capitalNotional: CAPITAL,
    lossLimitNotional: LOSS_LIMIT,
    ...OPEN,
    ...patch,
  };
}

async function seed() {
  const userId = randomUUID();
  const organizationId = randomUUID();
  await client`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
  await database.insert(schema.users).values({
    id: userId,
    identityLabel: "DEE1145 synthetic",
    email: `${userId}@waia.invalid`,
  });
  await database.insert(schema.organizations).values({
    id: organizationId,
    ownerUserId: userId,
    kind: "personal",
    name: "DEE1145 synthetic",
  });
  return { organizationId };
}

async function counts(organizationId: string) {
  const [row] = await client<
    {
      envelopes: number;
      journal: number;
      invalidated: number;
      current_rows: number;
      bases: number;
      allowances: number;
      orders: number;
    }[]
  >`
    select
      (select count(*)::int from trader_live_capital_envelopes_v2 where organization_id = ${organizationId}::uuid) as envelopes,
      (select count(*)::int from trader_live_capital_envelope_journal_v2 where organization_id = ${organizationId}::uuid) as journal,
      (select count(*)::int from trader_live_capital_envelope_journal_v2 where organization_id = ${organizationId}::uuid and stage = 'INVALIDATED') as invalidated,
      (select count(*)::int from trader_live_capital_envelope_current_v2 where organization_id = ${organizationId}::uuid) as current_rows,
      (select count(*)::int from trader_live_capital_basis_bindings_v2 where organization_id = ${organizationId}::uuid) as bases,
      (select count(*)::int from trader_risk_allowances_v2 where organization_id = ${organizationId}::uuid) as allowances,
      (select count(*)::int from trader_orders where organization_id = ${organizationId}::uuid) as orders`;
  return row!;
}

async function stageCount(organizationId: string, commandId: string, stage: string) {
  const [row] = await client<{ n: number }[]>`
    select count(*)::int as n from trader_live_capital_envelope_journal_v2
    where organization_id = ${organizationId}::uuid
      and command_id = ${commandId}::uuid
      and stage = ${stage}`;
  return row!.n;
}

describe.skipIf(!enabled)("DEE-1145 durable LiveCapitalEnvelopeV2", () => {
  beforeAll(() => {
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url!).hostname)) {
      throw new Error("LIVE_CAPITAL_ENVELOPE_PROOF_REQUIRES_LOOPBACK");
    }
    client = postgres(url!, { max: 1, prepare: false, onnotice: () => undefined });
    database = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it("restarts before and after each durable stage without a second effect", async () => {
    for (let stop = 0; stop < LIVE_CAPITAL_ENVELOPE_STAGES_V2.length; stop += 1) {
      const { organizationId } = await seed();
      const accountId = `acct-restart-${stop}`;
      const issued = command(organizationId, accountId);
      for (const stage of LIVE_CAPITAL_ENVELOPE_STAGES_V2.slice(0, stop + 1)) {
        await advanceLiveCapitalEnvelopeStageV2(client, {
          command: issued,
          boundOrganizationId: organizationId,
          stage,
        });
        await advanceLiveCapitalEnvelopeStageV2(client, {
          command: issued,
          boundOrganizationId: organizationId,
          stage,
        });
        expect(await stageCount(organizationId, issued.commandId, stage)).toBe(1);
      }
      const published = await produceLiveCapitalEnvelopeV2(client, {
        command: issued,
        boundOrganizationId: organizationId,
      });
      const replay = await produceLiveCapitalEnvelopeV2(client, {
        command: issued,
        boundOrganizationId: organizationId,
      });
      expect(published).toMatchObject({
        decision: "PUBLISHED",
        allowanceId: null,
        orderId: null,
        venueEffects: "ZERO",
        invalidated: false,
      });
      expect(replay).toMatchObject({
        decision: "PUBLISHED",
        replayed: true,
        envelopeDigest: published.envelopeDigest,
        basisDigest: published.basisDigest,
        allowanceId: null,
        orderId: null,
        venueEffects: "ZERO",
      });
      expect(await counts(organizationId)).toMatchObject({
        envelopes: 1,
        journal: LIVE_CAPITAL_ENVELOPE_STAGES_V2.length,
        invalidated: 0,
        current_rows: 1,
        bases: 1,
        allowances: 0,
        orders: 0,
      });
    }
  });

  it("does not give two processes overlapping current authority", async () => {
    const { organizationId } = await seed();
    const accountId = "acct-race";
    const left = postgres(url!, { max: 1, prepare: false, onnotice: () => undefined });
    const right = postgres(url!, { max: 1, prepare: false, onnotice: () => undefined });
    try {
      const [first, second] = await Promise.all([
        produceLiveCapitalEnvelopeV2(left, {
          command: command(organizationId, accountId),
          boundOrganizationId: organizationId,
        }),
        produceLiveCapitalEnvelopeV2(right, {
          command: command(organizationId, accountId),
          boundOrganizationId: organizationId,
        }),
      ]);
      const winner = [first, second].find((result) => result.decision === "PUBLISHED");
      const loser = [first, second].find((result) => result.decision === "REFUSED");
      expect(winner).toMatchObject({ allowanceId: null, orderId: null, venueEffects: "ZERO" });
      expect(loser).toMatchObject({
        reason: "OVERLAPPING_AUTHORITY",
        allowanceId: null,
        orderId: null,
        venueEffects: "ZERO",
        invalidated: false,
      });
      const [published] = await client<{ n: number }[]>`
        select count(*)::int as n from trader_live_capital_envelope_journal_v2
        where organization_id = ${organizationId}::uuid and account_id = ${accountId} and stage = 'PUBLISHED'`;
      expect(published!.n).toBe(1);
      expect(await counts(organizationId)).toMatchObject({
        current_rows: 1,
        bases: 1,
        allowances: 0,
        orders: 0,
      });
    } finally {
      await Promise.all([left.end({ timeout: 5 }), right.end({ timeout: 5 })]);
    }
  });

  it("invalidates a missing, stale, or changed envelope and leaves venue effects at zero", async () => {
    const { organizationId } = await seed();
    const accountId = "acct-invalidate";
    const missing = await invalidateLiveCapitalEnvelopeV2(client, {
      boundOrganizationId: organizationId,
      accountId,
      observed: {
        organizationId,
        accountId,
        policyDigest: POLICY,
        releaseSha: RELEASE,
      },
    });
    expect(missing).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_ABSENT",
      invalidated: false,
      venueEffects: "ZERO",
      allowanceId: null,
      orderId: null,
    });
    expect(await counts(organizationId)).toMatchObject({ journal: 0, current_rows: 0, bases: 0 });

    const stale = command(organizationId, accountId, STALE);
    const staleResult = await produceLiveCapitalEnvelopeV2(client, {
      command: stale,
      boundOrganizationId: organizationId,
    });
    expect(staleResult).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_STALE",
      invalidated: true,
      venueEffects: "ZERO",
      allowanceId: null,
      orderId: null,
    });
    const staleReplay = await produceLiveCapitalEnvelopeV2(client, {
      command: stale,
      boundOrganizationId: organizationId,
    });
    expect(staleReplay.invalidated).toBe(true);
    expect(await counts(organizationId)).toMatchObject({
      current_rows: 0,
      bases: 0,
      invalidated: 1,
      allowances: 0,
      orders: 0,
    });

    const issued = command(organizationId, `${accountId}-live`);
    const published = await produceLiveCapitalEnvelopeV2(client, {
      command: issued,
      boundOrganizationId: organizationId,
    });
    expect(published.decision).toBe("PUBLISHED");
    const issue = await gateLiveCapitalIssueV2(client, organizationId, issued.accountId);
    const bind = await gateCurrentAccountExecutionBindV1(client, organizationId, issued.accountId);
    const start = await gateLiveCapitalStartV2(client, organizationId, issued.accountId);
    expect(issue).toMatchObject({
      decision: "BASIS_BOUND",
      basisDigest: published.basisDigest,
      envelopeDigest: published.envelopeDigest,
      allowanceId: null,
      orderId: null,
      invoked: false,
    });
    expect(bind).toMatchObject({
      decision: "BASIS_BOUND",
      bindInvoked: false,
      basisDigest: published.basisDigest,
    });
    expect(start).toMatchObject({
      decision: "BASIS_BOUND",
      invoked: false,
      basisDigest: published.basisDigest,
    });

    const changed = await invalidateLiveCapitalEnvelopeV2(client, {
      boundOrganizationId: organizationId,
      accountId: issued.accountId,
      observed: {
        organizationId,
        accountId: "other-account",
        policyDigest: "ef".repeat(32),
        releaseSha: "01".repeat(32),
      },
    });
    expect(changed).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invalidated: true,
      venueEffects: "ZERO",
      allowanceId: null,
      orderId: null,
    });
    const changedReplay = await invalidateLiveCapitalEnvelopeV2(client, {
      boundOrganizationId: organizationId,
      accountId: issued.accountId,
      observed: {
        organizationId,
        accountId: issued.accountId,
        policyDigest: issued.policyDigest,
        releaseSha: issued.releaseSha,
      },
    });
    expect(changedReplay).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_ABSENT",
      invalidated: false,
    });
    const [invalidated] = await client<{ n: number }[]>`
      select count(*)::int as n from trader_live_capital_envelope_journal_v2
      where organization_id = ${organizationId}::uuid and command_id = ${issued.commandId}::uuid and stage = 'INVALIDATED'`;
    expect(invalidated!.n).toBe(1);
    expect(await gateLiveCapitalIssueV2(client, organizationId, issued.accountId)).toMatchObject({
      decision: "REFUSED",
      invoked: false,
      allowanceId: null,
      orderId: null,
    });
    expect(
      await gateCurrentAccountExecutionBindV1(client, organizationId, issued.accountId),
    ).toMatchObject({
      decision: "REFUSED",
      bindInvoked: false,
    });
    expect(await gateLiveCapitalStartV2(client, organizationId, issued.accountId)).toMatchObject({
      decision: "REFUSED",
      invoked: false,
    });
    expect(await counts(organizationId)).toMatchObject({
      allowances: 0,
      orders: 0,
      current_rows: 0,
    });
  });

  it("writes nothing for an external organization or a heartbeat", async () => {
    const home = await seed();
    const foreign = await seed();
    const issued = command(foreign.organizationId, "acct-foreign");
    await expect(
      produceLiveCapitalEnvelopeV2(client, {
        command: issued,
        boundOrganizationId: home.organizationId,
      }),
    ).rejects.toThrow("EXTERNAL_ORGANIZATION");
    await expect(
      invalidateLiveCapitalEnvelopeV2(client, {
        boundOrganizationId: home.organizationId,
        accountId: "acct-foreign",
        observed: {
          organizationId: foreign.organizationId,
          accountId: "acct-foreign",
          policyDigest: POLICY,
          releaseSha: RELEASE,
        },
      }),
    ).rejects.toThrow("EXTERNAL_ORGANIZATION");
    const heartbeat = Object.assign(command(home.organizationId, "acct-heartbeat"), {
      heartbeat: "pulse",
    });
    await expect(
      produceLiveCapitalEnvelopeV2(client, {
        command: heartbeat,
        boundOrganizationId: home.organizationId,
      }),
    ).rejects.toThrow("HEARTBEAT_IS_NOT_AUTHORITY");
    expect(await counts(home.organizationId)).toMatchObject({
      envelopes: 0,
      journal: 0,
      current_rows: 0,
      bases: 0,
      allowances: 0,
      orders: 0,
    });
    expect(await counts(foreign.organizationId)).toMatchObject({ envelopes: 0, journal: 0 });
  });
});
