import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHtrAccountingCycleBridge } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { createOrderExecutionServiceFromDeps } from "@/lib/trader/execution/execution-service";
import type { OrderExecutionServiceDeps } from "@/lib/trader/execution/execution-service.types";
import { DEFAULT_EXIT_RUN_CONFIG, EXIT_PLAN_SCHEMA_VERSION, type TrailingState } from "@/lib/trader/exits/exit-types";
import * as evaluationCycle from "@/lib/trader/intelligence/evaluation-cycle";
import {
  assertInformationSufficiencyReceiptV2,
  bindInformationSufficiencyReceiptAuthorityV2,
  evaluateInformationSufficiencyRuntimeAdmissionV2,
  type InformationQuestionRequirementV2,
  type InformationSufficiencyReceiptV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import type { LifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository.types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import beforeFix from "@/tests/fixtures/sufficiency/dee1118-before-fix.json";
import { GUARDIAN_SCOPE_AT, guardianScopeFixture } from "@/tests/helpers/guardian-observation-scope-fixture";
import { contradictionEvidence, contradictionProfile, evaluateContradiction, SUFFICIENCY_PIT } from "@/tests/helpers/sufficiency-contradiction";

// This is the admitted legacy paper composition proof, not full Intelligence or
// capital qualification. Only the analytical signal result is fixed; sufficiency,
// exact receipt admission, Guardian/exit math and Execution refusal are real.
function harness(requirement: Partial<InformationQuestionRequirementV2> = {}, mixed = true) {
  const f = guardianScopeFixture();
  const profile = contradictionProfile(requirement, {
    organizationId: f.input.context.organizationId, accountId: f.input.accountKey,
  });
  const evidence = [contradictionEvidence("support", "SUPPORTS", { availableAt: "2026-01-01T00:24:30.000Z" })];
  if (mixed) evidence.push(contradictionEvidence("unresolved", "UNRESOLVED", { availableAt: "2026-01-01T00:24:30.000Z" }));
  const receipt = evaluateContradiction(profile, evidence, { pitAnchor: GUARDIAN_SCOPE_AT });
  f.input.informationSufficiencyAuthority = bindInformationSufficiencyReceiptAuthorityV2(profile, receipt);
  const admission = evaluateInformationSufficiencyRuntimeAdmissionV2({
    authority: f.input.informationSufficiencyAuthority, organizationId: f.input.context.organizationId,
    requiredPurpose: "NEW_OPPORTUNITY", allowResearchNonCapital: true,
    expectedScope: { accountId: f.input.accountKey, symbol: "BTC/USDT", analyticalTimeframe: "1m", pitAnchor: GUARDIAN_SCOPE_AT },
  });
  const unrelated: TrailingState = {
    schemaVersion: EXIT_PLAN_SCHEMA_VERSION, phase: "ARMED", entryPrice: "2000",
    activationPrice: "2050", trailingDistanceUsdt: "10", maxFavorableExcursionUsdt: "100",
    peakPrice: "2100", stopPrice: "2090", lastUpdatedAt: "2026-01-01T00:24:00.000Z",
  };
  const trailing = new Map([["other-account-or-instrument", unrelated]]);
  f.input.guardian!.exitEngine = { runConfig: DEFAULT_EXIT_RUN_CONFIG, trailingStateByLotId: trailing };
  const lots = [f.lot];
  const trades = new Map([[f.trade.id, f.trade]]);
  const repository = {
    listOpenPositionLots: vi.fn<LifecycleRepository["listOpenPositionLots"]>(async (context, filter) => lots.filter((lot) =>
      lot.organizationId === context.organizationId && lot.accountKey === filter?.accountKey && lot.symbol === filter?.symbol)),
    getTradeById: vi.fn<LifecycleRepository["getTradeById"]>(async (_context, id) => trades.get(id) ?? null),
  } as unknown as LifecycleRepository;
  const recordGuardianEvaluated = vi.fn<NonNullable<PaperCycleDeps["lifecycleRecorder"]>["recordGuardianEvaluated"]>();
  const recordGuardianExitIntent = vi.fn<NonNullable<PaperCycleDeps["lifecycleRecorder"]>["recordGuardianExitIntent"]>();
  const recordSignalAcceptedLifecycleEvent = vi.fn<NonNullable<PaperCycleDeps["lifecycleRecorder"]>["recordSignalAcceptedLifecycleEvent"]>();
  const forbidden = vi.fn(() => { throw new Error("UNEXPECTED_CAPITAL_OR_PROVIDER_EFFECT"); });
  const execution = createOrderExecutionServiceFromDeps({
    nowMs: () => 0, connectorForMode: forbidden, writeAudit: forbidden,
    riskEngine: { evaluate: forbidden }, killSwitchResolver: { resolve: forbidden },
    orderRepository: new Proxy({}, { get: () => forbidden }),
  } as unknown as OrderExecutionServiceDeps);
  const submit = vi.spyOn(execution, "submitOrder");
  const deps = {
    execution, reconciliation: { reconcile: forbidden }, lifecycleRepository: repository,
    lifecycleRecorder: { recordGuardianEvaluated, recordGuardianExitIntent, recordSignalAcceptedLifecycleEvent },
  } as unknown as PaperCycleDeps;
  vi.spyOn(evaluationCycle, "runEvaluationCycle").mockReturnValue(f.evaluation);
  return { f, profile, receipt, admission, lots, trades, repository, trailing, unrelated,
    recordGuardianEvaluated, recordGuardianExitIntent, recordSignalAcceptedLifecycleEvent, forbidden, submit, deps };
}

function expectNoGuardianEffects(h: ReturnType<typeof harness>, before: string) {
  expect(h.recordGuardianEvaluated).not.toHaveBeenCalled();
  expect(h.recordGuardianExitIntent).not.toHaveBeenCalled();
  expect(h.recordSignalAcceptedLifecycleEvent).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.forbidden).not.toHaveBeenCalled();
  expect(JSON.stringify([...h.trailing])).toBe(before);
}

describe("DEE1128 paper sufficiency veto and scoped Guardian composition", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks the entry but observes only the selected lot and reaches real legacy exit refusal", async () => {
    const h = harness();
    const unrelatedBytes = JSON.stringify(h.unrelated);
    for (const [symbol, accountKey] of [["ETH/USDT", "account-a"], ["BTC/USDT", "account-b"]]) {
      const id = `${symbol}-${accountKey}`;
      h.lots.push({ ...h.f.lot, id: `lot-${id}`, tradeId: id, symbol, accountKey });
      h.trades.set(id, { ...h.f.trade, id, symbol, accountKey });
    }
    expect(h.receipt.status).toBe("INSUFFICIENT");
    expect(assertInformationSufficiencyReceiptV2(h.receipt, h.profile)).toEqual(h.receipt);
    expect(h.admission).toMatchObject({ status: "BLOCKED", reasonCode: "INSUFFICIENT", createsCapitalAuthority: false });
    const result = await runPaperCycleOnce(h.deps, h.f.input);
    expect(result.strategyExecutions).toMatchObject([{ submitBlocked: true, skipReason: "information_sufficiency_blocked", execution: null }]);
    expect(h.recordSignalAcceptedLifecycleEvent).not.toHaveBeenCalled();
    expect(h.repository.listOpenPositionLots).toHaveBeenCalledWith(h.f.input.context, { accountKey: "account-a", symbol: "BTC/USDT" });
    expect(result.guardian?.evaluations.map((row) => row.positionLotId)).toEqual([h.f.lot.id]);
    expect(result.guardian?.evaluations[0]?.reason.unrealizedPnlUsdt).toBe("1000");
    expect(result.guardian?.exitIntents).toMatchObject([{ accountKey: "account-a", symbol: "BTC/USDT", quantity: "1" }]);
    expect(h.recordGuardianEvaluated).toHaveBeenCalledTimes(1);
    expect(h.recordGuardianExitIntent).toHaveBeenCalledTimes(1);
    expect(h.trailing.get("other-account-or-instrument")).toBe(h.unrelated);
    expect(JSON.stringify(h.trailing.get("other-account-or-instrument"))).toBe(unrelatedBytes);
    expect(h.trailing.has(h.f.lot.id)).toBe(true);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0]?.[1]).toMatchObject({ accountKey: "account-a", symbol: "BTC/USDT", side: "sell", quantity: "1" });
    expect(result.guardianExecutions?.[0]?.execution).toMatchObject({ status: "execution_v2_required", order: null });
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it.each([
    ["supported only", {}, false],
    ["optional unresolved", { classification: "OPTIONAL_ENRICHMENT" }, true],
    ["inactive context", { classification: "CONTEXT_TRIGGERED", contextTriggerKey: "event" }, true],
    ["record-only unresolved", { contradictionPolicy: "RECORD_ONLY" }, true],
  ] satisfies readonly [string, Partial<InformationQuestionRequirementV2>, boolean][])(
    "preserves %s admission without granting capital authority", async (_label, requirement, mixed) => {
      const h = harness(requirement, mixed);
      h.f.evaluation.msv.derived.tradingPermission = "ALLOW_TRADING";
      h.f.input.guardian!.exitEngine = undefined;
      expect(h.receipt.status).toBe("SUFFICIENT");
      expect(h.admission).toMatchObject({ status: "ADMITTED", createsCapitalAuthority: false });
      const result = await runPaperCycleOnce(h.deps, h.f.input);
      expect(result.guardian?.evaluations).toMatchObject([{ decision: "HOLD", positionLotId: h.f.lot.id }]);
      expect(result.guardian?.exitIntents).toEqual([]);
      expect(result.strategyExecutions).toMatchObject([{ submitBlocked: true, execution: { status: "execution_v2_required", order: null } }]);
      expect(h.recordSignalAcceptedLifecycleEvent).toHaveBeenCalledTimes(1);
      expect(h.submit).toHaveBeenCalledTimes(1);
      expect(h.submit.mock.calls[0]?.[1].side).toBe("buy");
      expect(h.forbidden).not.toHaveBeenCalled();
    },
  );

  it("keeps REQUIRE_AGREEMENT unresolved evidence blocking at the same real caller", async () => {
    const h = harness({ contradictionPolicy: "REQUIRE_AGREEMENT" });
    expect(h.receipt.status).toBe("INSUFFICIENT");
    const result = await runPaperCycleOnce(h.deps, h.f.input);
    expect(result.strategyExecutions[0]?.skipReason).toBe("information_sufficiency_blocked");
    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(h.recordSignalAcceptedLifecycleEvent).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it.each(["foreign-account", "foreign-instrument", "mismatched-trade"])(
    "refuses a later %s before any Guardian batch effect even with an entry veto", async (kind) => {
      const h = harness();
      const later = { ...h.f.lot, id: "z-later", tradeId: "later-trade" };
      const trade = { ...h.f.trade, id: later.tradeId };
      if (kind === "foreign-account") later.accountKey = "account-b";
      if (kind === "foreign-instrument") later.symbol = "ETH/USDT";
      if (kind === "mismatched-trade") trade.accountKey = "account-b";
      h.lots.push(later); h.trades.set(trade.id, trade);
      vi.mocked(h.repository.listOpenPositionLots).mockResolvedValue(h.lots);
      const before = JSON.stringify([...h.trailing]);
      await expect(runPaperCycleOnce(h.deps, h.f.input)).rejects.toMatchObject({ code: "GUARDIAN_OBSERVATION_SCOPE_MISMATCH" });
      expectNoGuardianEffects(h, before);
    },
  );

  it("treats an honestly empty scoped selection as valid while retaining the entry veto", async () => {
    const h = harness(); h.lots.length = 0;
    const before = JSON.stringify([...h.trailing]);
    const result = await runPaperCycleOnce(h.deps, h.f.input);
    expect(result.guardian).toEqual({ evaluations: [], exitIntents: [] });
    expect(result.strategyExecutions[0]?.skipReason).toBe("information_sufficiency_blocked");
    expectNoGuardianEffects(h, before);
  });

  it("refuses the historical false-SUFFICIENT receipt rather than using it as valid blocked evidence", () => {
    const profile = beforeFix.profile as RequiredInformationProfileV2;
    const receipt = beforeFix.mixedReceipt as InformationSufficiencyReceiptV2;
    const original = JSON.stringify(receipt);
    expect(receipt.status).toBe("SUFFICIENT");
    expect(() => assertInformationSufficiencyReceiptV2(receipt, profile)).toThrow("receiptIdentity");
    expect(() => bindInformationSufficiencyReceiptAuthorityV2(profile, receipt)).toThrow("receiptIdentity");
    expect(evaluateInformationSufficiencyRuntimeAdmissionV2({
      authority: { schemaVersion: "information-sufficiency-runtime-authority-v2", kind: "PROFILE_RECEIPT",
        organizationId: profile.organizationId, purpose: profile.purpose, profile, receipt, authority: "EPISTEMIC_PREREQUISITE_ONLY" },
      organizationId: profile.organizationId, requiredPurpose: "NEW_OPPORTUNITY", allowResearchNonCapital: false,
      expectedScope: { accountId: profile.accountId, symbol: "BTC/USDT", analyticalTimeframe: "1m", pitAnchor: SUFFICIENCY_PIT },
    })).toMatchObject({ status: "BLOCKED", reasonCode: "INVALID_AUTHORITY", createsCapitalAuthority: false });
    expect(JSON.stringify(receipt)).toBe(original);
  });

  it.each(["disabled", "HTR"])("preserves the %s Guardian early return under valid insufficient evidence", async (kind) => {
    const h = harness();
    if (kind === "disabled") h.f.input.guardian!.runConfig.enabled = false;
    else {
      h.f.input.snapshot.cycleId = "25";
      h.f.input.htrAccounting = {
        bridge: createHtrAccountingCycleBridge({ organizationId: h.f.input.context.organizationId,
          accountKey: h.f.input.accountKey, runId: "joint-boundary-htr", frontierAsOf: GUARDIAN_SCOPE_AT }),
        resolveInventoryOpenQtyBySymbol: vi.fn(async () => ({})),
      };
    }
    const before = JSON.stringify([...h.trailing]);
    const result = await runPaperCycleOnce(h.deps, h.f.input);
    expect(result.guardian).toBeUndefined();
    if (kind === "HTR") expect(result.htrGuardian).toBeDefined();
    expect(result.strategyExecutions[0]?.skipReason).toBe("information_sufficiency_blocked");
    expect(h.repository.listOpenPositionLots).not.toHaveBeenCalled();
    expectNoGuardianEffects(h, before);
  });
});
