/** DEE-1159 durable attempt identity and per-trial ledger scope proof. */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  loadResearchTrainingLedgerScopePostgresV1,
  registerResearchAttemptPostgresV1,
} from "@/lib/trader/research/research-attempt-registry-postgres-v1";
import { researchExperimentIdentityV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!enabled || !url)("DEE-1159 Postgres research attempt registry v1", () => {
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

  async function registerExperiment(label: string, orgId = organizationA) {
    const proposal = buildResearchExperimentProposalV1(orgId, label);
    const registered = await registerResearchExperimentPostgresV1(db, requireOrgContext(orgId), proposal);
    return { proposal, registered, identity: researchExperimentIdentityV1(proposal), sourceRunId: `source-${randomUUID()}` };
  }

  async function attemptCount(orgId: string, commandId: string): Promise<number> {
    const rows = await witnessSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trader_research_attempts_v1
      WHERE organization_id = ${orgId}::uuid AND command_id = ${commandId}
    `;
    return rows[0]!.count;
  }

  beforeAll(async () => {
    ownerSql = postgres(url!, { max: 4, prepare: false });
    witnessSql = postgres(url!, { max: 3, prepare: false });
    db = drizzle(ownerSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    secondDb = drizzle(postgres(url!, { max: 3, prepare: false }), { schema: pgSchema }) as unknown as WaiaPostgresDb;
    organizationA = await seedOrganization("DEE-1159 attempt registry A");
    organizationB = await seedOrganization("DEE-1159 attempt registry B");
  }, 30_000);

  afterAll(async () => {
    await Promise.all([
      ownerSql?.end({ timeout: 5 }),
      witnessSql?.end({ timeout: 5 }),
      (secondDb as unknown as { $client?: postgres.Sql } | undefined)?.$client?.end({ timeout: 5 }),
    ]);
  }, 15_000);

  it("commits before returning and converges concurrent exact command retries", async () => {
    const { identity, sourceRunId } = await registerExperiment("attempt-commit-witness");
    const context = requireOrgContext(organizationA);
    const command = { specSha256: identity.specSha256, sourceRunId, commandId: `attempt-${randomUUID()}` };
    const target = db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
    const original = target.transaction;
    let rowVisibleBeforeReturn = false;
    target.transaction = async (...args: unknown[]) => {
      const result = await original.apply(db, args);
      rowVisibleBeforeReturn = (await attemptCount(organizationA, command.commandId)) === 1;
      return result;
    };
    let first: Awaited<ReturnType<typeof registerResearchAttemptPostgresV1>>;
    try {
      const results = await Promise.all([
        registerResearchAttemptPostgresV1(db, context, command),
        registerResearchAttemptPostgresV1(secondDb, context, command),
      ]);
      first = results[0]!;
    } finally {
      target.transaction = original;
    }
    const second = await registerResearchAttemptPostgresV1(secondDb, context, command);
    const witnessed = await witnessSql<{ id: string; spec_sha256: string }[]>`
      SELECT id, spec_sha256 FROM trader_research_attempts_v1
      WHERE organization_id = ${organizationA}::uuid AND command_id = ${command.commandId}
    `;
    expect(rowVisibleBeforeReturn).toBe(true);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ authority: "ATTEMPT_IDENTITY_ONLY", organizationId: organizationA,
      specSha256: identity.specSha256, commandId: command.commandId });
    expect(witnessed).toEqual([{ id: first.id, spec_sha256: identity.specSha256 }]);
    expect(await attemptCount(organizationA, command.commandId)).toBe(1);
  });

  it("refuses a changed spec for the same command and rejects an unregistered proposal", async () => {
    const first = await registerExperiment("attempt-command-conflict-original");
    const changed = await registerExperiment("attempt-command-conflict-changed");
    const commandId = `attempt-conflict-${randomUUID()}`;
    const context = requireOrgContext(organizationA);
    await registerResearchAttemptPostgresV1(db, context, {
      specSha256: first.identity.specSha256, sourceRunId: first.sourceRunId, commandId,
    });
    await expect(registerResearchAttemptPostgresV1(db, context, {
      specSha256: changed.identity.specSha256, sourceRunId: first.sourceRunId, commandId,
    })).rejects.toThrow("RESEARCH_ATTEMPT_COMMAND_CONFLICT");
    await expect(registerResearchAttemptPostgresV1(db, context, {
      specSha256: first.identity.specSha256, sourceRunId: `${first.sourceRunId}-other`, commandId,
    })).rejects.toThrow("RESEARCH_ATTEMPT_COMMAND_CONFLICT");
    expect(await attemptCount(organizationA, commandId)).toBe(1);

    const missingCommand = `attempt-unregistered-${randomUUID()}`;
    await expect(registerResearchAttemptPostgresV1(db, context, {
      specSha256: "f".repeat(64), sourceRunId: `missing-${randomUUID()}`, commandId: missingCommand,
    })).rejects.toThrow("RESEARCH_EXPERIMENT_NOT_REGISTERED");
    expect(await attemptCount(organizationA, missingCommand)).toBe(0);
  });

  it("enforces the exact ASCII command key and 128-character protocol bound in JS and SQL", async () => {
    const { identity, sourceRunId } = await registerExperiment("attempt-command-key-validation");
    const context = requireOrgContext(organizationA);
    const maxCommand = `a${"b".repeat(127)}`;
    await expect(registerResearchAttemptPostgresV1(db, context, {
      specSha256: identity.specSha256, sourceRunId, commandId: maxCommand,
    })).resolves.toMatchObject({ commandId: maxCommand });

    for (const commandId of ["a".repeat(129), "bad\tkey", "bad\u00a0key", "bad\n"]) {
      await expect(registerResearchAttemptPostgresV1(db, context, {
        specSha256: identity.specSha256, sourceRunId, commandId,
      })).rejects.toThrow();
    }

    for (const commandId of ["bad\tkey", "bad\u00a0key", "bad\n"]) {
      await expect(ownerSql`
        INSERT INTO trader_research_attempts_v1 (organization_id, spec_sha256, source_run_id, command_id)
        VALUES (${organizationA}::uuid, ${identity.specSha256}, ${sourceRunId}, ${commandId})
      `).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("captures command and organization before awaiting registry reads", async () => {
    const { identity, sourceRunId } = await registerExperiment("attempt-input-capture");
    const input: { specSha256: string; sourceRunId: string; commandId: string } = {
      specSha256: identity.specSha256, sourceRunId, commandId: `attempt-captured-${randomUUID()}`,
    };
    const mutableContext = { organizationId: organizationA } as OrgContext;
    const pending = registerResearchAttemptPostgresV1(db, mutableContext, input);
    input.commandId = `attempt-mutated-${randomUUID()}`;
    input.specSha256 = "f".repeat(64);
    input.sourceRunId = `mutated-${randomUUID()}`;
    (mutableContext as unknown as { organizationId: string }).organizationId = organizationB;
    const result = await pending;
    expect(result.organizationId).toBe(organizationA);
    expect(result.commandId).not.toBe(input.commandId);
    expect(result.specSha256).toBe(identity.specSha256);
    expect(result.sourceRunId).toBe(sourceRunId);
    expect(await attemptCount(organizationA, result.commandId)).toBe(1);
    expect(await attemptCount(organizationB, input.commandId)).toBe(0);
  });

  it("isolates same command IDs across organizations and keeps attempts tenant-bound", async () => {
    const a = await registerExperiment("attempt-cross-tenant-A", organizationA);
    const b = await registerExperiment("attempt-cross-tenant-B", organizationB);
    const commandId = `shared-command-${randomUUID()}`;
    const [attemptA, attemptB] = await Promise.all([
      registerResearchAttemptPostgresV1(db, requireOrgContext(organizationA), {
        specSha256: a.identity.specSha256, sourceRunId: a.sourceRunId, commandId,
      }),
      registerResearchAttemptPostgresV1(secondDb, requireOrgContext(organizationB), {
        specSha256: b.identity.specSha256, sourceRunId: b.sourceRunId, commandId,
      }),
    ]);
    expect(attemptA.id).not.toBe(attemptB.id);
    expect(await attemptCount(organizationA, commandId)).toBe(1);
    expect(await attemptCount(organizationB, commandId)).toBe(1);
    await expect(loadResearchTrainingLedgerScopePostgresV1(db, requireOrgContext(organizationB), {
      attemptId: attemptA.id, trialIndex: 0,
    })).rejects.toThrow("RESEARCH_ATTEMPT_NOT_REGISTERED");
    await expect(loadResearchTrainingLedgerScopePostgresV1(db, requireOrgContext(organizationA), {
      attemptId: randomUUID(), trialIndex: 0,
    })).rejects.toThrow("RESEARCH_ATTEMPT_NOT_REGISTERED");
  });

  it("refuses nested/savepoint adapters before reads or writes", async () => {
    const { identity, sourceRunId } = await registerExperiment("attempt-root-only");
    const commandId = `attempt-root-only-${randomUUID()}`;
    const before = await attemptCount(organizationA, commandId);
    await db.transaction(async tx => {
      const select = vi.spyOn(tx, "select");
      const insert = vi.spyOn(tx, "insert");
      await expect(registerResearchAttemptPostgresV1(tx as unknown as WaiaPostgresDb,
        requireOrgContext(organizationA), { specSha256: identity.specSha256, sourceRunId, commandId }))
        .rejects.toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
      await expect(loadResearchTrainingLedgerScopePostgresV1(tx as unknown as WaiaPostgresDb,
        requireOrgContext(organizationA), { attemptId: randomUUID(), trialIndex: 0 }))
        .rejects.toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
      expect(select).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });
    expect(await attemptCount(organizationA, commandId)).toBe(before);
  });

  it("derives stable, separate declared-trial scopes per attempt and bounds trial selection", async () => {
    const { identity, registered, sourceRunId } = await registerExperiment("attempt-trial-scopes");
    const context = requireOrgContext(organizationA);
    const firstAttempt = await registerResearchAttemptPostgresV1(db, context, {
      specSha256: identity.specSha256, sourceRunId, commandId: `trial-attempt-one-${randomUUID()}`,
    });
    const secondAttempt = await registerResearchAttemptPostgresV1(secondDb, context, {
      specSha256: identity.specSha256, sourceRunId, commandId: `trial-attempt-two-${randomUUID()}`,
    });
    const firstTrial = await loadResearchTrainingLedgerScopePostgresV1(db, context, {
      attemptId: firstAttempt.id, trialIndex: 0,
    });
    const retry = await loadResearchTrainingLedgerScopePostgresV1(secondDb, context, {
      attemptId: firstAttempt.id, trialIndex: 0,
    });
    const otherTrial = await loadResearchTrainingLedgerScopePostgresV1(db, context, {
      attemptId: firstAttempt.id, trialIndex: 1,
    });
    const otherAttempt = await loadResearchTrainingLedgerScopePostgresV1(db, context, {
      attemptId: secondAttempt.id, trialIndex: 0,
    });
    expect(firstTrial).toEqual(retry);
    expect(firstTrial.authority).toBe("ROW_SCOPE_ONLY");
    expect(firstTrial.identity.parameters).toEqual(registered.spec.orderedTrials[0]);
    expect(firstTrial.identity.partitionSha256).toBe(registered.spec.partitions.train.contentSha256);
    expect(otherTrial.identity.trialIndex).toBe(1);
    expect(new Set([firstTrial.identity.attemptId, otherAttempt.identity.attemptId]).size).toBe(2);
    expect(new Set([firstTrial.ledgerScope.historicalRunId, otherTrial.ledgerScope.historicalRunId,
      otherAttempt.ledgerScope.historicalRunId]).size).toBe(3);
    expect(new Set([firstTrial.ledgerScope.historicalAccountKey, otherTrial.ledgerScope.historicalAccountKey,
      otherAttempt.ledgerScope.historicalAccountKey]).size).toBe(3);
    await expect(loadResearchTrainingLedgerScopePostgresV1(db, context, {
      attemptId: firstAttempt.id, trialIndex: registered.spec.orderedTrials.length,
    })).rejects.toThrow("RESEARCH_TRIAL_NOT_DECLARED");
    await expect(loadResearchTrainingLedgerScopePostgresV1(db, context, {
      attemptId: firstAttempt.id, trialIndex: -1,
    })).rejects.toThrow();
  });

  it("uses database registration time, append-only guards, and browser-role denial", async () => {
    const { identity, sourceRunId } = await registerExperiment("attempt-db-guards");
    const context = requireOrgContext(organizationA);
    const commandId = `attempt-db-clock-${randomUUID()}`;
    const inserted = await registerResearchAttemptPostgresV1(db, context, {
      specSha256: identity.specSha256, sourceRunId, commandId,
    });
    expect(Date.parse(inserted.registeredAt)).toBeGreaterThan(Date.UTC(2020, 0, 1));

    const rawCommand = `raw-db-clock-${randomUUID()}`;
    await ownerSql`
      INSERT INTO trader_research_attempts_v1 (organization_id, spec_sha256, source_run_id, command_id, registered_at)
      VALUES (${organizationA}::uuid, ${identity.specSha256}, ${sourceRunId}, ${rawCommand}, '2000-01-01T00:00:00Z'::timestamptz)
    `;
    const rawRow = await witnessSql<{ registered_at: Date }[]>`
      SELECT registered_at FROM trader_research_attempts_v1
      WHERE organization_id = ${organizationA}::uuid AND command_id = ${rawCommand}
    `;
    expect(rawRow[0]?.registered_at.getTime()).toBeGreaterThan(Date.UTC(2020, 0, 1));

    await expect(ownerSql`
      UPDATE trader_research_attempts_v1 SET registered_at = registered_at + interval '1 day'
      WHERE organization_id = ${organizationA}::uuid AND command_id = ${commandId}
    `).rejects.toThrow("append-only discovery admission store");
    await expect(ownerSql`
      DELETE FROM trader_research_attempts_v1
      WHERE organization_id = ${organizationA}::uuid AND command_id = ${commandId}
    `).rejects.toThrow("append-only discovery admission store");
    await expect(ownerSql.begin(async tx => { await tx`TRUNCATE TABLE trader_research_attempts_v1`; }))
      .rejects.toThrow("append-only discovery admission store");

    for (const role of ["authenticated", "anon"] as const) {
      await expect(ownerSql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT id FROM trader_research_attempts_v1 WHERE id = ${inserted.id}::uuid`;
      })).rejects.toMatchObject({ code: "42501" });
      await expect(ownerSql.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`INSERT INTO trader_research_attempts_v1 (organization_id, spec_sha256, source_run_id, command_id)
          VALUES (${organizationA}::uuid, ${identity.specSha256}, ${sourceRunId}, ${`browser-${role}-${randomUUID()}`})`;
      })).rejects.toMatchObject({ code: "42501" });
    }
  });
});
