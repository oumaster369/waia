import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { StrategyPromotionService } from "@/lib/trader/validation-gate/promotion-service";
import {
  StrategyPromotionRequiredError,
  StrategyPromotionVersionMismatchError,
} from "@/lib/trader/validation-gate/strategy-promotion-record.errors";
import type { StrategyLiveAuthorizationInput } from "@/lib/trader/validation-gate/strategy-promotion-record.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Fail-closed live authorization guard for AT-E10.
 *
 * Caller MUST pass `strategyId` and `strategyVersion` from `StrategySignal` at the live
 * order boundary. Does not check org-level live-enable (AT-E10/AT-E13) or git commit SHA.
 */
export async function assertStrategyLiveAuthorized(
  service: StrategyPromotionService,
  context: OrgContext,
  input: StrategyLiveAuthorizationInput,
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);
  const record = await service.getEffectivePromotion(scoped, input.strategyId);

  if (!record) {
    throw new StrategyPromotionRequiredError();
  }

  if (record.strategyVersion !== input.strategyVersion) {
    throw new StrategyPromotionVersionMismatchError();
  }
}
