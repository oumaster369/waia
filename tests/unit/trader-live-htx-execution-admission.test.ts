import { describe, expect, it, vi } from "vitest";

import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { createLiveHtxConnector } from "@/lib/trader/live/live-connector";
import {
  assertLiveHtxExecutionAdmission,
  classifyLiveHtxExecutionAdmission,
  LiveHtxExecutionAdmissionError,
} from "@/lib/trader/live/live-htx-execution-admission";
import type { CredentialService } from "@/lib/trader/credentials/types";

const ORG = "00000000-0000-4000-8000-000000115101";

function metadata(scopes: readonly string[]) {
  return {
    version: 1,
    marketType: "spot",
    exchangeAccountId: "956",
    scopes: [...scopes],
    warnings: [],
    withdrawForbidden: true,
    transferForbidden: true,
  };
}

function credential(scopes: readonly string[]) {
  return {
    status: "active",
    venue: "htx",
    exchangeAccountId: "956",
    permissionMetadata: metadata(scopes),
  };
}

describe("live HTX execution admission (DEE-1151)", () => {
  it("writes the kill switch separately from the telemetry field and still does not post", async () => {
    const writeKillSwitch = vi.fn(async () => "WRITTEN" as const);
    const lines: string[] = [];
    await expect(
      assertLiveHtxExecutionAdmission({
        organizationId: ORG,
        credentialId: "cred-1",
        credential: credential(["read"]),
        sink: (line) => lines.push(line),
        writeKillSwitch,
      }),
    ).rejects.toThrow(LiveHtxExecutionAdmissionError);
    expect(writeKillSwitch).toHaveBeenCalledWith("LIVE_HTX_CREDENTIAL_READ_ONLY");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      kill_state_telemetry: "TRIPPED",
      kill_switch_write: "WRITTEN",
    });
  });

  it("drops the in-memory placement key so a later placeOrder cannot sign", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "ok" })) as typeof fetch;
    const connector = new HtxExchangeConnector({
      apiKey: "synthetic-key",
      apiSecret: "synthetic-secret",
      fetchImpl,
    });
    connector.dropInMemoryCredentials();
    await expect(
      connector.placeOrder({
        clientOrderId: "cid",
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        price: "1",
        quantity: "1",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/in-memory credentials were dropped/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("admits only an explicit trade-scoped credential", () => {
    expect(
      classifyLiveHtxExecutionAdmission({
        credentialId: "cred-1",
        credential: credential(["read", "trade"]),
      }),
    ).toEqual({ decision: "ADMITTED" });
  });

  it("fails closed with kill-state telemetry and does not post when credentials are absent or read-only", async () => {
    const cases = [
      {
        reason: "LIVE_HTX_CREDENTIAL_ABSENT" as const,
        credentialId: "",
        credential: null,
      },
      {
        reason: "LIVE_HTX_CREDENTIAL_ABSENT" as const,
        credentialId: "cred-1",
        credential: null,
      },
      {
        reason: "LIVE_HTX_CREDENTIAL_READ_ONLY" as const,
        credentialId: "cred-1",
        credential: credential(["read"]),
      },
    ];
    for (const item of cases) {
      const lines: string[] = [];
      await expect(
        assertLiveHtxExecutionAdmission({
          organizationId: ORG,
          credentialId: item.credentialId,
          credential: item.credential,
          sink: (line) => lines.push(line),
        }),
      ).rejects.toThrow(LiveHtxExecutionAdmissionError);
      const event = JSON.parse(lines[0] ?? "{}") as {
        outcome?: string;
        kill_state_telemetry?: string;
        kill_switch_write?: string;
        error_class?: string;
      };
      expect(event).toMatchObject({
        outcome: item.reason,
        kill_state_telemetry: "TRIPPED",
        kill_switch_write: "NOT_ATTEMPTED",
        error_class: "LiveHtxExecutionAdmissionError",
      });
      expect(JSON.stringify(event)).not.toMatch(/apiKey|apiSecret|secret/i);
    }
  });

  it("refuses a missing or read-only stored credential before decrypt or any exchange call", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "ok" })) as typeof fetch;
    const cases = [
      { id: "missing", row: null, reason: "LIVE_HTX_CREDENTIAL_ABSENT" },
      {
        id: "mock-credential",
        row: {
          id: "mock-credential",
          venue: "htx",
          exchangeAccountId: "956",
          apiKeyMasked: null,
          status: "active" as const,
          permissionMetadata: metadata(["read"]),
          createdAt: new Date(0),
          updatedAt: new Date(0),
          revokedAt: null,
        },
        reason: "LIVE_HTX_CREDENTIAL_READ_ONLY",
      },
    ];
    for (const item of cases) {
      const getDecryptedCredentials = vi.fn(async () => ({
        apiKey: "synthetic-key",
        apiSecret: "synthetic-secret",
      }));
      const lines: string[] = [];
      const service: CredentialService = {
        listCredentialMetadata: vi.fn(async () => (item.row ? [item.row] : [])),
        getDecryptedCredentials,
        storeCredentials: vi.fn(),
        revokeCredentials: vi.fn(),
      };
      await expect(
        createLiveHtxConnector({
          context: { organizationId: ORG },
          credentialId: item.id,
          credentialService: service,
          fetchImpl,
          telemetrySink: (line) => lines.push(line),
        }),
      ).rejects.toThrow(item.reason);
      expect(getDecryptedCredentials).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        outcome: item.reason,
        kill_state_telemetry: "TRIPPED",
        kill_switch_write: "NOT_ATTEMPTED",
      });
    }
  });
});
