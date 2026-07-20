import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  serializeAccountStatusProjection,
  serializeEffectiveKillSwitchState,
  serializeOrgLiveEnableView,
  serializePromotionRecord,
} from "@/lib/trader/admin-serialize";
import {
  adminSuccess,
  authorizeAdminRoute,
  mapServiceError,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { probeExecutionHostHealth } from "@/lib/trader/live/execution-host-health";
import {
  createPostgresOrgLiveEnableService,
  createSqliteOrgLiveEnableService,
} from "@/lib/trader/live/org-live-enable-service";
import {
  createPostgresKillSwitchService,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch/kill-switch-service";
import { createPostgresAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-postgres";
import { createSqliteAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-sqlite";
import {
  createPostgresStrategyPromotionService,
  createSqliteStrategyPromotionService,
} from "@/lib/trader/validation-gate/promotion-service";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const OVERVIEW_STRATEGY_IDS = ["mean_reversion_v0", "liquidity_sweep_reversal_v0"] as const;

function createKillSwitchService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteKillSwitchService(runtime.db);
  }
  return createPostgresKillSwitchService(runtime.db);
}

function createOrgLiveEnableService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteOrgLiveEnableService(runtime.db);
  }
  return createPostgresOrgLiveEnableService(runtime.db);
}

function createPromotionService(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteStrategyPromotionService(runtime.db);
  }
  return createPostgresStrategyPromotionService(runtime.db);
}

function createAccountStatusRepository(
  runtime: Awaited<ReturnType<AdminRouteHandlerDeps["getRuntimeDb"]>>,
) {
  if (runtime.kind === "sqlite") {
    return createSqliteAccountStatusRepository(runtime.db);
  }
  return createPostgresAccountStatusRepository(runtime.db);
}

export async function handleAdminOverviewGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  const exchangeAccountId = url.searchParams.get("exchange_account_id")?.trim() || null;

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const context = requireOrgContext(orgParsed);

    const liveEnableService = createOrgLiveEnableService(runtime);
    const killSwitchService = createKillSwitchService(runtime);
    const promotionService = createPromotionService(runtime);

    const [liveEnableState, killSwitchEffective, runtimeHealth, ...promotions] = await Promise.all([
      liveEnableService.getState(context),
      killSwitchService.getEffectiveState(context),
      probeExecutionHostHealth(process.env),
      ...OVERVIEW_STRATEGY_IDS.map((strategyId) =>
        promotionService.getEffectivePromotion(context, strategyId),
      ),
    ]);

    let accountStatus = null;
    if (exchangeAccountId) {
      const accountStatusRepository = createAccountStatusRepository(runtime);
      accountStatus = await accountStatusRepository.getProjection(context, exchangeAccountId);
    }

    const effectivePromotions = Object.fromEntries(
      OVERVIEW_STRATEGY_IDS.map((strategyId, index) => [
        strategyId,
        promotions[index] ? serializePromotionRecord(promotions[index]!) : null,
      ]),
    );

    return adminSuccess(
      {
        organizationId: orgParsed,
        liveEnable: liveEnableState ? serializeOrgLiveEnableView(liveEnableState) : null,
        killSwitchEffective: serializeEffectiveKillSwitchState(killSwitchEffective),
        effectivePromotions,
        runtimeHealth: {
          executionHostHealthy: runtimeHealth,
          executionHostConfigured: Boolean(process.env.WAIA_TRADER_EXECUTION_HOST_URL?.trim()),
        },
        accountStatus: accountStatus ? serializeAccountStatusProjection(accountStatus) : null,
      },
      runtime.kind,
    );
  } catch (err) {
    return mapServiceError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
