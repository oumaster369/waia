import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { authorizeFleetAdmin } from "@/lib/trader/admin-console/auth";
import { findQuickAnswer, QUICK_ANSWERS } from "@/lib/trader/admin-console/assistant/quick-answers";
import { adminRuntimeFlag } from "@/lib/trader/admin-console/runtime-flags";
import { assistantContext } from "@/lib/trader/admin-console/assistant/context";
import { factsFromTool } from "@/lib/trader/admin-console/assistant/facts";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { assistantEnabled, wrapToolResult } from "@/lib/trader/admin-console/assistant/guard";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";

export async function handleAdminConsoleAssistantQuickAnswersGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const auth = await authorizeFleetAdmin(deps, "admin.audit.read");
  if (!auth.ok) return auth.result;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return adminSuccess(
        adminEnvelope({
          data: {
            withoutModel: true,
            answers: QUICK_ANSWERS,
            context: assistantContext(parsed.query),
            enabled: assistantEnabled({
              WAIA_ADMIN_ASSISTANT_ENABLED: adminRuntimeFlag("WAIA_ADMIN_ASSISTANT_ENABLED"),
            }),
          },
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
        }),
        auth.runtime.kind === "sqlite" ? "sqlite" : "postgres",
      );
    }
    const answer = findQuickAnswer(id);
    if (!answer) return adminClientError(404, "NOT_FOUND", "Quick answer was not found.");
    const seen = new Set<string>();
    const tables: { tool: string; body: unknown; text: string }[] = [];
    for (const tool of answer.tools) {
      const key = tool === "list_jobs" || tool === "release_info" ? "system_status" : tool;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = await readAssistantTool(tool, request, deps);
      const text = wrapToolResult(tool, JSON.stringify(result.body));
      tables.push({ tool, body: result.body, text });
    }
    return adminSuccess(
      adminEnvelope({
        data: {
          withoutModel: true,
          id: answer.id,
          title: answer.title,
          tools: answer.tools,
          tables,
          context: assistantContext(parsed.query),
          facts: tables.flatMap((table) => factsFromTool(table, parsed.query)),
        },
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
      }),
      auth.runtime.kind === "sqlite" ? "sqlite" : "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(auth.runtime);
  }
}
