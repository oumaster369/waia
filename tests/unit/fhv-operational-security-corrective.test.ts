import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildFhvAdminCsrfSetCookieHeader,
  createFhvAdminCsrfToken,
  validateFhvAdminCsrf,
} from "@/lib/trader/fhv-admin-csrf";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR,
  createSuccessfulFhvCampaignControlExecutor,
} from "@/lib/trader/observability/fhv-campaign-control-executor";
import {
  createFhvObserverState,
  handleFhvObserverCommand,
} from "@/lib/trader/observability/fhv-observer-core";
import { resolveFhvObserverBridge } from "@/lib/trader/observability/fhv-observer-bridge";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  sha256Hex,
} from "@/lib/trader/observability/fhv-observer-transport-auth";
import {
  FhvRuntimeConfigError,
  requireFhvCommandSecret,
  requireFhvCsrfSecret,
} from "@/lib/trader/observability/fhv-runtime-secrets";
import { FhvRuntimeResponseValidationError } from "@/lib/trader/observability/fhv-runtime-response-validators";
import { assertFhvStatusOrganizationBinding } from "@/lib/trader/observability/fhv-telemetry-probes";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import { signFhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import { writeFhvRehearsalCampaignProgress } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";

const ORG_A = "00000000-0000-4000-8000-0000000416a1";
const ORG_B = "00000000-0000-4000-8000-0000000416b2";
const RUN_ID = "dee-416-security-run";
const COMMAND_SECRET = "fhv-test-command-secret-416";

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

describe("DEE-416 operational security corrective", () => {
  it("fails closed when required secrets are absent in production runtime", async () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    expect(() => requireFhvCommandSecret(env)).toThrow(FhvRuntimeConfigError);
    expect(() => requireFhvCsrfSecret(env)).toThrow(FhvRuntimeConfigError);

    const bridge = resolveFhvObserverBridge(env);
    expect(bridge.kind).toBe("AUTHENTICATED_OBSERVER_TUNNEL_ADAPTER");
    await expect(
      bridge.fetchStatus({
        organizationId: ORG_A,
        campaignRunId: RUN_ID,
      }),
    ).rejects.toThrow(FhvRuntimeConfigError);
  });

  it("rejects cross-organization status binding", () => {
    const status = sampleStatus(ORG_A);
    expect(() => assertFhvStatusOrganizationBinding(status, ORG_B, RUN_ID)).toThrow(
      "FHV_STATUS_ORG_MISMATCH",
    );
  });

  it("rejects run-id mismatches during status binding", () => {
    const status = sampleStatus(ORG_A);
    expect(() => assertFhvStatusOrganizationBinding(status, ORG_A, "other-run-id")).toThrow(
      "FHV_STATUS_RUN_MISMATCH",
    );
  });

  it("rejects commands when supervisor executor is not configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-command-reject-"));
    mkdirSync(root, { recursive: true });
    writeFhvRehearsalCampaignProgress(root, {
      schemaVersion: "fhv-rehearsal-campaign-progress/v1",
      runId: RUN_ID,
      cyclesProcessed: 5,
      expectedCycles: 100,
      phase: "running",
      updatedAtUtc: new Date().toISOString(),
    });
    const state = createFhvObserverState({
      runRoot: root,
      runId: RUN_ID,
      organizationId: ORG_A,
      commandSecret: COMMAND_SECRET,
      observerTunnelSecret: "fhv-test-tunnel-secret",
      campaignControlExecutor: UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR,
    });

    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
        commandId: "cmd-unconfigured",
        campaignRunId: RUN_ID,
        organizationId: ORG_A,
        operatorId: "operator-416",
        action: "GRACEFUL_STOP",
        reason: "test rejection",
        issuedAtUtc: "2026-07-21T12:00:00.000Z",
        expiresAtUtc: "2026-07-21T12:10:00.000Z",
        nonce: "nonce-unconfigured",
        idempotencyKey: "idem-unconfigured",
        expectedCampaignState: { phase: "running" },
        confirmationPhraseClass: "STOP",
      },
      COMMAND_SECRET,
    );

    try {
      const result = await handleFhvObserverCommand(state, command, "test", {
        nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
      });
      expect(result.status).toBe("rejected");
      expect(result.message).toBe("SUPERVISOR_NOT_CONFIGURED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes commands when a supervisor-neutral executor is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-command-exec-"));
    mkdirSync(root, { recursive: true });
    writeFhvRehearsalCampaignProgress(root, {
      schemaVersion: "fhv-rehearsal-campaign-progress/v1",
      runId: RUN_ID,
      cyclesProcessed: 5,
      expectedCycles: 100,
      phase: "running",
      updatedAtUtc: new Date().toISOString(),
    });
    const state = createFhvObserverState({
      runRoot: root,
      runId: RUN_ID,
      organizationId: ORG_A,
      commandSecret: COMMAND_SECRET,
      observerTunnelSecret: "fhv-test-tunnel-secret",
      campaignControlExecutor: createSuccessfulFhvCampaignControlExecutor(),
    });

    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
        commandId: "cmd-executed",
        campaignRunId: RUN_ID,
        organizationId: ORG_A,
        operatorId: "operator-416",
        action: "CREATE_DIAGNOSTIC_BUNDLE",
        reason: "test execution",
        issuedAtUtc: "2026-07-21T12:00:00.000Z",
        expiresAtUtc: "2026-07-21T12:10:00.000Z",
        nonce: "nonce-executed",
        idempotencyKey: "idem-executed",
        expectedCampaignState: { phase: "running" },
        confirmationPhraseClass: "DIAGNOSTIC",
      },
      COMMAND_SECRET,
    );

    try {
      const result = await handleFhvObserverCommand(state, command, "test", {
        nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
      });
      expect(result.status).toBe("executed");
      expect(result.enforcementApplied).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses local development adapter only when explicitly enabled outside production", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-local-bridge-"));
    const statusPath = join(root, "status.json");
    writeFileSync(statusPath, `${JSON.stringify(sampleStatus(ORG_A), null, 2)}\n`, "utf8");

    const env = {
      NODE_ENV: "test",
      FHV_STATUS_ADAPTER: "local_file",
      FHV_OPERATOR_STATUS_PATH: statusPath,
    } as NodeJS.ProcessEnv;

    const bridge = resolveFhvObserverBridge(env);
    expect(bridge.kind).toBe("LOCAL_DEVELOPMENT_STATUS_ADAPTER");
    const status = await bridge.fetchStatus({
      organizationId: ORG_A,
      campaignRunId: RUN_ID,
    });
    expect(status.campaign.runId).toBe(RUN_ID);

    await expect(
      bridge.fetchStatus({ organizationId: ORG_B, campaignRunId: RUN_ID }),
    ).rejects.toThrow(FhvRuntimeResponseValidationError);

    rmSync(root, { recursive: true, force: true });
  });

  it("builds verifiable observer tunnel auth tokens", () => {
    const secret = "fhv-test-tunnel-secret";
    const payload = {
      method: "GET",
      path: `/v1/status?organization_id=${ORG_A}&campaign_run_id=${RUN_ID}`,
      organizationId: ORG_A,
      campaignRunId: RUN_ID,
      timestampMs: Date.now(),
      nonce: createFhvObserverAuthNonce(),
      bodySha256: sha256Hex(""),
    };
    const token = buildFhvObserverAuthToken(payload, secret);
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain(secret);
  });
});

describe("DEE-416 CSRF cryptographic helpers (unit)", () => {
  it("validates matching header and cookie tokens with operator binding", () => {
    const secret = "fhv-browser-csrf-secret";
    const operatorId = "operator-browser-416";
    const token = createFhvAdminCsrfToken(secret, ORG_A, operatorId);
    const setCookie = buildFhvAdminCsrfSetCookieHeader(token, false);
    const cookiePair = setCookie.split(";")[0] ?? "";
    const [, cookieValueRaw] = cookiePair.split("=");
    const cookieValue = decodeURIComponent(cookieValueRaw ?? "");

    const postRequest = new Request(
      `http://localhost/api/trader/admin/fhv-operations/commands?organization_id=${ORG_A}`,
      {
        method: "POST",
        headers: {
          "x-fhv-csrf-token": token,
          cookie: `fhv_admin_csrf=${encodeURIComponent(cookieValue)}`,
        },
      },
    );

    expect(validateFhvAdminCsrf(postRequest, secret, ORG_A, operatorId)).toBe(true);
  });
});
