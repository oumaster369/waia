/** Local synthetic persistence only. No connector, dispatch or venue capability. */
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createExecutionAttemptV2, createExecutionPlanV2, createExecutionPolicyBindingV2 } from "@/lib/trader/execution/v2/contracts";
import { insertExecutionAttemptV2Postgres, insertExecutionPlanV2Postgres, insertExecutionPolicyV2Postgres } from "@/lib/trader/execution/v2/repository-postgres";
import { divideDecimal } from "@/lib/trader/risk/numeric";
import { admitRiskAllowanceV2Postgres, consumeRiskAllowanceForOrderV2Postgres,
  initializeRiskAccountStateV2Postgres, type AdmitRiskAllowanceV2Input } from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");
function account(accountId: string) {
  return {
    accountId,
    posture: "NORMAL" as const,
    killState: "CLEAR" as const,
    reconciliationStatus: "RECONCILED" as const,
    realitySnapshotId: `reality-${accountId}`,
    realityContentDigestHex: hex64(`reality-${accountId}`),
    reconciliationAuthorityDigestHex: hex64(`reconciliation-${accountId}`),
    reconciledInstrumentExposures: [
      {
        instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
        symbol: "BTCUSDT",
        baseQuantity: "0",
      },
    ],
    accounting: {
      reconciledExposureNotional: "0",
      worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0",
      exposureLimitNotional: "100",
    },
  };
}

function admission(accountId: string): AdmitRiskAllowanceV2Input {
  const decisionId = randomUUID();
  return {
    accountId,
    riskVerdictId: randomUUID(),
    riskAllowanceId: randomUUID(),
    issuanceEventId: randomUUID(),
    nonce: randomUUID(),
    validForMs: 30_000,
    verdict: {
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      instrumentIdentityDigestHex: hex64("BTCUSDT-SPOT"),
      decision: {
        decisionId,
        semanticDigestHex: hex64("decision-semantic"),
        contentDigestHex: hex64(decisionId),
        action: "ENTER_LONG",
        economicSizeSetId: "decision-execution-v2-sizes",
        economicSizeSetDigestHex: hex64("decision-execution-v2-sizes"),
        forecastId: "forecast-execution-v2",
        forecastContentDigestHex: hex64("forecast-execution-v2"),
        canonicalCausalLineageDigestHex: hex64("causal-lineage-execution-v2"),
      },
      riskPolicyVersion: "risk-v2-integration",
      riskPolicyDigestHex: hex64("risk-v2-integration"),
      limitVersions: [{ layer: "L2", version: "position-v1", digestHex: hex64("position-v1") }],
      reality: {
        snapshotId: `reality-${accountId}`,
        contentDigestHex: hex64(`reality-${accountId}`),
        asOfUtc: "2026-08-21T00:00:00.000Z",
        reconciliationAuthorityDigestHex: hex64(`reconciliation-${accountId}`),
        reconciliationStatus: "RECONCILED",
      },
      referencePrice: {
        authorityId: "test-median",
        authorityVersion: "v1",
        contentDigestHex: hex64("test-median-v1"),
        price: divideDecimal("25", "0.001"),
      },
      verdict: "APPROVE_CLAMPED",
      approvedQualifiedQuantity: "0.001",
      bindingLayers: ["L2"],
      reasonCodes: ["POSITION_LIMIT_BINDING"],
    },
  };
}

export async function persistDeliveryAttempt(db: WaiaPostgresDb, orgA: string, accountId = "delivery-fixture", initialize = true) {
    if (initialize) await initializeRiskAccountStateV2Postgres(db, { organizationId: orgA }, account(accountId));
    const admitted = await admitRiskAllowanceV2Postgres(
      db,
      { organizationId: orgA },
      admission(accountId),
    );
    const allowance = admitted.allowance;
    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: randomUUID(),
      organizationId: orgA,
      policyVersion: "htx-spot-v1",
      decisionId: allowance.decision.decisionId,
      decisionContentDigestHex: allowance.decision.contentDigestHex,
      decisionExecutionPolicyDigestHex: hex64("decision-execution-policy"),
      economicSizeSetDigestHex: allowance.decision.economicSizeSetDigestHex,
      venue: "HTX",
      market: "SPOT",
      instrumentIdentityDigestHex: allowance.instrumentIdentityDigestHex,
      allowedOrderTypes: ["limit"],
      allowedTimeInForce: ["GTC"],
      allowedLiquidityRoles: ["MAKER"],
      priceCollar: {
        minimumPrice: "24000",
        maximumPrice: "26000",
        authorityDigestHex: hex64("collar"),
      },
      quantityRules: {
        minimumQuantity: "0.001",
        quantityStep: "0.001",
        roundingMode: "EXACT",
        economicQualifiedQuantities: ["0.001"],
      },
      slicingPolicy: { maximumSlices: 1, completePlanRequired: true },
      retryPolicy: {
        maximumNetworkSubmissions: 1,
        sameIdentityRetryAllowed: false,
        venueIdempotencyProven: false,
      },
      cancelPolicy: {
        protectiveCancelAllowed: true,
        replacementRequiresPresealedOrFreshAuthority: true,
      },
      timeoutMs: 5_000,
      uncertaintyHandling: "RECONCILIATION_REQUIRED",
      effectiveFromUtc: "2026-08-21T00:00:00.000Z",
      effectiveUntilUtc: "2026-08-22T00:00:00.000Z",
    });
    const plan = createExecutionPlanV2({
      executionPlanId: randomUUID(),
      allowance,
      policy,
      approvedNotionalCeiling: "25",
      plannedQuantity: "0.001",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "25000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:00.000Z",
        closesAtUtc: "2026-08-21T00:00:05.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.001", limitPrice: "25000" }],
      sealedAtUtc: "2026-08-21T00:00:00.000Z",
    });
    const orderId = randomUUID();
    const consumed = await consumeRiskAllowanceForOrderV2Postgres(
      db,
      { organizationId: orgA },
      {
        accountId,
        riskAllowanceId: allowance.riskAllowanceId,
        nonce: allowance.nonce,
        consumptionEventId: randomUUID(),
        order: {
          id: orderId,
          executionMode: "live",
          symbol: "BTCUSDT",
          side: "buy",
          type: "limit",
          price: "25000",
          quantity: "0.001",
          clientOrderId: "legacy-placeholder",
          idempotencyKey: `execution-v2-${plan.contentDigestHex}`,
          strategySignalId: null,
          allocationDecisionId: null,
          credentialId: null,
        },
      },
    );
    expect(consumed.status).toBe("CONSUMED");
    const attempt = createExecutionAttemptV2({
      executionAttemptId: randomUUID(),
      orderId,
      plan,
      riskAllowanceContentDigestHex: allowance.contentDigestHex,
      boundAtUtc: "2026-08-21T00:00:00.001Z",
    });
    await insertExecutionPolicyV2Postgres(db, { organizationId: orgA }, policy);
    await runWaiaPostgresTransaction(db, async (tx) => {
      await insertExecutionPlanV2Postgres(tx, { organizationId: orgA }, plan);
      await tx
        .update(pgSchema.traderOrders)
        .set({
          clientOrderId: attempt.clientOrderId,
          executionPlanId: plan.executionPlanId,
          executionPlanDigest: plan.contentDigestHex,
          executionAttemptId: attempt.executionAttemptId,
          executionAttemptDigest: attempt.contentDigestHex,
        })
        .where(
          and(
            eq(pgSchema.traderOrders.id, orderId),
            eq(pgSchema.traderOrders.organizationId, orgA),
          ),
        );
      await insertExecutionAttemptV2Postgres(tx, { organizationId: orgA }, attempt);
    });
    return { accountId, allowance, attempt, plan, policy };
  }

