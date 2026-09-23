import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { traderAdminAssistantConversation } from "@/db/schema.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
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
  const opened = await openAdminConsole(_request, deps);
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
        scope: { kind: "fleet" },
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
  const opened = await openAdminConsole(request, deps, { mutate: true });
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
      title: parsed.data.title ?? "Новый разговор",
      createdAt: now,
      updatedAt: now,
    });
    return adminSuccess(
      adminEnvelope({
        data: {
          conversation: {
            id,
            title: parsed.data.title ?? "Новый разговор",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
        scope: { kind: "fleet" },
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
  const opened = await openAdminConsole(request, deps);
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
    return adminSuccess(
      adminEnvelope({ data: { conversation: toDto(row) }, scope: { kind: "fleet" } }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
