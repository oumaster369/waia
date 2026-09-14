import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTwinRepository } from "@/lib/ai-twin/model/postgres-repository";
import { TWIN_PERSONAL_MODEL_ACCESS_POLICY } from "@/lib/ai-twin/model/core-access";
import type {
  WorkingHypothesis,
  DynamicRelation,
  KnowledgeNeed,
} from "@/lib/ai-twin/model/persistence-contracts";
import {
  experienceFingerprint,
  TWIN_RETENTION_POLICY,
  type ExperienceDraft,
} from "@/lib/ai-twin/model/lifecycle";
import type {
  ModelContext,
  ModelConsentGrant,
  ObserveCommand,
  ProposeCommand,
  CorrectCommand,
} from "@/lib/ai-twin/model/contracts";

// Explicit opt-in must fail on bad identity, never silently skip or read ambient DB URLs.
const enabled = process.env.WAIA_TWIN_PG_FIXTURE === "1";
const subjectId = "11111111-1111-4111-8111-111111111111";
function organizationId(label: string): string {
  const prefix = [...label].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
  return `${prefix.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`;
}
const scope = { organizationId: organizationId("fixture-org-a"), subjectId };
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
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version: 1,
  scope,
  purpose: "formation",
  sources: ["dialogue", "diary"],
  mode: "private_modelling",
  permittedUses: ["productive_private_modelling"],
  disclosureBoundary: "private_only",
  issuedAt: now,
  temporalMode: "EXPIRES_AT",
  expiresAt: "2027-09-08T12:00:00.000Z",
  revokedAt: null,
  retentionPolicyId: TWIN_RETENTION_POLICY,
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
    let sessionActor: unknown = { actorClass: "human", actorUserId: subjectId };
    let afterCoreRead: (() => Promise<void>) | null = null;
    const authority = {
      resolveAuthenticatedActor: async (tx: postgres.TransactionSql) => {
        await tx`select txid_current()`;
        return sessionActor;
      },
      resolveCurrentCoreAccess: async (
        tx: postgres.TransactionSql,
        request: {
          actor: { actorClass: "human"; actorUserId: string };
          organizationId: string;
          subjectUserId: string;
        },
      ) => {
        await tx`
          select pg_advisory_xact_lock(
            hashtextextended(
              jsonb_build_array(${request.organizationId}::text,${request.subjectUserId}::text)::text,
              0
            )
          )
        `;
        const [state] = await tx<
          {
            organization_status: "current" | "stale" | "revoked";
            membership_status: "current" | "stale" | "revoked";
            subject_status: "current" | "stale" | "revoked";
          }[]
        >`
          select organization_status,membership_status,subject_status
          from twin_model_fixture.core_adapter_state
          where organization_id=${request.organizationId}
            and subject_id=${request.subjectUserId}
        `;
        if (afterCoreRead) await afterCoreRead();
        return {
          policyVersion: TWIN_PERSONAL_MODEL_ACCESS_POLICY,
          target: {
            organizationId: request.organizationId,
            subjectUserId: request.subjectUserId,
          },
          actor: {
            authentication: "authenticated",
            actorClass: request.actor.actorClass,
            actorUserId: request.actor.actorUserId,
          },
          organization: state
            ? { organizationId: request.organizationId, status: state.organization_status }
            : null,
          membership: state
            ? {
                organizationId: request.organizationId,
                actorUserId: request.actor.actorUserId,
                status: state.membership_status,
              }
            : null,
          subjectBinding: state
            ? {
                organizationId: request.organizationId,
                subjectUserId: request.subjectUserId,
                status: state.subject_status,
              }
            : null,
        };
      },
    };
    async function seedScopeState(value: typeof scope): Promise<void> {
      await owner.begin(async (tx) => {
        await tx`
          insert into twin_model_fixture.scope_lock
          values (${value.organizationId},${value.subjectId})
        `;
        await tx`
          insert into twin_model_fixture.core_adapter_state
            (organization_id,subject_id)
          values (${value.organizationId},${value.subjectId})
        `;
      });
    }
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
      const [{ ddl }] =
        await owner`select format('alter role twin_fixture_service password %L', ${url.password}::text) as ddl`;
      await owner.unsafe(ddl);
      created = true;
      await seedScopeState(scope);
      await owner`insert into twin_model_fixture.consent values (${scope.organizationId}, ${scope.subjectId}, ${grant.id}, ${grant.version}, ${owner.json(grant)})`;
      url.username = "twin_fixture_service";
      service = postgres(url.toString(), { max: 2, connect_timeout: 3, onnotice: () => {} });
      second = postgres(url.toString(), { max: 2, connect_timeout: 3, onnotice: () => {} });
      repo = createIsolatedTwinRepository(service, authority);
      reopened = createIsolatedTwinRepository(second, authority);
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
    it("re-resolves current Core adapter state for every repository transaction", async () => {
      expect(await repo.current(human)).toBeDefined();
      await owner`
        update twin_model_fixture.core_adapter_state
        set membership_status='revoked'
        where organization_id=${scope.organizationId} and subject_id=${scope.subjectId}
      `;
      try {
        await expect(repo.current(human)).rejects.toThrow("TWIN_MEMBERSHIP_NOT_CURRENT");
        await expect(repo.apply(human, observe("revoked-membership"))).rejects.toThrow(
          "TWIN_MEMBERSHIP_NOT_CURRENT",
        );
      } finally {
        await owner`
          update twin_model_fixture.core_adapter_state
          set membership_status='current'
          where organization_id=${scope.organizationId} and subject_id=${scope.subjectId}
        `;
      }
      expect(await repo.current(human)).toBeDefined();
    });
    it("holds current Core authority through protected work and rejects it after revocation", async () => {
      let entered!: () => void;
      let release!: () => void;
      const coreRead = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const continueWork = new Promise<void>((resolve) => {
        release = resolve;
      });
      afterCoreRead = async () => {
        entered();
        await continueWork;
      };
      const operation = repo.current(human);
      await coreRead;
      const revocation = owner`
        update twin_model_fixture.core_adapter_state
        set membership_status='revoked'
        where organization_id=${scope.organizationId} and subject_id=${scope.subjectId}
      `;
      let revoked = false;
      void revocation.then(() => {
        revoked = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(revoked).toBe(false);
      afterCoreRead = null;
      release();
      await expect(operation).resolves.toBeDefined();
      await revocation;
      await expect(repo.current(human)).rejects.toThrow("TWIN_MEMBERSHIP_NOT_CURRENT");
      await owner`
        update twin_model_fixture.core_adapter_state
        set membership_status='current'
        where organization_id=${scope.organizationId} and subject_id=${scope.subjectId}
      `;
    });
    it("rejects non-Human, foreign and hostile session authority", async () => {
      const original = sessionActor;
      try {
        sessionActor = { actorClass: "service", actorUserId: subjectId };
        await expect(repo.current(human)).rejects.toThrow("TWIN_SESSION_REQUIRED");
        sessionActor = {
          actorClass: "human",
          actorUserId: "33333333-3333-4333-8333-333333333333",
        };
        await expect(repo.current(human)).rejects.toThrow("TWIN_PERSONAL_SUBJECT_MISMATCH");
        sessionActor = new Proxy({ actorClass: "human", actorUserId: subjectId }, {});
        await expect(repo.current(human)).rejects.toThrow("TWIN_SESSION_REQUIRED");
        let read = false;
        const getter = { actorClass: "human" };
        Object.defineProperty(getter, "actorUserId", {
          enumerable: true,
          get() {
            read = true;
            return subjectId;
          },
        });
        sessionActor = getter;
        await expect(repo.current(human)).rejects.toThrow("TWIN_SESSION_REQUIRED");
        expect(read).toBe(false);
      } finally {
        sessionActor = original;
      }
    });
    it("snapshots caller context before asynchronous authority resolution", async () => {
      let entered!: () => void;
      let release!: () => void;
      const coreRead = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const continueWork = new Promise<void>((resolve) => {
        release = resolve;
      });
      afterCoreRead = async () => {
        entered();
        await continueWork;
      };
      const mutable: Context = {
        ...human,
        scope: { ...human.scope },
        actor: { ...human.actor },
      };
      const operation = repo.current(mutable);
      await coreRead;
      (mutable.scope as { organizationId: string }).organizationId = organizationId("mutated");
      (mutable.actor as { kind: "human" | "model" }).kind = "model";
      (mutable as { purpose: string }).purpose = "private_archive";
      afterCoreRead = null;
      release();
      await expect(operation).resolves.toBeDefined();

      let read = false;
      const hostile = { ...human };
      Object.defineProperty(hostile, "purpose", {
        enumerable: true,
        get() {
          read = true;
          return "formation";
        },
      });
      await expect(repo.current(hostile)).rejects.toThrow("INVALID_INPUT");
      expect(read).toBe(false);
    });
    it("snapshots write payloads before asynchronous authority resolution", async () => {
      const writeScope = { organizationId: organizationId("mutable-write"), subjectId };
      await seedScopeState(writeScope);
      const scopedGrant = { ...grant, scope: writeScope };
      await owner`insert into twin_model_fixture.consent values (${writeScope.organizationId},${subjectId},${grant.id},1,${owner.json(scopedGrant)})`;
      const scoped: Context = {
        ...human,
        scope: writeScope,
        actor: { kind: "human", subjectId },
      };
      const command: ObserveCommand = {
        ...observe("mutable-write"),
        scope: writeScope,
      };
      let entered!: () => void;
      let release!: () => void;
      const coreRead = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const continueWork = new Promise<void>((resolve) => {
        release = resolve;
      });
      afterCoreRead = async () => {
        entered();
        await continueWork;
      };
      const operation = repo.apply(scoped, command);
      await coreRead;
      (command as { source: "dialogue" | "diary" }).source = "diary";
      (command as { text: string }).text = "mutated after validation";
      afterCoreRead = null;
      release();
      await operation;
      const stored = (await repo.history(scoped)).observations.find(
        (observation) => observation.id === command.id,
      );
      expect(stored?.source).toBe("dialogue");
      expect(stored?.text).toBe("I chose a quiet walk");
    });
    it("issues explicit temporal consent at trusted time and appends revocation", async () => {
      const consentScope = { organizationId: organizationId("consent-issuance"), subjectId };
      const consentHuman: Context = {
        ...human,
        scope: consentScope,
        actor: { kind: "human", subjectId },
      };
      await seedScopeState(consentScope);
      const before =
        await owner`select count(*)::int as n from twin_model_fixture.consent where organization_id=${consentScope.organizationId} and subject_id=${subjectId}`;
      const issuance = {
        requestId: "99999999-9999-4999-8999-999999999999",
        confirmed: true,
        purpose: "formation",
        sources: ["dialogue", "diary"],
        permittedUses: ["productive_private_modelling"],
        disclosureBoundary: "private_only",
        retentionPolicyId: TWIN_RETENTION_POLICY,
        temporal: { mode: "UNTIL_REVOKED", expiresAt: null },
      } as const;
      const issued = await repo.issueConsent(consentHuman, issuance);
      expect(await repo.issueConsent(consentHuman, issuance)).toEqual(issued);
      await expect(
        repo.issueConsent(consentHuman, {
          ...issuance,
          sources: ["dialogue"],
        }),
      ).rejects.toThrow("CONSENT_REPLAY_CONFLICT");
      expect(issued).toMatchObject({
        version: 1,
        scope: consentScope,
        purpose: "formation",
        sources: ["dialogue", "diary"],
        permittedUses: ["productive_private_modelling"],
        disclosureBoundary: "private_only",
        temporalMode: "UNTIL_REVOKED",
        expiresAt: null,
        revokedAt: null,
      });
      expect(issued.issuedAt).not.toBe(consentHuman.now);
      const atIssue = { ...consentHuman, now: issued.issuedAt };
      await repo.apply(atIssue, {
        ...observe("issued-consent"),
        scope: consentScope,
        grant: { id: issued.id, version: issued.version },
        eventTime: issued.issuedAt,
      });
      await repo.revokeConsent(atIssue, { id: issued.id, version: issued.version });
      await repo.revokeConsent(atIssue, { id: issued.id, version: issued.version });
      expect(
        (await repo.history(atIssue)).observations.some(
          (observation) => observation.id === "issued-consent",
        ),
      ).toBe(false);
      await expect(
        repo.apply(atIssue, {
          ...observe("issued-consent-later"),
          scope: consentScope,
          grant: { id: issued.id, version: issued.version },
          eventTime: issued.issuedAt,
        }),
      ).rejects.toThrow();
      const after =
        await owner`select version,payload from twin_model_fixture.consent where organization_id=${consentScope.organizationId} and subject_id=${subjectId} and id=${issued.id} order by version`;
      expect(after.map((row) => row.version)).toEqual([1, 2]);
      expect(before[0].n).toBe(0);
      expect(after[0].payload.revokedAt).toBeNull();
      expect(after[1].payload.revokedAt).not.toBeNull();
    });
    it("rejects expired-at-issuance consent without writing a grant", async () => {
      const before =
        await owner`select count(*)::int as n from twin_model_fixture.consent where organization_id=${scope.organizationId} and subject_id=${scope.subjectId}`;
      await expect(
        repo.issueConsent(human, {
          requestId: "88888888-8888-4888-8888-888888888888",
          confirmed: true,
          purpose: "formation",
          sources: ["dialogue"],
          permittedUses: ["productive_private_modelling"],
          disclosureBoundary: "private_only",
          retentionPolicyId: TWIN_RETENTION_POLICY,
          temporal: { mode: "EXPIRES_AT", expiresAt: "2000-01-01T00:00:00.000Z" },
        }),
      ).rejects.toThrow("CONSENT_EXPIRY_REQUIRED");
      const after =
        await owner`select count(*)::int as n from twin_model_fixture.consent where organization_id=${scope.organizationId} and subject_id=${scope.subjectId}`;
      expect(after[0].n).toBe(before[0].n);
    });
    it("fails closed for a widened append-only consent lineage", async () => {
      const lineageScope = { organizationId: organizationId("consent-lineage"), subjectId };
      await seedScopeState(lineageScope);
      const initial = {
        ...grant,
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        scope: lineageScope,
      };
      const widened = {
        ...initial,
        version: 2,
        sources: ["dialogue"],
        revokedAt: "2026-09-14T12:00:00.000Z",
      };
      await owner`insert into twin_model_fixture.consent values (${lineageScope.organizationId},${subjectId},${initial.id},1,${owner.json(initial)})`;
      await owner`insert into twin_model_fixture.consent values (${lineageScope.organizationId},${subjectId},${initial.id},2,${owner.json(widened)})`;
      const scoped: Context = {
        ...human,
        scope: lineageScope,
        actor: { kind: "human", subjectId },
      };
      await expect(repo.current(scoped)).rejects.toThrow("CONSENT_LINEAGE_INVALID");
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
        const foreignValue =
          key === "organizationId"
            ? organizationId("foreign")
            : "33333333-3333-4333-8333-333333333333";
        const foreign = { ...human, scope: { ...scope, [key]: foreignValue } };
        foreign.actor = { kind: "human", subjectId: foreign.scope.subjectId };
        await expect(reopened.current(foreign)).rejects.toThrow();
        await expect(repo.apply(foreign, observe("history"))).rejects.toThrow("SCOPE_MISMATCH");
        await expect(
          repo.withdraw(foreign, "history", `foreign-${key}`, "withdraw_modelling"),
        ).rejects.toThrow();
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
        service`update twin_model_fixture.consent set payload='{}'::jsonb`,
      ).rejects.toThrow();
      await expect(service`delete from twin_model_fixture.consent`).rejects.toThrow();
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
      const bad = {
        ...grant,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        retentionPolicyId: "unapproved-policy",
      };
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
    it.each(["retry", "new"] as const)(
      "denies %s of a hypothesis with an ended validity interval",
      async (mode) => {
        const s = { organizationId: organizationId(`hypothesis-interval-${mode}`), subjectId };
        const h: Context = { ...human, scope: s, actor: { kind: "human", subjectId: s.subjectId } };
        const m: Context = { ...h, actor: { ...h.actor, kind: "model" } };
        const end = "2026-09-08T12:00:01.000Z";
        const g = { ...grant, scope: s };
        await seedScopeState(s);
        await owner`insert into twin_model_fixture.consent values (${s.organizationId},${s.subjectId},${g.id},1,${owner.json(g)})`;
        await repo.apply(h, { ...observe("interval-source"), scope: s });
        const source = { ...s, kind: "observation" as const, id: "interval-source", version: 1 };
        const value: WorkingHypothesis = {
          ref: { ...s, kind: "hypothesis", id: "interval-hypothesis", version: 1 },
          purpose: h.purpose,
          createdAt: mode === "retry" ? now : end,
          retentionPolicyId: g.retentionPolicyId,
          context: "Synthetic temporary interpretation",
          domains: ["preferences"],
          alternatives: [
            {
              id: "one",
              statement: "Temporary preference",
              support: [source],
              contradiction: [],
              uncertainty: "One report",
              falsifier: "Contrary report",
            },
            {
              id: "two",
              statement: "Contextual choice",
              support: [],
              contradiction: [source],
              uncertainty: "Context unknown",
              falsifier: "Repeated pattern",
            },
          ],
          validFrom: now,
          validUntil: end,
          lastSubstantialEvidenceAt: null,
          status: "proposed",
        };
        if (mode === "retry") {
          await repo.proposeHypothesis(m, value, "interval-request");
          expect(await reopened.hypotheses(m)).toEqual([value]);
        }
        const ended = { ...m, now: end };
        expect(await reopened.hypotheses(ended)).toEqual([]);
        await expect(repo.proposeHypothesis(ended, value, "interval-request")).rejects.toThrow(
          "RETENTION_UNAVAILABLE",
        );
        const [counts] =
          await owner`select count(*)::int as n from twin_model_fixture.object where organization_id=${s.organizationId} and kind='hypothesis'`;
        expect(counts.n).toBe(mode === "retry" ? 1 : 0);
      },
    );

    it("denies model access to archive metadata through every generic read surface", async () => {
      const archiveModel = { ...model, purpose: "private_archive" };
      await expect(reopened.history(archiveModel)).rejects.toThrow("HUMAN_REQUIRED");
      await expect(reopened.current(archiveModel)).rejects.toThrow("HUMAN_REQUIRED");
      await expect(reopened.hypotheses(archiveModel)).rejects.toThrow("HUMAN_REQUIRED");
      await expect(reopened.groundedCandidates(archiveModel)).rejects.toThrow("HUMAN_REQUIRED");
    });

    it("keeps private deletion clocks out of modelling without dropping cross-purpose observation fences", async () => {
      const s = { organizationId: organizationId("private-clock"), subjectId };
      const h: Context = { ...human, scope: s, actor: { kind: "human", subjectId: s.subjectId } };
      const m: Context = { ...h, actor: { ...h.actor, kind: "model" } };
      const g = { ...grant, scope: s };
      await seedScopeState(s);
      await owner`insert into twin_model_fixture.consent values (${s.organizationId},${s.subjectId},${g.id},1,${owner.json(g)})`;
      await repo.apply(h, { ...observe("public-source"), scope: s });
      const history = await reopened.history(m);
      const current = await reopened.current(m);
      const later = "2026-09-08T12:00:02.000Z";
      // Trusted synthetic rights seed; no archive content or authority is granted to modelling.
      for (const kind of ["private_source", "experience"] as const) {
        await owner`insert into twin_model_fixture.rights_request values (${s.organizationId},${s.subjectId},'private_archive',${`private-${kind}`},${`private-${kind}`},'delete_source',${later},'live_removed',${kind})`;
      }
      expect(await reopened.history(m)).toEqual(history);
      expect(await reopened.current(m)).toEqual(current);
      // A hidden private timestamp must not create a modelling write/STale-clock oracle either.
      await repo.apply(m, { ...propose("public-source"), scope: s });
      expect(await reopened.current(m)).toHaveLength(1);
      // Conversely, a trusted deletion of an observation remains global across purposes.
      await owner`insert into twin_model_fixture.rights_request values (${s.organizationId},${s.subjectId},'other-model-purpose','global-observation-delete','public-source','delete_source',${now},'restricted','observation')`;
      expect(await reopened.current(m)).toEqual([]);
      expect((await reopened.history(m)).observations).toEqual([]);
      await expect(repo.apply(h, { ...observe("public-source"), scope: s })).rejects.toThrow(
        "SOURCE_RESTRICTED",
      );
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
    it.each(["relation", "knowledge_need"] as const)(
      "stores grounded %s with current evidence and rights closure",
      async (kind) => {
        expect(typeof repo.proposeGroundedCandidate).toBe("function");
        const ownScope = { organizationId: organizationId(`grounded-${kind}`), subjectId };
        const h: Context = {
          ...human,
          scope: ownScope,
          actor: { kind: "human", subjectId: ownScope.subjectId },
        };
        const m: Context = { ...h, actor: { ...h.actor, kind: "model" } };
        const ownGrant = { ...grant, scope: ownScope };
        await seedScopeState(ownScope);
        await owner`insert into twin_model_fixture.consent values (${ownScope.organizationId},${ownScope.subjectId},${ownGrant.id},1,${owner.json(ownGrant)})`;
        await repo.apply(h, { ...observe("grounded-source"), scope: ownScope });
        await repo.apply(m, { ...propose("grounded-source"), scope: ownScope });
        const evidence = {
          ...ownScope,
          kind: "claim" as const,
          id: "claim-grounded-source",
          version: 1,
        };
        const base = {
          ref: { ...ownScope, kind, id: "candidate-1", version: 1 },
          purpose: h.purpose,
          createdAt: now,
          retentionPolicyId: grant.retentionPolicyId,
        };
        const value: DynamicRelation | KnowledgeNeed =
          kind === "relation"
            ? {
                ...base,
                kind: "tension",
                endpoints: [evidence],
                context: "Synthetic context",
                uncertainty: "One report only",
                validFrom: now,
                validUntil: "2026-09-09T12:00:00.000Z",
                status: "proposed",
              }
            : {
                ...base,
                reason: "Missing situational context",
                proposedObservation: "Optional further context",
                evidence: [evidence],
                state: "open",
              };
        await expect(repo.proposeGroundedCandidate(h, kind, value, "human-write")).rejects.toThrow(
          "MODEL_REQUIRED",
        );
        await expect(
          repo.proposeGroundedCandidate(m, "unknown" as never, value, "kind-write"),
        ).rejects.toThrow("INVALID_INPUT");
        await expect(
          repo.proposeGroundedCandidate(
            m,
            kind,
            { ...value, retentionPolicyId: "invented" },
            "policy-write",
          ),
        ).rejects.toThrow("PURPOSE_POLICY_MISMATCH");
        await expect(
          repo.proposeGroundedCandidate(m, kind, { ...value, purpose: "other" }, "purpose-write"),
        ).rejects.toThrow();
        await expect(
          repo.proposeGroundedCandidate(
            m,
            kind,
            {
              ...value,
              ...(kind === "relation" ? { status: "contested" } : { state: "resolved" }),
            },
            "transition-write",
          ),
        ).rejects.toThrow("BINDING_UNAVAILABLE");
        await expect(
          repo.proposeGroundedCandidate(
            m,
            kind,
            { ...value, ...(kind === "relation" ? { endpoints: [] } : { evidence: [] }) },
            "empty-write",
          ),
        ).rejects.toThrow("EVIDENCE_UNAVAILABLE");
        await repo.proposeGroundedCandidate(m, kind, value, "candidate-request");
        // JSON key ordering is not new content and must not make a retry conflict.
        await repo.proposeGroundedCandidate(
          m,
          kind,
          Object.fromEntries(Object.entries(value).reverse()),
          "candidate-request",
        );
        expect(await reopened.groundedCandidates(h)).toEqual([value]);
        await expect(
          repo.proposeGroundedCandidate(
            m,
            kind,
            {
              ...value,
              ...(kind === "relation" ? { uncertainty: "Changed" } : { reason: "Changed" }),
            },
            "candidate-request",
          ),
        ).rejects.toThrow("REPLAY_CONFLICT");
        for (const field of ["organizationId", "subjectId"] as const) {
          const foreignScope = {
            ...ownScope,
            [field]:
              field === "organizationId"
                ? organizationId(`foreign-${kind}`)
                : "33333333-3333-4333-8333-333333333333",
          };
          const foreign = {
            ...m,
            scope: foreignScope,
            actor: { ...m.actor, subjectId: foreignScope.subjectId },
          };
          await expect(reopened.groundedCandidates(foreign)).rejects.toThrow();
          await expect(
            repo.proposeGroundedCandidate(foreign, kind, value, "foreign-write"),
          ).rejects.toThrow();
        }
        if (kind === "relation") {
          const ended = { ...m, now: "2026-09-09T12:00:00.000Z" };
          expect(await reopened.groundedCandidates(ended)).toEqual([]);
          await expect(
            repo.proposeGroundedCandidate(ended, kind, value, "candidate-request"),
          ).rejects.toThrow("RETENTION_UNAVAILABLE");
        }
        const expired = { ...m, now: "2026-12-07T12:00:00.000Z" };
        expect(await reopened.groundedCandidates(expired)).toEqual([]);
        await expect(
          repo.proposeGroundedCandidate(expired, kind, value, "candidate-request"),
        ).rejects.toThrow("EVIDENCE_UNAVAILABLE");
        // Human correction makes the old exact claim revision ineligible; never rebind silently.
        await repo.apply(h, { ...correct("grounded-source"), scope: ownScope });
        expect(await reopened.groundedCandidates(h)).toEqual([]);
        await expect(
          repo.proposeGroundedCandidate(m, kind, value, "candidate-request"),
        ).rejects.toThrow("EVIDENCE_UNAVAILABLE");
        const currentEvidence = { ...evidence, version: 2 };
        const revised = {
          ...value,
          ref: { ...value.ref, id: "candidate-2" },
          ...(kind === "relation"
            ? { endpoints: [currentEvidence] }
            : { evidence: [currentEvidence] }),
        };
        await repo.proposeGroundedCandidate(m, kind, revised, "current-request");
        expect(await reopened.groundedCandidates(h)).toHaveLength(1);
        await repo.withdraw(h, "grounded-source", "grounded-rights", "withdraw_modelling");
        expect(await reopened.groundedCandidates(h)).toEqual([]);
        await expect(
          repo.proposeGroundedCandidate(m, kind, revised, "current-request"),
        ).rejects.toThrow("EVIDENCE_UNAVAILABLE");
        await owner.unsafe(
          "CREATE FUNCTION twin_model_fixture.fail_grounded_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='candidate-2' THEN RAISE EXCEPTION 'grounded_delete_failure'; END IF; RETURN OLD; END $$; CREATE TRIGGER fail_grounded_delete BEFORE DELETE ON twin_model_fixture.object FOR EACH ROW EXECUTE FUNCTION twin_model_fixture.fail_grounded_delete();",
        );
        try {
          await expect(repo.erase(h, "grounded-rights")).rejects.toThrow("grounded_delete_failure");
          expect(await reopened.groundedCandidates(h)).toEqual([]);
          expect(
            (
              await owner`select state from twin_model_fixture.rights_request where organization_id=${ownScope.organizationId} and request_id='grounded-rights'`
            )[0].state,
          ).toBe("restricted");
        } finally {
          await owner.unsafe(
            "DROP TRIGGER fail_grounded_delete ON twin_model_fixture.object; DROP FUNCTION twin_model_fixture.fail_grounded_delete();",
          );
        }
        await repo.erase(h, "grounded-rights");
        const [counts] =
          await owner`select (select count(*)::int from twin_model_fixture.object where organization_id=${ownScope.organizationId} and kind=${kind}) as objects, (select count(*)::int from twin_model_fixture.link where organization_id=${ownScope.organizationId}) as links, (select count(*)::int from twin_model_fixture.receipt where organization_id=${ownScope.organizationId}) as receipts`;
        expect(counts).toEqual({ objects: 0, links: 0, receipts: 0 });
      },
    );

    it("rejects grounded clock rollback and rechecks newly revoked consent before retry", async () => {
      const s = { organizationId: organizationId("grounded-clock"), subjectId };
      const h: Context = { ...human, scope: s, actor: { kind: "human", subjectId: s.subjectId } };
      const later = "2026-09-08T12:00:01.000Z";
      const m: Context = { ...h, now: later, actor: { ...h.actor, kind: "model" } };
      const g = { ...grant, scope: s };
      await seedScopeState(s);
      await owner`insert into twin_model_fixture.consent values (${s.organizationId},${s.subjectId},${g.id},1,${owner.json(g)})`;
      await repo.apply(h, { ...observe("clock-source"), scope: s });
      const value: KnowledgeNeed = {
        ref: { ...s, kind: "knowledge_need", id: "clock-need", version: 1 },
        purpose: h.purpose,
        retentionPolicyId: g.retentionPolicyId,
        createdAt: later,
        reason: "Synthetic context gap",
        proposedObservation: "Optional question",
        evidence: [{ ...s, kind: "observation", id: "clock-source", version: 1 }],
        state: "open",
      };
      await repo.proposeGroundedCandidate(m, "knowledge_need", value, "clock-request");
      expect(await reopened.groundedCandidates(m)).toEqual([value]);
      await expect(
        repo.proposeGroundedCandidate(
          { ...m, now },
          "knowledge_need",
          { ...value, ref: { ...value.ref, id: "clock-new" }, createdAt: now },
          "clock-backwards",
        ),
      ).rejects.toThrow("STALE_CLOCK");
      expect(
        (
          await owner`select count(*)::int as n from twin_model_fixture.object where organization_id=${s.organizationId} and id='clock-new'`
        )[0].n,
      ).toBe(0);
      const revoked = { ...g, version: 2, revokedAt: later };
      await owner`insert into twin_model_fixture.consent values (${s.organizationId},${s.subjectId},${g.id},2,${owner.json(revoked)})`;
      expect(await reopened.groundedCandidates(m)).toEqual([]);
      await expect(
        repo.proposeGroundedCandidate(m, "knowledge_need", value, "clock-request"),
      ).rejects.toThrow("EVIDENCE_UNAVAILABLE");
    });

    it("serializes a newer consent-version revocation with a concurrent writer", async () => {
      const isolated = { organizationId: organizationId("consent-race-org"), subjectId };
      const ctx = {
        ...human,
        scope: isolated,
        actor: { kind: "human" as const, subjectId: isolated.subjectId },
      };
      const consent = { ...grant, scope: isolated };
      await seedScopeState(isolated);
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
    it("preserves a separately authorized private archive, not a relabeled model source", async () => {
      expect(typeof repo.savePrivateSource).toBe("function");
      const archive = { ...human, purpose: "private_archive" };
      const source = {
        scope,
        id: "same-source-id",
        revision: 1,
        recordedAt: now,
        text: "A separately saved synthetic Human declaration",
        origin: "human_declaration" as const,
      };
      const seedAuthority = async (kind: "private_source" | "experience", id: string) => {
        const payload = {
          record: {
            scope,
            id,
            revision: 1,
            kind: kind === "private_source" ? "saved_episode" : "experience_archive",
            createdAt: now,
            evidenceEligible: true,
            erasureRequestedAt: null,
          },
          authorization: {
            scope,
            recordId: id,
            recordRevision: 1,
            purpose: "private_archive",
            approvedBy: "human",
            validFrom: now,
            validUntil: null,
            revokedAt: null,
            basisReference: `explicit-archive-${id}`,
          },
        };
        await owner`insert into twin_model_fixture.archive_authority values (${scope.organizationId},${scope.subjectId},${kind},${id},1,${owner.json(payload)})`;
      };
      await seedAuthority("private_source", source.id);
      await repo.savePrivateSource(archive, source);
      await expect(
        repo.savePrivateSource(archive, { ...source, text: "changed content" }),
      ).rejects.toThrow("REPLAY_CONFLICT");
      const draft: ExperienceDraft = {
        scope,
        id: "experience-private",
        revision: 1,
        recordedAt: now,
        eventTime: now,
        situation: "Synthetic experience",
        context: "Private reflection",
        intention: "Understand a choice",
        consideredOptions: ["Rest", "A crowded event"],
        decision: "Rest",
        reasons: ["Human stated preference"],
        expectedConsequences: ["More energy later"],
        observedOutcomes: [],
        humanLesson: "This choice depends on context",
        reinterpretations: [],
        uncertainty: "The later outcome is unknown",
        transferConditions: "No transfer authorized",
        provenance: [
          {
            scope,
            sourceId: source.id,
            sourceVersion: 1,
            kind: "human_declaration",
            authorizationReference: `explicit-archive-${source.id}`,
            eligible: true,
          },
        ],
      };
      await seedAuthority("experience", draft.id);
      await expect(
        repo.saveExperience(
          { ...archive, actor: model.actor },
          draft,
          experienceFingerprint(draft),
        ),
      ).rejects.toThrow("HUMAN_REQUIRED");
      await expect(repo.saveExperience(human, draft, experienceFingerprint(draft))).rejects.toThrow(
        "ARCHIVE_PURPOSE_REQUIRED",
      );
      await expect(repo.saveExperience(archive, draft, "wrong-approval")).rejects.toThrow();
      const relabeled = { ...draft, provenance: [{ ...draft.provenance[0], sourceId: "history" }] };
      await expect(
        repo.saveExperience(archive, relabeled, experienceFingerprint(relabeled)),
      ).rejects.toThrow("ARCHIVE_SOURCE_UNAVAILABLE");
      await repo.saveExperience(archive, draft, experienceFingerprint(draft));
      await repo.saveExperience(archive, draft, experienceFingerprint(draft));
      const changed = { ...draft, humanLesson: "Different content" };
      await expect(
        repo.saveExperience(archive, changed, experienceFingerprint(changed)),
      ).rejects.toThrow("REPLAY_CONFLICT");
      await repo.apply(human, observe(source.id));
      await repo.apply(model, propose(source.id));
      await repo.withdraw(human, source.id, "same-id-model-rights", "delete_source");
      await repo.erase(human, "same-id-model-rights");
      const preserved = await reopened.experience(archive, draft.id);
      expect(preserved?.observedOutcomes).toEqual([]);
      expect(preserved?.transferAuthority).toBe("none");
      for (const key of ["organizationId", "subjectId"] as const) {
        const otherScope = {
          ...scope,
          [key]:
            key === "organizationId"
              ? organizationId("foreign-archive")
              : "33333333-3333-4333-8333-333333333333",
        };
        const other = {
          ...archive,
          scope: otherScope,
          actor: { kind: "human" as const, subjectId: otherScope.subjectId },
        };
        await expect(reopened.experience(other, draft.id)).rejects.toThrow();
        await expect(
          repo.saveExperience(other, draft, experienceFingerprint(draft)),
        ).rejects.toThrow();
      }
      expect(
        (await reopened.experience({ ...archive, now: "2046-09-08T12:00:00.000Z" }, draft.id))
          ?.fingerprint,
      ).toBe(experienceFingerprint(draft));
      await expect(
        reopened.experience({ ...archive, actor: model.actor }, draft.id),
      ).rejects.toThrow("HUMAN_REQUIRED");
      expect((await reopened.current(human)).some((c) => c.claimId === draft.id)).toBe(false);
      await repo.apply(human, observe("mixed-source"));
      await owner`insert into twin_model_fixture.link values (${scope.organizationId},${scope.subjectId},'observation','mixed-source',1,'experience',${draft.id},1,'contextualizes')`;
      await repo.withdraw(human, "mixed-source", "mixed-rights", "withdraw_modelling");
      await expect(repo.erase(human, "mixed-rights")).rejects.toThrow(
        "CROSS_PURPOSE_REVIEW_REQUIRED",
      );
      expect((await reopened.experience(archive, draft.id))?.fingerprint).toBe(
        experienceFingerprint(draft),
      );
      const [currentAuthority] =
        await owner`select payload from twin_model_fixture.archive_authority where kind='private_source' and id=${source.id} and version=1`;
      const malformed = {
        ...currentAuthority.payload,
        record: { ...currentAuthority.payload.record, createdAt: "invalid" },
      };
      await owner`insert into twin_model_fixture.archive_authority values (${scope.organizationId},${scope.subjectId},'private_source',${source.id},2,${owner.json(malformed)})`;
      await expect(reopened.experience(archive, draft.id)).rejects.toThrow(
        "Canonical UTC timestamp required",
      );
      const revoked = {
        ...currentAuthority.payload,
        authorization: { ...currentAuthority.payload.authorization, revokedAt: now },
      };
      await owner`insert into twin_model_fixture.archive_authority values (${scope.organizationId},${scope.subjectId},'private_source',${source.id},3,${owner.json(revoked)})`;
      expect(await reopened.experience(archive, draft.id)).toBeNull();
      await expect(repo.savePrivateSource(archive, source)).rejects.toThrow(
        "ARCHIVE_AUTHORITY_UNAVAILABLE",
      );
      await expect(
        repo.saveExperience(archive, draft, experienceFingerprint(draft)),
      ).rejects.toThrow("ARCHIVE_SOURCE_UNAVAILABLE");
      await repo.withdraw(
        archive,
        source.id,
        "private-source-rights",
        "delete_source",
        "private_source",
      );
      expect(await reopened.experience(archive, draft.id)).toBeNull();
      await expect(
        repo.saveExperience(archive, draft, experienceFingerprint(draft)),
      ).rejects.toThrow("ARCHIVE_SOURCE_UNAVAILABLE");
      await repo.erase(archive, "private-source-rights");
      await expect(repo.savePrivateSource(archive, source)).rejects.toThrow("SOURCE_RESTRICTED");
      expect(
        (
          await owner`select count(*)::int as n from twin_model_fixture.object where kind in ('private_source','experience')`
        )[0].n,
      ).toBe(0);
    });
  },
);
