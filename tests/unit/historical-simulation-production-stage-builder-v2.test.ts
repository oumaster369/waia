import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { validateHistoricalSimulationModeledAtomicArtifactV2 } from
  "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";
import { buildHistoricalSimulationModeledCapitalArtifactsV2, buildHistoricalSimulationModeledNoopArtifactsV2 } from
  "@/lib/trader/historical-simulation-v2/production-stage-builder-v2";

const d = (char: string) => char.repeat(64);
const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;

describe("historical simulation production stage builder v2", () => {
  it("creates exact no-op artifacts for a CASH/no-order cycle and retains full Decision receipts", () => {
    const scope = { organizationId: id("11"), accountId: "account", runId: "run", cycleId: "cash-cycle",
      pitAnchor: "2026-08-30T10:01:00.000Z" };
    const ledger = { risk: { status: "NOT_EVALUATED", verdictContentDigestHex: null,
      allowanceContentDigestHex: null, reasonCodes: ["DECISION_CASH"] }, execution: { status: "NOT_DISPATCHED",
      planContentDigestHex: null, attemptContentDigestHex: null, reportContentDigestHex: null,
      reasonCodes: ["DECISION_CASH"] }, observedExecutionEffects: [] } as never;
    const artifacts = buildHistoricalSimulationModeledNoopArtifactsV2({ scope, ledgerEntry: ledger,
      decisionEvidence: { decisionReceipt: { contentDigestHex: d("d") } as never,
        whyNotCashReceipt: { contentDigestHex: d("c") } as never } });
    expect(artifacts.MODELED_RISK[0].sourceContentDigestHex).toBe(computeSemanticSha256Hex({ status: "NOT_EVALUATED",
      verdictContentDigestHex: null, allowanceContentDigestHex: null, reasonCodes: ["DECISION_CASH"] }));
    expect(artifacts.MODELED_EXECUTION[0].sourceContentDigestHex).toBe(computeSemanticSha256Hex({ status: "NOT_DISPATCHED",
      planContentDigestHex: null, attemptContentDigestHex: null, reportContentDigestHex: null,
      reasonCodes: ["DECISION_CASH"] }));
    expect(artifacts.OBSERVED_EXECUTION_EFFECTS[0].sourceContentDigestHex)
      .toBe(computeSemanticSha256Hex({ effects: [] }));
    expect(artifacts.MODELED_RISK[0].lineagePayload).toEqual(expect.objectContaining({
      decisionReceipt: expect.objectContaining({ contentDigestHex: d("d") }),
      whyNotCashReceipt: expect.objectContaining({ contentDigestHex: d("c") }) }));
  });

  it("projects risk, separate allowance/plan/attempt and no-fill report with full Decision lineage", () => {
    const riskBody = { schemaVersion: "waia.trader.historical_modeled_risk.v2" as const,
      source: "MODELED_HISTORICAL" as const, capitalEligible: false as const, riskVerdictId: id("1"),
      riskAllowanceId: id("2"), riskAllowanceContentDigestHex: "", decisionContentDigestHex: d("d"),
      accountingFrontierContentDigestHex: d("a"), verdict: "APPROVE" as const, approvedQuantity: "1",
      requestedReservationNotional: "100", remainingBeforeAdmissionNotional: "1000",
      remainingAfterAdmissionNotional: "900", reasonCodes: [] as readonly string[] };
    const allowance = { schemaVersion: "waia.trader.historical_modeled_risk_allowance.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, allowanceId: riskBody.riskAllowanceId,
      riskVerdictId: riskBody.riskVerdictId, decisionContentDigestHex: riskBody.decisionContentDigestHex,
      approvedQuantity: riskBody.approvedQuantity };
    riskBody.riskAllowanceContentDigestHex = computeSemanticSha256Hex(allowance);
    const risk = { ...riskBody, contentDigestHex: computeSemanticSha256Hex(riskBody) };
    const plan = { schemaVersion: "waia.trader.historical_modeled_execution_plan.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, executionPlanId: id("3"), decisionId: id("4"),
      decisionContentDigestHex: d("d"), riskReceiptContentDigestHex: risk.contentDigestHex,
      symbol: "BTCUSDT", side: "buy", quantity: "1" };
    const attempt = { schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, executionAttemptId: id("5"),
      executionPlanId: plan.executionPlanId, executionPlanContentDigestHex: computeSemanticSha256Hex(plan),
      acceptedAtUtc: "2026-08-30T10:00:00.000Z" };
    const execution = { schemaVersion: "waia.trader.historical_modeled_execution.v2" as const,
      source: "MODELED_HISTORICAL" as const, capitalEligible: false as const,
      executionPlanId: plan.executionPlanId, executionPlanContentDigestHex: computeSemanticSha256Hex(plan),
      executionAttemptId: attempt.executionAttemptId, executionAttemptContentDigestHex: computeSemanticSha256Hex(attempt),
      orderId: id("6"), orderContentDigestHex: d("6"), decisionId: plan.decisionId,
      decisionContentDigestHex: d("d"), riskVerdictId: risk.riskVerdictId,
      riskReceiptContentDigestHex: risk.contentDigestHex,
      symbol: "BTCUSDT", side: "buy" as const, quantity: "1", decisionBarIndex: 0,
      acceptedAtUtc: attempt.acceptedAtUtc, contentDigestHex: d("e") };
    const report = { schemaVersion: "waia.trader.historical_modeled_execution_report.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, cycleId: "cycle-1", decisionId: execution.decisionId,
      decisionContentDigestHex: execution.decisionContentDigestHex, executionPlanId: execution.executionPlanId,
      executionPlanContentDigestHex: execution.executionPlanContentDigestHex, orderId: execution.orderId,
      orderContentDigestHex: execution.orderContentDigestHex, executionAttemptId: execution.executionAttemptId,
      executionAttemptContentDigestHex: execution.executionAttemptContentDigestHex, status: "NO_FILL",
      fillEvidenceContentDigestHexes: [] as readonly string[] };
    const modeled = buildHistoricalSimulationModeledCapitalArtifactsV2({ scope: { organizationId: id("11"),
      accountId: "account", runId: "run", cycleId: "cycle-1", pitAnchor: "2026-08-30T10:01:00.000Z" },
      risk, execution, advance: { fillCount: 0, fillEvidence: [], fillDetails: [],
        accountingFrontierContentDigestHex: d("a"), accountingFrontier: {} as never,
        accountingAdvanced: false, effects: [{ effectId: d("f"),
          cycleId: "cycle-1", decisionId: execution.decisionId, decisionContentDigestHex: d("d"),
          riskReceiptContentDigestHex: risk.contentDigestHex, executionPlanId: execution.executionPlanId,
          executionPlanContentDigestHex: execution.executionPlanContentDigestHex,
          executionAttemptId: execution.executionAttemptId,
          executionAttemptContentDigestHex: execution.executionAttemptContentDigestHex, orderId: execution.orderId,
          orderContentDigestHex: execution.orderContentDigestHex, status: "NO_FILL", fillEvidenceContentDigestHexes: [],
          reportContentDigestHexes: [computeSemanticSha256Hex(report)], reasonCodes: ["NO_FILL_ON_CURRENT_BAR"] }] },
      decisionEvidence: { decisionReceipt: { contentDigestHex: d("d") } as never,
        whyNotCashReceipt: { contentDigestHex: d("c") } as never } });
    expect(modeled.MODELED_RISK.map((a) => a.sourceContentDigestHex)).toEqual([
      risk.contentDigestHex, risk.riskAllowanceContentDigestHex]);
    expect(modeled.MODELED_EXECUTION.map((a) => a.sourceContentDigestHex)).toEqual([
      execution.executionPlanContentDigestHex, execution.executionAttemptContentDigestHex]);
    expect(modeled.OBSERVED_EXECUTION_EFFECTS[0].sourcePayload).toEqual(report);
    const submittedWithoutPriorOrderEffect = buildHistoricalSimulationModeledCapitalArtifactsV2({
      scope: { organizationId: id("11"), accountId: "account", runId: "run", cycleId: "cycle-1",
        pitAnchor: "2026-08-30T10:01:00.000Z" }, risk, execution,
      advance: { fillCount: 0, fillEvidence: [], fillDetails: [],
        accountingFrontierContentDigestHex: d("a"), accountingFrontier: {} as never,
        accountingAdvanced: false, effects: [] },
      decisionEvidence: { decisionReceipt: { contentDigestHex: d("d") } as never,
        whyNotCashReceipt: { contentDigestHex: d("c") } as never },
    });
    expect(submittedWithoutPriorOrderEffect.OBSERVED_EXECUTION_EFFECTS[0].sourcePayload)
      .toEqual({ effects: [] });
    const scope = { organizationId: id("11"), accountId: "account", runId: "run",
      split: "DEVELOPMENT" as const, datasetAuthorityDigestHex: d("9") };
    for (const artifact of [...modeled.MODELED_RISK, ...modeled.MODELED_EXECUTION,
      ...modeled.OBSERVED_EXECUTION_EFFECTS]) {
      expect(() => validateHistoricalSimulationModeledAtomicArtifactV2(scope, "cycle-1", { artifactKind: artifact.artifactKind,
        artifactId: artifact.artifactId, contentDigestHex: artifact.contentDigestHex, payload: artifact })).not.toThrow();
    }
  });
});
