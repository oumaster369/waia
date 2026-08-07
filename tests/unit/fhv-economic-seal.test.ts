/**
 * WP-6A OPTION_E — economic seal eligibility and sealed-order registry.
 *
 * A terminal OrderState is not an economic-immutability frontier: recordFillSqlite and
 * recordFillProgressSqlite guard only on parent existence, never on terminality. These tests lock
 * the explicit seal frontier that replaces it, and the registry that preserves fill idempotency
 * after the hot-state rows are pruned.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateFhvEconomicSealEligibility,
  evaluateFhvSealBoundary,
  type FhvSealBoundaryProof,
  type FhvSealCandidateOrder,
} from "@/lib/trader/observability/fhv-economic-seal-eligibility";
import {
  computeFhvEconomicSealDigest,
  computeFhvFillIdentityCommitment,
  FHV_ECONOMIC_SEAL_SCHEMA,
  openFhvSealedOrderRegistry,
  publishFhvEconomicSeals,
  readFhvEconomicSeals,
  SealedLedgerIdentityDriftError,
  SealedLedgerScopeViolationError,
  type FhvEconomicSealV1,
} from "@/lib/trader/observability/fhv-economic-seal";

const ORG = "00000000-0000-4000-8000-000000000436";
const RUN = "fhv-seal-run";
const SESSION = "generation-1";

const CLEAN_PROOF: FhvSealBoundaryProof = {
  epochCommitted: true,
  sourceFrontierProven: true,
  reconciliationClean: true,
  ledgerDurable: true,
};

function order(overrides: Partial<FhvSealCandidateOrder> = {}): FhvSealCandidateOrder {
  return {
    orderId: "order-1",
    state: "FILLED",
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "65000.00",
    fillQuantitySum: "0.01",
    fillCount: 1,
    hasPendingExecutionIntent: false,
    ...overrides,
  };
}

function sealBody(
  overrides: Partial<Omit<FhvEconomicSealV1, "sealDigest">> = {},
): Omit<FhvEconomicSealV1, "sealDigest"> {
  const fillIds = overrides.fillIds ?? ["fill-1"];
  const exchangeTradeIds = overrides.exchangeTradeIds ?? ["trade-1"];
  return {
    schemaVersion: FHV_ECONOMIC_SEAL_SCHEMA,
    organizationId: ORG,
    runId: RUN,
    sessionIdentity: SESSION,
    orderId: "order-1",
    executionMode: "mock",
    finalObservedOrderState: "FILLED",
    finalQuantity: "0.01",
    finalFilledQuantity: "0.01",
    finalAvgFillPrice: "65000.00",
    lastOrderEventSeq: 3,
    fillIdentityCommitment: computeFhvFillIdentityCommitment(fillIds, exchangeTradeIds),
    fillIds,
    exchangeTradeIds,
    accountingFrontierSequence: 42,
    sourceFrontierGlobalEventSequence: 10_000,
    owningEpochId: 1,
    owningLastCycle: 9_999,
    ledgerSegmentSeq: 0,
    ledgerChainDigest: "c".repeat(64),
    economicExportDigest: "e".repeat(64),
    sealedAtReplayMs: 1_577_836_800_000,
    sealingReason: "EPOCH_COMMIT_ECONOMICALLY_COMPLETE",
    reconciliationProofIdentity: "r".repeat(64),
    ...overrides,
  };
}

const dirs: string[] = [];

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fhv-seal-spec-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WP-6A economic seal eligibility", () => {
  it("terminal state alone is not seal eligibility", () => {
    // FILLED but the recorded fills do not reconcile with the order aggregate.
    const result = evaluateFhvEconomicSealEligibility(
      order({ fillQuantitySum: "0.005" }),
      CLEAN_PROOF,
    );
    expect(result.eligible).toBe(false);
    expect(result).toMatchObject({ reason: "QUANTITY_RECONCILE_MISMATCH" });
  });

  it("retains open, partially filled, cancel-requested and reconciliation-required orders", () => {
    const cases: [Partial<FhvSealCandidateOrder>, string][] = [
      [{ state: "ACCEPTED" }, "NOT_TERMINAL_STATE"],
      [{ state: "PARTIALLY_FILLED" }, "UNRESOLVED_PARTIAL_FILL"],
      [{ state: "CANCEL_REQUESTED" }, "PENDING_CANCELLATION_OUTCOME"],
      [{ state: "RECONCILIATION_REQUIRED" }, "RECONCILIATION_REQUIRED_STATE"],
      [{ hasPendingExecutionIntent: true }, "PENDING_EXCHANGE_ACKNOWLEDGEMENT"],
    ];
    for (const [overrides, reason] of cases) {
      const result = evaluateFhvEconomicSealEligibility(order(overrides), CLEAN_PROOF);
      expect(result.eligible).toBe(false);
      expect(result).toMatchObject({ reason });
    }
  });

  it("retains a terminal but unreconciled order", () => {
    const result = evaluateFhvEconomicSealEligibility(order(), {
      ...CLEAN_PROOF,
      reconciliationClean: false,
    });
    expect(result.eligible).toBe(false);
    expect(result).toMatchObject({ reason: "RECONCILIATION_NOT_CLEAN" });
  });

  it("requires a committed epoch, proven source frontier and durable ledger", () => {
    expect(evaluateFhvSealBoundary({ ...CLEAN_PROOF, ledgerDurable: false })).toBe(
      "LEDGER_NOT_DURABLE",
    );
    expect(evaluateFhvSealBoundary({ ...CLEAN_PROOF, epochCommitted: false })).toBe(
      "EPOCH_NOT_COMMITTED",
    );
    expect(evaluateFhvSealBoundary({ ...CLEAN_PROOF, sourceFrontierProven: false })).toBe(
      "SOURCE_FRONTIER_NOT_PROVEN",
    );
    expect(evaluateFhvSealBoundary(CLEAN_PROOF)).toBeNull();
  });

  it("seals an economically complete, reconciled order", () => {
    expect(evaluateFhvEconomicSealEligibility(order(), CLEAN_PROOF).eligible).toBe(true);
    // A terminal order that never executed is complete too.
    expect(
      evaluateFhvEconomicSealEligibility(
        order({
          state: "REJECTED",
          filledQuantity: "0",
          fillQuantitySum: "0",
          fillCount: 0,
          avgFillPrice: null,
        }),
        CLEAN_PROOF,
      ).eligible,
    ).toBe(true);
  });

  it("compares economic decimals without going through Number", () => {
    // 0.010 and 0.01 are the same quantity; string inequality must not block a seal.
    expect(
      evaluateFhvEconomicSealEligibility(
        order({ filledQuantity: "0.010", fillQuantitySum: "0.01", quantity: "0.0100" }),
        CLEAN_PROOF,
      ).eligible,
    ).toBe(true);
  });
});

describe("WP-6A sealed-order registry", () => {
  it("publishes, reloads and indexes seals", () => {
    const runDir = makeRunDir();
    publishFhvEconomicSeals({
      runDir,
      organizationId: ORG,
      runId: RUN,
      sessionIdentity: SESSION,
      seals: [
        sealBody(),
        sealBody({ orderId: "order-2", fillIds: ["fill-2"], exchangeTradeIds: ["trade-2"] }),
      ],
    });

    const registry = openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN });
    expect(registry.sealCount).toBe(2);
    expect(registry.isSealed("order-1")).toBe(true);
    expect(registry.isSealed("order-unknown")).toBe(false);
    expect(registry.hasFillIdentity("order-1", "trade-1")).toBe(true);
    expect(registry.hasFillIdentity("order-1", "trade-999")).toBe(false);
    expect(registry.getSeal("order-2")?.orderId).toBe("order-2");
    expect(readFhvEconomicSeals(runDir)).toHaveLength(2);
  });

  it("fails closed on wrong tenant or wrong run identity", () => {
    const runDir = makeRunDir();
    publishFhvEconomicSeals({
      runDir,
      organizationId: ORG,
      runId: RUN,
      sessionIdentity: SESSION,
      seals: [sealBody()],
    });

    expect(() =>
      openFhvSealedOrderRegistry({ runDir, organizationId: "other-org", runId: RUN }),
    ).toThrow(SealedLedgerScopeViolationError);
    expect(() =>
      openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: "other-run" }),
    ).toThrow(SealedLedgerScopeViolationError);

    const registry = openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN });
    expect(() => registry.assertScope("other-org")).toThrow(SealedLedgerScopeViolationError);
    expect(() => registry.assertScope(ORG, "other-run")).toThrow(SealedLedgerScopeViolationError);
    expect(() => registry.assertScope(ORG, RUN)).not.toThrow();
  });

  it("fails closed on a tampered seal digest", () => {
    const runDir = makeRunDir();
    publishFhvEconomicSeals({
      runDir,
      organizationId: ORG,
      runId: RUN,
      sessionIdentity: SESSION,
      seals: [sealBody()],
    });

    const logPath = join(runDir, "economic-seal", "economic-seal-log.v1.ndjson");
    const seal = JSON.parse(readFileSync(logPath, "utf8").trim()) as FhvEconomicSealV1;
    writeFileSync(logPath, `${JSON.stringify({ ...seal, finalFilledQuantity: "999" })}\n`, "utf8");

    expect(() => openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN })).toThrow(
      SealedLedgerIdentityDriftError,
    );
  });

  it("fails closed on a fill-identity commitment mismatch", () => {
    const runDir = makeRunDir();
    const body = sealBody();
    const tampered = { ...body, exchangeTradeIds: ["trade-1", "trade-smuggled"] };
    const logPath = join(runDir, "economic-seal", "economic-seal-log.v1.ndjson");
    rmSync(join(runDir, "economic-seal"), { recursive: true, force: true });
    publishFhvEconomicSeals({
      runDir,
      organizationId: ORG,
      runId: RUN,
      sessionIdentity: SESSION,
      seals: [tampered],
    });
    expect(readFileSync(logPath, "utf8")).toContain("trade-smuggled");

    expect(() => openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN })).toThrow(
      SealedLedgerIdentityDriftError,
    );
  });

  it("fails closed on a duplicate seal for the same order", () => {
    const runDir = makeRunDir();
    publishFhvEconomicSeals({
      runDir,
      organizationId: ORG,
      runId: RUN,
      sessionIdentity: SESSION,
      seals: [sealBody(), sealBody()],
    });
    expect(() => openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN })).toThrow(
      SealedLedgerIdentityDriftError,
    );
  });

  it("refuses to publish a seal for a foreign org or run", () => {
    const runDir = makeRunDir();
    expect(() =>
      publishFhvEconomicSeals({
        runDir,
        organizationId: ORG,
        runId: RUN,
        sessionIdentity: SESSION,
        seals: [sealBody({ organizationId: "other-org" })],
      }),
    ).toThrow(SealedLedgerScopeViolationError);
  });

  it("binds the seal digest to every economic field", () => {
    const body = sealBody();
    const digest = computeFhvEconomicSealDigest(body);
    expect(computeFhvEconomicSealDigest({ ...body, finalAvgFillPrice: "65000.01" })).not.toBe(
      digest,
    );
    expect(computeFhvEconomicSealDigest({ ...body, accountingFrontierSequence: 43 })).not.toBe(
      digest,
    );
    // Deterministic replay time participates; wall clock never enters the record.
    expect(computeFhvEconomicSealDigest({ ...body, sealedAtReplayMs: 1 })).not.toBe(digest);
  });

  it("is empty and safe on a run with no seals", () => {
    const registry = openFhvSealedOrderRegistry({
      runDir: makeRunDir(),
      organizationId: ORG,
      runId: RUN,
    });
    expect(registry.sealCount).toBe(0);
    expect(registry.isSealed("order-1")).toBe(false);
    expect(registry.hasFillIdentity("order-1", "trade-1")).toBe(false);
  });
});
