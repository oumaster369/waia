import { describe, expect, it } from "vitest";

import { handleAdminConsoleSearchGet } from "@/lib/trader/admin-console/handlers/search";
import { handleAdminConsoleStreamPoll } from "@/lib/trader/admin-console/stream/console-stream";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";

const deps: AdminRouteHandlerDeps = {
  getUserId: async () => {
    throw new Error("auth should not run for a short query");
  },
  getRuntimeDb: async () => {
    throw new Error("db should not run for a short query");
  },
  disposeRuntimeDb: async () => undefined,
};

describe("admin console search", () => {
  it("rejects a query shorter than two characters", async () => {
    const result = await handleAdminConsoleSearchGet(
      new Request("http://localhost/api/trader/admin/console/search?q=a"),
      deps,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "QUERY_TOO_SHORT" } });
  });

  it("rejects an unknown stream topic before opening a database", async () => {
    const result = await handleAdminConsoleStreamPoll(
      new Request("http://localhost/api/trader/admin/console/stream?topics=not-a-topic"),
      deps,
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "UNKNOWN_TOPIC" } });
  });
});
