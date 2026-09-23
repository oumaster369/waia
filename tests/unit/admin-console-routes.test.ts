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
