/**
 * DEE-1159 durable registration boundary. Requires the complete isolated
 * PostgreSQL validation profile and the draft registry migration applied by
 * the native harness. Registrations are append-only test evidence; this file
 * deliberately does not delete their rows.
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  researchExperimentIdentityV1,
} from "@/lib/trader/research/research-experiment-contract-v1";
import {
  loadRegisteredResearchExperimentPostgresV1,
  registerResearchExperimentPostgresV1,
} from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!enabled || !url)("DEE-1159 Postgres research experiment registry v1", () => {
  let ownerSql: postgres.Sql;
  let witnessSql: postgres.Sql;
  let db: WaiaPostgresDb;
  let secondDb: WaiaPostgresDb;
  let organizationA = "";
  let organizationB = "";

  async function seedOrganization(displayName: string): Promise<string> {
    const userId = randomUUID();
    await ownerSql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING`;
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: displayName,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
    return ensureUserCoreSeedPostgres(db, { userId, displayName });
  }

  async function counts(specSha256: string, familySize: number) {
    const result = await witnessSql<{ experiments: number; families: number }[]>`
      SELECT
        (SELECT count(*)::int FROM trader_research_experiments_v1 WHERE spec_sha256 = ${specSha256}) AS experiments,
        (SELECT count(*)::int FROM trader_strategy_admission_family WHERE spec_sha256 = ${specSha256} AND family_size = ${familySize}) AS families
    `;
    return result[0]!;
  }

  beforeAll(async () => {
    ownerSql = postgres(url!, { max: 4, prepare: false });
    witnessSql = postgres(url!, { max: 2, prepare: false });
    db = drizzle(ownerSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    secondDb = drizzle(postgres(url!, { max: 2, prepare: false }), { schema: pgSchema }) as unknown as WaiaPostgresDb;
    organizationA = await seedOrganization("DEE-1159 registry A");
    organizationB = await seedOrganization("DEE-1159 registry B");
  }, 30_000);

  afterAll(async () => {
    await Promise.all([
      ownerSql?.end({ timeout: 5 }),
      witnessSql?.end({ timeout: 5 }),
      (secondDb as unknown as { $client?: postgres.Sql } | undefined)?.$client?.end({ timeout: 5 }),
    ]);
  }, 15_000);

  it("converges concurrent exact-spec registration on one immutable family and record", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "concurrent-idempotence");
    const identity = researchExperimentIdentityV1(proposal);
    const [first, second] = await Promise.all([
      registerResearchExperimentPostgresV1(db, requireOrgContext(organizationA), proposal),
      registerResearchExperimentPostgresV1(secondDb, requireOrgContext(organizationA), proposal),
    ]);
    const retry = await registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA),
      proposal,
    );

    expect(first).toEqual(second);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      authority: "REGISTRATION_ONLY",
      specSha256: identity.specSha256,
      declaredFamilySize: identity.declaredFamilySize,
      spec: identity.spec,
    });
    expect(await counts(identity.specSha256, identity.declaredFamilySize)).toEqual({
      experiments: 1,
      families: 1,
    });
  });

  it("normalizes uppercase proposal and context UUIDs to the same durable identity", async () => {
    const lowerProposal = buildResearchExperimentProposalV1(organizationA, "uuid-case-canonicalization");
    const upperProposal = structuredClone(lowerProposal);
    upperProposal.organizationId = organizationA.toUpperCase();
    const lowerIdentity = researchExperimentIdentityV1(lowerProposal);
    const upperIdentity = researchExperimentIdentityV1(upperProposal);
    expect(organizationA.toUpperCase()).not.toBe(organizationA);
    expect(upperIdentity.specSha256).toBe(lowerIdentity.specSha256);
    expect(upperIdentity.spec.organizationId).toBe(organizationA);

    const registered = await registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA.toUpperCase()),
      upperProposal,
    );
    const loaded = await loadRegisteredResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA.toUpperCase()),
      lowerIdentity.specSha256,
    );
    const exactRetry = await registerResearchExperimentPostgresV1(
      secondDb,
      requireOrgContext(organizationA),
      lowerProposal,
    );
    expect(loaded).toEqual(registered);
    expect(exactRetry).toEqual(registered);
  });

  it.each([100, 190])("refuses discovery cutoff %i touching training before any durable registration", async cutoff => {
    const proposal = buildResearchExperimentProposalV1(organizationA, `discovery-overlap-${cutoff}`);
    proposal.hypothesis.observationCutoffMs = cutoff;
    const digest = createHash("sha256").update(canonicalJsonString(proposal)).digest("hex");
    const transaction = vi.spyOn(db, "transaction");
    try {
      await expect(registerResearchExperimentPostgresV1(
        db,
        requireOrgContext(organizationA),
        proposal,
      )).rejects.toThrow("hypothesis observations must end before training starts");
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
    expect(await counts(digest, proposal.orderedTrials.length)).toEqual({ experiments: 0, families: 0 });
  });

  it("commits family and spec before returning, and a later caller exception cannot retract either", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "visible-before-return");
    const identity = researchExperimentIdentityV1(proposal);
    const transactionTarget = db as unknown as {
      transaction: (...args: unknown[]) => Promise<unknown>;
    };
    const originalTransaction = transactionTarget.transaction;
    let observedBeforePublicReturn: { experiments: number; families: number } | undefined;
    transactionTarget.transaction = async (...args: unknown[]) => {
      const committed = await originalTransaction.apply(db, args);
      observedBeforePublicReturn = await counts(identity.specSha256, identity.declaredFamilySize);
      return committed;
    };
    try {
      await expect((async () => {
        await registerResearchExperimentPostgresV1(db, requireOrgContext(organizationA), proposal);
        throw new Error("caller failed after registration returned");
      })()).rejects.toThrow("caller failed after registration returned");
    } finally {
      transactionTarget.transaction = originalTransaction;
    }

    expect(observedBeforePublicReturn).toEqual({ experiments: 1, families: 1 });
    expect(await counts(identity.specSha256, identity.declaredFamilySize)).toEqual({
      experiments: 1,
      families: 1,
    });
  });

  it("rejects a real outer transaction before any repository select or insert", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "outer-transaction-refusal");
    const identity = researchExperimentIdentityV1(proposal);
    const before = await counts(identity.specSha256, identity.declaredFamilySize);

    await db.transaction(async tx => {
      const select = vi.spyOn(tx, "select");
      const insert = vi.spyOn(tx, "insert");
      await expect(registerResearchExperimentPostgresV1(
        tx as unknown as WaiaPostgresDb,
        requireOrgContext(organizationA),
        proposal,
      )).rejects.toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
      await expect(loadRegisteredResearchExperimentPostgresV1(
        tx as unknown as WaiaPostgresDb,
        requireOrgContext(organizationA),
        identity.specSha256,
      )).rejects.toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
      expect(select).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    expect(await counts(identity.specSha256, identity.declaredFamilySize)).toEqual(before);
  });

  it("refuses cross-organization and absent reads, and rejects an org-mismatched proposal", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "tenant-read-boundary");
    const registered = await registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA),
      proposal,
    );

    await expect(loadRegisteredResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationB),
      registered.specSha256,
    )).rejects.toThrow("RESEARCH_EXPERIMENT_NOT_REGISTERED");
    await expect(loadRegisteredResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA),
      "f".repeat(64),
    )).rejects.toThrow("RESEARCH_EXPERIMENT_NOT_REGISTERED");

    const wrongOrgProposal = buildResearchExperimentProposalV1(organizationA, "org-mismatch");
    await expect(registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationB),
      wrongOrgProposal,
    )).rejects.toThrow("RESEARCH_EXPERIMENT_ORGANIZATION_MISMATCH");
  });

  it("rolls back the family row when the actual experiment insert fails", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "rollback-family-on-insert-error");
    const identity = researchExperimentIdentityV1(proposal);
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `dee1159_reject_${suffix}`;
    const functionName = `dee1159_reject_fn_${suffix}`;
    await ownerSql.unsafe(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.spec_sha256 = '${identity.specSha256}' THEN
          RAISE EXCEPTION 'DEE-1159 synthetic registry insert fault';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await ownerSql.unsafe(`
      CREATE TRIGGER ${triggerName} BEFORE INSERT ON public.trader_research_experiments_v1
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}()
    `);
    try {
      await expect(registerResearchExperimentPostgresV1(
        db,
        requireOrgContext(organizationA),
        proposal,
      )).rejects.toThrow("DEE-1159 synthetic registry insert fault");
    } finally {
      await ownerSql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON public.trader_research_experiments_v1`);
      await ownerSql.unsafe(`DROP FUNCTION IF EXISTS public.${functionName}()`);
    }
    expect(await counts(identity.specSha256, identity.declaredFamilySize)).toEqual({
      experiments: 0,
      families: 0,
    });
  });

  it("rejects a valid canonical experiment whose admission family is absent", async () => {
    const identity = researchExperimentIdentityV1(
      buildResearchExperimentProposalV1(organizationA, "missing-family-foreign-key"),
    );
    await expect(ownerSql`
      INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
      VALUES (${identity.specSha256}, ${organizationA}::uuid, ${identity.declaredFamilySize}, ${canonicalJsonString(identity.spec)})
    `).rejects.toMatchObject({ code: "23503" });
    expect(await counts(identity.specSha256, identity.declaredFamilySize))
      .toEqual({ experiments: 0, families: 0 });
  });

  it("refuses UPDATE, DELETE, and TRUNCATE against the persisted registry", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "append-only-mutations");
    const registered = await registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA),
      proposal,
    );
    await expect(ownerSql`
      UPDATE trader_research_experiments_v1 SET registered_at = registered_at + interval '1 day'
      WHERE spec_sha256 = ${registered.specSha256}
    `).rejects.toThrow("append-only discovery admission store");
    await expect(ownerSql`
      DELETE FROM trader_research_experiments_v1 WHERE spec_sha256 = ${registered.specSha256}
    `).rejects.toThrow("append-only discovery admission store");
    const [attemptTable] = await witnessSql<{ present: boolean }[]>`
      SELECT to_regclass('public.trader_research_attempts_v1') IS NOT NULL AS present
    `;
    const attemptsBefore = attemptTable?.present
      ? await witnessSql<{ count: number }[]>`SELECT count(*)::int AS count FROM trader_research_attempts_v1`
      : null;
    await expect(ownerSql.begin(async tx => {
      await tx.unsafe(`TRUNCATE TABLE trader_research_experiments_v1${attemptTable?.present ? " CASCADE" : ""}`);
    })).rejects.toThrow("append-only discovery admission store");
    expect(await counts(registered.specSha256, registered.declaredFamilySize)).toEqual({
      experiments: 1,
      families: 1,
    });
    if (attemptTable?.present) {
      const attemptsAfter = await witnessSql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM trader_research_attempts_v1
      `;
      expect(attemptsAfter).toEqual(attemptsBefore);
    }
  });

  it("denies browser-role reads and writes to the registration table", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "browser-role-denial");
    const identity = researchExperimentIdentityV1(proposal);
    await registerResearchExperimentPostgresV1(db, requireOrgContext(organizationA), proposal);

    for (const role of ["authenticated", "anon"] as const) {
      await expect(ownerSql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT spec_sha256 FROM trader_research_experiments_v1 WHERE spec_sha256 = ${identity.specSha256}`;
      })).rejects.toMatchObject({ code: "42501" });
      await expect(ownerSql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
          VALUES (${identity.specSha256}, ${organizationA}::uuid, ${identity.declaredFamilySize}, ${canonicalJsonString(identity.spec)})`;
      })).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("enforces RLS for a nonowner role with explicit table grants and NOBYPASSRLS", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "nobypassrls-row-isolation");
    const registered = await registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA),
      proposal,
    );
    const role = `dee1159_reader_${randomUUID().replaceAll("-", "")}`;
    await ownerSql.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    try {
      await ownerSql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await ownerSql.unsafe(`GRANT SELECT, INSERT ON public.trader_research_experiments_v1 TO ${role}`);
      const attributes = await ownerSql<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = ${role}
      `;
      expect(attributes).toEqual([{ rolbypassrls: false }]);

      const visibleRows = await ownerSql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        return tx`
          SELECT spec_sha256 FROM trader_research_experiments_v1
          WHERE spec_sha256 = ${registered.specSha256}
        `;
      });
      expect(visibleRows).toEqual([]);

      await expect(ownerSql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`INSERT INTO trader_research_experiments_v1
          (spec_sha256, organization_id, family_size, spec_canonical_json)
          VALUES (${registered.specSha256}, ${organizationA}::uuid, ${registered.declaredFamilySize}, ${canonicalJsonString(registered.spec)})`;
      })).rejects.toMatchObject({ code: "42501" });
    } finally {
      await ownerSql.unsafe(`REVOKE ALL ON public.trader_research_experiments_v1 FROM ${role}`);
      await ownerSql.unsafe(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
      await ownerSql.unsafe(`DROP ROLE IF EXISTS ${role}`);
    }
  });

  it("rejects database rows with family-count, missing-identity, or size mismatches", async () => {
    const wrongFamily = buildResearchExperimentProposalV1(organizationA, "db-family-count-mismatch");
    const wrongFamilyIdentity = researchExperimentIdentityV1(wrongFamily);
    await ownerSql`
      INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
      VALUES (${wrongFamilyIdentity.specSha256}, ${wrongFamilyIdentity.declaredFamilySize - 1})
    `;
    await expect(ownerSql`
      INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
      VALUES (${wrongFamilyIdentity.specSha256}, ${organizationA}::uuid, ${wrongFamilyIdentity.declaredFamilySize - 1}, ${canonicalJsonString(wrongFamilyIdentity.spec)})
    `).rejects.toMatchObject({ code: "23514" });

    for (const malformedJson of ["null", "{}"] as const) {
      const sha = createHash("sha256").update(malformedJson, "utf8").digest("hex");
      await ownerSql`
        INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
        VALUES (${sha}, 1)
        ON CONFLICT (spec_sha256) DO NOTHING
      `;
      const persistedFamily = await ownerSql<{ family_size: number }[]>`
        SELECT family_size FROM trader_strategy_admission_family WHERE spec_sha256 = ${sha}
      `;
      expect(persistedFamily).toEqual([{ family_size: 1 }]);
      await expect(ownerSql`
        INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
        VALUES (${sha}, ${organizationA}::uuid, 1, ${malformedJson})
      `).rejects.toMatchObject({ code: "23514" });
    }

    const oversizedProposal = buildResearchExperimentProposalV1(organizationA, "db-size-limit");
    const oversizedIdentity = researchExperimentIdentityV1(oversizedProposal);
    const oversizedCanonical = canonicalJsonString({
      ...oversizedIdentity.spec,
      databaseLimitProbe: "x".repeat(262_145),
    });
    const oversizedSha = createHash("sha256").update(oversizedCanonical, "utf8").digest("hex");
    await ownerSql`
      INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
      VALUES (${oversizedSha}, ${oversizedIdentity.declaredFamilySize})
    `;
    await expect(ownerSql`
      INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
      VALUES (${oversizedSha}, ${organizationA}::uuid, ${oversizedIdentity.declaredFamilySize}, ${oversizedCanonical})
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects forged digests, organization substitution, and conflicting family sizes", async () => {
    const forged = buildResearchExperimentProposalV1(organizationA, "forged-db-digest");
    const forgedIdentity = researchExperimentIdentityV1(forged);
    const forgedSha = createHash("sha256").update(randomUUID(), "utf8").digest("hex");
    expect(forgedSha).not.toBe(forgedIdentity.specSha256);
    await ownerSql`
      INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
      VALUES (${forgedSha}, ${forgedIdentity.declaredFamilySize})
    `;
    await expect(ownerSql`
      INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
      VALUES (${forgedSha}, ${organizationA}::uuid, ${forgedIdentity.declaredFamilySize}, ${canonicalJsonString(forgedIdentity.spec)})
    `).rejects.toMatchObject({ code: "23514" });

    const wrongOrg = buildResearchExperimentProposalV1(organizationA, "forged-db-organization");
    const wrongOrgIdentity = researchExperimentIdentityV1(wrongOrg);
    await ownerSql`
      INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
      VALUES (${wrongOrgIdentity.specSha256}, ${wrongOrgIdentity.declaredFamilySize})
    `;
    await expect(ownerSql`
      INSERT INTO trader_research_experiments_v1 (spec_sha256, organization_id, family_size, spec_canonical_json)
      VALUES (${wrongOrgIdentity.specSha256}, ${organizationB}::uuid, ${wrongOrgIdentity.declaredFamilySize}, ${canonicalJsonString(wrongOrgIdentity.spec)})
    `).rejects.toMatchObject({ code: "23514" });

    const familyConflict = buildResearchExperimentProposalV1(organizationA, "family-size-conflict");
    const conflictIdentity = researchExperimentIdentityV1(familyConflict);
    await ownerSql`
      INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
      VALUES (${conflictIdentity.specSha256}, ${conflictIdentity.declaredFamilySize - 1})
    `;
    await expect(registerResearchExperimentPostgresV1(
      db,
      requireOrgContext(organizationA),
      familyConflict,
    )).rejects.toThrow(/family_size_mismatch/);
    expect(await counts(conflictIdentity.specSha256, conflictIdentity.declaredFamilySize)).toEqual({
      experiments: 0,
      families: 0,
    });
    const conflictingFamily = await ownerSql<{ family_size: number }[]>`
      SELECT family_size FROM trader_strategy_admission_family WHERE spec_sha256 = ${conflictIdentity.specSha256}
    `;
    expect(conflictingFamily).toEqual([{ family_size: conflictIdentity.declaredFamilySize - 1 }]);
  });

  it("uses database time instead of a caller-supplied backdated timestamp", async () => {
    const proposal = buildResearchExperimentProposalV1(organizationA, "database-registration-time");
    const identity = researchExperimentIdentityV1(proposal);
    await ownerSql`
      INSERT INTO trader_strategy_admission_family (spec_sha256, family_size)
      VALUES (${identity.specSha256}, ${identity.declaredFamilySize})
    `;
    const canonical = canonicalJsonString(identity.spec);
    await ownerSql`
      INSERT INTO trader_research_experiments_v1
        (spec_sha256, organization_id, family_size, spec_canonical_json, registered_at)
      VALUES
        (${identity.specSha256}, ${organizationA}::uuid, ${identity.declaredFamilySize}, ${canonical}, '2000-01-01T00:00:00Z'::timestamptz)
    `;
    const rows = await witnessSql<{ registered_at: Date }[]>`
      SELECT registered_at FROM trader_research_experiments_v1 WHERE spec_sha256 = ${identity.specSha256}
    `;
    expect(rows[0]?.registered_at.getTime()).toBeGreaterThan(Date.UTC(2020, 0, 1));
  });
});
