import Database from "better-sqlite3";

import { resolveE2ESqlitePath } from "@/tests/e2e/helpers/dashboard-sqlite";

/** Grant platform admin (treasury read/mutate/publish) for an existing e2e user. */
export function grantPlatformAdminByUserEmail(email: string): { userId: string } {
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
    db.prepare(
      `INSERT INTO user_platform_roles (user_id, role, created_at)
       VALUES (@user_id, 'admin', @now)
       ON CONFLICT(user_id) DO UPDATE SET role = 'admin'`,
    ).run({ user_id: userRow.id, now: Date.now() });
    return { userId: userRow.id };
  } finally {
    db.close();
  }
}
