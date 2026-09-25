import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  traderAdminAssistantConversation,
  traderAdminAssistantMessage,
} from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { assistantContext } from "@/lib/trader/admin-console/assistant/context";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { redactDiagnosticText } from "@/lib/trader/admin-console/diagnostics/redact";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

const writeSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

function toDto(row: { id: string; title: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function handleAdminConsoleAssistantConversationsGet(
  _request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsedQuery = parseAdminConsoleQuery(new URL(_request.url));
  if (!parsedQuery.ok) return parsedQuery.result;
  const opened = await openAdminConsole(_request, deps, {
    requiredTables: HANDLER_TABLES.assistantConversations,
  });
  if (!opened.ok) return opened.result;
  try {
    const rows = await opened.runtime.db
      .select({
        id: traderAdminAssistantConversation.id,
        title: traderAdminAssistantConversation.title,
        createdAt: traderAdminAssistantConversation.createdAt,
        updatedAt: traderAdminAssistantConversation.updatedAt,
      })
      .from(traderAdminAssistantConversation)
      .where(
        and(
          eq(traderAdminAssistantConversation.adminUserId, opened.userId),
          isNull(traderAdminAssistantConversation.archivedAt),
        ),
      )
      .orderBy(desc(traderAdminAssistantConversation.updatedAt))
      .limit(50);
    return adminSuccess(
      adminEnvelope({
        data: { conversations: rows.map(toDto) },
        scope: adminScopeFromQuery(parsedQuery.query),
        mode: parsedQuery.query.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

export async function handleAdminConsoleAssistantConversationsPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsedQuery = parseAdminConsoleQuery(new URL(request.url));
  if (!parsedQuery.ok) return parsedQuery.result;
  const opened = await openAdminConsole(request, deps, {
    mutate: true,
    requiredTables: HANDLER_TABLES.assistantConversations,
  });
  if (!opened.ok) return opened.result;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminClientError(400, "BAD_REQUEST", "JSON body required.");
  }
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminClientError(400, "BAD_REQUEST", "Conversation body is invalid.");
  }
  try {
    const now = new Date();
    const id = crypto.randomUUID();
    await opened.runtime.db.insert(traderAdminAssistantConversation).values({
      id,
      organizationId: opened.contextOrgId,
      adminUserId: opened.userId,
      title: redactDiagnosticText(parsed.data.title ?? "Новый разговор", 80),
      createdAt: now,
      updatedAt: now,
    });
    return adminSuccess(
      adminEnvelope({
        data: {
          conversation: {
            id,
            title: redactDiagnosticText(parsed.data.title ?? "Новый разговор", 80),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
        scope: adminScopeFromQuery(parsedQuery.query),
        mode: parsedQuery.query.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

export async function handleAdminConsoleAssistantConversationGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  conversationId: string,
): Promise<AdminRouteHandlerResult> {
  if (!z.string().uuid().safeParse(conversationId).success) {
    return adminClientError(400, "BAD_REQUEST", "Conversation id is invalid.");
  }
  const parsedQuery = parseAdminConsoleQuery(new URL(request.url));
  if (!parsedQuery.ok) return parsedQuery.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.assistantConversations,
  });
  if (!opened.ok) return opened.result;
  try {
    const rows = await opened.runtime.db
      .select({
        id: traderAdminAssistantConversation.id,
        title: traderAdminAssistantConversation.title,
        createdAt: traderAdminAssistantConversation.createdAt,
        updatedAt: traderAdminAssistantConversation.updatedAt,
      })
      .from(traderAdminAssistantConversation)
      .where(
        and(
          eq(traderAdminAssistantConversation.id, conversationId),
          eq(traderAdminAssistantConversation.adminUserId, opened.userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return adminClientError(404, "NOT_FOUND", "Conversation was not found.");
    const context = assistantContext(parsedQuery.query);
    const messages = await opened.runtime.db
      .select({
        id: traderAdminAssistantMessage.id,
        role: traderAdminAssistantMessage.role,
        content: traderAdminAssistantMessage.content,
        status: traderAdminAssistantMessage.status,
        blocks: traderAdminAssistantMessage.blocksJson,
        context: traderAdminAssistantMessage.scopeJson,
        revisions: traderAdminAssistantMessage.dataRevisionsJson,
        at: traderAdminAssistantMessage.createdAt,
        promptVersion: traderAdminAssistantMessage.promptVersion,
      })
      .from(traderAdminAssistantMessage)
      .where(
        and(
          eq(traderAdminAssistantMessage.conversationId, conversationId),
          sql`${traderAdminAssistantMessage.scopeJson}->>'contextKey' = ${context.contextKey}`,
        ),
      )
      .orderBy(
        desc(traderAdminAssistantMessage.createdAt),
        asc(traderAdminAssistantMessage.role),
        desc(traderAdminAssistantMessage.id),
      )
      .limit(50);
    return adminSuccess(
      adminEnvelope({
        data: {
          conversation: toDto(row),
          context,
          messages: messages.reverse().map((m) => ({
            id: m.id,
            role: m.role,
            status: m.status,
            content:
              m.role === "assistant" && m.promptVersion !== "admin-assistant/v2"
                ? "Старый ответ не прошёл проверку фактов. Запросите актуальные данные."
                : redactDiagnosticText(m.content, 8000),
            blocks: m.promptVersion === "admin-assistant/v2" ? m.blocks : null,
            context: m.context,
            revisions: m.revisions,
            at: m.at.toISOString(),
          })),
        },
        scope: context.scope,
        mode: parsedQuery.query.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
