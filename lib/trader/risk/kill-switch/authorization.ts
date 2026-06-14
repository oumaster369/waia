import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { userPlatformRoles } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { KillSwitchAuthorizationError } from "@/lib/trader/risk/kill-switch/errors";
import type { KillSwitchActor } from "@/lib/trader/risk/kill-switch/types";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

const TRUSTED_RUNTIME_ACTOR_TYPES = new Set(["service", "system"]);

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
