// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { createPostgresObservationRepository } from "@/lib/trader/account-observation/postgres-repository";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { unavailableHtxV5Bills } from "@/lib/trader/account-observation/derivatives/htx-v5-bill-groups";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import type {
  AccountObservation,
  HtxV5AccountObservation,
  ObservationBinding,
  ObservationLease,
} from "@/lib/trader/account-observation/types";

// Authoring does not execute this fixture. Root provisions this one synthetic TLS target.
// No environment URL fallback, remote target, foreign 55460 fixture, or general migrator.
const enabled = process.env.DEE1248_HISTORY_PG17 === "1";
const database = "waia_history_1248_fixture";
const target = "127.0.0.1:55848/waia_history_1248_fixture";
const password = "local_history_fixture_only";
describe.skipIf(!enabled)(
  "DEE-1248 persisted financial history on isolated TLS PostgreSQL 17",
  () => {
    const collectorQueries: string[] = [];
    let admin: Sql;
    let collector: Sql;
    let projection: Sql;
    let repo: ReturnType<typeof createPostgresObservationRepository>;
    let reader: ReturnType<typeof createPostgresObservationReader>;
    let defaultsBeforeHistory: string;
    let controlAclBeforeHistory: string;
    beforeAll(async () => {
      const caPath = process.env.DEE1248_HISTORY_CA;
      if (!caPath) throw new Error("DEE1248_HISTORY_CA_REQUIRED");
      const ssl = { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
      const options = {
        ssl,
        max: 1,
        prepare: false,
        connect_timeout: 3,
        max_lifetime: 60,
      } as const;
      admin = postgres(`postgres://postgres:${password}@${target}`, options);
      const info = (
        await admin`SELECT current_database() AS db, current_setting('server_version_num')::int AS version,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`
      )[0];
      expect(info.db).toBe(database);
      expect(info.version).toBeGreaterThanOrEqual(170000);
      expect(info.version).toBeLessThan(180000);
      expect(info.tls).toBe(true);
      // A root-created empty fixture is required. Never replace an existing dataset.
      expect(
        Number(
          (
            await admin`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'`
          )[0].n,
        ),
      ).toBe(0);
      await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $$; CREATE TABLE public.organizations(id uuid PRIMARY KEY);`);
      // Exact minimal existing migrations, including 0205's reader-role policy blocks.
      // No production journal or 0229/0230/0231 replay is involved.
      for (const path of [
        "db/migrations_postgres/0006_exchange_credentials.sql",
        "db/migrations_postgres/0007_exchange_credentials_rls.sql",
        "db/migrations_postgres/0205_trader_account_observation_v1.sql",
      ])
        await admin.unsafe(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
      // Seed every PG17 table privilege, including structural privileges that RLS
      // cannot remove. The pending migration must revoke only the two new tables.
      await admin.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO service_role;
        CREATE TABLE public.history_fixture_acl_control (id integer);`);
      defaultsBeforeHistory = (
        await admin`SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.oid)::text,'[]') AS value FROM pg_default_acl d`
      )[0].value;
      controlAclBeforeHistory = (
        await admin`SELECT relacl::text AS value FROM pg_class WHERE oid='public.history_fixture_acl_control'::regclass`
      )[0].value;
      await admin.unsafe(
        readFileSync(
          "db/migrations_postgres/0233_trader_account_financial_history_v1.sql",
          "utf8",
        ).replaceAll("--> statement-breakpoint", ""),
      );
      const suffix = randomUUID().replaceAll("-", "");
      const collectorLogin = `hist_collect_${suffix}`,
        readerLogin = `hist_read_${suffix}`;
      for (const [login, role] of [
        [collectorLogin, "waia_account_observer"],
        [readerLogin, "waia_account_observation_reader"],
      ]) {
        await admin.unsafe(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
        PASSWORD '${password}'; GRANT ${role} TO "${login}" WITH INHERIT FALSE, SET TRUE;
        GRANT CONNECT ON DATABASE ${database} TO "${login}";`);
      }
      collector = postgres(`postgres://${collectorLogin}:${password}@${target}`, {
        ...options,
        debug: (_connection, query) => {
          collectorQueries.push(query);
        },
      });
      projection = postgres(`postgres://${readerLogin}:${password}@${target}`, options);
      for (const [client, login] of [
        [collector, collectorLogin],
        [projection, readerLogin],
      ] as const) {
        expect(
          (
            await client`SELECT session_user AS name, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`
          )[0],
        ).toMatchObject({ name: login, tls: true });
        expect(
          (
            await client`SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname=session_user`
          )[0],
        ).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolinherit: false,
        });
      }
      repo = createPostgresObservationRepository(collector);
      reader = createPostgresObservationReader(projection, {
        financialHistoryCursorKey: new Uint8Array(32).fill(9),
      });
      // Delay only amount-bearing synthetic INSERTs when explicitly requested by test config.
      // The second, sanitized transaction is not delayed and cannot reuse the amount payload.
      await admin.unsafe(`CREATE SEQUENCE public.history_fixture_insert_attempt_seq;
      GRANT USAGE ON SEQUENCE public.history_fixture_insert_attempt_seq TO waia_account_observer;
      CREATE TABLE public.history_fixture_delay (id boolean PRIMARY KEY, delay_ms integer NOT NULL);
      INSERT INTO public.history_fixture_delay VALUES (true, 0);
      GRANT SELECT ON public.history_fixture_delay TO waia_account_observer;
      CREATE FUNCTION public.history_fixture_delay_insert() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
      DECLARE duration integer; BEGIN
        PERFORM nextval('public.history_fixture_insert_attempt_seq');
        SELECT delay_ms INTO duration FROM public.history_fixture_delay WHERE id;
        IF duration > 0 AND NEW.payload#>>'{htxV5,bills,status}'='PARTIAL' THEN PERFORM pg_sleep(duration::numeric/1000); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER history_fixture_delay BEFORE INSERT ON public.trader_account_observations
        FOR EACH ROW EXECUTE FUNCTION public.history_fixture_delay_insert();`);
    }, 30000);
    afterAll(async () => {
      reader?.dispose();
      await projection?.end({ timeout: 2 });
      await collector?.end({ timeout: 2 });
      await admin?.end({ timeout: 2 });
      // Retain only this synthetic database and its roles for root diagnosis/owned cleanup.
    });
    async function seed(): Promise<ObservationBinding> {
      const binding = {
        organizationId: randomUUID(),
        credentialId: randomUUID(),
        exchangeAccountId: "12345678",
        credentialRevision: "1",
        configurationRevision: `scope-${randomUUID()}`,
      };
      await admin`INSERT INTO public.organizations VALUES (${binding.organizationId})`;
      await admin`INSERT INTO public.exchange_credentials (id,organization_id,venue,exchange_account_id,encrypted_payload)
      VALUES (${binding.credentialId},${binding.organizationId},'htx',${binding.exchangeAccountId},'synthetic-no-key')`;
      await admin`INSERT INTO public.trader_account_collection_state (organization_id,credential_id,exchange_account_id,configuration_revision,symbols)
      VALUES (${binding.organizationId},${binding.credentialId},${binding.exchangeAccountId},${binding.configurationRevision},'["BTCUSDT"]')`;
      return binding;
    }
    async function lease(binding: ObservationBinding): Promise<ObservationLease> {
      const result = await repo.claimDue(binding, "financial-fixture", Date.now(), 60000);
      expect(result).not.toBeNull();
      return result!;
    }
    function observation(
      binding: ObservationBinding,
      t = Date.now(),
      validUntilMs = t + 10000,
    ): AccountObservation {
      const scope = {
        enabled: true as const,
        scopeId: randomUUID(),
        windowStartMs: t - 2000,
        windowEndMs: t - 1000,
        validFromMs: t - 1000,
        validUntilMs,
      };
      const base = {
        status: "COMPLETE" as const,
        values: [],
        sourceAsOfMs: null,
        readStartedAtMs: t,
        readCompletedAtMs: t,
        error: null,
      };
      const balances = {
        ...base,
        values: [{ asset: "USDT", free: "42", locked: "0", total: "42" }],
      };
      const v5time = {
        readStartedAtMs: t,
        readCompletedAtMs: t,
        responseGeneratedAtMs: null,
        error: null,
      };
      const v5: HtxV5AccountObservation = {
        schemaVersion: "htx-v5-observation/v2",
        htxUid: "456",
        assetMode: { status: "COMPLETE", value: "1", ...v5time },
        balance: {
          status: "COMPLETE",
          value: {
            state: "normal",
            account: {
              equityUsd: "42",
              initialMarginUsd: "0",
              maintenanceMarginUsd: "0",
              maintenanceMarginRate: "0",
              profitUnrealUsd: "0",
              availableMarginUsd: "42",
              voucherValue: "0",
              createdTimeMs: null,
              updatedTimeMs: null,
            },
            details: [],
          },
          ...v5time,
        },
        positions: { status: "COMPLETE", values: [], ...v5time, pageScope: null },
        openOrders: {
          status: "PARTIAL",
          values: [],
          ...v5time,
          pageScope: {
            pageSize: 100,
            maxPages: 2,
            pagesRead: 1,
            nextFrom: null,
            completeness: "UNKNOWN",
          },
        },
        algoOrders: {
          status: "PARTIAL",
          values: [],
          ...v5time,
          pageScope: {
            pageSize: 20,
            maxPagesPerType: 2,
            queries: ["tp", "sl", "tpsl", "trigger", "trailing_stop"].map((type) => ({
              type,
              pagesRead: 1,
              nextFrom: null,
            })),
            completeness: "UNKNOWN",
          },
        },
        fills: {
          status: "NOT_CONFIGURED",
          values: null,
          readStartedAtMs: null,
          readCompletedAtMs: null,
          responseGeneratedAtMs: null,
          error: null,
          coverage: "NOT_CONFIGURED",
          contracts: [],
          windowStartMs: null,
          windowEndMs: null,
          pageScope: null,
        },
        bills: {
          ...unavailableHtxV5Bills(scope, "SCOPE_EXPIRED"),
          status: "PARTIAL",
          unavailableReason: null,
          values: [
            {
              id: "1",
              contractCode: "",
              marginMode: "cross",
              currency: "USDT",
              type: "30",
              category: "FUNDING_INCOME",
              amount: "0.25",
              createdTimeMs: t - 1500,
            },
          ],
          groups: [
            {
              currency: "USDT",
              type: "30",
              category: "FUNDING_INCOME",
              observedAmountSum: "0.25",
              recordCount: 1,
            },
          ],
          ...v5time,
          responseReceivedAtMs: t,
          pageScope: {
            pageSize: 100,
            maxPages: 1,
            pagesRead: 1,
            nextFrom: "1",
            completeness: "UNKNOWN",
          },
        },
      };
      return parseAccountObservation({
        schemaVersion: "account-observation/v4",
        observationId: randomUUID(),
        binding,
        collectionStartedAtMs: t,
        collectionCompletedAtMs: t,
        status: "PARTIAL",
        balances,
        openOrders: base,
        trades: [{ symbol: "BTCUSDT", component: base }],
        holdings: balances.values,
        htxV5: v5,
      });
    }
    function commit(l: ObservationLease, o: AccountObservation) {
      const now = Date.now();
      return repo.commitIfCurrent({
        lease: l,
        observation: o,
        nowMs: now,
        nextDueAtMs: now + 10000,
        consecutiveFailures: 0,
      });
    }
    async function assertSingle(o: AccountObservation) {
      const rows =
        await admin`SELECT o.payload, s.last_observation_id FROM trader_account_observations o
      JOIN trader_account_collection_state s USING(organization_id,credential_id,exchange_account_id)
      WHERE o.credential_id=${o.binding.credentialId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].last_observation_id).toBe(o.observationId);
      expect(parseAccountObservation(rows[0].payload)).toEqual(o);
      expect((await reader.readLatest(o.binding))?.balances).toEqual(o.balances);
      const coverage =
        await admin`SELECT coverage FROM trader_account_financial_coverage WHERE credential_id=${o.binding.credentialId}`;
      expect(coverage).toHaveLength(1);
      expect(coverage[0].coverage.status).toBe(
        o.htxV5?.schemaVersion === "htx-v5-observation/v2" ? o.htxV5.bills.status : "missing",
      );
      const bills =
        await admin`SELECT bill FROM trader_account_financial_bills WHERE credential_id=${o.binding.credentialId}`;
      expect(bills).toHaveLength(
        o.htxV5?.schemaVersion === "htx-v5-observation/v2" && o.htxV5.bills.status === "PARTIAL"
          ? 1
          : 0,
      );
    }
    it("appends exact active v4 and reads it through a separate restricted LOGIN", async () => {
      const b = await seed(),
        l = await lease(b),
        o = observation(b);
      expect(await commit(l, o)).toEqual({ observation: o });
      expect(await commit(l, o)).toEqual({ observation: o });
      expect(await reader.readLatest(b)).toEqual(o);
      await assertSingle(o);
    });
    it("sanitizes scope expired before append, keeps balances, and accepts only exact sanitized acknowledgement", async () => {
      const b = await seed(),
        l = await lease(b),
        now = Date.now();
      const o = observation(b, now - 2000, now - 1000);
      const result = await commit(l, o);
      expect(result).toMatchObject({
        observation: {
          balances: o.balances,
          htxV5: {
            bills: {
              status: "UNAVAILABLE",
              unavailableReason: "SCOPE_EXPIRED",
              values: null,
              groups: null,
            },
          },
        },
      });
      if (!result || typeof result !== "object") throw new Error("EXPECTED_STORED_FINANCIAL_ACK");
      await assertSingle(result.observation);
      expect(await commit(l, o)).toEqual(result);
      expect(await commit(l, { ...o, balances: { ...o.balances, values: [] }, holdings: [] })).toBe(
        false,
      );
    });
    it("refuses replay of an earlier amount-bearing row once its exact scope expires", async () => {
      const b = await seed(),
        l = await lease(b),
        o = observation(b, Date.now(), Date.now() + 500);
      expect(await commit(l, o)).toEqual({ observation: o });
      await admin`SELECT pg_sleep(0.55)`;
      expect(await commit(l, o)).toBe(false);
      await assertSingle(o);
    });
    it("rolls back an INSERT crossing expiry and retries exactly one amount-free base publication", async () => {
      const b = await seed(),
        l = await lease(b);
      const before = Number(
        (await admin`SELECT nextval('public.history_fixture_insert_attempt_seq') AS n`)[0].n,
      );
      await admin`UPDATE history_fixture_delay SET delay_ms=750 WHERE id`;
      const o = observation(b, Date.now(), Date.now() + 500);
      try {
        const result = await commit(l, o);
        expect(result).toMatchObject({
          observation: {
            balances: o.balances,
            htxV5: {
              balance: o.htxV5!.balance,
              bills: {
                status: "UNAVAILABLE",
                unavailableReason: "SCOPE_EXPIRED",
                values: null,
                groups: null,
              },
            },
          },
        });
        if (!result || typeof result !== "object") throw new Error("EXPECTED_STORED_FINANCIAL_ACK");
        await assertSingle(result.observation);
        expect(
          Number(
            (await admin`SELECT last_value AS n FROM public.history_fixture_insert_attempt_seq`)[0]
              .n,
          ) - before,
        ).toBe(2);
        expect(
          (
            await admin`SELECT consecutive_failures,lease_token FROM trader_account_collection_state WHERE credential_id=${b.credentialId}`
          )[0],
        ).toMatchObject({ consecutive_failures: 0, lease_token: null });
      } finally {
        await admin`UPDATE history_fixture_delay SET delay_ms=0 WHERE id`;
      }
    });
    it("owns the original observation, lease and cadence across caller mutation during the expiry retry", async () => {
      const b = await seed(),
        l = await lease(b);
      const pid = Number((await collector`SELECT pg_backend_pid() AS pid`)[0].pid);
      const before = Number(
        (await admin`SELECT nextval('public.history_fixture_insert_attempt_seq') AS n`)[0].n,
      );
      await admin`UPDATE history_fixture_delay SET delay_ms=1500 WHERE id`;
      const now = Date.now(),
        o = observation(b, now, now + 1000);
      const expected = parseAccountObservation(o);
      const input = {
        lease: { ...l, binding: { ...l.binding } },
        observation: o,
        nowMs: now,
        nextDueAtMs: now + 10000,
        consecutiveFailures: 0,
      };
      const pending = repo.commitIfCurrent(input);
      try {
        // Observe the real amount-bearing INSERT inside its trigger, before replacing inputs.
        // The nontransactional counter also proves rollback plus exactly one sanitized retry.
        let waiting = false;
        for (const deadline = Date.now() + 1200; Date.now() < deadline; ) {
          const activity =
            await admin`SELECT wait_event, query FROM pg_stat_activity WHERE pid=${pid}`;
          if (
            activity[0]?.wait_event === "PgSleep" &&
            String(activity[0]?.query).includes("INSERT INTO public.trader_account_observations")
          ) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        // Exercise both nested aliases and replacement of the top-level caller properties.
        Object.assign(input.observation.balances.values![0], { free: "777", total: "777" });
        Object.assign(input.lease.binding, { configurationRevision: "caller-mutated" });
        Object.assign(input.lease, { token: randomUUID(), ownerId: "caller-mutated" });
        const replacementBinding = { ...b, configurationRevision: "caller-replaced" };
        input.observation = observation(replacementBinding);
        input.lease = {
          ...l,
          binding: replacementBinding,
          token: randomUUID(),
          ownerId: "caller-replaced",
        };
        input.nowMs = now + 5000;
        input.nextDueAtMs = now + 65000;
        input.consecutiveFailures = 30;
        const result = await pending;
        expect(result).toMatchObject({
          observation: {
            observationId: expected.observationId,
            binding: expected.binding,
            balances: expected.balances,
            holdings: expected.holdings,
            htxV5: {
              bills: {
                status: "UNAVAILABLE",
                unavailableReason: "SCOPE_EXPIRED",
                values: null,
                groups: null,
              },
            },
          },
        });
        if (!result || typeof result !== "object") throw new Error("EXPECTED_STORED_FINANCIAL_ACK");
        await assertSingle(result.observation);
        const state = (
          await admin`SELECT o.lease_token, s.consecutive_failures,
        extract(epoch from (s.next_due_at-o.recorded_at))*1000 AS delay_ms
        FROM trader_account_observations o JOIN trader_account_collection_state s
          USING(organization_id,credential_id,exchange_account_id) WHERE o.credential_id=${b.credentialId}`
        )[0];
        expect(state).toMatchObject({ lease_token: l.token, consecutive_failures: 0 });
        expect(Number(state.delay_ms)).toBeGreaterThanOrEqual(10000);
        expect(Number(state.delay_ms)).toBeLessThan(12000);
        expect(
          Number(
            (await admin`SELECT last_value AS n FROM public.history_fixture_insert_attempt_seq`)[0]
              .n,
          ) - before,
        ).toBe(2);
      } finally {
        await pending.catch(() => undefined);
        await admin`UPDATE history_fixture_delay SET delay_ms=0 WHERE id`;
      }
    });
    it("fences stale configuration, rotation and cross-tenant reads without granting new scope", async () => {
      const b = await seed(),
        l = await lease(b),
        o = observation(b);
      expect(
        await commit(
          { ...l, binding: { ...b, configurationRevision: "stale" } },
          { ...o, binding: { ...b, configurationRevision: "stale" } },
        ),
      ).toBe(false);
      expect(await reader.readLatest({ ...b, organizationId: randomUUID() })).toBeNull();
      await admin`UPDATE exchange_credentials SET encrypted_payload='synthetic-rotated' WHERE id=${b.credentialId}`;
      expect(await commit(l, o)).toBe(false);
      expect(await reader.readLatest(b)).toBeNull();
      expect(
        Number(
          (
            await admin`SELECT count(*) AS n FROM trader_account_observations WHERE credential_id=${b.credentialId}`
          )[0].n,
        ),
      ).toBe(0);
    });
    const history = (binding: ObservationBinding, pageSize = 100, cursor: string | null = null) =>
      reader.readFinancialHistory({
        binding,
        pageSize,
        cursor,
        filters: { windowStartMs: null, windowEndMs: null },
      });
    async function due(b: ObservationBinding) {
      await admin`UPDATE trader_account_collection_state SET next_due_at=clock_timestamp() WHERE credential_id=${b.credentialId}`;
      return lease(b);
    }
    it("deduplicates overlap across config revisions and preserves first-seen and window provenance", async () => {
      const b = await seed(),
        t = Date.now(),
        first = observation(b, t);
      expect(await commit(await lease(b), first)).toEqual({ observation: first });
      const next = { ...b, configurationRevision: "second-scope" };
      await admin`UPDATE trader_account_collection_state SET configuration_revision=${next.configurationRevision} WHERE credential_id=${b.credentialId}`;
      const second = observation(next, t);
      expect(await commit(await due(next), second)).toEqual({ observation: second });
      expect(await history(b)).toBeNull();
      const page = await history(next, 1);
      expect(page?.records).toHaveLength(1);
      expect(page?.coverage).toHaveLength(1);
      expect(page?.records[0].provenance.binding).toEqual(b);
      expect(page?.records[0].bill.amount).toBe("0.25");
      expect(page?.nextCursor).toBeTruthy();
      const last = await history(next, 1, page!.nextCursor);
      expect(last?.records).toHaveLength(0);
      expect(last?.coverage).toHaveLength(1);
      expect(last?.nextCursor).toBeNull();
      expect(
        new Set([page!.coverage[0].provenance.scopeId, last!.coverage[0].provenance.scopeId]).size,
      ).toBe(2);
      await expect(history(next, 2, page!.nextCursor)).rejects.toThrow(
        "ACCOUNT_OBSERVATION_READ_FAILED",
      );
      await expect(
        history(
          next,
          1,
          page!.nextCursor!.replace(/.$/, (x) => (x === "0" ? "1" : "0")),
        ),
      ).rejects.toThrow();
      await expect(
        reader.readFinancialHistory({
          binding: next,
          pageSize: 1,
          cursor: page!.nextCursor,
          filters: { windowStartMs: t - 2000, windowEndMs: null },
        }),
      ).rejects.toThrow();
    });
    it("rolls back coverage, snapshot and pointer on inconsistent provider identity", async () => {
      const b = await seed(),
        t = Date.now(),
        first = observation(b, t);
      await commit(await lease(b), first);
      const second = observation(b, t);
      if (second.htxV5?.schemaVersion !== "htx-v5-observation/v2") throw new Error("fixture");
      Object.assign(second.htxV5.bills.values![0], { amount: "0.250" });
      const l = await due(b);
      await expect(commit(l, second)).rejects.toThrow("ACCOUNT_OBSERVATION_STORAGE_FAILED");
      expect((await history(b))?.records).toHaveLength(1);
      expect((await history(b))?.coverage).toHaveLength(1);
      expect((await reader.readLatest(b))?.observationId).toBe(first.observationId);
      expect(
        (
          await admin`SELECT lease_token FROM trader_account_collection_state WHERE credential_id=${b.credentialId}`
        )[0].lease_token,
      ).toBe(l.token);
    });
    it("retains same credential/confirmed UID history after rotation but rejects stale binding, revoke and other credentials", async () => {
      const b = await seed(),
        t = Date.now();
      await commit(await lease(b), observation(b, t));
      await admin`UPDATE exchange_credentials SET encrypted_payload='rotation-two' WHERE id=${b.credentialId}`;
      const rotated = { ...b, credentialRevision: "2" };
      expect(await history(b)).toBeNull();
      expect(await history(rotated)).toBeNull();
      await commit(await due(rotated), observation(rotated, t));
      const result = await history(rotated);
      expect(result?.records[0].provenance.binding.credentialRevision).toBe("1");
      const other = { ...(await seed()), exchangeAccountId: b.exchangeAccountId };
      await commit(await lease(other), observation(other, t));
      expect((await history(other))?.records[0].provenance.binding.credentialId).toBe(
        other.credentialId,
      );
      expect(await history({ ...rotated, organizationId: other.organizationId })).toBeNull();
      expect(await history({ ...rotated, exchangeAccountId: "different" })).toBeNull();
      await admin`UPDATE exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
      expect(await history(rotated)).toBeNull();
    });
    it("never joins a different current UID and rejects a cursor from the former UID", async () => {
      const b = await seed(),
        t = Date.now();
      await commit(await lease(b), observation(b, t));
      await commit(await due(b), observation(b, t));
      const first = await history(b, 1);
      const changed = observation(b, t);
      Object.assign(changed.htxV5!, { htxUid: "789" });
      await commit(await due(b), changed);
      expect((await history(b))?.records.map((r) => r.htxUid)).toEqual(["789"]);
      expect((await history(b))?.coverage).toHaveLength(1);
      await expect(history(b, 1, first!.nextCursor)).rejects.toThrow();
    });
    it("keeps observed-empty, error, unavailable and NOT_CONFIGURED distinct", async () => {
      const b = await seed(),
        t = Date.now(),
        empty = observation(b, t);
      if (empty.htxV5?.schemaVersion !== "htx-v5-observation/v2") throw new Error("fixture");
      Object.assign(empty.htxV5.bills, {
        values: [],
        groups: [],
        pageScope: { ...empty.htxV5.bills.pageScope, nextFrom: null },
      });
      await commit(await lease(b), empty);
      expect((await history(b))?.coverage[0]).toMatchObject({
        status: "PARTIAL",
        observedRowCount: 0,
        completeness: "UNKNOWN",
      });
      const failed = observation(b, t);
      if (failed.htxV5?.schemaVersion !== "htx-v5-observation/v2") throw new Error("fixture");
      Object.assign(failed.htxV5.bills, {
        status: "ERROR",
        values: null,
        groups: null,
        pageScope: null,
        error: "READ_FAILED",
        responseReceivedAtMs: null,
      });
      await commit(await due(b), failed);
      expect((await history(b))?.coverage.map((c) => c.status).sort()).toEqual([
        "ERROR",
        "PARTIAL",
      ]);
      const unconfigured = observation(b, t);
      const { bills, ...v5 } = unconfigured.htxV5 as Extract<
        HtxV5AccountObservation,
        { schemaVersion: "htx-v5-observation/v2" }
      >;
      expect(bills.status).toBe("PARTIAL");
      const v3 = parseAccountObservation({
        ...unconfigured,
        schemaVersion: "account-observation/v3",
        htxV5: { ...v5, schemaVersion: "htx-v5-observation/v1" },
      });
      expect(await commit(await due(b), v3)).toBe(true);
      const result = await history(b);
      expect(result?.currentFinancialStatus).toBe("NOT_CONFIGURED");
      expect(result?.records).toEqual([]);
      expect(result?.coverage).toHaveLength(2);
      const legacy = Object.fromEntries(Object.entries(v3).filter(([key]) => key !== "htxV5"));
      const noUid = parseAccountObservation({
        ...legacy,
        schemaVersion: "account-observation/v1",
        status: "COMPLETE",
        observationId: randomUUID(),
      });
      expect(await commit(await due(b), noUid)).toBe(true);
      expect(await history(b)).toBeNull();
    });
    it("removes all inherited service-role privileges only from the two history tables", async () => {
      const privileges = [
        "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
        "REFERENCES", "TRIGGER", "MAINTAIN",
      ];
      for (const privilege of privileges) {
        expect(
          (await admin`SELECT has_table_privilege('service_role','public.history_fixture_acl_control',${privilege}) AS allowed`)[0].allowed,
        ).toBe(true);
        for (const table of ["trader_account_financial_bills", "trader_account_financial_coverage"]) {
          expect(
            (await admin`SELECT has_table_privilege('service_role',${table},${privilege}) AS allowed`)[0].allowed,
          ).toBe(false);
        }
      }
      expect(
        (await admin`SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.oid)::text,'[]') AS value FROM pg_default_acl d`)[0].value,
      ).toBe(defaultsBeforeHistory);
      expect(
        (await admin`SELECT relacl::text AS value FROM pg_class WHERE oid='public.history_fixture_acl_control'::regclass`)[0].value,
      ).toBe(controlAclBeforeHistory);
      const acls = await admin`SELECT c.relname AS table_name, coalesce(r.rolname,'PUBLIC') AS grantee, a.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE c.oid IN ('public.trader_account_financial_bills'::regclass,'public.trader_account_financial_coverage'::regclass)
          AND a.grantee<>c.relowner ORDER BY c.relname,r.rolname,a.privilege_type`;
      expect([...acls]).toEqual(
        ["trader_account_financial_bills", "trader_account_financial_coverage"].flatMap((table_name) => [
          { table_name, grantee: "waia_account_observation_reader", privilege_type: "SELECT" },
          { table_name, grantee: "waia_account_observer", privilege_type: "SELECT" },
        ]),
      );
      for (const table of ["trader_account_financial_bills", "trader_account_financial_coverage"]) {
        expect(
          (await admin`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=${table}::regclass`)[0],
        ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
        expect(
          (await admin`SELECT has_column_privilege('waia_account_observer',${table},'provenance','INSERT') AS allowed`)[0].allowed,
        ).toBe(true);
        await expect(
          admin.begin(async (tx) => {
            await tx`SET LOCAL ROLE service_role`;
            return tx.unsafe(`SELECT * FROM public.${table}`);
          }),
        ).rejects.toThrow("permission denied");
      }
    });
    it("denies reader writes, tenant mismatch and all mutation/truncation even by the owner", async () => {
      const b = await seed();
      await commit(await lease(b), observation(b));
      const tables = ["trader_account_financial_bills", "trader_account_financial_coverage"];
      for (const table of tables) {
        const grants =
          await admin`SELECT has_table_privilege('waia_account_observation_reader',${table},'INSERT,UPDATE,DELETE,TRUNCATE') AS writes,
        has_table_privilege('anon',${table},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS anon,
        has_table_privilege('authenticated',${table},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS authenticated`;
        expect(grants[0]).toEqual({ writes: false, anon: false, authenticated: false });
        const custody = await admin`SELECT
        has_column_privilege('waia_account_observer', ${table}, 'recorded_xid', 'INSERT') AS xid,
        has_column_privilege('waia_account_observer', ${table}, 'recorded_at', 'INSERT') AS recorded`;
        expect(custody[0]).toEqual({ xid: false, recorded: false });
        await expect(
          admin.unsafe(
            `UPDATE public.${table} SET htx_uid='999' WHERE credential_id='${b.credentialId}'`,
          ),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_IMMUTABLE");
        await expect(
          admin.unsafe(`DELETE FROM public.${table} WHERE credential_id='${b.credentialId}'`),
        ).rejects.toThrow("ACCOUNT_OBSERVATION_IMMUTABLE");
        await expect(admin.unsafe(`TRUNCATE public.${table}`)).rejects.toThrow(
          "ACCOUNT_OBSERVATION_IMMUTABLE",
        );
        const hidden = await projection.begin(async (tx) => {
          await tx`SET LOCAL ROLE waia_account_observation_reader`;
          await tx`SELECT set_config('waia.observation_org',${randomUUID()},true),set_config('waia.observation_credential',${b.credentialId},true),set_config('waia.observation_account',${b.exchangeAccountId},true)`;
          return tx.unsafe(`SELECT * FROM public.${table}`);
        });
        expect(hidden).toHaveLength(0);
        await expect(
          projection.begin(async (tx) => {
            await tx`SET LOCAL ROLE waia_account_observation_reader`;
            await tx.unsafe(`DELETE FROM public.${table}`);
          }),
        ).rejects.toThrow();
      }
    });
    it("writes 100 bills and an all-duplicate window with constant SQL statement count", async () => {
      const b = await seed(),
        t = Date.now();
      const many = () => {
        const o = observation(b, t);
        if (o.htxV5?.schemaVersion !== "htx-v5-observation/v2") throw new Error("fixture");
        const bill = o.htxV5.bills.values![0];
        Object.assign(o.htxV5.bills, {
          values: Array.from({ length: 100 }, (_, i) => ({ ...bill, id: String(i + 1) })),
          pageScope: { ...o.htxV5.bills.pageScope, nextFrom: "100" },
          groups: [
            {
              currency: "USDT",
              type: "30",
              category: "FUNDING_INCOME",
              observedAmountSum: "25",
              recordCount: 100,
            },
          ],
        });
        return o;
      };
      for (const l of [await lease(b), null]) {
        const active = l ?? (await due(b));
        const offset = collectorQueries.length;
        expect(await commit(active, many())).toBeTruthy();
        const statements = collectorQueries
          .slice(offset)
          .filter((q) => q.includes("public.trader_account_financial_"));
        expect(statements).toHaveLength(3);
      }
      const page = await history(b);
      expect(page?.records).toHaveLength(100);
      expect(page?.coverage).toHaveLength(2);
      expect(page?.nextCursor).toBeNull();
    });
    it("freezes page membership across an in-flight collector commit and includes it in a new read", async () => {
      const b = await seed(),
        t = Date.now();
      const withId = (id: string) => {
        const o = observation(b, t);
        if (o.htxV5?.schemaVersion !== "htx-v5-observation/v2") throw new Error("fixture");
        Object.assign(o.htxV5.bills.values![0], { id });
        Object.assign(o.htxV5.bills.pageScope!, { nextFrom: id });
        return o;
      };
      await commit(await lease(b), withId("1"));
      await commit(await due(b), withId("2"));
      const l = await due(b),
        pid = Number((await collector`SELECT pg_backend_pid() AS pid`)[0].pid);
      await admin`UPDATE history_fixture_delay SET delay_ms=750 WHERE id`;
      const pending = commit(l, withId("3"));
      try {
        let waiting = false;
        for (const deadline = Date.now() + 600; Date.now() < deadline; ) {
          const activity = await admin`SELECT wait_event FROM pg_stat_activity WHERE pid=${pid}`;
          if (activity[0]?.wait_event === "PgSleep") {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(waiting).toBe(true);
        const first = await history(b, 1);
        expect(first?.records.map((r) => r.bill.id)).toEqual(["1"]);
        expect(first?.nextCursor).toBeTruthy();
        expect(await pending).toBeTruthy();
        const second = await history(b, 1, first!.nextCursor);
        expect(second?.records.map((r) => r.bill.id)).toEqual(["2"]);
        expect(second?.nextCursor).toBeNull();
        expect((await history(b))?.records.map((r) => r.bill.id)).toEqual(["1", "2", "3"]);
        expect((await history(b))?.coverage).toHaveLength(3);
      } finally {
        await pending.catch(() => undefined);
        await admin`UPDATE history_fixture_delay SET delay_ms=0 WHERE id`;
      }
    });
    it("stores full top-level xid inside a subtransaction and denies INSERT xid overrides", async () => {
      const b = await seed();
      await commit(await lease(b), observation(b));
      const source = (
        await admin`SELECT * FROM trader_account_financial_bills WHERE credential_id=${b.credentialId}`
      )[0];
      const rows = await admin.begin(async (tx) => {
        const top = (await tx`SELECT pg_current_xact_id()::text AS xid`)[0].xid;
        await tx`SAVEPOINT history_child`;
        const inserted = await tx`INSERT INTO trader_account_financial_bills
        (organization_id,credential_id,exchange_account_id,observation_id,htx_uid,provider_bill_id,created_time_ms,bill,provenance)
        VALUES (${b.organizationId},${b.credentialId},${b.exchangeAccountId},${source.observation_id},'456','999',${source.created_time_ms},${tx.json(source.bill)},${tx.json(source.provenance)})
        RETURNING recorded_xid::text AS xid`;
        expect(inserted[0].xid).toBe(top);
        await tx`ROLLBACK TO SAVEPOINT history_child`;
        return inserted;
      });
      expect(rows).toHaveLength(1);
      await expect(
        collector.begin(async (tx) => {
          await tx`SET LOCAL ROLE waia_account_observer`;
          await tx`SELECT set_config('waia.observation_org',${b.organizationId},true),set_config('waia.observation_credential',${b.credentialId},true),set_config('waia.observation_account',${b.exchangeAccountId},true)`;
          await tx`INSERT INTO trader_account_financial_bills
        (organization_id,credential_id,exchange_account_id,observation_id,htx_uid,provider_bill_id,created_time_ms,bill,provenance,recorded_xid)
        VALUES (${b.organizationId},${b.credentialId},${b.exchangeAccountId},${source.observation_id},'456','999',${source.created_time_ms},${tx.json(source.bill)},${tx.json(source.provenance)},'1'::xid8)`;
        }),
      ).rejects.toThrow(/permission denied/);
    });
    it("fails closed when stored normalized keys or coverage differ from immutable source provenance", async () => {
      const b = await seed();
      await commit(await lease(b), observation(b));
      for (const [table, column, expression] of [
        ["trader_account_financial_bills", "created_time_ms", "created_time_ms+1"],
        ["trader_account_financial_bills", "provider_bill_id", "'999'"],
        ["trader_account_financial_coverage", "window_start_ms", "window_start_ms-1"],
        [
          "trader_account_financial_coverage",
          "coverage",
          "jsonb_set(coverage,'{provenance,scopeId}','\"00000000-0000-4000-8000-000000000001\"')",
        ],
      ]) {
        const original = (
          await admin.unsafe(
            `SELECT ${column} AS value FROM ${table} WHERE credential_id='${b.credentialId}'`,
          )
        )[0].value;
        const trigger = table.endsWith("bills")
          ? "trader_financial_bills_immutable"
          : "trader_financial_coverage_immutable";
        try {
          await admin.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
          await admin.unsafe(
            `UPDATE ${table} SET ${column}=${expression} WHERE credential_id='${b.credentialId}'`,
          );
          await expect(history(b)).rejects.toThrow("ACCOUNT_OBSERVATION_READ_FAILED");
        } finally {
          await admin.unsafe(`UPDATE ${table} SET ${column}=$1 WHERE credential_id=$2`, [
            typeof original === "object" ? admin.json(original) : original,
            b.credentialId,
          ]);
          await admin.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      expect((await history(b))?.records).toHaveLength(1);
    });
    it("rolls every new financial row back if the lease expires during publication", async () => {
      const b = await seed(),
        l = await lease(b),
        o = observation(b);
      await admin`UPDATE trader_account_collection_state SET lease_expires_at=clock_timestamp()+interval '200 milliseconds' WHERE credential_id=${b.credentialId}`;
      await admin`UPDATE history_fixture_delay SET delay_ms=500 WHERE id`;
      try {
        await expect(commit(l, o)).rejects.toThrow("ACCOUNT_OBSERVATION_STORAGE_FAILED");
        expect(await history(b)).toBeNull();
        expect(
          (
            await admin`SELECT count(*)::int AS n FROM trader_account_financial_bills WHERE credential_id=${b.credentialId}`
          )[0].n,
        ).toBe(0);
        expect(
          (
            await admin`SELECT count(*)::int AS n FROM trader_account_financial_coverage WHERE credential_id=${b.credentialId}`
          )[0].n,
        ).toBe(0);
        expect(
          (
            await admin`SELECT count(*)::int AS n FROM trader_account_observations WHERE credential_id=${b.credentialId}`
          )[0].n,
        ).toBe(0);
      } finally {
        await admin`UPDATE history_fixture_delay SET delay_ms=0 WHERE id`;
      }
    });
  },
);
