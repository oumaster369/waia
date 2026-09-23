import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { authorizeFleetAdmin } from "@/lib/trader/admin-console/auth";
import { findQuickAnswer, QUICK_ANSWERS } from "@/lib/trader/admin-console/assistant/quick-answers";
import { wrapToolResult } from "@/lib/trader/admin-console/assistant/guard";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";

export async function handleAdminConsoleAssistantQuickAnswersGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const auth = await authorizeFleetAdmin(deps, "admin.audit.read");
  if (!auth.ok) return auth.result;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return adminSuccess(
        adminEnvelope({
          data: { withoutModel: true, answers: QUICK_ANSWERS },
          scope: { kind: "fleet" },
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
        },
        scope: { kind: "fleet" },
      }),
      auth.runtime.kind === "sqlite" ? "sqlite" : "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(auth.runtime);
  }
}
