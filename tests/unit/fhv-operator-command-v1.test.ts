import { describe, expect, it } from "vitest";

import {
  FHV_COMMAND_MAX_TTL_MS,
  FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
} from "@/lib/trader/observability/fhv-observability.constants";
import {
  FhvCommandVerificationError,
  signFhvOperatorCommandV1,
  verifyFhvOperatorCommandV1,
  type FhvOperatorCommandV1,
} from "@/lib/trader/observability/fhv-operator-command-v1";

const ORG_ID = "00000000-0000-4000-8000-0000000416a1";
const RUN_ID = "dee-416-command-run";
const SECRET = "fhv-test-command-secret-416";

type UnsignedCommand = Omit<FhvOperatorCommandV1, "signature" | "signatureAlgorithm">;

function baseUnsignedCommand(overrides: Partial<UnsignedCommand> = {}): UnsignedCommand {
  const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
  return {
    schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
    commandId: "cmd-416-001",
    campaignRunId: RUN_ID,
    organizationId: ORG_ID,
    operatorId: "operator-416",
    action: "PAUSE_AT_CHECKPOINT",
    reason: "operator requested pause for inspection",
    issuedAtUtc: new Date(nowMs).toISOString(),
    expiresAtUtc: new Date(nowMs + 5 * 60 * 1000).toISOString(),
    nonce: "nonce-416-abc123",
    idempotencyKey: "idem-416-001",
    expectedCampaignState: { phase: "REPLAY", checkpointSeq: 42 },
    confirmationPhraseClass: "NONE",
    ...overrides,
  };
}

function signCommand(overrides: Partial<UnsignedCommand> = {}): FhvOperatorCommandV1 {
  return signFhvOperatorCommandV1(baseUnsignedCommand(overrides), SECRET);
}

function verifyInput(
  command: FhvOperatorCommandV1,
  overrides: Partial<Parameters<typeof verifyFhvOperatorCommandV1>[0]> = {},
): void {
  verifyFhvOperatorCommandV1({
    command,
    secret: SECRET,
    expectedRunId: RUN_ID,
    expectedOrganizationId: ORG_ID,
    currentPhase: "REPLAY",
    currentCheckpointSeq: 42,
    seenNonces: new Set<string>(),
    seenIdempotencyKeys: new Set<string>(),
    nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
    ...overrides,
  });
}

describe("DEE-416 FHV operator command v1", () => {
  it("signs and verifies a valid command", () => {
    const command = signCommand();
    expect(command.signatureAlgorithm).toBe("HMAC-SHA256");
    expect(command.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(() => verifyInput(command)).not.toThrow();
  });

  it("rejects expired commands", () => {
    const command = signCommand({
      issuedAtUtc: "2026-07-21T11:00:00.000Z",
      expiresAtUtc: "2026-07-21T11:05:00.000Z",
    });
    expect(() => verifyInput(command, { nowMs: Date.parse("2026-07-21T12:01:00.000Z") })).toThrow(
      FhvCommandVerificationError,
    );
    try {
      verifyInput(command, { nowMs: Date.parse("2026-07-21T12:01:00.000Z") });
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_COMMAND_EXPIRED" });
    }
  });

  it("rejects commands whose TTL exceeds the max window", () => {
    const issuedMs = Date.parse("2026-07-21T12:00:00.000Z");
    const command = signCommand({
      issuedAtUtc: new Date(issuedMs).toISOString(),
      expiresAtUtc: new Date(issuedMs + FHV_COMMAND_MAX_TTL_MS + 1).toISOString(),
    });
    expect(() => verifyInput(command, { nowMs: issuedMs + 1000 })).toThrow(
      FhvCommandVerificationError,
    );
  });

  it("rejects nonce replay", () => {
    const command = signCommand();
    const seenNonces = new Set<string>([command.nonce]);
    expect(() => verifyInput(command, { seenNonces })).toThrow(FhvCommandVerificationError);
    try {
      verifyInput(command, { seenNonces });
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_COMMAND_REPLAY" });
    }
  });

  it("rejects idempotency key replay", () => {
    const command = signCommand();
    const seenIdempotencyKeys = new Set<string>([command.idempotencyKey]);
    expect(() => verifyInput(command, { seenIdempotencyKeys })).toThrow(
      FhvCommandVerificationError,
    );
  });

  it("rejects stale expected campaign state", () => {
    const command = signCommand({ expectedCampaignState: { phase: "PAUSED", checkpointSeq: 42 } });
    expect(() => verifyInput(command, { currentPhase: "REPLAY" })).toThrow(
      FhvCommandVerificationError,
    );
    try {
      verifyInput(command, { currentPhase: "REPLAY" });
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_COMMAND_STALE_STATE" });
    }
  });

  it("rejects invalid signatures", () => {
    const command = signCommand();
    const tampered = { ...command, signature: "0".repeat(64) };
    expect(() => verifyInput(tampered)).toThrow(FhvCommandVerificationError);
    try {
      verifyInput(tampered);
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_COMMAND_SIGNATURE_INVALID" });
    }
  });
});
