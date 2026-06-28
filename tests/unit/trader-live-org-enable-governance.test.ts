import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import {
  OrgLiveEnableAckRequiredError,
  OrgLiveEnableCoolingOffNotElapsedError,
  REQUIRED_ORG_LIVE_ENABLE_ACK,
  createSqliteOrgLiveEnableService,
} from "@/lib/trader/live";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000212a";
const OPERATOR = { actorType: "admin" as const, actorId: "operator-212" };

describe("org live-enable governance FSM (DEE-212 / BP-7)", () => {
  let orgA: string;
  let nowMs = 1_700_000_000_000;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-live-enable-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "live-enable.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "live-enable@example.com",
      password: "password123",
    });
    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Live Enable A" });
  });

  function service() {
    return createSqliteOrgLiveEnableService(getDb(), { nowMs: () => nowMs });
  }

  it("runs request → confirm → enable → disable with audit trail", async () => {
    const context = requireOrgContext(orgA);
    const svc = service();

    const requested = await svc.requestEnable(OPERATOR, context, { maxNotionalCap: "10.00" });
    expect(requested.state).toBe("REQUESTED");
    expect(requested.stateVersion).toBe(1);

    const confirmed = await svc.confirmEnable(OPERATOR, context, {
      expectedStateVersion: requested.stateVersion,
      ackPhrase: REQUIRED_ORG_LIVE_ENABLE_ACK,
    });
    expect(confirmed.state).toBe("COOLING_OFF");

    await expect(
      svc.markEnabled(OPERATOR, context, { expectedStateVersion: confirmed.stateVersion }),
    ).rejects.toThrow(OrgLiveEnableCoolingOffNotElapsedError);

    nowMs += 900_001;
    const enabled = await svc.markEnabled(OPERATOR, context, {
      expectedStateVersion: confirmed.stateVersion,
    });
    expect(enabled.state).toBe("ENABLED");

    const disabled = await svc.disable(OPERATOR, context, {
      expectedStateVersion: enabled.stateVersion,
      reason: "drill complete",
    });
    expect(disabled.state).toBe("DISABLED");

    const db = getDb();
    const auditActions = db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgA))
      .all()
      .map((row) => row.action);

    expect(auditActions).toEqual(
      expect.arrayContaining([
        traderAuditActions.orgLiveEnableRequested,
        traderAuditActions.orgLiveEnableConfirmed,
        traderAuditActions.orgLiveEnableEnabled,
        traderAuditActions.orgLiveEnableDisabled,
      ]),
    );
  });

  it("rejects confirm without exact ack phrase", async () => {
    const context = requireOrgContext(orgA);
    const svc = service();
    const requested = await svc.requestEnable(OPERATOR, context, { maxNotionalCap: "5.00" });
    await expect(
      svc.confirmEnable(OPERATOR, context, {
        expectedStateVersion: requested.stateVersion,
        ackPhrase: "wrong phrase",
      }),
    ).rejects.toThrow(OrgLiveEnableAckRequiredError);
  });
});
