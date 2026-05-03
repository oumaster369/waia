import bcrypt from "bcryptjs";

import { users } from "@/db/schema";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

export function insertEmailPasswordUser(
  db: WaiaSqliteDb,
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
