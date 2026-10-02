import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import {
  LIVE_CAPITAL_ENVELOPE_STAGES_V2,
  type LiveCapitalEnvelopeCommandV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-v2";
import type { LiveCapitalObservedIdentityV2 } from "@/lib/trader/risk/v2/live-capital-envelope-postgres";
import { TEST_HUMAN_SOURCE_METHOD_QUALIFIED } from "../helpers/live-capital-test-envelope";
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

function watch(
  issued: LiveCapitalEnvelopeCommandV2,
  patch: Partial<LiveCapitalObservedIdentityV2> = {},
): LiveCapitalObservedIdentityV2 {
  return {
    organizationId: patch.organizationId ?? issued.organizationId,
    accountId: patch.accountId ?? issued.accountId,
    policyDigest: patch.policyDigest ?? issued.policyDigest,
    releaseSha: patch.releaseSha ?? issued.releaseSha,
  };
}

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
          sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
          command: issued,
          boundOrganizationId: organizationId,
          stage,
          observed: watch(issued),
        });
        await advanceLiveCapitalEnvelopeStageV2(client, {
          sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
          command: issued,
          boundOrganizationId: organizationId,
          stage,
          observed: watch(issued),
        });
        expect(await stageCount(organizationId, issued.commandId, stage)).toBe(1);
      }
      const published = await produceLiveCapitalEnvelopeV2(client, {
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: organizationId,
        observed: watch(issued),
      });
      const replay = await produceLiveCapitalEnvelopeV2(client, {
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: organizationId,
        observed: watch(issued),
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
      const leftCommand = command(organizationId, accountId);
      const rightCommand = command(organizationId, accountId);
      const [first, second] = await Promise.all([
        produceLiveCapitalEnvelopeV2(left, {
          sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
          command: leftCommand,
          boundOrganizationId: organizationId,
          observed: watch(leftCommand),
        }),
        produceLiveCapitalEnvelopeV2(right, {
          sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
          command: rightCommand,
          boundOrganizationId: organizationId,
          observed: watch(rightCommand),
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

  it("refuses the first produce when observed policy, release, or account differs", async () => {
    const { organizationId } = await seed();
    const foreignPolicy = "ef".repeat(32);
    const foreignRelease = "01".repeat(32);
    const cases = [
      { accountId: "acct-first-policy", observed: { policyDigest: foreignPolicy } },
      { accountId: "acct-first-release", observed: { releaseSha: foreignRelease } },
      { accountId: "acct-first-account", observed: { accountId: "other-observed-account" } },
    ] as const;
    for (const item of cases) {
      const issued = command(organizationId, item.accountId);
      const result = await produceLiveCapitalEnvelopeV2(client, {
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: organizationId,
        observed: watch(issued, item.observed),
      });
      expect(result).toMatchObject({
        decision: "REFUSED",
        reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
        allowanceId: null,
        orderId: null,
        venueEffects: "ZERO",
        invalidated: false,
      });
      expect(result.decision).not.toBe("PUBLISHED");
      expect(await stageCount(organizationId, issued.commandId, "INVALIDATED")).toBe(0);
      expect(await stageCount(organizationId, issued.commandId, "PUBLISHED")).toBe(0);
      const watchedAccount = "accountId" in item.observed ? item.observed.accountId : issued.accountId;
      for (const accountId of new Set([issued.accountId, watchedAccount])) {
        const [current] = await client<{ n: number }[]>`
          select count(*)::int as n from trader_live_capital_envelope_current_v2
          where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
        expect(current!.n).toBe(0);
      }
      const published = await produceLiveCapitalEnvelopeV2(client, {
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: organizationId,
        observed: watch(issued),
      });
      expect(published).toMatchObject({
        decision: "PUBLISHED",
        invalidated: false,
        allowanceId: null,
        orderId: null,
        venueEffects: "ZERO",
      });
      const replay = await produceLiveCapitalEnvelopeV2(client, {
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: organizationId,
        observed: watch(issued),
      });
      expect(replay).toMatchObject({
        decision: "PUBLISHED",
        replayed: true,
        envelopeDigest: published.envelopeDigest,
        basisDigest: published.basisDigest,
        allowanceId: null,
        orderId: null,
      });
      expect(await stageCount(organizationId, issued.commandId, "PUBLISHED")).toBe(1);
      expect(await stageCount(organizationId, issued.commandId, "INVALIDATED")).toBe(0);
      const [foreignCurrent] = await client<{ n: number }[]>`
        select count(*)::int as n from trader_live_capital_envelope_current_v2
        where organization_id = ${organizationId}::uuid and account_id = ${watchedAccount}
          and account_id <> ${issued.accountId}`;
      expect(foreignCurrent!.n).toBe(0);
    }
    expect(await counts(organizationId)).toMatchObject({
      current_rows: 3,
      bases: 3,
      invalidated: 0,
      allowances: 0,
      orders: 0,
    });
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
      sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
      command: stale,
      boundOrganizationId: organizationId,
      observed: watch(stale),
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
      sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
      command: stale,
      boundOrganizationId: organizationId,
      observed: watch(stale),
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
      sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
      command: issued,
      boundOrganizationId: organizationId,
      observed: watch(issued),
    });
    expect(published.decision).toBe("PUBLISHED");
    const seen = watch(issued);
    const issue = await gateLiveCapitalIssueV2(client, organizationId, issued.accountId, seen);
    const bind = await gateCurrentAccountExecutionBindV1(
      client,
      organizationId,
      issued.accountId,
      seen,
    );
    const start = await gateLiveCapitalStartV2(client, organizationId, issued.accountId, seen);
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
    expect(
      await gateLiveCapitalIssueV2(client, organizationId, issued.accountId, watch(issued)),
    ).toMatchObject({
      decision: "REFUSED",
      invoked: false,
      allowanceId: null,
      orderId: null,
    });
    expect(
      await gateCurrentAccountExecutionBindV1(
        client,
        organizationId,
        issued.accountId,
        watch(issued),
      ),
    ).toMatchObject({
      decision: "REFUSED",
      bindInvoked: false,
    });
    expect(
      await gateLiveCapitalStartV2(client, organizationId, issued.accountId, watch(issued)),
    ).toMatchObject({
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
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: home.organizationId,
        observed: watch(issued),
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
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: heartbeat,
        boundOrganizationId: home.organizationId,
        observed: watch(heartbeat),
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

  it("invalidates a published envelope after expiry or an external policy or release change", async () => {
    const { organizationId } = await seed();
    const changedPolicy = "ef".repeat(32);
    const changedRelease = "01".repeat(32);

    async function publish(
      accountId: string,
      window: { validFromUtc: string; validUntilUtc: string } = OPEN,
    ) {
      const issued = command(organizationId, accountId, window);
      const published = await produceLiveCapitalEnvelopeV2(client, {
        sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
        command: issued,
        boundOrganizationId: organizationId,
        observed: watch(issued),
      });
      expect(published).toMatchObject({
        decision: "PUBLISHED",
        invalidated: false,
        allowanceId: null,
        orderId: null,
      });
      return issued;
    }

    async function expectCleared(accountId: string, commandId: string) {
      expect(await stageCount(organizationId, commandId, "INVALIDATED")).toBe(1);
      const [current] = await client<{ n: number }[]>`
        select count(*)::int as n from trader_live_capital_envelope_current_v2
        where organization_id = ${organizationId}::uuid and account_id = ${accountId}`;
      expect(current!.n).toBe(0);
    }

    const policy = await publish("acct-policy-after");
    const policyReplay = await produceLiveCapitalEnvelopeV2(client, {
      sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
      command: policy,
      boundOrganizationId: organizationId,
      observed: watch(policy, { policyDigest: changedPolicy }),
    });
    expect(policyReplay).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invalidated: true,
      allowanceId: null,
      orderId: null,
    });
    await expectCleared("acct-policy-after", policy.commandId);
    await produceLiveCapitalEnvelopeV2(client, {
      sourceMethodQualified: TEST_HUMAN_SOURCE_METHOD_QUALIFIED,
      command: policy,
      boundOrganizationId: organizationId,
      observed: watch(policy, { policyDigest: changedPolicy }),
    });
    expect(await stageCount(organizationId, policy.commandId, "INVALIDATED")).toBe(1);

    const releaseIssue = await publish("acct-release-issue");
    expect(
      await gateLiveCapitalIssueV2(
        client,
        organizationId,
        releaseIssue.accountId,
        watch(releaseIssue, { releaseSha: changedRelease }),
      ),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invoked: false,
      allowanceId: null,
      orderId: null,
    });
    await expectCleared(releaseIssue.accountId, releaseIssue.commandId);

    const releaseBind = await publish("acct-release-bind");
    expect(
      await gateCurrentAccountExecutionBindV1(
        client,
        organizationId,
        releaseBind.accountId,
        watch(releaseBind, { releaseSha: changedRelease }),
      ),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      bindInvoked: false,
    });
    await expectCleared(releaseBind.accountId, releaseBind.commandId);

    const releaseStart = await publish("acct-release-start");
    expect(
      await gateLiveCapitalStartV2(
        client,
        organizationId,
        releaseStart.accountId,
        watch(releaseStart, { releaseSha: changedRelease }),
      ),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      invoked: false,
      allowanceId: null,
      orderId: null,
    });
    await expectCleared(releaseStart.accountId, releaseStart.commandId);
    await gateLiveCapitalStartV2(
      client,
      organizationId,
      releaseStart.accountId,
      watch(releaseStart, { releaseSha: changedRelease }),
    );
    expect(await stageCount(organizationId, releaseStart.commandId, "INVALIDATED")).toBe(1);

    const [until] = await client<{ until: string }[]>`
      select to_char(
        date_trunc('milliseconds', clock_timestamp() + interval '6 seconds') at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as until`;
    const expiry = await publish("acct-expiry-after", {
      validFromUtc: OPEN.validFromUtc,
      validUntilUtc: until!.until,
    });
    await client`
      select pg_sleep(greatest(0, extract(epoch from (${until!.until}::timestamptz - clock_timestamp())) + 0.25))`;
    expect(
      await gateLiveCapitalIssueV2(client, organizationId, expiry.accountId, watch(expiry)),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_STALE",
      invoked: false,
      allowanceId: null,
      orderId: null,
    });
    await expectCleared(expiry.accountId, expiry.commandId);
    expect(
      await gateLiveCapitalIssueV2(client, organizationId, expiry.accountId, watch(expiry)),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_ABSENT",
      invoked: false,
    });
    expect(await stageCount(organizationId, expiry.commandId, "INVALIDATED")).toBe(1);

    expect(await counts(organizationId)).toMatchObject({
      allowances: 0,
      orders: 0,
      current_rows: 0,
    });
  }, 60_000);

  it("pins the composite validation key and invoker search_path", async () => {
    const [unique] = await client<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conname = 'tmrvr_v1_id_organization_uq'`;
    expect(unique!.def).toBe("UNIQUE (id, organization_id)");
    const [foreign] = await client<{ def: string }[]>`
      select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'trader_risk_account_reference_members_v1'
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid) like '%validation_digest%'`;
    expect(foreign!.def).toContain("FOREIGN KEY (validation_digest, organization_id)");
    expect(foreign!.def).toContain("trader_mi_raw_validation_receipt_v1(id, organization_id)");
    const [fn] = await client<{ prosecdef: boolean; proconfig: string[] | null }[]>`
      select p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'waia_risk_current_account_v1_block_mutation'`;
    expect(fn!.prosecdef).toBe(false);
    expect(fn!.proconfig ?? []).toContain("search_path=pg_catalog, public");
    const triggers = await client<{ relname: string; proname: string; nspname: string }[]>`
      select c.relname, p.proname, n.nspname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
      where not t.tgisinternal
        and c.relname in (
          'trader_live_capital_envelopes_v2',
          'trader_live_capital_envelope_journal_v2',
          'trader_live_capital_basis_bindings_v2')
      order by c.relname`;
    expect(triggers).toEqual([
      {
        relname: "trader_live_capital_basis_bindings_v2",
        proname: "waia_risk_current_account_v1_block_mutation",
        nspname: "public",
      },
      {
        relname: "trader_live_capital_envelope_journal_v2",
        proname: "waia_risk_current_account_v1_block_mutation",
        nspname: "public",
      },
      {
        relname: "trader_live_capital_envelopes_v2",
        proname: "waia_risk_current_account_v1_block_mutation",
        nspname: "public",
      },
    ]);
  });
});
