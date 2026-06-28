import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  ExecutionHostUnavailableError,
  LivePathCredentialRequiredError,
  LivePathNotionalCapExceededError,
  LivePathRiskRejectedError,
  OrgLiveEnableRequiredError,
  OrgLiveTradingNotPermittedError,
  createAssertLivePathAuthorized,
  createSqliteOrgLiveEnableService,
} from "@/lib/trader/live";
import type { CredentialService } from "@/lib/trader/credentials/types";
import { approveDecision, buildRiskSnapshot, rejectDecision } from "@/lib/trader/risk/decision";
import { engineReasonCodes } from "@/lib/trader/risk/reason-codes";
import type { KillSwitchResolverPort } from "@/lib/trader/risk/evaluate.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  StrategyPromotionRequiredError,
  StrategyPromotionVersionMismatchError,
  createSqliteStrategyPromotionService,
} from "@/lib/trader/validation-gate";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000212b";
const STRATEGY_ID = "mean_reversion_v0";

function stubKillSwitch(blocked = false): KillSwitchResolverPort {
  return {
    getEffectiveState: async () => ({
      organizationId: "org",
      blocked,
      enforcementMode: blocked ? "STOP_ACCOUNT" : null,
      bindingState: blocked ? "ACTIVE" : null,
      resolutionStatus: "ok",
      contributors: [],
      resolvedAt: new Date().toISOString(),
    }),
  };
}

function stubCredentialService(): CredentialService {
  return {
    storeCredentials: vi.fn(),
    getDecryptedCredentials: vi.fn().mockResolvedValue({ apiKey: "k", apiSecret: "s" }),
    revokeCredentials: vi.fn(),
    listCredentialMetadata: vi.fn().mockResolvedValue([
      {
        id: "cred-212",
        venue: "htx",
        exchangeAccountId: "htx-spot-1",
        apiKeyMasked: "****",
        status: "active",
        permissionMetadata: {
          version: 1,
          marketType: "spot",
          exchangeAccountId: "htx-spot-1",
          scopes: ["trade"],
          warnings: [],
          withdrawForbidden: true,
          transferForbidden: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        revokedAt: null,
      },
    ]),
  };
}

function baseSubmitInput() {
  return {
    clientOrderId: "live-client-1",
    idempotencyKey: "live-idem-1",
    executionMode: "live" as const,
    symbol: "BTC/USDT",
    side: "buy" as const,
    type: "market" as const,
    quantity: "0.001",
    credentialId: "cred-212",
    strategySignalId: "sig-212",
    strategyId: STRATEGY_ID,
    strategyVersion: "0.1.0",
    allocationDecisionId: null,
    referencePrice: "50000",
    accountKey: "htx-spot-1",
  };
}

describe("composite live authorization gate (DEE-212 / BP-7)", () => {
  let org0: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-live-gate-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "live-gate.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "live-gate@example.com",
      password: "password123",
    });
    org0 = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Gate User" });
    process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = org0;
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(org0), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });
  });

  function makeAssert(
    options: {
      orgLiveEnabled?: boolean;
      promotionVersion?: string | null;
      probeHostHealth?: () => Promise<boolean>;
      liveCap?: string;
      killSwitchBlocked?: boolean;
      credentialService?: CredentialService;
    } = {},
  ) {
    const db = getDb();
    const orgLiveEnableService = createSqliteOrgLiveEnableService(db);
    if (options.orgLiveEnabled) {
      vi.spyOn(orgLiveEnableService, "getState").mockResolvedValue({
        organizationId: org0,
        state: "ENABLED",
        maxNotionalCap: options.liveCap ?? "10.00",
        requestedAt: new Date(),
        coolingOffEndsAt: new Date(),
        enabledAt: new Date(),
        disabledAt: null,
        operatorAckPhraseHash: "hash",
        stateVersion: 3,
        lastEventSeq: 3,
        lastEventDigest: "digest",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else {
      vi.spyOn(orgLiveEnableService, "getState").mockResolvedValue(null);
    }

    const promotionService = createSqliteStrategyPromotionService(db);
    if (options.promotionVersion != null) {
      vi.spyOn(promotionService, "getEffectivePromotion").mockResolvedValue({
        strategyVersion: options.promotionVersion,
      } as never);
    }

    return createAssertLivePathAuthorized({
      orgLiveEnableService,
      promotionService,
      killSwitchResolver: stubKillSwitch(options.killSwitchBlocked ?? false),
      riskLimitsService: createSqliteRiskLimitsService(db),
      credentialService: options.credentialService ?? stubCredentialService(),
      env: process.env,
      probeHostHealth: options.probeHostHealth ?? (async () => true),
    });
  }

  it("denies non–Org-0 organizations", async () => {
    const assertGate = makeAssert({ orgLiveEnabled: true, promotionVersion: "0.1.0" });
    const otherOrg = "00000000-0000-4000-8000-000000other";
    const input = baseSubmitInput();
    await expect(
      assertGate(requireOrgContext(otherOrg), {
        submitInput: input,
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(OrgLiveTradingNotPermittedError);
  });

  it("denies when org live-enable is not ENABLED", async () => {
    const assertGate = makeAssert({ orgLiveEnabled: false });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(OrgLiveEnableRequiredError);
  });

  it("denies when EFFECTIVE promotion is missing", async () => {
    const assertGate = makeAssert({ orgLiveEnabled: true });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(StrategyPromotionRequiredError);
  });

  it("denies when execution host health probe fails", async () => {
    const assertGate = makeAssert({
      orgLiveEnabled: true,
      promotionVersion: "0.1.0",
      probeHostHealth: async () => false,
    });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(ExecutionHostUnavailableError);
  });

  it("denies when notional exceeds org live cap", async () => {
    const assertGate = makeAssert({
      orgLiveEnabled: true,
      promotionVersion: "0.1.0",
      liveCap: "10.00",
    });
    const riskDecision = {
      riskDecisionId: "rd-212",
      organizationId: org0,
      configVersion: 1,
      decision: approveDecision(
        buildRiskSnapshot({
          order: {
            clientOrderId: "c",
            symbol: "BTC/USDT",
            side: "buy",
            type: "market",
            quantity: "1",
          },
          checksApplied: [],
        }),
        new Date().toISOString(),
      ),
    };

    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: { ...baseSubmitInput(), quantity: "1", referencePrice: "50000" },
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
        riskDecision,
      }),
    ).rejects.toThrow(LivePathNotionalCapExceededError);
  });

  it("denies when kill switch is active", async () => {
    const assertGate = makeAssert({
      orgLiveEnabled: true,
      promotionVersion: "0.1.0",
      killSwitchBlocked: true,
    });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(LivePathRiskRejectedError);
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("KILL_SWITCH") });
  });

  it("denies when credentialId is missing", async () => {
    const assertGate = makeAssert({ orgLiveEnabled: true, promotionVersion: "0.1.0" });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: { ...baseSubmitInput(), credentialId: null },
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(LivePathCredentialRequiredError);
  });

  it("denies when credential is not found in metadata", async () => {
    const assertGate = makeAssert({
      orgLiveEnabled: true,
      promotionVersion: "0.1.0",
      credentialService: {
        storeCredentials: vi.fn(),
        getDecryptedCredentials: vi.fn(),
        revokeCredentials: vi.fn(),
        listCredentialMetadata: vi.fn().mockResolvedValue([]),
      },
    });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(LivePathCredentialRequiredError);
  });

  it("denies when credential is revoked or non-HTX", async () => {
    const assertGate = makeAssert({
      orgLiveEnabled: true,
      promotionVersion: "0.1.0",
      credentialService: {
        storeCredentials: vi.fn(),
        getDecryptedCredentials: vi.fn(),
        revokeCredentials: vi.fn(),
        listCredentialMetadata: vi.fn().mockResolvedValue([
          {
            id: "cred-212",
            venue: "htx",
            exchangeAccountId: "htx-spot-1",
            apiKeyMasked: "****",
            status: "revoked",
            permissionMetadata: {
              version: 1,
              marketType: "spot",
              exchangeAccountId: "htx-spot-1",
              scopes: ["trade"],
              warnings: [],
              withdrawForbidden: true,
              transferForbidden: true,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            revokedAt: new Date(),
          },
        ]),
      },
    });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
      }),
    ).rejects.toThrow(LivePathCredentialRequiredError);
  });

  it("denies when strategy version mismatches EFFECTIVE promotion", async () => {
    const assertGate = makeAssert({ orgLiveEnabled: true, promotionVersion: "0.1.0" });
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.2.0",
      }),
    ).rejects.toThrow(StrategyPromotionVersionMismatchError);
  });

  it("denies when risk engine outcome is REJECT", async () => {
    const assertGate = makeAssert({ orgLiveEnabled: true, promotionVersion: "0.1.0" });
    const riskDecision = {
      riskDecisionId: "rd-reject-212",
      organizationId: org0,
      configVersion: 1,
      decision: rejectDecision(
        [engineReasonCodes.limitsNotConfigured],
        buildRiskSnapshot({
          order: {
            clientOrderId: "c",
            symbol: "BTC/USDT",
            side: "buy",
            type: "market",
            quantity: "0.001",
          },
          checksApplied: [],
        }),
        new Date().toISOString(),
      ),
    };

    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
        riskDecision,
      }),
    ).rejects.toThrow(LivePathRiskRejectedError);
    await expect(
      assertGate(requireOrgContext(org0), {
        submitInput: baseSubmitInput(),
        strategyId: STRATEGY_ID,
        strategyVersion: "0.1.0",
        riskDecision,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("REJECT") });
  });
});
