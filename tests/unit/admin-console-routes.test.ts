import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { handleAdminConsoleTimeGet } from "@/lib/trader/admin-console/handlers/time";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a951";
const ADMIN_ID = "00000000-0000-4000-8000-00000000a952";

describe("admin console routes on sqlite", () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-admin-console-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "console.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "console-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "console-admin@waia.invalid",
      password: "password123",
    });
    ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Console User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Console Admin" });
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
  });

  function deps(userId: string | null): AdminRouteHandlerDeps {
    return {
      getUserId: async () => userId,
      getRuntimeDb: getWaiaRuntimeDb,
      disposeRuntimeDb: disposeWaiaRuntimeDb,
    };
  }

  it("requires a signed-in admin and returns POSTGRES_REQUIRED on sqlite", async () => {
    const request = new Request("http://localhost/api/trader/admin/console/time");
    const anonymous = await handleAdminConsoleTimeGet(request, deps(null));
    expect(anonymous.status).toBe(401);
    const forbidden = await handleAdminConsoleTimeGet(request, deps(USER_ID));
    expect(forbidden.status).toBe(403);
    const allowed = await handleAdminConsoleTimeGet(request, deps(ADMIN_ID));
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).toContain("POSTGRES_REQUIRED");
  });

  it("returns POSTGRES_REQUIRED for client and invoice reads on sqlite", async () => {
    const { handleAdminConsoleClientsGet } =
      await import("@/lib/trader/admin-console/handlers/clients");
    const { handleAdminConsoleInvoicesGet } =
      await import("@/lib/trader/admin-console/handlers/invoices");
    const clients = await handleAdminConsoleClientsGet(
      new Request("http://localhost/api/trader/admin/console/clients"),
      deps(ADMIN_ID),
    );
    const invoices = await handleAdminConsoleInvoicesGet(
      new Request("http://localhost/api/trader/admin/console/invoices"),
      deps(ADMIN_ID),
    );
    expect(clients.status).toBe(200);
    expect(invoices.status).toBe(200);
    expect(JSON.stringify(clients.body)).toContain("POSTGRES_REQUIRED");
    expect(JSON.stringify(invoices.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsoleIncidentsGet } =
      await import("@/lib/trader/admin-console/handlers/incidents");
    const incidents = await handleAdminConsoleIncidentsGet(
      new Request("http://localhost/api/trader/admin/console/incidents"),
      deps(ADMIN_ID),
    );
    expect(incidents.status).toBe(200);
    expect(JSON.stringify(incidents.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsolePaymentsGet } =
      await import("@/lib/trader/admin-console/handlers/payments");
    const { handleAdminConsoleDisputesGet } =
      await import("@/lib/trader/admin-console/handlers/disputes");
    const payments = await handleAdminConsolePaymentsGet(
      new Request("http://localhost/api/trader/admin/console/payments"),
      deps(ADMIN_ID),
    );
    const disputes = await handleAdminConsoleDisputesGet(
      new Request("http://localhost/api/trader/admin/console/disputes"),
      deps(ADMIN_ID),
    );
    expect(payments.status).toBe(200);
    expect(disputes.status).toBe(200);
    expect(JSON.stringify(payments.body)).toContain("POSTGRES_REQUIRED");
    expect(JSON.stringify(disputes.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsoleExportGet } =
      await import("@/lib/trader/admin-console/handlers/export");
    const exported = await handleAdminConsoleExportGet(
      new Request("http://localhost/api/trader/admin/console/export?dataset=invoices"),
      deps(ADMIN_ID),
    );
    expect(exported.status).toBe(200);
    expect(JSON.stringify(exported.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsoleProposalsGet } =
      await import("@/lib/trader/admin-console/handlers/proposals");
    const proposals = await handleAdminConsoleProposalsGet(
      new Request("http://localhost/api/trader/admin/console/proposals"),
      deps(ADMIN_ID),
    );
    expect(proposals.status).toBe(200);
    expect(JSON.stringify(proposals.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsoleCycleTraceGet } =
      await import("@/lib/trader/admin-console/handlers/cycle-trace");
    const invalid = await handleAdminConsoleCycleTraceGet(
      new Request("http://localhost/api/trader/admin/console/cycles/not-a-uuid"),
      deps(ADMIN_ID),
      "not-a-uuid",
    );
    expect(invalid.status).toBe(400);
    const trace = await handleAdminConsoleCycleTraceGet(
      new Request(
        "http://localhost/api/trader/admin/console/cycles/00000000-0000-4000-8000-000000000001",
      ),
      deps(ADMIN_ID),
      "00000000-0000-4000-8000-000000000001",
    );
    expect(trace.status).toBe(200);
    expect(JSON.stringify(trace.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsoleFillsGet } =
      await import("@/lib/trader/admin-console/handlers/fills");
    const { handleAdminConsoleClosedTradesGet } =
      await import("@/lib/trader/admin-console/handlers/closed-trades");
    const fills = await handleAdminConsoleFillsGet(
      new Request("http://localhost/api/trader/admin/console/fills"),
      deps(ADMIN_ID),
    );
    const closed = await handleAdminConsoleClosedTradesGet(
      new Request("http://localhost/api/trader/admin/console/closed-trades"),
      deps(ADMIN_ID),
    );
    expect(fills.status).toBe(200);
    expect(closed.status).toBe(200);
    expect(JSON.stringify(fills.body)).toContain("POSTGRES_REQUIRED");
    expect(JSON.stringify(closed.body)).toContain("POSTGRES_REQUIRED");
    const { handleAdminConsolePositionsGet } =
      await import("@/lib/trader/admin-console/handlers/positions");
    const { handleAdminConsoleAttentionGet } =
      await import("@/lib/trader/admin-console/handlers/attention");
    const positions = await handleAdminConsolePositionsGet(
      new Request("http://localhost/api/trader/admin/console/positions"),
      deps(ADMIN_ID),
    );
    const attention = await handleAdminConsoleAttentionGet(
      new Request("http://localhost/api/trader/admin/console/attention"),
      deps(ADMIN_ID),
    );
    expect(positions.status).toBe(200);
    expect(attention.status).toBe(200);
    expect(JSON.stringify(positions.body)).toContain("POSTGRES_REQUIRED");
    expect(JSON.stringify(attention.body)).toContain("POSTGRES_REQUIRED");
  });

  function assistantMessage(flag: string | undefined): Request {
    if (flag === undefined) delete process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
    else process.env.WAIA_ADMIN_ASSISTANT_ENABLED = flag;
    return new Request("http://localhost/api/trader/admin/console/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        conversationId: "00000000-0000-4000-8000-00000000a952",
        content: "Какие ордера ещё работают?",
      }),
    });
  }

  it("serves help and model-free quick answers, and refuses the model when the flag is off", async () => {
    const { handleAdminConsoleAssistantHelpGet } =
      await import("@/lib/trader/admin-console/handlers/assistant-help");
    const { handleAdminConsoleAssistantQuickAnswersGet } =
      await import("@/lib/trader/admin-console/handlers/assistant-quick-answers");
    const { handleAdminConsoleAssistantMessagesPost } =
      await import("@/lib/trader/admin-console/handlers/assistant-messages");
    const { handleAdminConsoleAssistantConversationsGet } =
      await import("@/lib/trader/admin-console/handlers/assistant-conversations");
    const help = await handleAdminConsoleAssistantHelpGet(
      new Request("http://localhost/api/trader/admin/console/assistant/help"),
      deps(ADMIN_ID),
    );
    expect(help.status).toBe(200);
    expect(JSON.stringify(help.body)).toContain("Сводка");
    expect(JSON.stringify(help.body)).not.toContain("POSTGRES_REQUIRED");
    const anonymous = await handleAdminConsoleAssistantHelpGet(
      new Request("http://localhost/api/trader/admin/console/assistant/help"),
      deps(null),
    );
    expect(anonymous.status).toBe(401);

    const previous = process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
    delete process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
    try {
      const catalog = await handleAdminConsoleAssistantQuickAnswersGet(
        new Request("http://localhost/api/trader/admin/console/assistant/quick-answers"),
        deps(ADMIN_ID),
      );
      expect(catalog.status).toBe(200);
      expect(JSON.stringify(catalog.body)).toContain("withoutModel");
      const incidentsAnswer = await handleAdminConsoleAssistantQuickAnswersGet(
        new Request(
          "http://localhost/api/trader/admin/console/assistant/quick-answers?id=incidents",
        ),
        deps(ADMIN_ID),
      );
      expect(incidentsAnswer.status).toBe(200);
      const incidentsBody = JSON.stringify(incidentsAnswer.body);
      expect(incidentsBody).toContain("withoutModel");
      expect(incidentsBody).toContain("POSTGRES_REQUIRED");
      expect(incidentsBody).not.toContain("ASSISTANT_DISABLED");

      const disabled = await handleAdminConsoleAssistantMessagesPost(
        assistantMessage(undefined),
        deps(ADMIN_ID),
      );
      expect(disabled.status).toBe(200);
      expect(JSON.stringify(disabled.body)).toContain("ASSISTANT_DISABLED");
      const streamed = await handleAdminConsoleAssistantMessagesPost(
        new Request("http://localhost/api/trader/admin/console/assistant/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            conversationId: "00000000-0000-4000-8000-00000000a952",
            content: "Какие ордера ещё работают?",
          }),
        }),
        deps(ADMIN_ID),
      );
      expect(streamed.status).toBe(200);
      expect(new TextDecoder().decode(streamed.binaryBody)).toContain("event: error");
      expect(new TextDecoder().decode(streamed.binaryBody)).toContain("ASSISTANT_DISABLED");

      const enabled = await handleAdminConsoleAssistantMessagesPost(
        assistantMessage("on"),
        deps(ADMIN_ID),
      );
      expect(enabled.status).toBe(200);
      expect(JSON.stringify(enabled.body)).toContain("POSTGRES_REQUIRED");
    } finally {
      if (previous === undefined) delete process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
      else process.env.WAIA_ADMIN_ASSISTANT_ENABLED = previous;
    }

    const conversations = await handleAdminConsoleAssistantConversationsGet(
      new Request("http://localhost/api/trader/admin/console/assistant/conversations"),
      deps(ADMIN_ID),
    );
    expect(conversations.status).toBe(200);
    expect(JSON.stringify(conversations.body)).toContain("POSTGRES_REQUIRED");
  });
});
