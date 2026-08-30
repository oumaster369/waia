import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteRuntimeControlLeaseRepositoryV2 } from "@/lib/trader/runtime-authority/v2";

const databases: Database.Database[] = [];
const digest = (character: string) => character.repeat(64);

function openDb() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE organizations (id text PRIMARY KEY);
    INSERT INTO organizations VALUES ('org-a'), ('org-b');
    CREATE TABLE trader_runtime_control_lease_heads_v2 (
      organization_id text PRIMARY KEY, runtime_instance_id text NOT NULL, lease_epoch integer NOT NULL,
      content_digest text NOT NULL, valid_until_utc text NOT NULL, updated_at integer NOT NULL);
    CREATE TABLE trader_runtime_control_lease_epoch_history_v2 (
      content_digest text PRIMARY KEY, organization_id text NOT NULL, runtime_instance_id text NOT NULL,
      lease_epoch integer NOT NULL, prior_content_digest text, valid_until_utc text NOT NULL,
      adjudicated_at_utc text NOT NULL, created_at integer NOT NULL,
      UNIQUE (organization_id, lease_epoch));
    CREATE TRIGGER history_update_guard BEFORE UPDATE ON trader_runtime_control_lease_epoch_history_v2
      BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
    CREATE TRIGGER history_delete_guard BEFORE DELETE ON trader_runtime_control_lease_epoch_history_v2
      BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
  `);
  return sqlite;
}

function claim(runtimeInstanceId: string, leaseContentDigest: string, organizationId = "org-a") {
  return { organizationId, runtimeInstanceId, leaseEpoch: 1, leaseContentDigest,
    validUntilUtc: "2026-08-30T04:00:00.000Z", adjudicatedAtUtc: "2026-08-30T03:00:00.000Z",
    expectedPreviousDigest: null } as const;
}

afterEach(() => { while (databases.length) databases.pop()!.close(); });

describe("SQLite Runtime Authority lease CAS", () => {
  it("has one winner under 8-way contention and isolates tenants", async () => {
    const repository = createSqliteRuntimeControlLeaseRepositoryV2(openDb());
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      repository.claimExclusive(claim(`runtime-${index}`, digest(index.toString(16))))));
    expect(outcomes.filter((outcome) => outcome === "CLAIMED")).toHaveLength(1);
    expect(await repository.current("org-b")).toBeNull();
    expect(await repository.claimExclusive(claim("runtime-b", digest("f"), "org-b"))).toBe("CLAIMED");
  });

  it("rolls history back if the process fails between history and head", async () => {
    const sqlite = openDb();
    const repository = createSqliteRuntimeControlLeaseRepositoryV2(sqlite, { afterHistoryInsert: () => {
      throw new Error("SIMULATED_CRASH");
    } });
    await expect(repository.claimExclusive(claim("runtime-a", digest("a")))).rejects.toThrow("SIMULATED_CRASH");
    expect(sqlite.prepare("SELECT count(*) AS n FROM trader_runtime_control_lease_epoch_history_v2").get()).toEqual({ n: 0 });
    expect(await repository.current("org-a")).toBeNull();
  });

  it("survives repository restart and rejects stale, expired, skipped-epoch and ABA claims", async () => {
    const sqlite = openDb();
    const first = claim("runtime-a", digest("a"));
    expect(await createSqliteRuntimeControlLeaseRepositoryV2(sqlite).claimExclusive(first)).toBe("CLAIMED");
    const restarted = createSqliteRuntimeControlLeaseRepositoryV2(sqlite);
    await expect(restarted.assertCurrentHolder({ ...first, adjudicatedAtUtc: "2026-08-30T04:00:00.001Z" }))
      .rejects.toThrow("STALE_HOLDER");
    expect(await restarted.claimExclusive({ ...first, runtimeInstanceId: "runtime-b", leaseEpoch: 3,
      leaseContentDigest: digest("b"), expectedPreviousDigest: digest("a"),
      adjudicatedAtUtc: "2026-08-30T04:00:00.001Z", validUntilUtc: "2026-08-30T05:00:00.000Z" })).toBe("CONFLICT");
    const second = { ...first, runtimeInstanceId: "runtime-b", leaseEpoch: 2,
      leaseContentDigest: digest("b"), expectedPreviousDigest: digest("a"),
      adjudicatedAtUtc: "2026-08-30T04:00:00.001Z", validUntilUtc: "2026-08-30T05:00:00.000Z" } as const;
    expect(await restarted.claimExclusive(second)).toBe("CLAIMED");
    expect(await restarted.claimExclusive({ ...second, runtimeInstanceId: "runtime-a", leaseEpoch: 3,
      leaseContentDigest: digest("a"), expectedPreviousDigest: digest("a"),
      adjudicatedAtUtc: "2026-08-30T05:00:00.001Z", validUntilUtc: "2026-08-30T06:00:00.000Z" })).toBe("CONFLICT");
    await expect(restarted.assertCurrentHolder({ ...first, adjudicatedAtUtc: second.adjudicatedAtUtc }))
      .rejects.toThrow("STALE_HOLDER");
  });
});
