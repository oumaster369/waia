import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  ExecutionHostUnavailableError,
  LivePathCredentialRequiredError,
  LivePathNotionalCapExceededError,
  LivePathRiskRejectedError,
  LivePathStrategyContextRequiredError,
  OrgLiveEnableRequiredError,
  OrgLiveTradingNotPermittedError,
} from "@/lib/trader/live/errors";
import { assertOrgLiveEnabled } from "@/lib/trader/live/assert-org-live-enabled";
import { probeExecutionHostHealth } from "@/lib/trader/live/execution-host-health";
import type { OrgLiveEnableService } from "@/lib/trader/live/org-live-enable-service";
import { isOrg0Organization } from "@/lib/trader/live/org0-allowlist";
import { isTerminalReject } from "@/lib/trader/risk/decision";
import type { KillSwitchResolverPort, RiskEngineDecision } from "@/lib/trader/risk/evaluate.types";
import type { RiskLimitsService } from "@/lib/trader/risk/limits/types";
import { compareDecimal, minDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import { resolveHtxSecureCredential } from "@/lib/trader/security/htx-secure-credential-resolver";
import { assertStrategyLiveAuthorized } from "@/lib/trader/validation-gate/assert-strategy-live-authorized";
import type { StrategyPromotionService } from "@/lib/trader/validation-gate/promotion-service";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type LivePathAuthorizationInput = {
  submitInput: SubmitOrderInput;
  strategyId: string;
  strategyVersion: string;
  riskDecision?: RiskEngineDecision;
};

export type LivePathAuthorizationDeps = {
  orgLiveEnableService: OrgLiveEnableService;
  promotionService: StrategyPromotionService;
  killSwitchResolver: KillSwitchResolverPort;
  riskLimitsService: RiskLimitsService;
  credentialService: CredentialService;
  env?: Record<string, unknown>;
  probeHostHealth?: (env?: Record<string, unknown>) => Promise<boolean>;
};

function resolveOrderQuantity(
  submitInput: SubmitOrderInput,
  riskDecision?: RiskEngineDecision,
): string {
  if (
    riskDecision?.decision.outcome === "RESIZE" &&
    riskDecision.decision.resize?.quantity != null
  ) {
    return riskDecision.decision.resize.quantity;
  }
  return submitInput.quantity;
}

function resolveEffectiveNotionalCap(
  liveCap: string,
  orgRiskMaxNotional: string | null | undefined,
): string {
  if (orgRiskMaxNotional == null || orgRiskMaxNotional.trim() === "") {
    return liveCap;
  }
  return minDecimal(liveCap, orgRiskMaxNotional);
}

/**
 * Canonical composite live authorization gate (single source of truth).
 * Every live execution request must pass through this function.
 */
export function createAssertLivePathAuthorized(deps: LivePathAuthorizationDeps) {
  const env = deps.env ?? process.env;
  const probeHostHealth = deps.probeHostHealth ?? probeExecutionHostHealth;

  return async function assertLivePathAuthorized(
    context: OrgContext,
    input: LivePathAuthorizationInput,
  ): Promise<void> {
    const scoped = requireOrgContext(context.organizationId);
    const { submitInput, strategyId, strategyVersion, riskDecision } = input;

    if (submitInput.executionMode !== "live") {
      throw new OrgLiveTradingNotPermittedError(scoped.organizationId);
    }

    if (!isOrg0Organization(scoped.organizationId, env)) {
      throw new OrgLiveTradingNotPermittedError(scoped.organizationId);
    }

    const liveState = await deps.orgLiveEnableService.getState(scoped);
    if (!liveState || liveState.state !== "ENABLED") {
      throw new OrgLiveEnableRequiredError();
    }

    await assertStrategyLiveAuthorized(deps.promotionService, scoped, {
      strategyId,
      strategyVersion,
    });

    const killSwitch = await deps.killSwitchResolver.getEffectiveState(scoped);
    if (killSwitch.resolutionStatus === "fail_closed" || killSwitch.blocked) {
      throw new LivePathRiskRejectedError("KILL_SWITCH");
    }

    if (riskDecision != null) {
      if (isTerminalReject(riskDecision.decision.outcome)) {
        throw new LivePathRiskRejectedError(riskDecision.decision.outcome);
      }
      if (
        riskDecision.decision.outcome !== "APPROVE" &&
        riskDecision.decision.outcome !== "RESIZE"
      ) {
        throw new LivePathRiskRejectedError(riskDecision.decision.outcome);
      }

      const quantity = resolveOrderQuantity(submitInput, riskDecision);
      const notional = multiplyDecimal(quantity, submitInput.referencePrice);
      const orgLimits = await deps.riskLimitsService.getLimitsForOrg(scoped);
      const effectiveCap = resolveEffectiveNotionalCap(
        liveState.maxNotionalCap,
        orgLimits?.maxNotional,
      );
      if (compareDecimal(notional, effectiveCap) > 0) {
        throw new LivePathNotionalCapExceededError(notional, effectiveCap);
      }
    }

    if (!submitInput.credentialId) {
      throw new LivePathCredentialRequiredError();
    }

    const metadata = await deps.credentialService.listCredentialMetadata(scoped);
    const credential = metadata.find((row) => row.id === submitInput.credentialId);
    if (!credential || credential.status !== "active" || credential.venue !== "htx") {
      throw new LivePathCredentialRequiredError();
    }

    const decrypted = await deps.credentialService.getDecryptedCredentials(
      scoped,
      submitInput.credentialId,
    );
    resolveHtxSecureCredential({
      venue: credential.venue,
      exchangeAccountId: credential.exchangeAccountId,
      credentials: decrypted,
      permissionMetadata: credential.permissionMetadata,
    });

    const hostHealthy = await probeHostHealth(env);
    if (!hostHealthy) {
      throw new ExecutionHostUnavailableError();
    }
  };
}

export type LivePathAuthorizationHook = (
  context: OrgContext,
  submitInput: SubmitOrderInput,
  options?: { riskDecision?: RiskEngineDecision },
) => Promise<void>;

export function createExecutionLiveAuthorizationHook(
  deps: LivePathAuthorizationDeps,
): LivePathAuthorizationHook {
  const assertLivePathAuthorized = createAssertLivePathAuthorized(deps);
  return async (context, submitInput, options) => {
    if (!submitInput.strategyId || !submitInput.strategyVersion) {
      throw new LivePathStrategyContextRequiredError();
    }
    await assertLivePathAuthorized(context, {
      submitInput,
      strategyId: submitInput.strategyId,
      strategyVersion: submitInput.strategyVersion,
      riskDecision: options?.riskDecision,
    });
  };
}
