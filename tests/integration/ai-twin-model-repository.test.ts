import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTwinRepository } from "@/lib/ai-twin/model/postgres-repository";
import type { WorkingHypothesis } from "@/lib/ai-twin/model/persistence-contracts";
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
    let created = false;
    beforeAll(async () => {
      const raw = process.env.WAIA_TWIN_PG_FIXTURE_URL;
      const token = process.env.WAIA_TWIN_PG_FIXTURE_TOKEN;
      const port = process.env.WAIA_TWIN_PG_FIXTURE_PORT;
      const container = process.env.WAIA_TWIN_PG_FIXTURE_CONTAINER;
      if (!raw || !token || !/^[a-f0-9]{64}$/.test(container ?? "") || !port)
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
      created = true;
      await owner`insert into twin_model_fixture.scope_lock values (${scope.organizationId}, ${scope.subjectId})`;
      await owner`insert into twin_model_fixture.consent values (${scope.organizationId}, ${scope.subjectId}, ${grant.id}, ${grant.version}, ${owner.json(grant)})`;
      url.username = "twin_fixture_service";
      service = postgres(url.toString(), { max: 2, connect_timeout: 3, onnotice: () => {} });
      second = postgres(url.toString(), { max: 2, connect_timeout: 3, onnotice: () => {} });
      repo = createIsolatedTwinRepository(service);
      reopened = createIsolatedTwinRepository(second);
    });
    afterAll(async () => {
      await Promise.all([service, second].filter(Boolean).map((sql) => sql.end({ timeout: 2 })));
      try {
        if (created) {
          const [identity] =
            await owner`select current_database() as db, current_user as role, current_setting('waia.fixture_token', true) as token`;
          if (
            identity.db !== "waia_twin_fixture_20260908" ||
            identity.role !== "waia_twin_fixture_owner" ||
            identity.token !== process.env.WAIA_TWIN_PG_FIXTURE_TOKEN
          )
            throw new Error("Cleanup fixture marker mismatch");
          // Only the exact schema/roles created by THIS run, after identity revalidation.
          await owner.unsafe(
            "DROP SCHEMA twin_model_fixture CASCADE; DROP ROLE twin_fixture_service; DROP ROLE twin_fixture_browser;",
          );
        }
      } finally {
        await owner?.end({ timeout: 2 });
      }
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
    it("denies object UPDATE to the service and object SELECT to the browser role", async () => {
      await expect(
        service`update twin_model_fixture.object set payload='{}'::jsonb`,
      ).rejects.toThrow();
      await expect(
        owner.begin(async (sql) => {
          await sql`set local role twin_fixture_browser`;
          await sql`select * from twin_model_fixture.object`;
        }),
      ).rejects.toThrow();
    });
    it("rolls back partial writes and retains restriction across failed physical cleanup", async () => {
      await repo.apply(human, observe("rollback"));
      await repo.apply(model, propose("rollback"));
      await owner.unsafe(
        "CREATE FUNCTION twin_model_fixture.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' AND OLD.id='rollback' THEN RAISE EXCEPTION 'fixture_delete_failure'; END IF; IF TG_OP='INSERT' AND NEW.id='correction-rollback-a' THEN RAISE EXCEPTION 'fixture_insert_failure'; END IF; RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT OR DELETE ON twin_model_fixture.object FOR EACH ROW EXECUTE FUNCTION twin_model_fixture.inject_failure();",
      );
      try {
        await expect(repo.apply(human, correct("rollback"))).rejects.toThrow(
          "fixture_insert_failure",
        );
        expect(
          (await reopened.history(human)).claims
            .filter((c) => c.claimId === "claim-rollback")
            .map((c) => c.revision),
        ).toEqual([1]);
        await repo.withdraw(human, "rollback", "rights-rollback", "delete_source");
        await expect(repo.erase(human, "rights-rollback")).rejects.toThrow(
          "fixture_delete_failure",
        );
        expect((await reopened.current(human)).some((c) => c.claimId === "claim-rollback")).toBe(
          false,
        );
        const [pending] =
          await owner`select state from twin_model_fixture.rights_request where request_id='rights-rollback'`;
        expect(pending.state).toBe("restricted");
      } finally {
        await owner.unsafe(
          "DROP TRIGGER fixture_fail ON twin_model_fixture.object; DROP FUNCTION twin_model_fixture.inject_failure();",
        );
      }
      await repo.erase(human, "rights-rollback");
      await expect(repo.apply(human, observe("rollback"))).rejects.toThrow("SOURCE_RESTRICTED");
    });
    it("does not accept a replay after approved dialogue retention expires", async () => {
      const later = { ...human, now: "2026-12-07T12:00:00.000Z" };
      expect(await reopened.current(later)).toEqual([]);
      await expect(repo.apply(later, observe("history"))).rejects.toThrow("RETENTION_UNAVAILABLE");
    });
    it("rejects an unknown retention policy before storing a new observation", async () => {
      const bad = { ...grant, id: "unapproved-grant", retentionPolicyId: "unapproved-policy" };
      await owner`insert into twin_model_fixture.consent values (${scope.organizationId},${scope.subjectId},${bad.id},1,${owner.json(bad)})`;
      await expect(
        repo.apply(human, { ...observe("unknown-policy"), grant: { id: bad.id, version: 1 } }),
      ).rejects.toThrow("POLICY_UNAVAILABLE");
      expect(
        (
          await owner`select count(*)::int as n from twin_model_fixture.object where id='unknown-policy'`
        )[0].n,
      ).toBe(0);
    });
    it("persists competing interpretations with exact current evidence, and removes their dependent content", async () => {
      await repo.apply(human, observe("hypothesis-source"));
      const source = {
        ...scope,
        kind: "observation" as const,
        id: "hypothesis-source",
        version: 1,
      };
      const hypothesis: WorkingHypothesis = {
        ref: { ...scope, kind: "hypothesis", id: "hypothesis-a", version: 1 },
        purpose: model.purpose,
        createdAt: now,
        retentionPolicyId: grant.retentionPolicyId,
        context: "Synthetic weekend",
        domains: ["preferences"],
        alternatives: [
          {
            id: "one",
            statement: "May prefer quiet plans",
            support: [source],
            contradiction: [],
            uncertainty: "One observation",
            falsifier: "A contrary contextual report",
          },
          {
            id: "two",
            statement: "May be a temporary preference",
            support: [],
            contradiction: [source],
            uncertainty: "Alternatives unresolved",
            falsifier: "A consistent repeated preference",
          },
        ],
        validFrom: now,
        validUntil: null,
        lastSubstantialEvidenceAt: null,
        status: "proposed",
      };
      await expect(
        repo.proposeHypothesis(model, { ...hypothesis, purpose: "other-purpose" }, "wrong-purpose"),
      ).rejects.toThrow();
      await expect(
        repo.proposeHypothesis(
          model,
          { ...hypothesis, lastSubstantialEvidenceAt: now },
          "forged-anchor",
        ),
      ).rejects.toThrow("BINDING_UNAVAILABLE");
      await expect(repo.proposeHypothesis(human, hypothesis, "human-proposal")).rejects.toThrow(
        "MODEL_REQUIRED",
      );
      await repo.proposeHypothesis(model, hypothesis, "hypothesis-request");
      await repo.proposeHypothesis(model, hypothesis, "hypothesis-request");
      const rows = await reopened.hypotheses(human);
      expect(rows[0].alternatives).toHaveLength(2);
      expect(rows[0].alternatives[1].contradiction).toEqual([source]);
      expect(
        (
          await owner`select count(*)::int as n from twin_model_fixture.link where target_id='hypothesis-a'`
        )[0].n,
      ).toBe(2);
      await repo.withdraw(human, "hypothesis-source", "hypothesis-rights", "delete_source");
      expect(await reopened.hypotheses(human)).toEqual([]);
      await expect(repo.proposeHypothesis(model, hypothesis, "hypothesis-request")).rejects.toThrow(
        "EVIDENCE_UNAVAILABLE",
      );
      await repo.erase(human, "hypothesis-rights");
      expect(
        (
          await owner`select count(*)::int as n from twin_model_fixture.object where id='hypothesis-a'`
        )[0].n,
      ).toBe(0);
    });
    it("serializes a newer consent-version revocation with a concurrent writer", async () => {
      const isolated = { organizationId: "consent-race-org", subjectId: "consent-race-human" };
      const ctx = {
        ...human,
        scope: isolated,
        actor: { kind: "human" as const, subjectId: isolated.subjectId },
      };
      const consent = { ...grant, scope: isolated };
      await owner`insert into twin_model_fixture.scope_lock values (${isolated.organizationId},${isolated.subjectId})`;
      await owner`insert into twin_model_fixture.consent values (${isolated.organizationId},${isolated.subjectId},${consent.id},1,${owner.json(consent)})`;
      let release!: () => void;
      let entered!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const revoking = owner.begin(async (tx) => {
        const revoked = { ...consent, version: 2, revokedAt: now };
        await tx`insert into twin_model_fixture.consent values (${isolated.organizationId},${isolated.subjectId},${consent.id},2,${tx.json(revoked)})`;
        entered();
        await hold;
      });
      await ready;
      const attempt = repo.apply(ctx, { ...observe("consent-race"), scope: isolated }).then(
        () => "accepted",
        () => "denied",
      );
      let waiting = false;
      try {
        for (let i = 0; i < 100 && !waiting; i++) {
          waiting =
            (
              await second`select count(*)::int as n from pg_locks where locktype='advisory' and granted=false`
            )[0].n > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
        await revoking;
      }
      expect(waiting).toBe(true);
      expect(await attempt).toBe("denied");
      expect(
        (
          await owner`select count(*)::int as n from twin_model_fixture.object where organization_id=${isolated.organizationId}`
        )[0].n,
      ).toBe(0);
    });
  },
);
