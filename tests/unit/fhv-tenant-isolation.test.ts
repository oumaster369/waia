import { describe, expect, it } from "vitest";

import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import {
  FhvCommandVerificationError,
  signFhvOperatorCommandV1,
  verifyFhvOperatorCommandV1,
} from "@/lib/trader/observability/fhv-operator-command-v1";

const ORG_A = "00000000-0000-4000-8000-0000000416a1";
const ORG_B = "00000000-0000-4000-8000-0000000416b2";
const RUN_ID = "dee-416-tenant-run";
const SECRET = "fhv-test-command-secret-416";

describe("DEE-416 FHV tenant isolation", () => {
  it("rejects commands whose organizationId does not match expected tenant", () => {
    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
        commandId: "cmd-tenant-416",
        campaignRunId: RUN_ID,
        organizationId: ORG_A,
        operatorId: "operator-416",
        action: "GRACEFUL_STOP",
        reason: "tenant isolation check",
        issuedAtUtc: "2026-07-21T12:00:00.000Z",
        expiresAtUtc: "2026-07-21T12:10:00.000Z",
        nonce: "nonce-tenant-416",
        idempotencyKey: "idem-tenant-416",
        expectedCampaignState: { phase: "REPLAY" },
        confirmationPhraseClass: "STOP",
      },
      SECRET,
    );

    expect(() =>
      verifyFhvOperatorCommandV1({
        command,
        secret: SECRET,
        expectedRunId: RUN_ID,
        expectedOrganizationId: ORG_B,
        currentPhase: "REPLAY",
        seenNonces: new Set<string>(),
        seenIdempotencyKeys: new Set<string>(),
        nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
      }),
    ).toThrow(FhvCommandVerificationError);

    try {
      verifyFhvOperatorCommandV1({
        command,
        secret: SECRET,
        expectedRunId: RUN_ID,
        expectedOrganizationId: ORG_B,
        currentPhase: "REPLAY",
        seenNonces: new Set<string>(),
        seenIdempotencyKeys: new Set<string>(),
        nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_COMMAND_ORG_MISMATCH" });
    }
  });

  it("accepts commands when organizationId matches expected tenant", () => {
    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
        commandId: "cmd-tenant-416-ok",
        campaignRunId: RUN_ID,
        organizationId: ORG_A,
        operatorId: "operator-416",
        action: "CREATE_DIAGNOSTIC_BUNDLE",
        reason: "matched tenant command",
        issuedAtUtc: "2026-07-21T12:00:00.000Z",
        expiresAtUtc: "2026-07-21T12:10:00.000Z",
        nonce: "nonce-tenant-416-ok",
        idempotencyKey: "idem-tenant-416-ok",
        expectedCampaignState: { phase: "REPLAY" },
        confirmationPhraseClass: "DIAGNOSTIC",
      },
      SECRET,
    );

    expect(() =>
      verifyFhvOperatorCommandV1({
        command,
        secret: SECRET,
        expectedRunId: RUN_ID,
        expectedOrganizationId: ORG_A,
        currentPhase: "REPLAY",
        seenNonces: new Set<string>(),
        seenIdempotencyKeys: new Set<string>(),
        nowMs: Date.parse("2026-07-21T12:01:00.000Z"),
      }),
    ).not.toThrow();
  });
});
