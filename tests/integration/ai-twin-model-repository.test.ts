import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTwinRepository } from "@/lib/ai-twin/model/postgres-repository";
import type {
  ModelContext,
  ModelConsentGrant,
  ObserveCommand,
  ProposeCommand,
  CorrectCommand,
} from "@/lib/ai-twin/model/contracts";

// Explicit opt-in must fail on bad identity, never silently skip or read ambient DB URLs.
const enabled = process.env.WAIA_TWIN_PG_FIXTURE === "1";
const scope = { organizationId: "fixture-org-a", subjectId: "fixture-human-a" };
const now = "2026-09-08T12:00:00.000Z";
type Context = Omit<ModelContext, "grants">;
const human: Context = {
  scope,
  purpose: "formation",
  now,
  actor: { kind: "human", subjectId: scope.subjectId },
};
const model: Context = { ...human, actor: { ...human.actor, kind: "model" } };
const grant: ModelConsentGrant = {
  id: "grant-a",
  version: 1,
  scope,
  purpose: "formation",
  sources: ["dialogue", "diary"],
  mode: "private_modelling",
  issuedAt: now,
  expiresAt: "2027-09-08T12:00:00.000Z",
  revokedAt: null,
  retentionPolicyId: "human-approved-2026-09-08/v1",
};
const observe = (id: string): ObserveCommand => ({
  kind: "observe",
  scope,
  requestId: `observe-${id}`,
  id,
  grant: { id: grant.id, version: 1 },
  source: "dialogue",
  eventTime: now,
  context: "Synthetic planning",
  text: "I chose a quiet walk",
  projectionRisks: ["missing_context"],
});
const propose = (id: string): ProposeCommand => ({
  kind: "propose",
  scope,
  requestId: `propose-${id}`,
  claimId: `claim-${id}`,
  statement: "May prefer quiet plans",
  domain: "preferences",
  context: "Weekend only",
  uncertainty: "One self-report",
  observationIds: [id],
});
const correct = (id: string, suffix = "a"): CorrectCommand => ({
  kind: "correct",
  scope,
  requestId: `correct-${id}-${suffix}`,
  id: `correction-${id}-${suffix}`,
  claimId: `claim-${id}`,
  expectedRevision: 1,
  action: "correct",
  reason: "Human context",
  statement: "I wanted quiet only that weekend",
  context: "Not a stable general preference",
});

describe.skipIf(!enabled)(
  "AI-TWIN dedicated PostgreSQL fixture (not runtime/backup qualification)",
  () => {
    let owner: postgres.Sql;
    let service: postgres.Sql;
    let second: postgres.Sql;
    let repo: ReturnType<typeof createIsolatedTwinRepository>;
    let reopened: ReturnType<typeof createIsolatedTwinRepository>;
    beforeAll(async () => {
      const raw = process.env.WAIA_TWIN_PG_FIXTURE_URL;
      const token = process.env.WAIA_TWIN_PG_FIXTURE_TOKEN;
      const port = process.env.WAIA_TWIN_PG_FIXTURE_PORT;
      const container = process.env.WAIA_TWIN_PG_FIXTURE_CONTAINER;
      if (!raw || !token || !/^\w{64}$/.test(container ?? "") || !port)
        throw new Error("Explicit fixture identity required");
      const url = new URL(raw);
      if (
        url.protocol !== "postgres:" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== port ||
        url.pathname !== "/waia_twin_fixture_20260908" ||
        url.username !== "waia_twin_fixture_owner" ||
        url.search ||
        url.hash
      )
        throw new Error("Fixture URL mismatch");
      owner = postgres(raw, { max: 1, connect_timeout: 3, onnotice: () => {} });
      const [identity] =
        await owner`select current_database() as db, current_user as role, current_setting('waia.fixture_token', true) as token`;
      if (
        identity.db !== "waia_twin_fixture_20260908" ||
        identity.role !== "waia_twin_fixture_owner" ||
        identity.token !== token
      )
        throw new Error("Fixture marker mismatch");
      // No DROP/TRUNCATE/reuse: a non-empty prior fixture fails setup and is not overwritten.
      await owner.unsafe(
        readFileSync(new URL("../fixtures/ai-twin-model-repository.sql", import.meta.url), "utf8"),
      );
      await owner`insert into twin_model_fixture.scope_lock values (${scope.organizationId}, ${scope.subjectId})`;
      await owner`insert into twin_model_fixture.consent values (${scope.organizationId}, ${scope.subjectId}, ${grant.id}, ${grant.version}, ${owner.json(grant)})`;
      url.username = "twin_fixture_service";
      service = postgres(url.toString(), { max: 2, connect_timeout: 3, onnotice: () => {} });
      second = postgres(url.toString(), { max: 2, connect_timeout: 3, onnotice: () => {} });
      repo = createIsolatedTwinRepository(service);
      reopened = createIsolatedTwinRepository(second);
    });
    afterAll(async () => {
      await Promise.all(
        [owner, service, second].filter(Boolean).map((sql) => sql.end({ timeout: 2 })),
      );
    });

    it("persists source, proposed claim and explicit correction across separate connections", async () => {
      await repo.apply(human, observe("history"));
      await repo.apply(model, propose("history"));
      await repo.apply(human, correct("history"));
      const history = await reopened.history(human);
      expect(
        history.claims.filter((x) => x.claimId === "claim-history").map((x) => x.revision),
      ).toEqual([1, 2]);
      expect(history.observations.find((x) => x.id === "history")?.text).toBe(
        "I chose a quiet walk",
      );
      expect(
        (await reopened.current(human)).find((x) => x.claimId === "claim-history")?.basis,
      ).toBe("human_endorsed");
    });
    it("rejects conflicting retries and stale concurrent Human corrections", async () => {
      await repo.apply(human, observe("race"));
      await repo.apply(model, propose("race"));
      await expect(repo.apply(human, { ...observe("race"), text: "different" })).rejects.toThrow(
        "REPLAY_CONFLICT",
      );
      const results = await Promise.allSettled([
        repo.apply(human, correct("race", "a")),
        reopened.apply(human, correct("race", "b")),
      ]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    });
    it.each(["organizationId", "subjectId"] as const)(
      "isolates %s on reads, writes and rights requests",
      async (key) => {
        const foreign = { ...human, scope: { ...scope, [key]: "another" } };
        foreign.actor = { kind: "human", subjectId: foreign.scope.subjectId };
        expect(await reopened.current(foreign)).toEqual([]);
        await expect(repo.apply(foreign, observe("history"))).rejects.toThrow("SCOPE_MISMATCH");
        await expect(
          repo.withdraw(foreign, "history", `foreign-${key}`, "withdraw_modelling"),
        ).rejects.toThrow("SOURCE_UNAVAILABLE");
      },
    );
    it("immediately restricts use and denies replay before physical erasure", async () => {
      await repo.apply(human, observe("erase"));
      await repo.apply(model, propose("erase"));
      await repo.apply(human, correct("erase"));
      await repo.withdraw(human, "erase", "rights-erase", "withdraw_modelling");
      expect((await reopened.current(human)).some((x) => x.claimId === "claim-erase")).toBe(false);
      await expect(repo.apply(human, observe("erase"))).rejects.toThrow("SOURCE_RESTRICTED");
      await expect(repo.apply(model, propose("erase"))).rejects.toThrow("EVIDENCE_UNAVAILABLE");
      const raw =
        await owner`select count(*)::int as n from twin_model_fixture.object where id='erase'`;
      expect(raw[0].n).toBe(1); // restriction is not a false physical-deletion claim
      await repo.erase(human, "rights-erase");
      const gone =
        await owner`select count(*)::int as n from twin_model_fixture.object where id in ('erase','claim-erase','correction-erase-a')`;
      expect(gone[0].n).toBe(0);
      await expect(repo.apply(human, observe("erase"))).rejects.toThrow("SOURCE_RESTRICTED");
    });
    it("denies model authority for Human rights operations", async () => {
      await expect(
        repo.withdraw(model, "history", "model-rights", "delete_source"),
      ).rejects.toThrow("HUMAN_REQUIRED");
    });
    it("does not grant browser or app service unscoped infrastructure privileges", async () => {
      await expect(
        service`update twin_model_fixture.object set payload='{}'::jsonb`,
      ).rejects.toThrow();
      await owner.begin(async (sql) => {
        await sql`set local role twin_fixture_browser`;
        await expect(sql`select * from twin_model_fixture.object`).rejects.toThrow();
      });
    });
  },
);
