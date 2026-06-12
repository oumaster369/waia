import Database from "better-sqlite3";

import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { resolveE2ESqlitePath } from "@/tests/e2e/helpers/dashboard-sqlite";

/** Test fixture: grant trader entitlement for an existing user's personal org (direct SQLite). */
export function grantTraderEntitlementByUserEmail(email: string): void {
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

    const organizationId = personalOrganizationIdFromUserId(userRow.id);
    const now = Date.now();

    db.prepare(
      `INSERT INTO organization_entitlements (id, organization_id, entitlement_key, enabled, source_module, created_at, updated_at)
       VALUES (@id, @organization_id, 'trader', 1, 'trader', @now, @now)
       ON CONFLICT(organization_id, entitlement_key) DO UPDATE SET enabled = 1, updated_at = @now`,
    ).run({
      id: crypto.randomUUID(),
      organization_id: organizationId,
      now,
    });
  } finally {
    db.close();
  }
}
