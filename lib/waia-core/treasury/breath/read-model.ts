import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type { AuditLogInput } from "@/lib/waia-core/types";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type {
  TreasuryActorContext,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import {
  activeCommitmentsForBudget,
  assignedNegativeCashMagnitude,
  budgetFillRatioDisplay,
  computeVerifiedAccountingTotals,
  contributionFundedMicros,
  deriveCheckpointCashBalance,
  deriveActiveCommittedFunds,
  deriveCurrentFreeFunds,
  latestBalanceCheckpoint,
} from "@/lib/waia-core/treasury/breath/accounting";
import {
  collectGlobalPendingReasons,
  evaluateBalanceReconciliationGate,
  evaluateMaterialUnresolvedReconciliation,
  latestReconciliation,
  selectActiveRunwayPlans,
  selectApplicablePublicIdeals,
  selectCurrentPublicBudgets,
  selectEligiblePublicFundingNeeds,
} from "@/lib/waia-core/treasury/breath/publication-gates";
import type {
  BreathFactsRepository,
  BreathLoadedFacts,
} from "@/lib/waia-core/treasury/breath/repository.types";
import {
  computeRunwayEndsAt,
  computeRunwayInputDigest,
} from "@/lib/waia-core/treasury/breath/runway";
import {
  breathPendingReasons,
  moneyString,
  type BreathAdminPreview,
  type BreathBudgetDto,
  type BreathPendingReason,
  type BreathPublicActivity,
  type BreathPublicSnapshot,
  type BreathRunwayDto,
  type TreasuryBalanceCheckpointRecord,
  type TreasuryRunwaySnapshotRecord,
} from "@/lib/waia-core/treasury/breath/types";

export type TreasuryBreathReadModelPort = {
  getAdminPreview(context: OrgContext): Promise<BreathAdminPreview>;
  getPublicSnapshot(context: OrgContext): Promise<BreathPublicSnapshot>;
  refreshRunwaySnapshot(
    context: OrgContext,
    actor: TreasuryActorContext,
    reason: string,
  ): Promise<TreasuryRunwaySnapshotRecord>;
  confirmBalanceCheckpoint(
    context: OrgContext,
    actor: TreasuryActorContext,
    input: {
      currency: string;
      confirmedBalanceMicros: bigint;
      asOf: Date;
      note: string;
      reason: string;
    },
  ): Promise<TreasuryBalanceCheckpointRecord>;
};

export const WP6_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED = true as const;

const GLOBAL_PENDING_REASONS = new Set<BreathPendingReason>([
  breathPendingReasons.BREATH_DISABLED,
  breathPendingReasons.IDEAL_BUDGET_MISSING,
  breathPendingReasons.IDEAL_BUDGET_AMBIGUOUS,
  breathPendingReasons.MATERIAL_RECONCILIATION_REQUIRED,
  breathPendingReasons.BALANCE_RECONCILIATION_MISSING,
  breathPendingReasons.BALANCE_RECONCILIATION_STALE,
  breathPendingReasons.BALANCE_RECONCILIATION_UNAVAILABLE,
  breathPendingReasons.BALANCE_RECONCILIATION_MISMATCH,
  breathPendingReasons.BALANCE_RECONCILIATION_PENDING_UNEXPLAINED,
  breathPendingReasons.BALANCE_RECONCILIATION_SCOPE_INVALID,
  breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE,
  breathPendingReasons.IDENTITY_MISMATCH,
]);

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (!max || date.getTime() > max.getTime()) max = date;
  }
  return max;
}

function publicActivity(tx: TreasuryTransactionRecord): BreathPublicActivity {
  return {
    occurredAt: tx.occurredAt.toISOString(),
    kind: tx.kind,
    direction: tx.direction,
    publicDescription: tx.publicDescription,
    cashEffectMicros: tx.cashEffectMicros === null ? null : moneyString(tx.cashEffectMicros),
    accountingAmountMicros:
      tx.accountingAmountMicros === null ? null : moneyString(tx.accountingAmountMicros),
    counterpartyDisplay: tx.publishCounterparty ? tx.counterpartyDisplay : null,
  };
}

function recentPublicActivity(
  transactions: readonly TreasuryTransactionRecord[],
  limit: number,
): BreathPublicActivity[] {
  return [...transactions]
    .filter(
      (tx) =>
        tx.status === "VERIFIED" &&
        tx.detailPublication === "DETAIL_PUBLIC" &&
        tx.detailSupersededById === null,
    )
    .sort((a, b) => {
      const byTime = b.occurredAt.getTime() - a.occurredAt.getTime();
      if (byTime !== 0) return byTime;
      return a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(0, limit))
    .map(publicActivity);
}

function emptyPendingPublic(): BreathPublicSnapshot {
  return {
    status: "pending",
    lastUpdatedAt: null,
    stageLabel: null,
    work: null,
    methodologyNote: null,
    idealAnnualBudget: null,
    resources: null,
    currentFreeFunds: null,
    budget: null,
    runway: { status: "pending" },
    recentActivity: [],
  };
}

export function toBreathPublicSnapshot(preview: BreathAdminPreview): BreathPublicSnapshot {
  return {
    status: preview.status,
    lastUpdatedAt: preview.lastUpdatedAt,
    stageLabel: preview.stageLabel,
    work: preview.work,
    methodologyNote: preview.methodologyNote,
    idealAnnualBudget: preview.idealAnnualBudget,
    resources: preview.resources,
    currentFreeFunds: preview.currentFreeFunds,
    budget: preview.budget,
    runway: preview.runway,
    recentActivity: preview.recentActivity,
  };
}

function mapBalanceComponent(
  reason: BreathPendingReason | null,
  ok: boolean,
): BreathAdminPreview["componentStatus"]["balanceReconciliation"] {
  if (ok) return "ok";
  switch (reason) {
    case breathPendingReasons.BALANCE_RECONCILIATION_MISSING:
      return "missing";
    case breathPendingReasons.BALANCE_RECONCILIATION_STALE:
      return "stale";
    case breathPendingReasons.BALANCE_RECONCILIATION_UNAVAILABLE:
      return "unavailable";
    case breathPendingReasons.BALANCE_RECONCILIATION_MISMATCH:
      return "mismatch";
    case breathPendingReasons.BALANCE_RECONCILIATION_SCOPE_INVALID:
      return "scope_invalid";
    default:
      return "pending_unexplained";
  }
}

export function createTreasuryBreathReadModel(deps: {
  facts: BreathFactsRepository;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  now?: () => Date;
  newId?: () => string;
}): TreasuryBreathReadModelPort {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function materializeRunway(input: {
    context: OrgContext;
    facts: BreathLoadedFacts;
    freeFunds: bigint;
    forceRefresh: boolean;
  }): Promise<{
    dto: BreathRunwayDto;
    snapshot: TreasuryRunwaySnapshotRecord | null;
    reason: BreathPendingReason | null;
  }> {
    const initialPlans = selectActiveRunwayPlans(input.facts.runwayPlans, now());
    if (initialPlans.length === 0) {
      return { dto: { status: "pending" }, snapshot: null, reason: null };
    }
    if (initialPlans.length > 1) {
      return {
        dto: { status: "pending" },
        snapshot: null,
        reason: breathPendingReasons.ACTIVE_RUNWAY_PLAN_AMBIGUOUS,
      };
    }

    try {
      const snapshot = await deps.facts.runExclusive(
        input.context.organizationId,
        async (store) => {
          const facts = await deps.facts.loadFacts(input.context);
          const plans = selectActiveRunwayPlans(facts.runwayPlans, now());
          if (plans.length !== 1) {
            throw new TreasuryValidationError(
              plans.length > 1
                ? breathPendingReasons.ACTIVE_RUNWAY_PLAN_AMBIGUOUS
                : "NO_ACTIVE_RUNWAY_PLAN",
              "Active runway plan set changed under concurrency control",
            );
          }
          const plan = plans[0]!;
          const accounting = computeVerifiedAccountingTotals(facts.transactions);
          const checkpoint = latestBalanceCheckpoint(facts.balanceCheckpoints ?? [], plan.currency);
          const canonicalCashBalance = checkpoint
            ? deriveCheckpointCashBalance(checkpoint, facts.transactions)
            : accounting.accountingCashBalance;
          const allocated = deriveActiveCommittedFunds(facts.commitments);
          const freeFunds = deriveCurrentFreeFunds(canonicalCashBalance, allocated);
          const digest = computeRunwayInputDigest({
            verified: facts.transactions,
            commitments: facts.commitments,
            plan,
            freeFundsAtAsOfMicros: freeFunds,
          });
          const latest = await store.getLatestRunwaySnapshot(input.context, plan.id);
          if (
            !input.forceRefresh &&
            latest &&
            latest.inputDigest === digest &&
            latest.runwayPlanId === plan.id
          ) {
            return latest;
          }
          const runwayAsOf = now();
          const endsAt = computeRunwayEndsAt({
            runwayAsOf,
            freeFundsAtAsOfMicros: freeFunds,
            approvedDailyBurnMicros: plan.dailyBurnMicros,
          });
          const created: TreasuryRunwaySnapshotRecord = {
            id: newId(),
            organizationId: input.context.organizationId,
            runwayPlanId: plan.id,
            runwayAsOf,
            freeFundsAtAsOfMicros: freeFunds,
            approvedDailyBurnMicros: plan.dailyBurnMicros,
            endsAt,
            inputDigest: digest,
            createdAt: runwayAsOf,
          };
          await store.insertRunwaySnapshot(created);
          return created;
        },
      );
      return {
        dto: {
          status: "available",
          runwayAsOf: snapshot.runwayAsOf.toISOString(),
          endsAt: snapshot.endsAt.toISOString(),
          freeFundsAtAsOf: moneyString(snapshot.freeFundsAtAsOfMicros),
          approvedDailyBurn: moneyString(snapshot.approvedDailyBurnMicros),
        },
        snapshot,
        reason: null,
      };
    } catch (err) {
      if (err instanceof TreasuryValidationError) {
        if (err.reasonCode === breathPendingReasons.RUNWAY_DATE_OUT_OF_RANGE) {
          return { dto: { status: "pending" }, snapshot: null, reason: err.reasonCode };
        }
        if (err.reasonCode === breathPendingReasons.ACTIVE_RUNWAY_PLAN_AMBIGUOUS) {
          return { dto: { status: "pending" }, snapshot: null, reason: err.reasonCode };
        }
        if (err.reasonCode === "NO_ACTIVE_RUNWAY_PLAN") {
          return { dto: { status: "pending" }, snapshot: null, reason: null };
        }
      }
      throw err;
    }
  }

  async function buildAdminPreview(context: OrgContext): Promise<BreathAdminPreview> {
    const org = requireOrgContext(context.organizationId);
    const facts = await deps.facts.loadFacts(org);
    const settings = facts.settings;
    const breathEnabled = settings?.breathEnabled === true;
    const ideals = selectApplicablePublicIdeals(facts.idealBudgets, now());
    const budgets = selectCurrentPublicBudgets(facts.budgets, now());
    const fundingNeeds = selectEligiblePublicFundingNeeds(facts.fundingNeeds);
    const latest = latestReconciliation(facts.reconciliations);
    const materialReconciliation = evaluateMaterialUnresolvedReconciliation(facts.transactions);
    const reconciliationGate = evaluateBalanceReconciliationGate({
      latest,
      inceptions: facts.inceptions,
      now: now(),
    });
    const checkpoint = latestBalanceCheckpoint(
      facts.balanceCheckpoints ?? [],
      ideals.length === 1 ? ideals[0]!.currency : undefined,
    );
    const materialAfterCheckpoint = checkpoint
      ? evaluateMaterialUnresolvedReconciliation(
          facts.transactions.filter((row) => row.occurredAt.getTime() > checkpoint.asOf.getTime()),
        )
      : materialReconciliation;
    const balanceGate = checkpoint ? { ok: true, reason: null } : reconciliationGate;

    let verifiedIncomplete = false;
    let accounting: ReturnType<typeof computeVerifiedAccountingTotals> | null = null;
    try {
      accounting = computeVerifiedAccountingTotals(facts.transactions);
    } catch (err) {
      if (
        err instanceof TreasuryValidationError &&
        (err.reasonCode === breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE ||
          err.reasonCode === breathPendingReasons.IDENTITY_MISMATCH)
      ) {
        verifiedIncomplete = true;
      } else {
        throw err;
      }
    }

    const pendingReasons = collectGlobalPendingReasons({
      breathEnabled,
      idealCount: ideals.length,
      materialReconciliation: materialAfterCheckpoint,
      balanceGate,
      verifiedIncomplete,
    });
    if (budgets.length > 1)
      pendingReasons.push(breathPendingReasons.ACTIVE_PUBLIC_BUDGET_AMBIGUOUS);
    if (fundingNeeds.length > 1) {
      pendingReasons.push(breathPendingReasons.PUBLIC_FUNDING_NEED_AMBIGUOUS);
    }

    const allocated = deriveActiveCommittedFunds(facts.commitments);
    const canonicalCashBalance =
      accounting && checkpoint
        ? deriveCheckpointCashBalance(checkpoint, facts.transactions)
        : (accounting?.accountingCashBalance ?? 0n);
    const freeFunds = accounting ? deriveCurrentFreeFunds(canonicalCashBalance, allocated) : 0n;

    let runway = {
      dto: { status: "pending" } as BreathRunwayDto,
      snapshot: null as TreasuryRunwaySnapshotRecord | null,
      reason: null as BreathPendingReason | null,
    };
    if (accounting && !verifiedIncomplete) {
      runway = await materializeRunway({
        context: org,
        facts,
        freeFunds,
        forceRefresh: false,
      });
      if (runway.reason === breathPendingReasons.ACTIVE_RUNWAY_PLAN_AMBIGUOUS) {
        pendingReasons.push(runway.reason);
      }
      if (runway.reason === breathPendingReasons.RUNWAY_DATE_OUT_OF_RANGE) {
        pendingReasons.push(runway.reason);
      }
    }

    const selectedBudget = budgets.length === 1 ? budgets[0]! : null;
    let budgetDto: BreathBudgetDto | null = null;
    if (selectedBudget && accounting && !verifiedIncomplete) {
      try {
        const funded = contributionFundedMicros(
          facts.transactions,
          (tx) => tx.budgetId === selectedBudget.id,
        );
        const committed = activeCommitmentsForBudget(facts.commitments, selectedBudget.id);
        const spent = assignedNegativeCashMagnitude(facts.transactions, selectedBudget.id);
        const remaining = selectedBudget.plannedAmountMicros - spent - committed;
        const fillRatio = budgetFillRatioDisplay(funded, selectedBudget.plannedAmountMicros);
        budgetDto = {
          code: selectedBudget.code,
          title: selectedBudget.title,
          currency: selectedBudget.currency,
          planned: moneyString(selectedBudget.plannedAmountMicros),
          funded: moneyString(funded),
          committed: moneyString(committed),
          spent: moneyString(spent),
          remaining: moneyString(remaining),
          fillRatio: fillRatio ?? 0,
        };
      } catch (err) {
        if (
          err instanceof TreasuryValidationError &&
          err.reasonCode === breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE
        ) {
          verifiedIncomplete = true;
          pendingReasons.push(breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE);
        } else {
          throw err;
        }
      }
    }

    const selectedNeed = fundingNeeds.length === 1 ? fundingNeeds[0]! : null;
    let neededNext: bigint | null = null;
    if (selectedNeed && accounting && !verifiedIncomplete) {
      try {
        const derivedFunded = contributionFundedMicros(
          facts.transactions,
          (tx) => tx.fundingNeedId === selectedNeed.id,
        );
        neededNext = selectedNeed.requiredAmountMicros - derivedFunded;
      } catch (err) {
        if (
          err instanceof TreasuryValidationError &&
          err.reasonCode === breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE
        ) {
          verifiedIncomplete = true;
          pendingReasons.push(breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE);
        } else {
          throw err;
        }
      }
    }

    const selectedIdeal = ideals.length === 1 ? ideals[0]! : null;
    const recentActivity = recentPublicActivity(
      facts.transactions,
      settings?.recentActivityLimit ?? 5,
    );
    const idealAuditTimes = selectedIdeal
      ? await deps.facts.listIdealBudgetAuditTimes(org, selectedIdeal.id)
      : [];
    const lastUpdated = maxDate([
      settings?.updatedAt,
      selectedIdeal?.createdAt,
      ...idealAuditTimes,
      selectedBudget?.updatedAt,
      selectedNeed?.updatedAt,
      latest?.createdAt,
      checkpoint?.createdAt,
      runway.snapshot?.createdAt,
      ...facts.transactions.flatMap((tx) =>
        tx.status === "VERIFIED" ? [tx.verifiedAt, tx.updatedAt] : [],
      ),
      ...facts.commitments
        .filter((row) => row.status === "APPROVED" || row.status === "RELEASED")
        .map((row) => row.updatedAt),
    ]);

    const uniquePending = [...new Set(pendingReasons)];
    const financialOk =
      accounting !== null &&
      !verifiedIncomplete &&
      !uniquePending.some((reason) => GLOBAL_PENDING_REASONS.has(reason));

    return {
      status: financialOk ? "published" : "pending",
      lastUpdatedAt: lastUpdated ? lastUpdated.toISOString() : null,
      stageLabel: settings?.stageLabel ?? null,
      work: settings?.workSummary ?? null,
      methodologyNote: settings?.methodologyNote ?? null,
      idealAnnualBudget:
        financialOk && selectedIdeal
          ? {
              periodYear: selectedIdeal.periodYear,
              currency: selectedIdeal.currency,
              amount: moneyString(selectedIdeal.amountMicros),
            }
          : null,
      resources:
        financialOk && accounting
          ? {
              entered: moneyString(accounting.entered),
              spent: moneyString(accounting.spent),
              remaining: moneyString(canonicalCashBalance),
              allocated: moneyString(allocated),
              neededNext: neededNext === null ? null : moneyString(neededNext),
            }
          : null,
      currentFreeFunds: financialOk ? moneyString(freeFunds) : null,
      budget: financialOk ? budgetDto : null,
      runway: runway.dto,
      recentActivity,
      pendingReasons: uniquePending,
      componentStatus: {
        breathEnabled,
        idealBudget: ideals.length === 1 ? "ok" : ideals.length === 0 ? "missing" : "ambiguous",
        materialReconciliation: materialAfterCheckpoint,
        balanceReconciliation: mapBalanceComponent(balanceGate.reason, balanceGate.ok),
        budget: budgets.length === 1 ? "ok" : budgets.length === 0 ? "absent" : "ambiguous",
        fundingNeed:
          fundingNeeds.length === 1 ? "ok" : fundingNeeds.length === 0 ? "absent" : "ambiguous",
        verifiedFinancialComplete: !verifiedIncomplete,
      },
      reconciliationGate: {
        latestId: checkpoint?.id ?? latest?.id ?? null,
        status: checkpoint ? "HUMAN_CONFIRMED" : (latest?.status ?? null),
        createdAt: checkpoint?.createdAt.toISOString() ?? latest?.createdAt.toISOString() ?? null,
      },
      runwayStatus: {
        status: runway.dto.status,
        reason: runway.reason,
        snapshotId: runway.snapshot?.id ?? null,
      },
    };
  }

  return {
    async getAdminPreview(context) {
      return buildAdminPreview(context);
    },
    async getPublicSnapshot(context) {
      try {
        return toBreathPublicSnapshot(await buildAdminPreview(context));
      } catch {
        return emptyPendingPublic();
      }
    },
    async refreshRunwaySnapshot(context, actor, reason) {
      const org = requireOrgContext(context.organizationId);
      const trimmed = reason.trim();
      if (!trimmed) {
        throw new TreasuryValidationError("INVALID_BODY", "reason is required");
      }
      if (!actor.actorUserId) {
        throw new TreasuryValidationError(
          "ACTOR_REQUIRED",
          "snapshot refresh requires an admin actor",
        );
      }
      const facts = await deps.facts.loadFacts(org);
      const accounting = computeVerifiedAccountingTotals(facts.transactions);
      const activePlans = selectActiveRunwayPlans(facts.runwayPlans, now());
      const checkpoint = latestBalanceCheckpoint(
        facts.balanceCheckpoints ?? [],
        activePlans.length === 1 ? activePlans[0]!.currency : undefined,
      );
      const canonicalCashBalance = checkpoint
        ? deriveCheckpointCashBalance(checkpoint, facts.transactions)
        : accounting.accountingCashBalance;
      const allocated = deriveActiveCommittedFunds(facts.commitments);
      const freeFunds = deriveCurrentFreeFunds(canonicalCashBalance, allocated);
      const result = await materializeRunway({
        context: org,
        facts,
        freeFunds,
        forceRefresh: true,
      });
      if (!result.snapshot) {
        throw new TreasuryValidationError(
          result.reason ?? breathPendingReasons.ACTIVE_RUNWAY_PLAN_AMBIGUOUS,
          "Cannot refresh runway snapshot without exactly one ACTIVE approved burn plan",
        );
      }
      await deps.writeAudit({
        actorType: actor.actorType,
        actorId: actor.actorUserId,
        action: treasuryAuditActions.runwaySnapshotRefresh,
        entityType: treasuryEntityTypes.runwaySnapshot,
        entityId: result.snapshot.id,
        organizationId: org.organizationId,
        metadata: { reason: trimmed, inputDigest: result.snapshot.inputDigest },
      });
      return result.snapshot;
    },
    async confirmBalanceCheckpoint(context, actor, input) {
      const org = requireOrgContext(context.organizationId);
      if (!actor.actorUserId) {
        throw new TreasuryValidationError(
          "ACTOR_REQUIRED",
          "balance checkpoint requires an admin actor",
        );
      }
      const currency = input.currency.trim().toUpperCase();
      const note = input.note.trim();
      const reason = input.reason.trim();
      if (!currency || !note || !reason) {
        throw new TreasuryValidationError("INVALID_BODY", "currency, note and reason are required");
      }
      if (input.confirmedBalanceMicros < 0n) {
        throw new TreasuryValidationError(
          "INVALID_BALANCE",
          "confirmed balance must be non-negative",
        );
      }
      if (!Number.isFinite(input.asOf.getTime()) || input.asOf.getTime() > now().getTime()) {
        throw new TreasuryValidationError("INVALID_AS_OF", "as_of must be a valid past time");
      }
      const createdAt = now();
      const record: TreasuryBalanceCheckpointRecord = {
        id: newId(),
        organizationId: org.organizationId,
        currency,
        confirmedBalanceMicros: input.confirmedBalanceMicros,
        asOf: input.asOf,
        sourceLabel: "HUMAN_CONFIRMED",
        note,
        confirmedByUserId: actor.actorUserId,
        createdAt,
      };
      await deps.facts.runExclusive(org.organizationId, async (store) => {
        await store.insertBalanceCheckpoint(record);
      });
      await deps.writeAudit({
        actorType: actor.actorType,
        actorId: actor.actorUserId,
        action: treasuryAuditActions.balanceCheckpointConfirm,
        entityType: treasuryEntityTypes.balanceCheckpoint,
        entityId: record.id,
        organizationId: org.organizationId,
        metadata: { reason, currency, asOf: input.asOf.toISOString() },
      });
      return record;
    },
  };
}
