import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createProductionTwinRepository } from "@/lib/ai-twin/model/postgres-production-repository";
import { TWIN_RETENTION_POLICY } from "@/lib/ai-twin/model/lifecycle";
import type { ModelContext } from "@/lib/ai-twin/model/contracts";

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
  },
);
