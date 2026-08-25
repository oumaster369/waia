import { describe, expect, it } from "vitest";

import { loadWatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";
import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher/config";
import { runTreasuryWatcherCycle } from "@/lib/waia-core/treasury/watcher/cycle";
import { treasuryWatcherReadiness } from "@/lib/waia-core/treasury/watcher/build-worker-deps";
import { createSilentTreasuryWatcherLogger } from "@/lib/waia-core/treasury/watcher/logger";
import {
  createFakeChainAdapter,
  createWatcherHarness,
  ctxA,
  ctxB,
  watcherConfig,
} from "@/tests/unit/helpers/treasury-wp3";

describe("DEE-606 WP-3 treasury watcher DARK + org/inception", () => {
  it("1. TREASURY_WATCHER_ENABLED defaults false", () => {
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
    expect(loadTreasuryWatcherConfig({ TREASURY_WATCHER_ENABLED: "" }).enabled).toBe(false);
  });

  it("100. WATCHER_ENABLED does not enable Treasury watcher", () => {
    const treasury = loadTreasuryWatcherConfig({ WATCHER_ENABLED: "true" });
    const payment = loadWatcherConfig({
      WATCHER_ENABLED: "true",
      TREASURY_WATCHER_ENABLED: "true",
    });
    expect(treasury.enabled).toBe(false);
    expect(payment.enabled).toBe(true);
    expect(loadTreasuryWatcherConfig({ TREASURY_WATCHER_ENABLED: "true" }).enabled).toBe(true);
  });

  it("parses Treasury-specific env names independently", () => {
    const config = loadTreasuryWatcherConfig({
      TREASURY_WATCHER_ENABLED: "true",
      TREASURY_WATCHER_CONFIRMATIONS_REQUIRED: "7",
      TREASURY_WATCHER_RESCAN_WINDOW: "11",
      TREASURY_WATCHER_MAX_BLOCKS_PER_CYCLE: "9",
      TREASURY_WATCHER_LEASE_TTL_SECONDS: "12",
      TREASURY_WATCHER_STALE_THRESHOLD_SECONDS: "13",
      TREASURY_WATCHER_RPC_MAX_RETRIES: "4",
      TREASURY_WATCHER_REORG_AGEOUT_MINUTES: "15",
      TREASURY_WATCHER_MAX_PAGES_PER_BLOCK: "8",
      TREASURY_WATCHER_USDT_CONTRACT: "TCustomContract",
      TREASURY_WATCHER_TRON_PRIMARY_URL: "https://primary.example",
      TREASURY_WATCHER_TRON_SECONDARY_URL: "https://secondary.example",
      TREASURY_WATCHER_TRONGRID_API_KEY: "k1",
      TREASURY_WATCHER_TRON_SECONDARY_API_KEY: "k2",
    });
    expect(config.confirmationsRequired).toBe(7);
    expect(config.rescanWindow).toBe(11);
    expect(config.maxBlocksPerCycle).toBe(9);
    expect(config.tokenContract).toBe("TCustomContract");
    expect(config.tronGridApiKey).toBe("k1");
  });

  it("requires org, Postgres, TronGrid, and an independent secondary before readiness", () => {
    expect(treasuryWatcherReadiness({ TREASURY_WATCHER_ENABLED: "true" })).toMatchObject({
      enabled: true,
      ready: false,
    });
    expect(
      treasuryWatcherReadiness({
        TREASURY_WATCHER_ENABLED: "false",
        TREASURY_WATCHER_ORGANIZATION_ID: ctxA.organizationId,
        DATABASE_URL_POSTGRES: "postgresql://local.invalid/waia",
        TREASURY_WATCHER_TRONGRID_API_KEY: "primary",
        TREASURY_WATCHER_TRON_SECONDARY_URL: "https://secondary.example",
      }),
    ).toMatchObject({
      enabled: false,
      primaryKeyPresent: true,
      secondaryConfigured: true,
      ready: true,
    });
    expect(
      treasuryWatcherReadiness({
        TREASURY_WATCHER_ORGANIZATION_ID: ctxA.organizationId,
        DATABASE_URL_POSTGRES: "postgresql://local.invalid/waia",
        TREASURY_WATCHER_TRONGRID_API_KEY: "primary",
        TREASURY_WATCHER_TRON_PRIMARY_URL: "https://api.trongrid.io",
        TREASURY_WATCHER_TRON_SECONDARY_URL: "https://api.trongrid.io/another-path",
      }),
    ).toMatchObject({ secondaryConfigured: false, ready: false });
  });

  it("2-3. disabled cycle makes zero chain calls and zero persistence mutations", async () => {
    const chain = createFakeChainAdapter();
    const harness = await createWatcherHarness({ enabled: false, chain });
    const report = await harness.run();
    expect(report.outcome).toBe("noop_disabled");
    expect(chain.chainCalls).toBe(0);
    expect(report.chainCalls).toBe(0);
    expect(report.persistenceMutations).toBe(0);
    expect(await harness.watcherRepository.listObservationsForOrg(ctxA)).toHaveLength(0);
    expect(await harness.watcherRepository.listOrgTransactions(ctxA)).toHaveLength(0);
    expect(await harness.watcherRepository.getCheckpoint(ctxA, "TRC-20:treasury")).toBeNull();
  });

  it("4. explicit OrgContext is required", async () => {
    const harness = await createWatcherHarness();
    await expect(
      runTreasuryWatcherCycle(
        { organizationId: "" },
        {
          config: watcherConfig(),
          chainAdapter: harness.chain,
          watcherRepository: harness.watcherRepository,
          treasuryRepository: harness.services.repository,
          transactions: harness.services.transactions,
          logger: createSilentTreasuryWatcherLogger(),
        },
      ),
    ).rejects.toThrow(OrgScopeError);
  });

  it("5. no ACTIVE inception => closed/no-op", async () => {
    const chain = createFakeChainAdapter();
    const harness = await createWatcherHarness({ skipInception: true, chain });
    const report = await harness.run();
    expect(report.outcome).toBe("noop_no_inception");
    expect(chain.chainCalls).toBe(0);
    expect(report.persistenceMutations).toBe(0);
  });

  it("6. wrong-org inception is not visible", async () => {
    const harness = await createWatcherHarness();
    const report = await harness.run(ctxB);
    expect(report.outcome).toBe("noop_no_inception");
    expect(harness.chain.chainCalls).toBe(0);
  });
});
