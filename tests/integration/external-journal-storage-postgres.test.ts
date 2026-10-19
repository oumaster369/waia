import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresExternalJournalRepository } from "@/lib/trader/external-journal/postgres-repository";
import { prepareExternalJournalBatch, type ExternalJournalStorageLease } from "@/lib/trader/external-journal/storage-contract";

// Synthetic, disposable, TLS-only local fixture. Never reads DATABASE_URL.
const enabled = process.env.DEE1232_JOURNAL_PG17 === "1";
const database = "waia_journal_fixture";
const port = 55841;
const fixturePassword = "local_journal_fixture_only";
const sourceA = "11111111-1111-4111-8111-111111111111";
const sourceB = "22222222-2222-4222-8222-222222222222";
const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const credA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const credB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const gen = "synthetic-generation-1";
const sourceFingerprint = "a".repeat(64);
const generationFingerprint = "b".repeat(64);
const bytes = (text: string) => new TextEncoder().encode(text);

describe.skipIf(!enabled)("durable external journal on restricted PostgreSQL 17 logins", () => {
  let admin: postgres.Sql;
  let loginA: postgres.Sql;
  let loginB: postgres.Sql;
  let loginA2: postgres.Sql;
  let repoA: ReturnType<typeof createPostgresExternalJournalRepository>;
  let repoB: ReturnType<typeof createPostgresExternalJournalRepository>;
  const clients: postgres.Sql[] = [];

  function connect(username: string, application: string) {
    const caPath = process.env.DEE1232_JOURNAL_CA;
    if (!caPath) throw new Error("EXPLICIT_LOCAL_FIXTURE_CA_REQUIRED");
    const client = postgres({ host: "127.0.0.1", port, database, username,
      password: fixturePassword, max: username === "postgres" ? 3 : 1, prepare: false,
      connect_timeout: 3, idle_timeout: 2, onnotice: () => {},
      ssl: { ca: readFileSync(caPath), rejectUnauthorized: true, servername: "localhost" },
      connection: { application_name: application, statement_timeout: 3000, lock_timeout: 1000 },
    });
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    admin = connect("postgres", "dee1232-native-admin");
    const version = Number((await admin`SHOW server_version_num`)[0].server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000);
    expect(version).toBeLessThan(180000);
    expect((await admin`SELECT current_database() AS name`)[0].name).toBe(database);
    // This fixture is exclusively owned by this test on its pinned loopback/TLS endpoint.
    await admin.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE ALL ON SCHEMA public FROM PUBLIC;");
    // Minimal actual prerequisite tables and the exact immutable 0205 revision trigger.
    await admin.unsafe(`CREATE TABLE public.organizations (id uuid PRIMARY KEY);
      CREATE TABLE public.exchange_credentials (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
        venue text NOT NULL, exchange_account_id text NOT NULL, status text NOT NULL,
        observation_revision bigint NOT NULL DEFAULT 1 CHECK (observation_revision>0),
        encrypted_payload text NOT NULL DEFAULT 'synthetic-only', payload_key_version text,
        wrapped_dek_key_version text, wrapped_dek_key text, permission_metadata jsonb,
        revoked_at timestamptz
      ); ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY;`);
    const oldSql = readFileSync("db/migrations_postgres/0205_trader_account_observation_v1.sql", "utf8");
    const revisionBlock = oldSql.slice(oldSql.indexOf("CREATE FUNCTION public.trader_observation_credential_revision()"),
      oldSql.indexOf("CREATE TABLE public.trader_account_collection_state"));
    expect(revisionBlock).toContain("OBSERVATION_REVISION_IS_DATABASE_OWNED");
    await admin.unsafe(revisionBlock);
    for (const role of ["anon", "authenticated", "service_role", "waia_account_observer", "waia_account_observation_reader", "waia_account_observation_credential"]) {
      await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
        CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB; END IF; END $$`);
    }
    const contract = readFileSync("tests/fixtures/external-journal-storage-contract.sql", "utf8");
    await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_external_journal_importer') THEN
      CREATE ROLE waia_external_journal_importer NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF; END $$;
      GRANT SELECT(permission_metadata) ON public.exchange_credentials TO waia_external_journal_importer;`);
    await expect(admin.begin(tx => tx.unsafe(contract))).rejects.toThrow("UNSAFE");
    await admin.unsafe("REVOKE SELECT(permission_metadata) ON public.exchange_credentials FROM waia_external_journal_importer");
    await admin.begin(tx => tx.unsafe(contract));
    for (const name of ["waia_journal_native_a", "waia_journal_native_b"]) {
      await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN
        CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB CONNECTION LIMIT 2 PASSWORD '${fixturePassword}'; END IF; END $$;
        GRANT waia_external_journal_importer TO ${name};`);
    }
    loginA = connect("waia_journal_native_a", "dee1232-native-a");
    loginB = connect("waia_journal_native_b", "dee1232-native-b");
    loginA2 = connect("waia_journal_native_a", "dee1232-native-a2");
    repoA = createPostgresExternalJournalRepository(loginA);
    repoB = createPostgresExternalJournalRepository(loginB);
  });

  afterAll(async () => { await Promise.all(clients.map(client => client.end({ timeout: 3 }))); });

  beforeEach(async () => {
    await admin.unsafe(`DROP TRIGGER IF EXISTS journal_fixture_failure ON public.trader_external_journal_records;
      DROP FUNCTION IF EXISTS public.journal_fixture_failure();
      TRUNCATE public.trader_external_journal_records, public.trader_external_journal_generations,
        public.trader_external_journal_sources, public.exchange_credentials, public.organizations;`);
    for (const [source, org, credential, account, login] of [
      [sourceA, orgA, credA, "account-a", "waia_journal_native_a"],
      [sourceB, orgB, credB, "account-b", "waia_journal_native_b"],
    ]) {
      await admin`INSERT INTO public.organizations(id) VALUES (${org})`;
      await admin`INSERT INTO public.exchange_credentials(id,organization_id,venue,exchange_account_id,status)
        VALUES (${credential},${org},'htx',${account},'active')`;
      await admin`INSERT INTO public.trader_external_journal_sources(source_id,organization_id,credential_id,
        exchange_account_id,credential_revision,external_uid,market,api_mode,writer_discriminator,
        source_fingerprint,assigned_login,binding_state,verification_receipt,verified_at,verification_expires_at)
        VALUES (${source},${org},${credential},${account},1,${'uid-'+account},'futures','htx-v5',
          'synthetic-writer',${sourceFingerprint},${login},'VERIFIED',${'c'.repeat(64)},
          clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes')`;
      await admin`INSERT INTO public.trader_external_journal_generations(source_id,generation_id,organization_id,
        credential_id,exchange_account_id,source_binding_revision,generation_fingerprint)
        VALUES (${source},${gen},${org},${credential},${account},1,${generationFingerprint})`;
    }
  });

  async function claim(ttlMs = 30_000) {
    const result = await repoA.claim({ sourceId: sourceA, generationId: gen, ownerId: "native-worker", ttlMs });
    expect(result.status).toBe("CLAIMED");
    if (result.status !== "CLAIMED") throw new Error("NATIVE_CLAIM_REQUIRED");
    return result.lease;
  }
  function prepare(lease: ExternalJournalStorageLease, text: string, endOfSource = false) {
    const chunk = bytes(text);
    return prepareExternalJournalBatch({ lease, chunk, chunkStartOffset: lease.cursor.nextOffset,
      sourceEvidence: { sourceFingerprint, generationFingerprint,
        sizeBefore: lease.cursor.nextOffset + chunk.length, sizeAfter: lease.cursor.nextOffset + chunk.length,
        // These are generated fixture bytes, with an explicit DB-clock timestamp.
        // Do not assume the macOS host clock equals the Docker VM clock to the ms.
        observedAtMs: lease.claimedAtMs, prefixVerified: true }, endOfSource });
  }
  async function rows() {
    return admin`SELECT source_id,byte_offset,byte_length,record_kind,code,payload,raw_sha256
      FROM public.trader_external_journal_records ORDER BY source_id,byte_offset`;
  }
  async function cursor() {
    const result = await admin`SELECT cursor_version,next_offset,pending_offset,pending_bytes,
      discard_line_offset,discard_bytes_seen,state FROM public.trader_external_journal_generations
      WHERE source_id=${sourceA} AND generation_id=${gen}`;
    return result[0];
  }
  async function scoped<T>(client: postgres.Sql, source: string, callback: (tx: postgres.TransactionSql) => Promise<T>) {
    return client.begin(async tx => {
      await tx`SET LOCAL ROLE waia_external_journal_importer`;
      await tx`SELECT set_config('waia.journal_source',${source},true),
        set_config('waia.journal_generation',${gen},true)`;
      return callback(tx);
    });
  }

  it("uses two real non-bypass LOGINs over verified TLS", async () => {
    for (const [client, name] of [[loginA, "waia_journal_native_a"], [loginB, "waia_journal_native_b"]] as const) {
      const rows = await client`SELECT session_user AS login, current_user AS effective,
        r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolinherit,
        s.ssl FROM pg_roles r JOIN pg_stat_ssl s ON s.pid=pg_backend_pid() WHERE r.rolname=session_user`;
      expect(rows[0]).toMatchObject({ login: name, effective: name, rolsuper: false,
        rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolinherit: false, ssl: true });
    }
    expect(repoA).toBeDefined(); expect(repoB).toBeDefined();
  });

  it("atomically appends observed and quarantined records and recognizes exact ambiguous acknowledgement", async () => {
    const lease = await claim();
    const batch = prepare(lease, '{"event":"filled","contract":"BTC-USDT","tradeId":"1"}\n{bad}\n');
    expect(batch.records).toHaveLength(2);
    expect(await repoA.commit(batch)).toEqual({ status: "COMMITTED" });
    const stored = await rows();
    expect(stored.map(r => r.record_kind)).toEqual(["observation", "quarantine"]);
    expect(stored[0].payload).toMatchObject({ authority: "external_executor_observation", canonicalFill: false });
    expect(stored[1].payload).toBeNull();
    expect(Number((await cursor()).next_offset)).toBe(batch.cursor.nextOffset);
    expect(await repoA.commit(batch)).toEqual({ status: "REPLAYED" });
    expect(await rows()).toEqual(stored);
  });

  it("hydrates partial tails after restart, and persists an oversized terminal quarantine once", async () => {
    const first = prepare(await claim(), '{"event":"filled",');
    expect(await repoA.commit(first)).toMatchObject({ status: "COMMITTED" });
    const resumed = createPostgresExternalJournalRepository(loginA);
    const snapshot = await resumed.load(sourceA, gen);
    expect(snapshot?.cursor).toEqual(first.cursor);
    const second = prepare(await claim(), '"tradeId":"2"}\n' + 'x'.repeat(32_769));
    expect(await repoA.commit(second)).toMatchObject({ status: "COMMITTED" });
    expect((await resumed.load(sourceA, gen))?.cursor.discardUntilLf).toBeDefined();
    const third = prepare(await claim(), '\n');
    expect(await repoA.commit(third)).toMatchObject({ status: "COMMITTED" });
    expect(await rows()).toHaveLength(2);
    expect((await rows())[1]).toMatchObject({ record_kind: "quarantine", code: "line_too_large", raw_sha256: null, payload: null });
    expect(await resumed.load(sourceA, gen)).toMatchObject({ cursorVersion: 3, cursor: third.cursor });
  });

  it("does not grant cross-login access even with forged source and generation contexts", async () => {
    expect(await repoB.load(sourceA, gen)).toBeNull();
    expect(await repoB.claim({ sourceId: sourceA, generationId: gen, ownerId: "foreign", ttlMs: 1000 }))
      .toMatchObject({ status: "REFUSED" });
    expect(await scoped(loginB, sourceA, tx => tx`SELECT source_id FROM public.trader_external_journal_sources`)).toHaveLength(0);
    expect(await scoped(loginA, sourceB, tx => tx`SELECT id FROM public.exchange_credentials`)).toHaveLength(0);
    expect(await rows()).toHaveLength(0);
  });

  it("protects all new relations with FORCE RLS and withholds platform role and credential-secret privileges", async () => {
    const catalog = await admin`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE relname IN ('trader_external_journal_sources','trader_external_journal_generations','trader_external_journal_records')`;
    expect(catalog).toHaveLength(3);
    expect(catalog.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    for (const relation of catalog) {
      for (const role of ["anon", "authenticated", "service_role", "waia_account_observer", "waia_account_observation_reader", "waia_account_observation_credential"]) {
        const privileges = await admin`SELECT has_table_privilege(${role},${'public.'+relation.relname},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS any,
          has_any_column_privilege(${role},${'public.'+relation.relname},'SELECT,INSERT,UPDATE,REFERENCES') AS columns`;
        expect(privileges[0]).toEqual({ any: false, columns: false });
      }
    }
    for (const column of ["*", "encrypted_payload", "permission_metadata", "wrapped_dek_key"]) {
      await expect(scoped(loginA, sourceA, tx => tx.unsafe(`SELECT ${column} FROM public.exchange_credentials`)))
        .rejects.toMatchObject({ code: "42501" });
    }
    await expect(loginA`SELECT source_id FROM public.trader_external_journal_sources`).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses importer registry/revision mutation and record edits, including owner record edits", async () => {
    await expect(scoped(loginA, sourceA, tx => tx`UPDATE public.trader_external_journal_sources
      SET binding_revision=binding_revision WHERE source_id=${sourceA}`)).rejects.toThrow("SOURCE_MUTATION_FORBIDDEN");
    await expect(scoped(loginA, sourceA, tx => tx`UPDATE public.exchange_credentials
      SET observation_revision=observation_revision+1 WHERE id=${credA}`)).rejects.toThrow("OBSERVATION_REVISION_IS_DATABASE_OWNED");
    const batch = prepare(await claim(), '{}\n');
    expect(await repoA.commit(batch)).toMatchObject({ status: "COMMITTED" });
    await expect(scoped(loginA, sourceA, tx => tx`DELETE FROM public.trader_external_journal_records`)).rejects.toMatchObject({ code: "42501" });
    await expect(admin`UPDATE public.trader_external_journal_records SET code='unknown'`).rejects.toThrow("RECORD_IMMUTABLE");
    await expect(admin`DELETE FROM public.trader_external_journal_records`).rejects.toThrow("RECORD_IMMUTABLE");
    await expect(scoped(loginA, sourceA, tx => tx`INSERT INTO public.trader_external_journal_generations
      (source_id,generation_id,organization_id,credential_id,exchange_account_id,source_binding_revision,generation_fingerprint)
      VALUES (${sourceA},'new',${orgA},${credA},'account-a',1,${generationFingerprint})`)).rejects.toMatchObject({ code: "42501" });
  });

  it.each(["revoked", "replacement"] as const)("refuses a prepared batch after credential %s", async change => {
    const batch = prepare(await claim(), '{}\n');
    if (change === "revoked") await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${credA}`;
    else await admin`UPDATE public.exchange_credentials SET encrypted_payload='synthetic-replacement' WHERE id=${credA}`;
    expect(await repoA.commit(batch)).toMatchObject({ status: "REFUSED" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).next_offset)).toBe(0);
    expect(await repoB.load(sourceB, gen)).not.toBeNull();
  });

  it.each(["external_uid", "api_mode", "writer_discriminator", "source_fingerprint", "binding_state"] as const)
    ("refuses a prepared batch after source %s changes", async field => {
      const batch = prepare(await claim(), '{}\n');
      const value = field === "binding_state" ? "SUSPENDED" : field === "source_fingerprint" ? 'd'.repeat(64) : "changed";
      await admin.unsafe(`UPDATE public.trader_external_journal_sources SET ${field}=$1 WHERE source_id=$2`, [value, sourceA]);
      expect(await repoA.commit(batch)).toMatchObject({ status: "REFUSED" });
      expect(await rows()).toHaveLength(0);
      expect(Number((await cursor()).next_offset)).toBe(0);
    });

  it("admits only one concurrent lease holder and prevents the loser from consuming bytes", async () => {
    const competitor = createPostgresExternalJournalRepository(loginA2);
    const attempts = await Promise.all([repoA, competitor].map((repo, index) => repo.claim({ sourceId: sourceA,
      generationId: gen, ownerId: `worker-${index}`, ttlMs: 30_000 })));
    expect(attempts.filter(r => r.status === "CLAIMED")).toHaveLength(1);
    expect(attempts.filter(r => r.status === "REFUSED")).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses evidence claiming a future database time without weakening the clock boundary", async () => {
    const lease = await claim();
    const batch = prepareExternalJournalBatch({ lease, chunk: bytes('{}\n'), chunkStartOffset: 0,
      sourceEvidence: { sourceFingerprint, generationFingerprint, sizeBefore: 3, sizeAfter: 3,
        observedAtMs: lease.expiresAtMs - 1, prefixVerified: true } });
    expect(await repoA.commit(batch)).toMatchObject({ status: "REFUSED", reason: "STALE_EVIDENCE" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).next_offset)).toBe(0);
  });

  it("rolls back earlier inserts when a later record fails", async () => {
    const batch = prepare(await claim(), '{}\n{bad}\n');
    await admin.unsafe(`CREATE FUNCTION public.journal_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.record_kind='quarantine' THEN RAISE EXCEPTION 'SYNTHETIC_INSERT_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER journal_fixture_failure BEFORE INSERT ON public.trader_external_journal_records
      FOR EACH ROW EXECUTE FUNCTION public.journal_fixture_failure();`);
    await expect(repoA.commit(batch)).rejects.toMatchObject({ outcome: "UNKNOWN" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).cursor_version)).toBe(0);
  });

  it("rolls back inserted records when the lease expires before final cursor CAS", async () => {
    await admin.unsafe(`CREATE FUNCTION public.journal_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$;
      CREATE TRIGGER journal_fixture_failure AFTER INSERT ON public.trader_external_journal_records
      FOR EACH ROW EXECUTE FUNCTION public.journal_fixture_failure();`);
    const batch = prepare(await claim(1000), '{}\n');
    await expect(repoA.commit(batch)).rejects.toMatchObject({ outcome: "UNKNOWN" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).cursor_version)).toBe(0);
    expect(Number((await cursor()).next_offset)).toBe(0);
  });

  it("serializes an in-flight commit behind credential revocation and then refuses it", async () => {
    const batch = prepare(await claim(), '{}\n');
    let pending: ReturnType<typeof repoA.commit> | undefined;
    await admin.begin(async tx => {
      await tx`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${credA}`;
      pending = repoA.commit(batch);
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const activity = await admin`SELECT 1 FROM pg_stat_activity WHERE application_name='dee1232-native-a'
          AND wait_event_type='Lock'`;
        if (activity.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    });
    expect(await pending).toMatchObject({ status: "REFUSED" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).next_offset)).toBe(0);
  });

  it("refuses expired source verification and safely closes a verified empty EOF generation", async () => {
    await admin`UPDATE public.trader_external_journal_sources
      SET verification_expires_at=clock_timestamp()-interval '1 second' WHERE source_id=${sourceB}`;
    expect(await repoB.claim({ sourceId: sourceB, generationId: gen, ownerId: "expired", ttlMs: 1000 }))
      .toMatchObject({ status: "REFUSED" });
    const batch = prepare(await claim(), '', true);
    expect(await repoA.commit(batch)).toMatchObject({ status: "COMMITTED" });
    expect(await repoA.commit(batch)).toMatchObject({ status: "REPLAYED" });
    expect((await cursor()).state).toBe("CLOSED");
    expect(await repoA.claim({ sourceId: sourceA, generationId: gen, ownerId: "later", ttlMs: 1000 }))
      .toMatchObject({ status: "REFUSED", reason: "INACTIVE" });
    expect(await rows()).toHaveLength(0);
  });

  it("does not acknowledge a stale earlier batch after a later commit", async () => {
    const first = prepare(await claim(), '{}\n');
    expect(await repoA.commit(first)).toMatchObject({ status: "COMMITTED" });
    const second = prepare(await claim(), '{}\n');
    expect(await repoA.commit(second)).toMatchObject({ status: "COMMITTED" });
    expect(await repoA.commit(first)).toMatchObject({ status: "REFUSED" });
    expect(await rows()).toHaveLength(2);
    expect(Number((await cursor()).cursor_version)).toBe(2);
  });

  it("refuses changed bytes at the same committed identity without altering durable records", async () => {
    const lease = await claim();
    const first = prepare(lease, '{"event":"filled"}\n');
    const conflicting = prepare(lease, '{"event":"closed"}\n');
    expect(await repoA.commit(first)).toMatchObject({ status: "COMMITTED" });
    const before = await rows();
    expect(await repoA.commit(conflicting)).toMatchObject({ status: "REFUSED", reason: "INTEGRITY_CONFLICT", generationSuspended: true });
    expect(await rows()).toEqual(before);
    expect((await cursor()).state).toBe("SUSPENDED");
  });

  it("refuses source replacement/truncation before storage without resetting its generation", async () => {
    const lease = await claim();
    const batch = prepare(lease, '{}\n');
    expect(await repoA.commit(batch)).toMatchObject({ status: "COMMITTED" });
    const next = await claim();
    expect(() => prepareExternalJournalBatch({ lease: next, chunk: bytes('{}\n'), chunkStartOffset: next.cursor.nextOffset,
      sourceEvidence: { sourceFingerprint, generationFingerprint: 'e'.repeat(64), sizeBefore: 6,
        sizeAfter: 6, observedAtMs: Date.now(), prefixVerified: true } })).toThrow("SOURCE_CHANGED");
    expect(() => prepareExternalJournalBatch({ lease: next, chunk: bytes('{}\n'), chunkStartOffset: next.cursor.nextOffset,
      sourceEvidence: { sourceFingerprint, generationFingerprint, sizeBefore: 0,
        sizeAfter: 0, observedAtMs: Date.now(), prefixVerified: true } })).toThrow("SOURCE_TRUNCATED");
    expect(Number((await cursor()).next_offset)).toBe(3);
    expect(await rows()).toHaveLength(1);
  });

  it("qualification delta: fences in-flight source re-verification", async () => {
    const batch = prepare(await claim(), '{}\n');
    let pending: ReturnType<typeof repoA.commit> | undefined;
    await admin.begin(async tx => {
      await tx`UPDATE public.trader_external_journal_sources SET verification_receipt=${'d'.repeat(64)} WHERE source_id=${sourceA}`;
      pending = repoA.commit(batch);
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const activity = await admin`SELECT 1 FROM pg_stat_activity WHERE application_name='dee1232-native-a' AND wait_event_type='Lock'`;
        if (activity.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    });
    expect(await pending).toMatchObject({ status: "REFUSED" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).cursor_version)).toBe(0);
  });

  it("qualification delta: conflicting replay cannot suspend a successor lease", async () => {
    const oldLease = await claim();
    const first = prepare(oldLease, '{"event":"filled"}\n');
    const conflict = prepare(oldLease, '{"event":"closed"}\n');
    expect(await repoA.commit(first)).toMatchObject({ status: "COMMITTED" });
    const successor = await claim();
    expect(await repoA.commit(conflict)).toMatchObject({ status: "REFUSED", reason: "INTEGRITY_CONFLICT", generationSuspended: false });
    expect((await cursor()).state).toBe("ACTIVE");
    expect((await admin`SELECT lease_token FROM public.trader_external_journal_generations WHERE source_id=${sourceA}`)[0].lease_token).toBe(successor.token);
    expect(await repoA.commit(prepare(successor, '{}\n'))).toMatchObject({ status: "COMMITTED" });
    expect(await rows()).toHaveLength(2);
  });

  it("qualification delta: nested payload extras fail the SQL check under a valid importer lease", async () => {
    const lease = await claim(), batch = prepare(lease, '{"event":"filled"}\n');
    const r = batch.records[0]!;
    const payload = JSON.parse(JSON.stringify(r.payload));
    payload.source.unapprovedNestedField = "synthetic";
    await expect(scoped(loginA, sourceA, async tx => {
      await tx`SELECT set_config('waia.journal_lease',${lease.token},true), set_config('waia.journal_owner',${lease.ownerId},true),
        set_config('waia.journal_cursor_version',${String(lease.cursorVersion)},true)`;
      await tx`INSERT INTO public.trader_external_journal_records
        (source_id,generation_id,organization_id,credential_id,exchange_account_id,byte_offset,byte_length,raw_sha256,
          normalizer_version,record_kind,code,payload,record_digest,batch_digest)
        VALUES (${sourceA},${gen},${orgA},${credA},'account-a',${r.byteOffset},${r.byteLength},${r.rawSha256},
          ${r.normalizerVersion},${r.recordKind},${r.code},${tx.json(payload)},${r.recordDigest},${batch.digest})`;
    })).rejects.toMatchObject({ code: "23514" });
    expect(await rows()).toHaveLength(0);
    expect(await repoA.commit(batch)).toMatchObject({ status: "COMMITTED" });
  });

  it("qualification delta: source-proof expiry rolls back with a still-live lease", async () => {
    // Re-enroll this empty synthetic generation at the newly owned source revision.
    await admin`DELETE FROM public.trader_external_journal_generations WHERE source_id=${sourceA}`;
    await admin`UPDATE public.trader_external_journal_sources SET verification_expires_at=clock_timestamp()+interval '800 milliseconds' WHERE source_id=${sourceA}`;
    await admin`INSERT INTO public.trader_external_journal_generations(source_id,generation_id,organization_id,credential_id,exchange_account_id,source_binding_revision,generation_fingerprint)
      SELECT source_id,${gen},organization_id,credential_id,exchange_account_id,binding_revision,${generationFingerprint}
      FROM public.trader_external_journal_sources WHERE source_id=${sourceA}`;
    await admin.unsafe(`CREATE FUNCTION public.journal_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(1.0); RETURN NEW; END $$;
      CREATE TRIGGER journal_fixture_failure AFTER INSERT ON public.trader_external_journal_records
      FOR EACH ROW EXECUTE FUNCTION public.journal_fixture_failure();`);
    const lease = await claim(30000), batch = prepare(lease, '{}\n');
    await expect(repoA.commit(batch)).rejects.toMatchObject({ outcome: "UNKNOWN" });
    expect(await rows()).toHaveLength(0);
    expect(Number((await cursor()).cursor_version)).toBe(0);
    expect((await admin`SELECT lease_expires_at>clock_timestamp() AS live FROM public.trader_external_journal_generations WHERE source_id=${sourceA}`)[0].live).toBe(true);
  });

});
