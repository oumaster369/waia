import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import type { HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";
import {
  buildHistoricalComparisonIdentitiesV1,
  buildHistoricalCoverageProofV1,
  buildHistoricalRehearsalStartedReceiptV1,
  buildHistoricalScientificAdmissionRefusalReceiptV1,
  buildRuntimeReleaseBindingReceiptDigestV1,
  HISTORICAL_TERMINAL_RUNNER_ORGANIZATION_ID,
} from "@/lib/trader/historical-simulation-v2/historical-terminal-receipts-v1";
import {
  historicalTerminalAdminObservationUrlV1,
  historicalTerminalTenantObservationUrlV1,
  verifyHistoricalTerminalLaunchV1,
  type HistoricalTerminalLaunchFactsV1,
  type HistoricalTerminalObservationHttpAdapterV1,
} from "@/lib/trader/historical-simulation-v2/historical-terminal-launch-verifier-v1";

const tenantUserId = "11111111-1111-4111-8111-111111111111";
const organizationId = personalOrganizationIdFromUserId(tenantUserId);
const accountId = "durable-account";
const runId = "observed-walk-forward-35";
const releaseSha = "a".repeat(40);
const digest = "b".repeat(64);
const lifecycleDigest = "c".repeat(64);
const ledgerDigest = "d".repeat(64);

function scientificPayload() {
  const identities = buildHistoricalComparisonIdentitiesV1();
  return {
    statistics: identities.map((identity) => ({
      comparisonIdentityDigestHex: identity.comparisonIdentityDigestHex,
      pRaw: 0.2,
      dBar: 0.1,
      tObs: 1.5,
      extremeCount: 1,
      n: 10,
    })),
    holmComparisons: identities.map((identity) => ({
      comparisonId: identity.comparisonIdentityDigestHex,
      pValue: 0.2,
    })),
  };
}

function lineage(id = randomUUID()) {
  return { id, contentDigestHex: digest, releaseSha };
}

function projection(
  overrides: Partial<HistoricalObservableProjectionV2> = {},
): HistoricalObservableProjectionV2 {
  const cycle = {
    accountId,
    cycleSequence: 1,
    cycleId: "cycle-1",
    symbol: "BTCUSDT" as const,
    partition: "WALK_FORWARD" as const,
    replayBarClosedAtUtc: "2026-01-01T00:00:00.000Z",
    cash: "100.00000000",
    equity: "100.00000000",
    netPnl: "0.00000000",
    grossRealizedPnl: "0.00000000",
    netRealizedPnl: "0.00000000",
    netUnrealizedPnl: "0.00000000",
    buyAndHoldGrossEquity: "100.00000000",
    strategyMinusBuyAndHoldGross: "0.00000000",
    buyAndHoldConvention: "GROSS_MARK_TO_MARKET_NO_FEES" as const,
    openPositionsCount: 0,
    decisionsCount: 1,
    riskVetoCount: 0,
    ordersCount: 0,
    fillsCount: 0,
    pendingModeledOrders: [],
    lastForecast: {},
    lastDecision: {},
    lastPortfolio: {},
    lastRisk: {},
    lastExecution: {},
    lastAccounting: {},
    lastGuardian: {},
    lastLearning: {},
    observedExecutionEffects: [],
    modeledRealityArtifacts: [],
    knowledgeArtifacts: [],
    stages: [],
    snapshots: [],
    checkpoint: {
      committedCycleSequence: 1,
      nextRecordIndex: 2,
      nextCycleSequence: 2,
      contentDigestHex: digest,
    },
    ledgerHeadContentDigestHex: ledgerDigest,
  };
  return {
    schemaVersion: "waia.trader.historical_observable_read_model.v2",
    mode: "HISTORICAL_SIMULATION",
    capitalEligible: false,
    organizationId,
    runId,
    eventId: "admin-event",
    observedAt: "2026-09-13T00:00:00.000Z",
    lifecycle: {
      phase: "RUNNING",
      qualifiedTotalCycles: 3,
      committedCycles: 1,
      remainingCycles: 2,
      progressBps: 3333,
      nextCycleSequence: 2,
      latestCommittedCycleId: "cycle-1",
      observedAt: "2026-09-13T00:00:00.000Z",
      errorCode: null,
      contentDigestHex: lifecycleDigest,
    },
    accounts: [{ ...cycle, history: [cycle] }],
    aggregate: {
      accountCount: 1,
      cash: "100.00000000",
      equity: "100.00000000",
      netPnl: "0.00000000",
      buyAndHoldGrossEquity: "100.00000000",
      strategyMinusBuyAndHoldGross: "0.00000000",
      cycles: 1,
      decisions: 1,
      riskVetoes: 0,
      orders: 0,
      fills: 0,
      processedRecords: 1,
      latestCycleSequence: 1,
      qualifiedTotalCycles: 3,
      committedCycles: 1,
      progressBps: 3333,
      runPhase: "RUNNING",
    },
    ...overrides,
  };
}

function passingFacts(
  overrides: Partial<HistoricalTerminalLaunchFactsV1> = {},
): HistoricalTerminalLaunchFactsV1 {
  return {
    releaseSha,
    organizationId,
    accountId,
    runId,
    tenantUserId,
    proposals: [lineage()],
    ratifications: [lineage()],
    fourSurfaceAuthorities: [lineage()],
    acceptedClaims: [{ claimantId: "consumer-1" }],
    leaseAcquired: true,
    lifecycle: { phase: "RUNNING", contentDigestHex: lifecycleDigest, releaseSha },
    health: { status: "ok", releaseSha, imageReleaseSha: releaseSha, runId },
    adminCookie: "admin-session",
    tenantCookie: "tenant-session",
    ...scientificPayload(),
    ...overrides,
  };
}

function adapter(
  input: Readonly<{
    admin?: Partial<
      import("@/lib/trader/historical-simulation-v2/historical-terminal-launch-verifier-v1").HistoricalTerminalObservationHttpResultV1
    >;
    tenant?: Partial<
      import("@/lib/trader/historical-simulation-v2/historical-terminal-launch-verifier-v1").HistoricalTerminalObservationHttpResultV1
    >;
  }> = {},
): HistoricalTerminalObservationHttpAdapterV1 & { urls: string[] } {
  const urls: string[] = [];
  const adminBody = projection({ eventId: "admin-event" });
  const tenantBody = projection({ eventId: "tenant-event" });
  return {
    urls,
    async fetch({ url, role }) {
      urls.push(url);
      if (role === "admin") {
        return { status: 200, authenticated: true, body: adminBody, ...input.admin };
      }
      return { status: 200, authenticated: true, body: tenantBody, ...input.tenant };
    },
  };
}

function productionSourceFiles(root = resolve(process.cwd())): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "tests" || entry === ".git") continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry)) files.push(path);
    }
  };
  for (const dir of ["app", "lib", "scripts", "services", "db"]) walk(join(root, dir));
  return files;
}

describe("DEE-1006 terminal receipt writers", () => {
  it("seals a stable scientific-refusal content digest", () => {
    const payload = scientificPayload();
    const first = buildHistoricalScientificAdmissionRefusalReceiptV1({
      releaseSha,
      organizationId,
      runId,
      reasonCode: "HOLM_FWER_FAIL",
      ...payload,
    });
    const second = buildHistoricalScientificAdmissionRefusalReceiptV1({
      releaseSha,
      organizationId,
      runId,
      reasonCode: "HOLM_FWER_FAIL",
      ...payload,
    });
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
    expect(first.comparisonIdentities).toHaveLength(20);
    expect(first.surfaces).toHaveLength(4);
    expect(first.coverage).toEqual(buildHistoricalCoverageProofV1());
    expect(first.holmFwer.familyPass).toBe(false);
    expect(first.runtimeReleaseBindingReceiptDigestHex).toBe(
      buildRuntimeReleaseBindingReceiptDigestV1(releaseSha),
    );
    const mutated = buildHistoricalScientificAdmissionRefusalReceiptV1({
      releaseSha,
      organizationId,
      runId,
      reasonCode: "BRIER_GATE_FAIL",
      ...payload,
    });
    expect(mutated.contentDigestHex).not.toBe(first.contentDigestHex);
  });

  it("refuses secrets in receipt JSON", () => {
    expect(() =>
      buildHistoricalRehearsalStartedReceiptV1({
        releaseSha,
        runtimeReleaseBindingReceiptDigestHex:
          buildRuntimeReleaseBindingReceiptDigestV1(releaseSha),
        organizationId,
        accountId,
        runId,
        proposalId: randomUUID(),
        proposalContentDigestHex: digest,
        ratificationId: randomUUID(),
        ratificationContentDigestHex: digest,
        fourSurfaceAuthorityId: randomUUID(),
        fourSurfaceAuthorityContentDigestHex: digest,
        consumerClaim: { claimantId: "cookie-session", accepted: true, concurrentClaimantCount: 0 },
        lease: { leaseKey: "lease", acquired: true },
        lifecycle: { phase: "RUNNING", contentDigestHex: digest },
        imageHealthBinding: { releaseSha, imageReleaseSha: releaseSha, runId, status: "ok" },
        adminObservationBinding: {
          organizationId,
          runId,
          lifecycleContentDigestHex: digest,
          accountId,
          ledgerHeadContentDigestHex: digest,
          cycleSequence: 1,
          cycleId: "cycle-1",
        },
        tenantObservationBinding: {
          organizationId,
          runId,
          accountId,
          lifecycleContentDigestHex: digest,
          ledgerHeadContentDigestHex: digest,
          cycleSequence: 1,
          cycleId: "cycle-1",
        },
      }),
    ).toThrow("SECRET");
  });

  it("seals a stable rehearsal-started content digest", () => {
    const input = {
      releaseSha,
      runtimeReleaseBindingReceiptDigestHex: buildRuntimeReleaseBindingReceiptDigestV1(releaseSha),
      organizationId,
      accountId,
      runId,
      proposalId: randomUUID(),
      proposalContentDigestHex: digest,
      ratificationId: randomUUID(),
      ratificationContentDigestHex: digest,
      fourSurfaceAuthorityId: randomUUID(),
      fourSurfaceAuthorityContentDigestHex: digest,
      consumerClaim: {
        claimantId: "consumer-1",
        accepted: true as const,
        concurrentClaimantCount: 0 as const,
      },
      lease: { leaseKey: "lease", acquired: true as const },
      lifecycle: { phase: "RUNNING" as const, contentDigestHex: digest },
      imageHealthBinding: { releaseSha, imageReleaseSha: releaseSha, runId, status: "ok" as const },
      adminObservationBinding: {
        organizationId,
        runId,
        lifecycleContentDigestHex: digest,
        accountId,
        ledgerHeadContentDigestHex: digest,
        cycleSequence: 1,
        cycleId: "cycle-1",
      },
      tenantObservationBinding: {
        organizationId,
        runId,
        accountId,
        lifecycleContentDigestHex: digest,
        ledgerHeadContentDigestHex: digest,
        cycleSequence: 1,
        cycleId: "cycle-1",
      },
    };
    const first = buildHistoricalRehearsalStartedReceiptV1(input);
    const second = buildHistoricalRehearsalStartedReceiptV1(input);
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
    expect(first.schemaVersion).toBe("waia.trader.historical_rehearsal_started.v1");
  });
});

describe("DEE-1006 sole terminal verifier", () => {
  it("emits PASS only after every predicate and ignores raw eventId", async () => {
    const http = adapter();
    const result = await verifyHistoricalTerminalLaunchV1(passingFacts(), { observation: http });
    expect(result.status).toBe("PASS");
    if (result.status !== "PASS") throw new Error("expected PASS");
    expect(result.marker).toBe(
      `HISTORICAL_REHEARSAL_STARTED=PASS receipt=${result.receipt.contentDigestHex}`,
    );
    expect(http.urls).toEqual([
      historicalTerminalAdminObservationUrlV1(organizationId, runId),
      historicalTerminalTenantObservationUrlV1(runId, accountId),
    ]);
    expect(http.urls.every((url) => url.includes("transport=poll"))).toBe(true);
    expect(HISTORICAL_TERMINAL_RUNNER_ORGANIZATION_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["missing proposal", { proposals: [] }, "MISSING_PROPOSAL"],
    ["missing ratification", { ratifications: [] }, "MISSING_RATIFICATION"],
    ["missing authority", { fourSurfaceAuthorities: [] }, "MISSING_FOUR_SURFACE_AUTHORITY"],
    [
      "release mismatch",
      { proposals: [{ ...lineage(), releaseSha: "b".repeat(40) }] },
      "RELEASE_MISMATCH",
    ],
    [
      "concurrent claimant",
      { acceptedClaims: [{ claimantId: "a" }, { claimantId: "b" }] },
      "CONCURRENT_CLAIMANT",
    ],
    ["busy lease", { leaseAcquired: false }, "CONCURRENT_CLAIMANT"],
    [
      "wrong lifecycle",
      { lifecycle: { phase: "QUEUED", contentDigestHex: lifecycleDigest, releaseSha } },
      "WRONG_LIFECYCLE",
    ],
    [
      "health mismatch",
      { health: { status: "degraded", releaseSha, imageReleaseSha: releaseSha, runId } },
      "HEALTH_MISMATCH",
    ],
    ["fixture run", { runId: "e2e-observation-only" }, "FIXTURE_IDENTITY"],
    ["fixture org", { organizationId: "selected-org" }, "FIXTURE_IDENTITY"],
    ["unauthenticated cookie", { adminCookie: undefined }, "UNAUTHENTICATED_OBSERVATION"],
  ] as const)("refuses %s", async (_name, overrides, reason) => {
    const result = await verifyHistoricalTerminalLaunchV1(
      passingFacts(overrides as Partial<HistoricalTerminalLaunchFactsV1>),
      { observation: adapter() },
    );
    expect(result.status).toBe("REFUSED");
    if (result.status !== "REFUSED") throw new Error("expected REFUSED");
    expect(result.reasonCode).toBe(reason);
    expect(result.marker).toBe(
      `SCIENTIFIC_ADMISSION_REFUSED=${reason}:${result.receipt.contentDigestHex}`,
    );
  });

  it("refuses when the observation adapter is missing", async () => {
    const result = await verifyHistoricalTerminalLaunchV1(passingFacts(), {});
    expect(result.status).toBe("REFUSED");
    if (result.status !== "REFUSED") throw new Error("expected REFUSED");
    expect(result.reasonCode).toBe("OBSERVATION_ADAPTER_MISSING");
  });

  it("refuses unauthenticated 200 and 401/403 rather than PASS", async () => {
    const unauthenticated = await verifyHistoricalTerminalLaunchV1(passingFacts(), {
      observation: adapter({ admin: { status: 200, authenticated: false } }),
    });
    expect(unauthenticated.status).toBe("REFUSED");
    if (unauthenticated.status !== "REFUSED") throw new Error("expected REFUSED");
    expect(unauthenticated.reasonCode).toBe("UNAUTHENTICATED_OBSERVATION");
    const forbidden = await verifyHistoricalTerminalLaunchV1(passingFacts(), {
      observation: adapter({ tenant: { status: 403, authenticated: false, body: null } }),
    });
    expect(forbidden.status).toBe("REFUSED");
    if (forbidden.status !== "REFUSED") throw new Error("expected REFUSED");
    expect(forbidden.reasonCode).toBe("UNAUTHENTICATED_OBSERVATION");
  });

  it("refuses missing Admin, missing tenant, and cross-run observation", async () => {
    const missingAdmin = await verifyHistoricalTerminalLaunchV1(passingFacts(), {
      observation: adapter({ admin: { status: 200, authenticated: true, body: null } }),
    });
    expect(missingAdmin.status === "REFUSED" && missingAdmin.reasonCode).toBe(
      "MISSING_ADMIN_OBSERVATION",
    );
    const missingTenant = await verifyHistoricalTerminalLaunchV1(passingFacts(), {
      observation: adapter({ tenant: { status: 200, authenticated: true, body: null } }),
    });
    expect(missingTenant.status === "REFUSED" && missingTenant.reasonCode).toBe(
      "MISSING_TENANT_OBSERVATION",
    );
    const crossRun = await verifyHistoricalTerminalLaunchV1(passingFacts(), {
      observation: adapter({
        tenant: { status: 200, authenticated: true, body: projection({ runId: "other-run" }) },
      }),
    });
    expect(crossRun.status === "REFUSED" && crossRun.reasonCode).toBe("CROSS_RUN_OBSERVATION");
  });

  it("refuses when the tenant personal organization is not the run organization", async () => {
    const result = await verifyHistoricalTerminalLaunchV1(
      passingFacts({ tenantUserId: randomUUID() }),
      { observation: adapter() },
    );
    expect(result.status === "REFUSED" && result.reasonCode).toBe("ORGANIZATION_SCOPE");
  });

  it("is the only production emitter of the rehearsal PASS marker", () => {
    const marker = "HISTORICAL_REHEARSAL_STARTED=PASS";
    const hits = productionSourceFiles().filter((path) =>
      readFileSync(path, "utf8").includes(marker),
    );
    expect(hits.map((path) => relative(process.cwd(), path))).toEqual([
      "lib/trader/historical-simulation-v2/historical-terminal-launch-verifier-v1.ts",
    ]);
  });
});
