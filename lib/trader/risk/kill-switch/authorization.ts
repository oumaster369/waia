import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { organizationMembers, userPlatformRoles } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { KillSwitchAuthorizationError } from "@/lib/trader/risk/kill-switch/errors";
import type { KillSwitchActor, KillSwitchTarget } from "@/lib/trader/risk/kill-switch/types";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

const TRUSTED_RUNTIME_ACTOR_TYPES = new Set(["service", "system"]);
const HUMAN_RECOVERY_ACTOR_TYPES = new Set(["user", "admin"]);

function assertHumanRecoveryActor(actor: KillSwitchActor): void {
  if (!actor.actorId) {
    throw new KillSwitchAuthorizationError();
  }
  if (
    actor.actorType === "service" ||
    actor.actorType === "system" ||
    actor.actorType === "agent"
  ) {
    throw new KillSwitchAuthorizationError();
  }
  if (!HUMAN_RECOVERY_ACTOR_TYPES.has(actor.actorType)) {
    throw new KillSwitchAuthorizationError();
  }
}

export function assertPlatformKillSwitchAuthoritySqlite(db: WaiaDb, actor: KillSwitchActor): void {
  if (actor.actorId) {
    const roleRow = db
      .select({ role: userPlatformRoles.role })
      .from(userPlatformRoles)
      .where(eq(userPlatformRoles.userId, actor.actorId))
      .limit(1)
      .all()[0];

    if (roleRow?.role !== "admin") {
      throw new KillSwitchAuthorizationError();
    }
    return;
  }

  if (!TRUSTED_RUNTIME_ACTOR_TYPES.has(actor.actorType)) {
    throw new KillSwitchAuthorizationError();
  }
}

export async function assertPlatformKillSwitchAuthorityPostgres(
  ex: PgReadExecutor,
  actor: KillSwitchActor,
): Promise<void> {
  if (actor.actorId) {
    const rows = await ex
      .select({ role: pgSchema.userPlatformRoles.role })
      .from(pgSchema.userPlatformRoles)
      .where(eq(pgSchema.userPlatformRoles.userId, actor.actorId))
      .limit(1);

    if (rows[0]?.role !== "admin") {
      throw new KillSwitchAuthorizationError();
    }
    return;
  }

  if (!TRUSTED_RUNTIME_ACTOR_TYPES.has(actor.actorType)) {
    throw new KillSwitchAuthorizationError();
  }
}

export function assertRecoveryConfirmAuthoritySqlite(
  db: WaiaDb,
  actor: KillSwitchActor,
  target: KillSwitchTarget,
): void {
  assertHumanRecoveryActor(actor);

  if (target.scopeType === "platform") {
    const roleRow = db
      .select({ role: userPlatformRoles.role })
      .from(userPlatformRoles)
      .where(eq(userPlatformRoles.userId, actor.actorId!))
      .limit(1)
      .all()[0];

    if (roleRow?.role !== "admin") {
      throw new KillSwitchAuthorizationError();
    }
    return;
  }

  const memberRow = db
    .select({ memberRole: organizationMembers.memberRole })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, target.organizationId),
        eq(organizationMembers.userId, actor.actorId!),
      ),
    )
    .limit(1)
    .all()[0];

  if (memberRow?.memberRole !== "owner") {
    throw new KillSwitchAuthorizationError();
  }
}

export async function assertRecoveryConfirmAuthorityPostgres(
  ex: PgReadExecutor,
  actor: KillSwitchActor,
  target: KillSwitchTarget,
): Promise<void> {
  assertHumanRecoveryActor(actor);

  if (target.scopeType === "platform") {
    const rows = await ex
      .select({ role: pgSchema.userPlatformRoles.role })
      .from(pgSchema.userPlatformRoles)
      .where(eq(pgSchema.userPlatformRoles.userId, actor.actorId!))
      .limit(1);

    if (rows[0]?.role !== "admin") {
      throw new KillSwitchAuthorizationError();
    }
    return;
  }

  const memberRows = await ex
    .select({ memberRole: pgSchema.organizationMembers.memberRole })
    .from(pgSchema.organizationMembers)
    .where(
      and(
        eq(pgSchema.organizationMembers.organizationId, target.organizationId),
        eq(pgSchema.organizationMembers.userId, actor.actorId!),
      ),
    )
    .limit(1);

  if (memberRows[0]?.memberRole !== "owner") {
    throw new KillSwitchAuthorizationError();
  }
}
