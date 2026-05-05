import bcrypt from "bcryptjs";

import { users } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

/** Synchronous inserts for Vitest fixtures (`beforeAll` stays sync until DEE-64B1 follow-up). */
export function insertEmailPasswordUser(
  db: WaiaDb,
  params: { id: string; email: string; password: string; identityLabel?: string },
): void {
  const email = params.email.trim().toLowerCase();
  db.insert(users)
    .values({
      id: params.id,
      email,
      identityLabel: params.identityLabel ?? email.split("@")[0] ?? email,
      passwordHash: bcrypt.hashSync(params.password, 10),
    })
    .run();
  ensureUserTwinSeed(db, params.id);
}
