/**
 * Risk Engine Service (DEE-241).
 *
 * Fail-closed pre-trade gate that orchestrates the trade-abuse (DEE-238) and
 * capital (DEE-240) evaluators over org-scoped limits (DEE-239), merges their
 * results into one canonical RiskDecision, generates a risk_decision_id
 * (Master Spec §14 idempotency), and writes a metadata-only audit event on
 * every evaluation.
 *
 * Merge invariants (see plan INV-1..INV-6):
 * - Resize metadata is present iff the final outcome is RESIZE (enforced
 *   structurally via the DEE-238 decision factories).
 * - RESIZE originates only from trade-abuse; the capital evaluator never emits it.
 * - Final reasonCodes are the de-duplicated union of every evaluator that ran.
 * - The snapshot describes the originally-requested order; trimmed values live
 *   only in the resize hint.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { evaluateCapitalLimits } from "@/lib/trader/risk/capital-limits-evaluator";
import {
  approveDecision,
  buildRiskSnapshot,
  closeOnlyDecision,
  isTerminalReject,
  mergeReasonCodes,
  rejectDecision,
  resizeDecision,
  stopAccountDecision,
} from "@/lib/trader/risk/decision";
import type {
  EvaluateOrderRequestInput,
  RiskEngineDecision,
  RiskEngineService,
  RiskEngineServiceDeps,
} from "@/lib/trader/risk/evaluate.types";
import {
  createPostgresRiskLimitsService,
  createSqliteRiskLimitsService,
} from "@/lib/trader/risk/limits/limits-service";
import { toCapitalLimitsConfig, toTradeAbuseLimitsConfig } from "@/lib/trader/risk/limits/types";
import {
  buildKillSwitchAuditMetadata,
  mapEffectiveStateToDecision,
} from "@/lib/trader/risk/kill-switch-enforcement";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { engineReasonCodes, type RiskReasonCode } from "@/lib/trader/risk/reason-codes";
import { evaluateTradeAbuse } from "@/lib/trader/risk/trade-abuse-evaluator";
import type {
  RiskCheckName,
  RiskDecision,
  RiskDecisionOutcome,
  RiskSnapshot,
} from "@/lib/trader/risk/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgRiskEngineExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

const OUTCOME_ORDINAL: Record<RiskDecisionOutcome, number> = {
  APPROVE: 0,
  RESIZE: 1,
  REJECT: 2,
  CLOSE_ONLY: 3,
  STOP_ACCOUNT: 4,
};

/** Total order over outcomes; ties keep the left (equal-restriction) outcome. */
function mostRestrictive(a: RiskDecisionOutcome, b: RiskDecisionOutcome): RiskDecisionOutcome {
  return OUTCOME_ORDINAL[a] >= OUTCOME_ORDINAL[b] ? a : b;
}

function mergeChecks(a: RiskCheckName[], b: RiskCheckName[]): RiskCheckName[] {
  const seen = new Set<RiskCheckName>();
  const out: RiskCheckName[] = [];
  for (const check of [...a, ...b]) {
    if (!seen.has(check)) {
      seen.add(check);
      out.push(check);
    }
  }
  return out;
}

/**
 * Merge two evaluator decisions into one canonical RiskDecision, building the
 * result through the appropriate factory so resize metadata can only attach to
 * a RESIZE outcome (INV-1/INV-2).
 */
function mergeDecisions(
  tradeAbuse: RiskDecision,
  capital: RiskDecision,
  evaluatedAt: string,
): RiskDecision {
  const outcome = mostRestrictive(tradeAbuse.outcome, capital.outcome);
  const reasonCodes = mergeReasonCodes(tradeAbuse.reasonCodes, capital.reasonCodes);
  const snapshot: RiskSnapshot = {
    ...tradeAbuse.snapshot,
    checksApplied: mergeChecks(tradeAbuse.snapshot.checksApplied, capital.snapshot.checksApplied),
  };

  switch (outcome) {
    case "APPROVE":
      return approveDecision(snapshot, evaluatedAt);
    case "RESIZE":
      // INV-3: RESIZE implies trade-abuse produced a hint. Fail closed if absent.
      if (!tradeAbuse.resize) {
        return rejectDecision(
          mergeReasonCodes(reasonCodes, [engineReasonCodes.evaluationError]),
          snapshot,
          evaluatedAt,
        );
      }
      return resizeDecision(reasonCodes, snapshot, tradeAbuse.resize, evaluatedAt);
    case "REJECT":
      return rejectDecision(reasonCodes, snapshot, evaluatedAt);
    case "CLOSE_ONLY":
      return closeOnlyDecision(reasonCodes, snapshot, evaluatedAt);
    case "STOP_ACCOUNT":
      return stopAccountDecision(reasonCodes, snapshot, evaluatedAt);
  }
}

function failClosedDecision(
  order: EvaluateOrderRequestInput["order"],
  code: RiskReasonCode,
  evaluatedAt: string,
): RiskDecision {
  return rejectDecision([code], buildRiskSnapshot({ order, checksApplied: [] }), evaluatedAt);
}

export function createRiskEngineService(deps: RiskEngineServiceDeps): RiskEngineService {
  return {
    async evaluateOrderRequest(input: EvaluateOrderRequestInput): Promise<RiskEngineDecision> {
      const orgContext = requireOrgContext(input.context.organizationId);
      const limitsContext: OrgContext = input.context.userId
        ? { organizationId: orgContext.organizationId, userId: input.context.userId }
        : orgContext;

      const riskDecisionId = deps.newDecisionId();
      const evaluatedAt = new Date(deps.nowMs()).toISOString();

      const effectiveKillSwitch = await deps.killSwitchResolver.getEffectiveState(orgContext);
      const killSwitchEnforcement = mapEffectiveStateToDecision(
        effectiveKillSwitch,
        input.order,
        evaluatedAt,
      );

      let configVersion: number | null = null;
      let decision: RiskDecision;

      if (killSwitchEnforcement.enforced && killSwitchEnforcement.decision) {
        decision = killSwitchEnforcement.decision;
      } else {
        try {
          const metadata = await deps.limitsService.getLimitsForOrg(limitsContext);

          if (!metadata) {
            decision = failClosedDecision(
              input.order,
              engineReasonCodes.limitsNotConfigured,
              evaluatedAt,
            );
          } else {
            configVersion = metadata.configVersion;

            if (!input.accountState) {
              decision = failClosedDecision(
                input.order,
                engineReasonCodes.accountStateUnavailable,
                evaluatedAt,
              );
            } else {
              const tradeAbuse = evaluateTradeAbuse(
                {
                  order: input.order,
                  referencePrice: input.referencePrice,
                  accountKey: input.accountKey,
                },
                toTradeAbuseLimitsConfig(metadata),
                { nowMs: deps.nowMs, rateStore: deps.rateStore },
              );

              if (isTerminalReject(tradeAbuse.outcome)) {
                decision = tradeAbuse;
              } else {
                const evaluatedOrder =
                  tradeAbuse.outcome === "RESIZE" && tradeAbuse.resize
                    ? { ...input.order, quantity: tradeAbuse.resize.quantity }
                    : input.order;

                const capital = evaluateCapitalLimits(
                  {
                    order: evaluatedOrder,
                    referencePrice: input.referencePrice,
                    accountState: input.accountState,
                  },
                  toCapitalLimitsConfig(metadata),
                  { nowMs: deps.nowMs },
                );

                decision = mergeDecisions(tradeAbuse, capital, evaluatedAt);
              }
            }
          }
        } catch {
          decision = failClosedDecision(
            input.order,
            engineReasonCodes.evaluationError,
            evaluatedAt,
          );
        }
      }

      const auditMetadata: Record<string, unknown> = {
        riskDecisionId,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        symbol: input.order.symbol,
        clientOrderId: input.order.clientOrderId,
        configVersion,
        scopeType: "organization",
        checksApplied: decision.snapshot.checksApplied,
        killSwitch: buildKillSwitchAuditMetadata(effectiveKillSwitch),
      };

      await deps.writeAudit({
        actorType: "service",
        actorId: null,
        action: traderAuditActions.riskDecisionCreated,
        entityType: traderEntityTypes.riskDecision,
        entityId: riskDecisionId,
        organizationId: orgContext.organizationId,
        metadata: auditMetadata,
      });

      return {
        riskDecisionId,
        organizationId: orgContext.organizationId,
        configVersion,
        decision,
      };
    },
  };
}

export function createSqliteRiskEngineService(
  db: WaiaDb,
  deps: Partial<RiskEngineServiceDeps> = {},
): RiskEngineService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return createRiskEngineService({
    limitsService: deps.limitsService ?? createSqliteRiskLimitsService(db),
    killSwitchResolver:
      deps.killSwitchResolver ??
      createKillSwitchResolver({
        repository: createSqliteKillSwitchRepository(db),
        nowMs,
      }),
    rateStore: deps.rateStore ?? createInMemoryOrderRateStore(),
    writeAudit:
      deps.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input)),
    nowMs,
    newDecisionId: deps.newDecisionId ?? (() => crypto.randomUUID()),
  });
}

export function createPostgresRiskEngineService(
  ex: PgRiskEngineExecutor,
  deps: Partial<RiskEngineServiceDeps> = {},
): RiskEngineService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return createRiskEngineService({
    limitsService: deps.limitsService ?? createPostgresRiskLimitsService(ex),
    killSwitchResolver:
      deps.killSwitchResolver ??
      createKillSwitchResolver({
        repository: createPostgresKillSwitchRepository(ex),
        nowMs,
      }),
    rateStore: deps.rateStore ?? createInMemoryOrderRateStore(),
    writeAudit:
      deps.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogPostgres(ex, input)),
    nowMs,
    newDecisionId: deps.newDecisionId ?? (() => crypto.randomUUID()),
  });
}
