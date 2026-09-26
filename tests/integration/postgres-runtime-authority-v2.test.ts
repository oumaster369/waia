import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { buildRuntimeAuthorityAssessmentV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-assessment-v2";
import {
  createPostgresRuntimeAuthorityAssessmentRepositoryV2,
  createPostgresRuntimeAuthorityStartupWriterV2,
  createPostgresRuntimeControlLeaseRepositoryV2,
} from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2";
import type { RuntimeControlLeaseClaimV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-v2";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// These are deterministic trusted adjudication inputs, not a deployed wall-clock proof.
const AT = "2026-08-30T03:00:00.000Z";
const UNTIL = "2026-08-30T04:00:00.000Z";
const AFTER = "2026-08-30T04:00:00.001Z";

function postgresCause(error: unknown): { code?: string; constraint_name?: string } {
  let value = error as { code?: string; constraint_name?: string; cause?: unknown };
  while (value.cause) value = value.cause as typeof value;
  return value;
}

describe.skipIf(!enabled)("Postgres Runtime Authority lease and startup persistence", () => {
  let client: postgres.Sql;
  let db: WaiaPostgresDb;
  let organizationId: string;
  const context = () => ({ organizationId });
  const leases = () => createPostgresRuntimeControlLeaseRepositoryV2(db);
  const writer = () => createPostgresRuntimeAuthorityStartupWriterV2(db);
  const reads = () => createPostgresRuntimeAuthorityAssessmentRepositoryV2(db);

  beforeAll(() => {
    if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(new URL(url!).hostname)) {
      throw new Error("RUNTIME_AUTHORITY_TEST_REQUIRES_LOOPBACK_POSTGRES");
    }
    client = postgres(url!, { max: 2 });
    db = drizzle(client, { schema });
  });
  beforeEach(async () => {
    organizationId = await seedWp13User(url!, randomUUID(), "Runtime Authority test");
  });
  afterAll(async () => { await client?.end({ timeout: 5 }); });

  function claim(patch: Partial<RuntimeControlLeaseClaimV2> = {}): RuntimeControlLeaseClaimV2 {
    return {
      organizationId, runtimeInstanceId: `runtime-${organizationId}`, leaseEpoch: 1,
      leaseContentDigest: digest(`${organizationId}:lease:1`), expectedPreviousDigest: null,
      adjudicatedAtUtc: AT, validUntilUtc: UNTIL, ...patch,
    };
  }
  function assessment(value = claim()) {
    return buildRuntimeAuthorityAssessmentV2({
      organizationId: value.organizationId, runtimeInstanceId: value.runtimeInstanceId,
      releaseId: "synthetic-release", releaseContentDigest: digest("synthetic-release"),
      realityFrontierId: "synthetic-frontier", realityContentDigest: digest("synthetic-frontier"),
      controlLeaseEpoch: value.leaseEpoch, controlLeaseContentDigest: value.leaseContentDigest,
      adjudicatedAtUtc: value.adjudicatedAtUtc,
      evidence: { realityRebuildComplete: true, executionUncertaintyResolved: true,
        guardianCoverageComplete: true, allowancesValid: true, releaseIdentityValid: true,
        promotionIdentityValid: true, credentialsReady: true, persistenceReady: true,
        exclusiveControlLeaseValid: true },
    });
  }
  async function history() {
    return client`SELECT * FROM trader_runtime_control_lease_epoch_history_v2
      WHERE organization_id = ${organizationId}::uuid ORDER BY lease_epoch`;
  }

  it("has one winner under observed eight-connection advisory-lock contention", async () => {
    const gate = postgres(url!, { max: 1 });
    const contenders = Array.from({ length: 8 }, () => postgres(url!, { max: 1 }));
    let pending: Promise<string[]> | undefined;
    let released = false;
    try {
      const pids = await Promise.all(contenders.map(async (connection) =>
        (await connection<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid));
      expect(new Set(pids).size).toBe(8);
      await gate`BEGIN`;
      await gate`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 637))`;
      pending = Promise.all(contenders.map((connection, index) =>
        createPostgresRuntimeControlLeaseRepositoryV2(drizzle(connection, { schema }))
          .claimExclusive(claim({ runtimeInstanceId: `runtime-${index}`,
            leaseContentDigest: digest(`${organizationId}:${index}`) }))));
      let blocked = 0;
      try {
        for (let attempt = 0; attempt < 200; attempt++) {
          const rows = await client<{ count: number }[]>`SELECT count(*)::int AS count
            FROM pg_stat_activity WHERE pid = ANY(${pids}::int[]) AND wait_event = 'advisory'`;
          blocked = rows[0]!.count;
          if (blocked === 8) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally { await gate`ROLLBACK`; released = true; }
      const outcomes = await pending;
      expect(blocked).toBe(8);
      expect(outcomes.filter((outcome) => outcome === "CLAIMED")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "CONFLICT")).toHaveLength(7);
      expect(await history()).toHaveLength(1);
      expect(await leases().current(organizationId)).toMatchObject({ leaseEpoch: 1 });
    } finally {
      if (!released) await gate`ROLLBACK`.catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      await Promise.all([...contenders, gate].map((connection) => connection.end({ timeout: 5 })));
    }
  });

  it("reads the same lease and assessment after reconnect and isolates tenant reads", async () => {
    const first = claim();
    await leases().claimExclusive(first);
    const value = assessment(first);
    await writer().commitAssessment(context(), value);
    const otherOrg = await seedWp13User(url!, randomUUID(), "Other Runtime tenant");
    const connection = postgres(url!, { max: 1 });
    try {
      const restarted = drizzle(connection, { schema });
      const read = createPostgresRuntimeAuthorityAssessmentRepositoryV2(restarted);
      await createPostgresRuntimeControlLeaseRepositoryV2(restarted).assertCurrentHolder(first);
      expect(await read.getById(context(), value.assessmentId)).toEqual(value);
      expect(await read.listByRuntime(context(), first.runtimeInstanceId)).toEqual([value]);
      expect(await read.getById({ organizationId: otherOrg }, value.assessmentId)).toBeNull();
      expect(await read.listByOrganization({ organizationId: otherOrg })).toEqual([]);
      expect(await leases().current(otherOrg)).toBeNull();
    } finally { await connection.end({ timeout: 5 }); }
  });

  it("requires expiry, next epoch and exact prior digest, then fences the old owner", async () => {
    const first = claim();
    await leases().claimExclusive(first);
    const next = claim({ runtimeInstanceId: "next-runtime", leaseEpoch: 2,
      leaseContentDigest: digest(`${organizationId}:lease:2`),
      expectedPreviousDigest: first.leaseContentDigest, adjudicatedAtUtc: AFTER,
      validUntilUtc: "2026-08-30T05:00:00.000Z" });
    for (const invalid of [
      { ...next, adjudicatedAtUtc: "2026-08-30T03:59:59.999Z" },
      { ...next, leaseEpoch: 3 }, { ...next, expectedPreviousDigest: digest("wrong") },
    ]) expect(await leases().claimExclusive(invalid)).toBe("CONFLICT");
    expect(await leases().claimExclusive(next)).toBe("CLAIMED");
    await expect(leases().assertCurrentHolder({ ...first, adjudicatedAtUtc: AFTER }))
      .rejects.toThrow("STALE_HOLDER");
    await expect(leases().assertCurrentHolder({ ...next, adjudicatedAtUtc: "2026-08-30T05:00:00.001Z" }))
      .rejects.toThrow("STALE_HOLDER");
    await expect(writer().commitAssessment(context(), assessment(first))).rejects.toThrow("STALE_HOLDER");
    expect((await history()).map((row) => row.lease_epoch)).toEqual([1, 2]);
    expect(await reads().listByOrganization(context())).toEqual([]);
  });

  it("refuses every wrong startup-holder dimension before persisting an assessment", async () => {
    const first = claim();
    await leases().claimExclusive(first);
    await expect(writer().commitAssessment({ organizationId: randomUUID() }, assessment(first)))
      .rejects.toThrow("TENANT_MISMATCH");
    for (const invalid of [claim({ runtimeInstanceId: "wrong" }), claim({ leaseEpoch: 2 }),
      claim({ leaseContentDigest: digest("wrong") }), claim({ adjudicatedAtUtc: AFTER })]) {
      await expect(writer().commitAssessment(context(), assessment(invalid))).rejects.toThrow("STALE_HOLDER");
    }
    expect(await reads().listByOrganization(context())).toEqual([]);
    expect(await writer().commitAssessment(context(), assessment(first))).toEqual(assessment(first));
  });

  it("replays identical assessment bytes once and refuses forged content and the unfenced writer", async () => {
    await leases().claimExclusive(claim());
    const value = assessment();
    await writer().commitAssessment(context(), value);
    await writer().commitAssessment(context(), JSON.parse(JSON.stringify(value)));
    await expect(writer().commitAssessment(context(), { ...value, posture: "HALT" }))
      .rejects.toThrow("DERIVATION_MISMATCH");
    await expect(writer().commitAssessment(context(), { ...value, releaseId: "changed" }))
      .rejects.toThrow("DIGEST_MISMATCH");
    await expect(reads().append(context(), value)).rejects.toThrow("FENCED_STARTUP_WRITER");
    expect(await reads().listByOrganization(context())).toEqual([value]);
  });

  it("enforces append-only history and assessment using actual database triggers", async () => {
    await leases().claimExclusive(claim());
    await writer().commitAssessment(context(), assessment());
    for (const table of ["trader_runtime_control_lease_epoch_history_v2", "trader_runtime_authority_assessments_v2"]) {
      await expect(client.unsafe(`UPDATE ${table} SET runtime_instance_id = 'forged' WHERE organization_id = $1::uuid`, [organizationId]))
        .rejects.toThrow("RUNTIME_AUTHORITY_V2_APPEND_ONLY");
      await expect(client.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [organizationId]))
        .rejects.toThrow("RUNTIME_AUTHORITY_V2_APPEND_ONLY");
    }
    expect(await history()).toHaveLength(1);
    expect(await reads().listByOrganization(context())).toEqual([assessment()]);
  });

  it("refuses an existing assessment identity with conflicting stored bytes without overwriting it", async () => {
    await leases().claimExclusive(claim());
    const value = assessment();
    // Deliberately corrupt synthetic persistence; this is not an admitted assessment.
    await client`INSERT INTO trader_runtime_authority_assessments_v2
      (assessment_id, organization_id, runtime_instance_id, posture, content_digest, canonical_json, adjudicated_at_utc)
      VALUES (${value.assessmentId}, ${organizationId}::uuid, ${value.runtimeInstanceId}, ${value.posture},
        ${value.contentDigest}, '{}', ${value.adjudicatedAtUtc})`;
    await expect(writer().commitAssessment(context(), value)).rejects.toThrow("PERSISTENCE_CONFLICT");
    await expect(reads().getById(context(), value.assessmentId)).rejects.toThrow();
    const stored = await client`SELECT canonical_json FROM trader_runtime_authority_assessments_v2
      WHERE assessment_id = ${value.assessmentId}`;
    expect(stored).toEqual([{ canonical_json: "{}" }]);
  });

  it("rolls back history when the native head write fails, then permits a clean retry", async () => {
    let error: unknown;
    try {
      await db.transaction(async (tx) => {
        // Transactional DDL is local to this isolated test and rolls back with the failure.
        await tx.execute(sql.raw(`ALTER TABLE trader_runtime_control_lease_heads_v2
          ADD CONSTRAINT runtime_test_head_failure CHECK (organization_id <> '${organizationId}'::uuid) NOT VALID`));
        await createPostgresRuntimeControlLeaseRepositoryV2(tx).claimExclusive(claim());
      });
    } catch (caught) { error = caught; }
    expect(error).toBeDefined();
    expect(postgresCause(error)).toMatchObject({ code: "23514", constraint_name: "runtime_test_head_failure" });
    expect(await history()).toEqual([]);
    expect(await leases().current(organizationId)).toBeNull();
    expect(await leases().claimExclusive(claim())).toBe("CLAIMED");
    expect(await history()).toHaveLength(1);
  });

  it("preserves the lease and leaves no assessment on native insert failure, then retries once", async () => {
    await leases().claimExclusive(claim());
    const before = await leases().current(organizationId);
    let error: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`ALTER TABLE trader_runtime_authority_assessments_v2
          ADD CONSTRAINT runtime_test_assessment_failure CHECK (organization_id <> '${organizationId}'::uuid) NOT VALID`));
        await createPostgresRuntimeAuthorityStartupWriterV2(tx).commitAssessment(context(), assessment());
      });
    } catch (caught) { error = caught; }
    expect(error).toBeDefined();
    expect(postgresCause(error)).toMatchObject({ code: "23514", constraint_name: "runtime_test_assessment_failure" });
    expect(await reads().listByOrganization(context())).toEqual([]);
    expect(await leases().current(organizationId)).toEqual(before);
    await writer().commitAssessment(context(), assessment());
    expect(await reads().listByOrganization(context())).toEqual([assessment()]);
  });
});
