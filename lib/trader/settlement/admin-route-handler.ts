import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  serializeAccountStatusEvent,
  serializeAccountStatusProjection,
} from "@/lib/trader/admin-serialize";
import {
  adminClientError,
  adminSuccess,
  authorizeAdminRoute,
  mapServiceError,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { createPostgresAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-postgres";
import { createSqliteAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function parseExchangeAccountId(url: URL): string | AdminRouteHandlerResult {
  const exchangeAccountId = url.searchParams.get("exchange_account_id")?.trim();
  if (!exchangeAccountId) {
    return adminClientError(
      400,
      "EXCHANGE_ACCOUNT_ID_REQUIRED",
      "exchange_account_id query param required.",
    );
  }
  return exchangeAccountId;
}

function createAccountStatusRepository(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteAccountStatusRepository(runtime.db);
  }
  return createPostgresAccountStatusRepository(runtime.db);
}

export async function handleAdminAccountStatusGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }
  const exchangeAccountId = parseExchangeAccountId(url);
  if (typeof exchangeAccountId !== "string") {
    return exchangeAccountId;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const context = requireOrgContext(orgParsed);
    const repository = createAccountStatusRepository(runtime);

    const [projection, events] = await Promise.all([
      repository.getProjection(context, exchangeAccountId),
      repository.listEventsForAccount(context, exchangeAccountId),
    ]);

    return adminSuccess(
      {
        projection: projection ? serializeAccountStatusProjection(projection) : null,
        events: events.map(serializeAccountStatusEvent),
      },
      runtime.kind,
    );
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
