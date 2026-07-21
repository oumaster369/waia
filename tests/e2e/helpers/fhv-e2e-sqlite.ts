import Database from "better-sqlite3";

import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { resolveE2ESqlitePath } from "@/tests/e2e/helpers/dashboard-sqlite";

export function grantPlatformAdminByUserEmail(email: string): string {
  const fp = resolveE2ESqlitePath();
  if (fp === ":memory:") {
    throw new Error(
      "[e2e] DATABASE_URL is :memory:; Playwright needs a shared on-disk SQLite file.",
    );
  }

  const db = new Database(fp);
  db.pragma("foreign_keys = ON");
  try {
    const userRow = db
      .prepare(`SELECT id FROM users WHERE email = @email LIMIT 1`)
      .get({ email: email.trim().toLowerCase() }) as { id: string } | undefined;

    if (!userRow) {
      throw new Error(`[e2e] No user row for email ${email}`);
    }

    db.prepare(`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = @userId`).run({
      userId: userRow.id,
    });

    return personalOrganizationIdFromUserId(userRow.id);
  } finally {
    db.close();
  }
}
