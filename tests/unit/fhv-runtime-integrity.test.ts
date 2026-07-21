import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  FHV_ADMIN_CSRF_COOKIE,
  FHV_ADMIN_CSRF_HEADER,
  createFhvAdminCsrfToken,
} from "@/lib/trader/fhv-admin-csrf";
import {
  FHV_COMMAND_CAPABILITY,
  handleAdminFhvOperationsCommandPost,
  handleAdminFhvOperationsStatusGet,
  type FhvAdminHandlerDeps,
} from "@/lib/trader/fhv-admin-handler";
import { checkAndRecordFhvCommandRateLimit } from "@/lib/trader/fhv-admin-rate-limit-durable";
import {
  buildFhvAdminCommandPath,
  buildFhvAdminStatusPath,
} from "@/lib/trader/fhv-campaign-run-id";
import { parseFhvAdminCommandRequest } from "@/lib/trader/observability/fhv-admin-command-request-schema";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  validateFhvCampaignHeartbeat,
  writeFhvCampaignHeartbeat,
} from "@/lib/trader/observability/fhv-campaign-heartbeat";
import { FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import { buildRequiredConfirmationPhrase } from "@/lib/trader/observability/fhv-command-confirmation";
import {
  createFhvObserverState,
  runFhvObserverTick,
} from "@/lib/trader/observability/fhv-observer-core";
import {
  loadFhvObserverProgressState,
  saveFhvObserverProgressState,
} from "@/lib/trader/observability/fhv-observer-progress-state";
import {
  createFhvObserverTransportNonceCache,
  createFhvObserverTransportNonceCacheForRunRoot,
} from "@/lib/trader/observability/fhv-observer-transport-nonce-cache";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  sha256Hex,
  verifyFhvObserverAuthToken,
} from "@/lib/trader/observability/fhv-observer-transport-auth";
import type { FhvObserverBridge } from "@/lib/trader/observability/fhv-observer-bridge";
import {
  FhvRuntimeResponseValidationError,
  validateFhvOperatorStatusV1Response,
} from "@/lib/trader/observability/fhv-runtime-response-validators";
import { readFhvOperatorStatusTolerant } from "@/lib/trader/observability/fhv-status-writer";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const ORG_A = "00000000-0000-4000-8000-0000000416a1";
const RUN_ID = "dee-416-integrity-run";
const ADMIN_ID = "00000000-0000-4000-8000-00000000d416";
const CSRF_SECRET = "fhv-integrity-csrf-secret";
const COMMAND_SECRET = "fhv-integrity-command-secret";

function sampleStatus(organizationId: string) {
  return buildFhvOperatorStatusV1({
    organizationId,
    runId: RUN_ID,
    phase: "validation",
    codeSha: "sha",
    artifactDigest: "artifact",
    datasetSeal: "seal",
    datasetDigest: "digest",
    configurationDigest: "config",
  });
}

function writeHeartbeat(
  runRoot: string,
  input: {
    organizationId: string;
    runId: string;
    sequence: number;
    heartbeatAtUtc: string;
    barsProcessed?: number;
  },
): void {
  mkdirSync(join(runRoot, "control"), { recursive: true });
  writeFhvCampaignHeartbeat(runRoot, {
    schemaVersion: FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    campaignProcessIdentity: "campaign-process-416",
    heartbeatSequence: input.sequence,
    heartbeatAtUtc: input.heartbeatAtUtc,
    barsProcessed: input.barsProcessed ?? 0,
    phase: "validation",
  });
}

describe("DEE-416 FHV runtime integrity", () => {
  describe("campaign-owned heartbeat", () => {
    it("does not treat observer ticks alone as a healthy heartbeat", async () => {
      const root = mkdtempSync(join(tmpdir(), "fhv-heartbeat-missing-"));
      mkdirSync(root, { recursive: true });
      const state = createFhvObserverState({
        runRoot: root,
        runId: RUN_ID,
        organizationId: ORG_A,
        commandSecret: COMMAND_SECRET,
        observerTunnelSecret: "fhv-tunnel-secret",
      });

      try {
        await runFhvObserverTick(state, {
          nowMs: Date.parse("2026-07-21T12:00:00.000Z"),
          barsProcessed: 10,
        });
        const status = readFhvOperatorStatusTolerant(root);
        expect(status?.campaign.heartbeatState).toBe("UNKNOWN_OR_MISSING");
        expect(status?.campaign.heartbeatAgeMs).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("uses campaign heartbeat age and rejects wrong org/run", async () => {
      const root = mkdtempSync(join(tmpdir(), "fhv-heartbeat-valid-"));
      mkdirSync(root, { recursive: true });
      writeHeartbeat(root, {
        organizationId: ORG_A,
        runId: RUN_ID,
        sequence: 1,
        heartbeatAtUtc: "2026-07-21T12:00:00.000Z",
        barsProcessed: 5,
      });

      const validation = validateFhvCampaignHeartbeat({
        runRoot: root,
        organizationId: ORG_A,
        runId: RUN_ID,
        nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
      });
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.heartbeatAgeSec).toBe(60);
      }

      expect(
        validateFhvCampaignHeartbeat({
          runRoot: root,
          organizationId: "other-org",
          runId: RUN_ID,
        }).ok,
      ).toBe(false);

      expect(
        validateFhvCampaignHeartbeat({
          runRoot: root,
          organizationId: ORG_A,
          runId: "other-run",
          lastSeenSequence: 5,
        }),
      ).toMatchObject({ ok: false, heartbeatState: "RUN_MISMATCH" });

      rmSync(root, { recursive: true, force: true });
    });

    it("detects heartbeat sequence regression", () => {
      const root = mkdtempSync(join(tmpdir(), "fhv-heartbeat-seq-"));
      mkdirSync(root, { recursive: true });
      writeHeartbeat(root, {
        organizationId: ORG_A,
        runId: RUN_ID,
        sequence: 1,
        heartbeatAtUtc: "2026-07-21T12:00:00.000Z",
      });

      const result = validateFhvCampaignHeartbeat({
        runRoot: root,
        organizationId: ORG_A,
        runId: RUN_ID,
        lastSeenSequence: 3,
      });
      expect(result).toMatchObject({ ok: false, heartbeatState: "SEQUENCE_REGRESSION" });
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("durable stall/progress state", () => {
    it("restores persisted progress and does not hide pre-existing stall on restart", async () => {
      const root = mkdtempSync(join(tmpdir(), "fhv-stall-restart-"));
      mkdirSync(root, { recursive: true });
      saveFhvObserverProgressState(root, {
        schemaVersion: "fhv-observer-progress-state/v1",
        runId: RUN_ID,
        organizationId: ORG_A,
        lastBarsProcessed: 40,
        lastProgressAtUtc: "2026-07-21T10:00:00.000Z",
        lastHeartbeatSequence: 2,
        processRestartCount: 1,
        restoredConservatively: false,
      });

      const restarted = createFhvObserverState({
        runRoot: root,
        runId: RUN_ID,
        organizationId: ORG_A,
        commandSecret: COMMAND_SECRET,
        observerTunnelSecret: "fhv-tunnel-secret",
      });
      expect(restarted.lastBarsProcessed).toBe(40);
      expect(restarted.lastProgressMs).toBe(Date.parse("2026-07-21T10:00:00.000Z"));

      await runFhvObserverTick(restarted, {
        nowMs: Date.parse("2026-07-21T12:00:00.000Z"),
        barsProcessed: 40,
        processRestartCount: 2,
      });
      const restored = loadFhvObserverProgressState(root);
      expect(restored?.processRestartCount).toBe(2);
      expect(restored?.lastBarsProcessed).toBe(40);

      rmSync(root, { recursive: true, force: true });
    });

    it("initializes conservatively when no prior progress exists", () => {
      const root = mkdtempSync(join(tmpdir(), "fhv-stall-fresh-"));
      mkdirSync(root, { recursive: true });
      const state = createFhvObserverState({
        runRoot: root,
        runId: RUN_ID,
        organizationId: ORG_A,
        commandSecret: COMMAND_SECRET,
        observerTunnelSecret: "fhv-tunnel-secret",
      });
      expect(state.restoredConservatively).toBe(true);
      expect(state.lastProgressMs).toBe(0);
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("bounded replay protection", () => {
    it("rejects replay inside the accepted window and prunes expired nonces", () => {
      const cache = createFhvObserverTransportNonceCache({
        maxEntries: 10,
        ttlMs: 60_000,
        maxSkewMs: 5_000,
      });
      const payload = {
        organizationId: ORG_A,
        campaignRunId: RUN_ID,
        nonce: "nonce-replay-416",
      };
      const secret = "fhv-replay-secret";
      const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
      const token = buildFhvObserverAuthToken(
        {
          method: "GET",
          path: "/v1/status",
          organizationId: ORG_A,
          campaignRunId: RUN_ID,
          timestampMs: nowMs,
          nonce: payload.nonce,
          bodySha256: sha256Hex(""),
        },
        secret,
      );

      verifyFhvObserverAuthToken({
        headerValue: token,
        payload: {
          method: "GET",
          path: "/v1/status",
          organizationId: ORG_A,
          campaignRunId: RUN_ID,
          timestampMs: nowMs,
          nonce: payload.nonce,
          bodySha256: sha256Hex(""),
        },
        secret,
        nowMs,
        nonceCache: cache,
      });

      expect(() =>
        verifyFhvObserverAuthToken({
          headerValue: token,
          payload: {
            method: "GET",
            path: "/v1/status",
            organizationId: ORG_A,
            campaignRunId: RUN_ID,
            timestampMs: nowMs,
            nonce: payload.nonce,
            bodySha256: sha256Hex(""),
          },
          secret,
          nowMs,
          nonceCache: cache,
        }),
      ).toThrow("FHV_OBSERVER_AUTH_REPLAY");

      cache.prune(nowMs + 20 * 60 * 1000);
      expect(cache.has(payload)).toBe(false);
    });

    it("persists nonces across restart via run-root cache", () => {
      const root = mkdtempSync(join(tmpdir(), "fhv-nonce-persist-"));
      mkdirSync(root, { recursive: true });
      const cacheA = createFhvObserverTransportNonceCacheForRunRoot(root);
      cacheA.remember({
        nonce: "persisted-nonce",
        organizationId: ORG_A,
        campaignRunId: RUN_ID,
        nowMs: Date.parse("2026-07-21T12:00:00.000Z"),
      });

      const cacheB = createFhvObserverTransportNonceCacheForRunRoot(root);
      expect(
        cacheB.has({ nonce: "persisted-nonce", organizationId: ORG_A, campaignRunId: RUN_ID }),
      ).toBe(true);
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("strict command request schema", () => {
    it("requires exact confirmation phrases per action", () => {
      const parsed = parseFhvAdminCommandRequest({
        organizationId: ORG_A,
        urlCampaignRunId: RUN_ID,
        rawBody: {
          organization_id: ORG_A,
          campaign_run_id: RUN_ID,
          action: "EMERGENCY_STOP",
          reason: "operator emergency stop",
          confirmation_phrase: buildRequiredConfirmationPhrase(RUN_ID, "EMERGENCY_STOP"),
        },
      });
      expect(parsed.confirmationPhraseClass).toBe("EMERGENCY");
    });

    it("rejects unknown actions and invalid confirmation phrases", () => {
      expect(() =>
        parseFhvAdminCommandRequest({
          organizationId: ORG_A,
          urlCampaignRunId: RUN_ID,
          rawBody: {
            action: "DELETE_EVERYTHING",
            reason: "bad action",
            confirmation_phrase: "nope",
          },
        }),
      ).toThrow();

      expect(() =>
        parseFhvAdminCommandRequest({
          organizationId: ORG_A,
          urlCampaignRunId: RUN_ID,
          rawBody: {
            action: "GRACEFUL_STOP",
            reason: "wrong phrase",
            confirmation_phrase: "STOP wrong-run",
          },
        }),
      ).toThrow();
    });
  });

  describe("runtime response validation", () => {
    it("rejects status payloads with org/run binding mismatch", () => {
      const status = sampleStatus(ORG_A);
      expect(() =>
        validateFhvOperatorStatusV1Response({
          payload: status,
          organizationId: ORG_A,
          campaignRunId: "other-run",
        }),
      ).toThrow(FhvRuntimeResponseValidationError);
    });

    it("rejects oversized status payloads", () => {
      const status = sampleStatus(ORG_A);
      const oversized = {
        ...status,
        recentAlerts: Array.from({ length: 25 }, (_, index) => ({
          alertId: `FHV-ALERT-${index}`,
          severity: "WARNING",
          firedAtUtc: "2026-07-21T12:00:00.000Z",
          message: "x".repeat(500),
        })),
      };
      expect(() =>
        validateFhvOperatorStatusV1Response({
          payload: oversized,
          organizationId: ORG_A,
          campaignRunId: RUN_ID,
        }),
      ).toThrow(FhvRuntimeResponseValidationError);
    });
  });

  describe("atomic durable rate limit", () => {
    beforeAll(() => {
      resetWaiaSqliteSingleton();
      process.env.WAIA_DB_BACKEND = "sqlite";
      const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "fhv-rate-limit-"));
      process.env.DATABASE_URL = `file:${path.join(tmpDir, "rate-limit.sqlite")}`;
      migrateDatabaseFromEnv();
      const rateDb = getDb();
      insertEmailPasswordUser(rateDb, {
        id: "00000000-0000-4000-8000-00000000d417",
        email: "fhv-rate-limit@waia.invalid",
        password: "password123",
      });
      ensureUserCoreSeedSqlite(rateDb, {
        userId: "00000000-0000-4000-8000-00000000d417",
        displayName: "Rate Limit Operator",
      });
    });

    it("does not exceed limit under concurrent attempts", async () => {
      const runtime = await getWaiaRuntimeDb();
      expect(runtime.kind).toBe("sqlite");
      const limit = 3;
      const operatorId = "00000000-0000-4000-8000-00000000d417";
      const organizationId = personalOrganizationIdFromUserId(operatorId);
      const nowMs = Date.parse("2026-07-21T12:00:00.000Z");

      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          checkAndRecordFhvCommandRateLimit(runtime, {
            organizationId,
            operatorId,
            action: "RESUME_FROM_CHECKPOINT",
            nowMs,
            limit,
          }),
        ),
      );
      const allowed = attempts.filter((entry) => entry.allowed).length;
      expect(allowed).toBe(limit);
      await disposeWaiaRuntimeDb(runtime);
    });
  });

  describe("handler integration with mocked bridge", () => {
    let adminOrgId: string;
    let handlerDb: WaiaDb;

    beforeAll(() => {
      resetWaiaSqliteSingleton();
      const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "fhv-handler-"));
      process.env.DATABASE_URL = `file:${path.join(tmpDir, "handler.sqlite")}`;
      migrateDatabaseFromEnv();
      handlerDb = getDb();
      insertEmailPasswordUser(handlerDb, {
        id: ADMIN_ID,
        email: "fhv-integrity-admin@waia.invalid",
        password: "password123",
      });
      adminOrgId = ensureUserCoreSeedSqlite(handlerDb, {
        userId: ADMIN_ID,
        displayName: "FHV Admin",
      });
      handlerDb
        .update(userPlatformRoles)
        .set({ role: "admin" })
        .where(eq(userPlatformRoles.userId, ADMIN_ID))
        .run();
    });

    function createDeps(bridge: FhvObserverBridge): FhvAdminHandlerDeps {
      return {
        getUserId: async () => ADMIN_ID,
        getRuntimeDb: getWaiaRuntimeDb,
        disposeRuntimeDb: disposeWaiaRuntimeDb,
        resolveBridge: () => bridge,
        env: {
          NODE_ENV: "test",
          FHV_ADMIN_CSRF_SECRET: CSRF_SECRET,
          FHV_OPERATOR_COMMAND_SECRET: COMMAND_SECRET,
        } as NodeJS.ProcessEnv,
      };
    }

    it("requires campaign_run_id for status requests", async () => {
      const bridge: FhvObserverBridge = {
        kind: "LOCAL_DEVELOPMENT_STATUS_ADAPTER",
        fetchStatus: vi.fn(),
        fetchDetail: vi.fn(),
        forwardCommand: vi.fn(),
      };
      const result = await handleAdminFhvOperationsStatusGet(
        new Request(
          `http://localhost/api/trader/admin/fhv-operations/status?organization_id=${adminOrgId}`,
        ),
        createDeps(bridge),
      );
      expect(result.status).toBe(400);
      expect(bridge.fetchStatus).not.toHaveBeenCalled();
    });

    it("forwards signed commands through authenticated bridge after CSRF validation", async () => {
      const status = sampleStatus(adminOrgId);
      const forwardCommand = vi.fn(async () => ({
        schemaVersion: "fhv-command-result/v1" as const,
        commandId: "cmd-bridge-416",
        idempotencyKey: "idem-bridge-416",
        status: "rejected" as const,
        message: "SUPERVISOR_NOT_CONFIGURED",
        completedAtUtc: "2026-07-21T12:01:00.000Z",
        enforcementApplied: false,
      }));
      const bridge: FhvObserverBridge = {
        kind: "AUTHENTICATED_OBSERVER_TUNNEL_ADAPTER",
        fetchStatus: vi.fn(async () => status),
        fetchDetail: vi.fn(),
        forwardCommand,
      };
      const csrfToken = createFhvAdminCsrfToken(CSRF_SECRET, adminOrgId, ADMIN_ID);
      const statusPath = buildFhvAdminStatusPath(adminOrgId, RUN_ID);
      const commandPath = buildFhvAdminCommandPath(adminOrgId, RUN_ID);

      const postBody = {
        organization_id: adminOrgId,
        campaign_run_id: RUN_ID,
        action: "GRACEFUL_STOP",
        reason: "runtime integrity test stop",
        confirmation_phrase: buildRequiredConfirmationPhrase(RUN_ID, "GRACEFUL_STOP"),
        expected_phase: "validation",
      };

      const result = await handleAdminFhvOperationsCommandPost(
        new Request(`http://localhost${commandPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [FHV_ADMIN_CSRF_HEADER]: csrfToken,
            cookie: `${FHV_ADMIN_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}`,
          },
          body: JSON.stringify(postBody),
        }),
        createDeps(bridge),
      );

      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(forwardCommand).toHaveBeenCalledTimes(1);
      expect(statusPath).toContain(`campaign_run_id=${encodeURIComponent(RUN_ID)}`);
      expect(commandPath).toContain(`campaign_run_id=${encodeURIComponent(RUN_ID)}`);
      expect(result.body).toMatchObject({ capabilities: FHV_COMMAND_CAPABILITY });
    });
  });
});
