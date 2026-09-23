import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  traderAdminAssistantConversation,
  traderAdminAssistantMessage,
  traderAdminAssistantToolCall,
} from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

export async function handleAdminConsoleAssistantTraceGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  messageId: string,
): Promise<AdminRouteHandlerResult> {
  if (!z.string().uuid().safeParse(messageId).success) {
    return adminClientError(400, "BAD_REQUEST", "Message id is invalid.");
  }
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  try {
    const owned = await opened.runtime.db
      .select({ id: traderAdminAssistantMessage.id })
      .from(traderAdminAssistantMessage)
      .innerJoin(
        traderAdminAssistantConversation,
        eq(traderAdminAssistantMessage.conversationId, traderAdminAssistantConversation.id),
      )
      .where(
        and(
          eq(traderAdminAssistantMessage.id, messageId),
          eq(traderAdminAssistantConversation.adminUserId, opened.userId),
        ),
      )
      .limit(1);
    if (owned.length === 0) {
      return adminClientError(404, "NOT_FOUND", "Message was not found.");
    }
    const calls = await opened.runtime.db
      .select({
        id: traderAdminAssistantToolCall.id,
        toolName: traderAdminAssistantToolCall.toolName,
        toolVersion: traderAdminAssistantToolCall.toolVersion,
        argsJson: traderAdminAssistantToolCall.argsJson,
        resultSummaryJson: traderAdminAssistantToolCall.resultSummaryJson,
        status: traderAdminAssistantToolCall.status,
        errorCode: traderAdminAssistantToolCall.errorCode,
      })
      .from(traderAdminAssistantToolCall)
      .where(eq(traderAdminAssistantToolCall.messageId, messageId));
    return adminSuccess(
      adminEnvelope({
        data: { messageId, calls },
        scope: { kind: "fleet" },
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
