import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import {
  createProductionTwinRepository,
  twinObservationTargetDigest,
} from "@/lib/ai-twin/model/postgres-production-repository";
import { TWIN_RETENTION_POLICY } from "@/lib/ai-twin/model/lifecycle";
import { TWIN_RIGHTS_OPERATION_POLICY } from "@/lib/ai-twin/model/rights-operation";
import type { ModelContext, ProjectionRisk } from "@/lib/ai-twin/model/contracts";

const enabled = process.env.WAIA_SHARED_PG17 === "1";

describe.skipIf(!enabled)(
  "DEE-871 production epistemic persistence on isolated PostgreSQL 17",
  () => {
    const connections: postgres.Sql[] = [];
    let sql: postgres.Sql;
    const actorUserId = randomUUID();
    const organizationId = randomUUID();
    const otherUserId = randomUUID();
    const otherOrgId = randomUUID();
    type Context = Omit<ModelContext, "grants">;
    const now = "2026-09-14T12:00:00.000Z";
    const human = (): Context => ({
      scope: { organizationId, subjectId: actorUserId },
      purpose: "formation",
      now,
      actor: { kind: "human", subjectId: actorUserId },
    });

    beforeAll(async () => {
      const raw = process.env.WAIA_SHARED_PG17_URL ?? "";
      const marker = process.env.WAIA_SHARED_PG17_MARKER;
      const url = new URL(raw);
      if (
        !marker ||
        url.protocol !== "postgres:" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== process.env.WAIA_SHARED_PG17_PORT
      ) {
        throw new Error("WRONG_OWNED_LOCAL_TARGET");
      }
      const root = postgres(raw, {
        max: 1,
        prepare: false,
        connect_timeout: 3,
        onnotice: () => {},
      });
      connections.push(root);
      const name = "dee871_" + randomUUID().replaceAll("-", "");
      await root.unsafe(`CREATE DATABASE "${name}"`);
      const dbUrl = new URL(raw);
      dbUrl.pathname = "/" + name;
      sql = postgres(dbUrl.toString(), {
        max: 1,
        prepare: false,
        connect_timeout: 3,
        onnotice: () => {},
      });
      connections.push(sql);
      await sql.unsafe(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8"));
      await migrate(drizzle(sql), { migrationsFolder: "db/migrations_postgres" });
      await sql`insert into auth.users(id) values(${actorUserId}::uuid), (${otherUserId}::uuid)`;
      await sql`insert into public.users(id, identity_label, email)
      values (${actorUserId}::uuid, 'Twin subject', ${actorUserId + "@invalid.local"}),
             (${otherUserId}::uuid, 'Other member', ${otherUserId + "@invalid.local"})`;
      await sql`insert into public.organizations(id, owner_user_id, kind)
      values (${organizationId}::uuid, ${actorUserId}::uuid, 'personal'),
             (${otherOrgId}::uuid, ${otherUserId}::uuid, 'personal')`;
      await sql`insert into public.organization_members(id, organization_id, user_id, member_role)
      values (${randomUUID()}::uuid, ${organizationId}::uuid, ${actorUserId}::uuid, 'owner'),
             (${randomUUID()}::uuid, ${organizationId}::uuid, ${otherUserId}::uuid, 'member'),
             (${randomUUID()}::uuid, ${otherOrgId}::uuid, ${otherUserId}::uuid, 'owner')`;
    }, 120000);

    afterAll(async () => {
      await Promise.all(connections.map((handle) => handle.end({ timeout: 2 })));
    });

    function repo(actor = actorUserId) {
      return createProductionTwinRepository({
        sql,
        resolveActorUserId: async () => actor,
      });
    }

    it("issues and revokes consent for the same Human only", async () => {
      const grant = await repo().issueConsent(human(), {
        confirmed: true,
        requestId: randomUUID(),
        purpose: "formation",
        sources: ["dialogue", "diary"],
        permittedUses: ["productive_private_modelling"],
        disclosureBoundary: "private_only",
        retentionPolicyId: TWIN_RETENTION_POLICY,
        temporal: { mode: "UNTIL_REVOKED", expiresAt: null },
      });
      expect(grant.scope).toEqual({ organizationId, subjectId: actorUserId });
      expect(grant.revokedAt).toBeNull();
      await repo().revokeConsent(human(), { id: grant.id, version: 1 });
      const otherSubjectIntent = {
        confirmed: true as const,
        requestId: randomUUID(),
        purpose: "formation" as const,
        sources: ["dialogue"] as const,
        permittedUses: ["productive_private_modelling"] as const,
        disclosureBoundary: "private_only" as const,
        retentionPolicyId: TWIN_RETENTION_POLICY,
        temporal: { mode: "UNTIL_REVOKED" as const, expiresAt: null },
      };
      await expect(
        repo().issueConsent(
          {
            ...human(),
            scope: { organizationId, subjectId: otherUserId },
          },
          otherSubjectIntent,
        ),
      ).rejects.toThrow(/TWIN_PERSONAL_SUBJECT_MISMATCH|TWIN_CORE|SCOPE_MISMATCH/);
      await expect(repo(otherUserId).issueConsent(human(), otherSubjectIntent)).rejects.toThrow(
        /TWIN_PERSONAL_SUBJECT_MISMATCH|TWIN_CORE|SCOPE_MISMATCH/,
      );
      await expect(
        repo().issueConsent(
          {
            ...human(),
            scope: { organizationId: otherOrgId, subjectId: actorUserId },
          },
          {
            confirmed: true,
            requestId: randomUUID(),
            purpose: "formation",
            sources: ["dialogue"],
            permittedUses: ["productive_private_modelling"],
            disclosureBoundary: "private_only",
            retentionPolicyId: TWIN_RETENTION_POLICY,
            temporal: { mode: "UNTIL_REVOKED", expiresAt: null },
          },
        ),
      ).rejects.toThrow();
    }, 60000);

    it("qualifies version history, idempotency, rights use-block, and residual-copy fail-closed", async () => {
      const digest = (character: string) => `sha256:${character.repeat(64)}`;
      const consentRequest = randomUUID();
      const grant = await repo().issueConsent(human(), {
        confirmed: true,
        requestId: consentRequest,
        purpose: "formation",
        sources: ["dialogue", "diary"],
        permittedUses: ["productive_private_modelling"],
        disclosureBoundary: "private_only",
        retentionPolicyId: TWIN_RETENTION_POLICY,
        temporal: { mode: "UNTIL_REVOKED", expiresAt: null },
      });
      expect(
        await repo().issueConsent(human(), {
          confirmed: true,
          requestId: consentRequest,
          purpose: "formation",
          sources: ["dialogue", "diary"],
          permittedUses: ["productive_private_modelling"],
          disclosureBoundary: "private_only",
          retentionPolicyId: TWIN_RETENTION_POLICY,
          temporal: { mode: "UNTIL_REVOKED", expiresAt: null },
        }),
      ).toEqual(grant);
      await expect(
        repo().issueConsent(human(), {
          confirmed: true,
          requestId: consentRequest,
          purpose: "formation",
          sources: ["dialogue"],
          permittedUses: ["productive_private_modelling"],
          disclosureBoundary: "private_only",
          retentionPolicyId: TWIN_RETENTION_POLICY,
          temporal: { mode: "UNTIL_REVOKED", expiresAt: null },
        }),
      ).rejects.toThrow("CONSENT_REPLAY_CONFLICT");

      const observationId = "obs-wp3-1";
      const observeRequest = randomUUID();
      const observe = {
        kind: "observe" as const,
        requestId: observeRequest,
        scope: { organizationId, subjectId: actorUserId },
        id: observationId,
        grant: { id: grant.id, version: 1 },
        source: "dialogue" as const,
        eventTime: now,
        context: "desk",
        text: "I prefer quiet mornings",
        projectionRisks: [] as ProjectionRisk[],
      };
      await repo().apply(human(), observe);
      await repo().apply(human(), observe);
      await expect(repo().apply(human(), { ...observe, text: "changed" })).rejects.toThrow(
        "REPLAY_CONFLICT",
      );
      await repo().apply(
        { ...human(), actor: { kind: "model", subjectId: actorUserId } },
        {
          kind: "propose",
          requestId: randomUUID(),
          scope: { organizationId, subjectId: actorUserId },
          claimId: "claim-wp3-1",
          statement: "Quiet mornings matter",
          domain: "values",
          context: "work",
          uncertainty: "stated once",
          observationIds: [observationId],
        },
      );
      const ledger = await repo().history(human());
      expect(ledger.observations).toHaveLength(1);
      expect(ledger.claims.map((claim) => claim.revision)).toEqual([1]);
      expect(await repo().current(human())).toHaveLength(1);
      await expect(
        repo().recordEndorsement(human(), {
          endorsementId: randomUUID(),
          target: {
            organizationId,
            subjectId: actorUserId,
            recordId: "claim-wp3-1",
            recordRevision: 1,
          },
          basis: "initial_model_endorsement",
          confirmedAt: now,
          confirmedBy: {
            kind: "human",
            organizationId,
            subjectId: actorUserId,
          },
        }),
      ).rejects.toThrow("CLAIM_UNAVAILABLE");

      const requestedAt = "2026-09-14T11:00:00.000Z";
      const operationId = "delete-obs-wp3-1";
      const target = {
        scopeKind: "record" as const,
        digest: twinObservationTargetDigest(observationId),
      };
      const actor = {
        actorClass: "human" as const,
        subjectId: actorUserId,
        actorReference: "human-ref-1",
      };
      const validation = {
        scope: { organizationId, subjectId: actorUserId },
        now: "2026-09-14T23:00:00.000Z",
      };
      const requested = {
        operationId,
        policyVersion: TWIN_RIGHTS_OPERATION_POLICY,
        scope: { organizationId, subjectId: actorUserId },
        type: "DELETE" as const,
        target,
        requestedAt,
        requestedBy: actor,
        acceptedBy: null,
        history: [
          {
            sequence: 1,
            state: "REQUESTED" as const,
            at: requestedAt,
            completionEvidenceDigest: null,
          },
        ],
        attempts: [],
        effect: null,
      };
      await repo().recordRightsOperation(human(), requested, validation);
      for (const row of [
        { digest: digest("2"), evidenceClass: "rights-accepted" },
        { digest: digest("3"), evidenceClass: "use-blocked" },
      ]) {
        await repo().admitCompletionEvidence(human(), {
          digest: row.digest,
          evidenceClass: row.evidenceClass,
          producerReference: "rights-controller",
          admittedByReference: "human-ref-1",
        });
      }
      const blocked = {
        ...requested,
        acceptedBy: actor,
        history: [
          requested.history[0],
          {
            sequence: 2,
            state: "ACCEPTED" as const,
            at: "2026-09-14T11:01:00.000Z",
            completionEvidenceDigest: digest("2"),
          },
          {
            sequence: 3,
            state: "USE_BLOCKED" as const,
            at: "2026-09-14T11:02:00.000Z",
            completionEvidenceDigest: digest("3"),
          },
        ],
      };
      await repo().recordRightsOperation(human(), blocked, validation);
      expect(await repo().current(human())).toEqual([]);
      expect((await repo().history(human())).observations).toEqual([]);
      expect((await repo().history(human())).claims).toEqual([]);
      await repo().executeQualifiedRemoval(human(), operationId, "observation", observationId);
      expect((await repo().history(human())).observations).toEqual([]);
      await expect(
        repo().recordRightsOperation(
          human(),
          {
            ...blocked,
            history: [
              ...blocked.history,
              {
                sequence: 4,
                state: "LIVE_REMOVAL_IN_PROGRESS" as const,
                at: "2026-09-14T11:03:00.000Z",
                completionEvidenceDigest: null,
              },
              {
                sequence: 5,
                state: "LIVE_REMOVED" as const,
                at: "2026-09-14T11:04:00.000Z",
                completionEvidenceDigest: digest("2"),
              },
              {
                sequence: 6,
                state: "RESIDUAL_COPIES_PENDING" as const,
                at: "2026-09-14T11:05:00.000Z",
                completionEvidenceDigest: null,
              },
              {
                sequence: 7,
                state: "CLOSED" as const,
                at: "2026-09-14T11:06:00.000Z",
                completionEvidenceDigest: digest("3"),
              },
            ],
            attempts: [
              {
                attemptId: "attempt-1",
                sequence: 1,
                startedAt: "2026-09-14T11:03:10.000Z",
                completedAt: "2026-09-14T11:03:20.000Z",
                outcome: "SUCCEEDED" as const,
                outcomeCode: "LIVE_CLEANUP_VERIFIED",
                completionEvidenceDigest: digest("2"),
              },
            ],
          },
          validation,
        ),
      ).rejects.toThrow("COPY_INVENTORY_REQUIRED");
      expect(await repo().current(human())).toEqual([]);
    }, 60000);
  },
);
