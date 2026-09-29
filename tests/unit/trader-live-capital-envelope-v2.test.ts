import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  decideLiveCapitalEnvelopePublicationV2,
  sealLiveCapitalEnvelopeV2,
  type LiveCapitalEnvelopeCommandV2,
} from "@/lib/trader/risk/v2/live-capital-envelope-v2";
import { decideCurrentAccountBasisPublicationV1 } from "@/lib/trader/risk/v2/risk-account-reconciliation-v1";

/** Synthetic operator input. These amounts exist only in this test. */
const command: LiveCapitalEnvelopeCommandV2 = {
  commandId: "00000000-0000-4000-8000-000000114502",
  organizationId: "00000000-0000-4000-8000-000000114501",
  accountId: "synthetic-envelope-account",
  policyDigest: "ab".repeat(32),
  releaseSha: "cd".repeat(32),
  capitalNotional: "10",
  lossLimitNotional: "1",
  validFromUtc: "2020-01-01T00:00:00.000Z",
  validUntilUtc: "2099-01-01T00:00:00.000Z",
};
const nowUtc = "2026-09-29T00:00:00.000Z";

function bound(patch: Partial<typeof command> = {}) {
  return {
    organizationId: patch.organizationId ?? command.organizationId,
    accountId: patch.accountId ?? command.accountId,
    policyDigest: patch.policyDigest ?? command.policyDigest,
    releaseSha: patch.releaseSha ?? command.releaseSha,
    nowUtc,
  };
}

describe("LiveCapitalEnvelopeV2 publication", () => {
  it("keeps a missing envelope refused and ignores a qualification boolean", () => {
    expect(
      decideCurrentAccountBasisPublicationV1({
        liveCapitalEnvelope: null,
        sourceMethodQualified: true,
      }),
    ).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
    expect(
      decideLiveCapitalEnvelopePublicationV2({
        liveCapitalEnvelope: null,
        sourceMethodQualified: false,
      }),
    ).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });

  it("publishes a sealed operator command with zero venue effects", () => {
    const receipt = sealLiveCapitalEnvelopeV2(command);
    const qualified = decideCurrentAccountBasisPublicationV1({
      liveCapitalEnvelope: receipt,
      sourceMethodQualified: true,
      bound: bound(),
    });
    const unqualified = decideLiveCapitalEnvelopePublicationV2({
      liveCapitalEnvelope: receipt,
      sourceMethodQualified: false,
      bound: bound(),
    });
    expect(qualified).toEqual(unqualified);
    expect(qualified).toMatchObject({
      decision: "PUBLISHED",
      envelopeDigest: receipt.contentDigest,
      allowanceId: null,
      orderId: null,
    });
    expect(qualified.decision === "PUBLISHED" && qualified.basisDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses heartbeat, a boolean, an external organization, a stale window, and a changed identity", () => {
    const sealDirty = (extra: Record<string, string | boolean>) =>
      sealLiveCapitalEnvelopeV2(Object.assign({}, command, extra));
    expect(() => sealDirty({ heartbeat: "pulse" })).toThrow("HEARTBEAT_IS_NOT_AUTHORITY");
    expect(() => sealDirty({ authorized: true })).toThrow("AUTHORITY_BOOLEAN_FORBIDDEN");
    expect(() => sealDirty({ enabled: false })).toThrow("AUTHORITY_BOOLEAN_FORBIDDEN");
    expect(() => sealDirty({ liveEnabled: true })).toThrow("AUTHORITY_BOOLEAN_FORBIDDEN");
    const receipt = sealLiveCapitalEnvelopeV2(command);
    expect(
      decideLiveCapitalEnvelopePublicationV2({
        liveCapitalEnvelope: receipt,
        sourceMethodQualified: true,
        bound: bound({ organizationId: "00000000-0000-4000-8000-000000114599" }),
      }),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "EXTERNAL_ORGANIZATION",
      allowanceId: null,
      orderId: null,
    });
    expect(
      decideLiveCapitalEnvelopePublicationV2({
        liveCapitalEnvelope: receipt,
        sourceMethodQualified: false,
        bound: { ...bound(), nowUtc: "2019-06-01T00:00:00.000Z" },
      }),
    ).toMatchObject({
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_STALE",
      basisDigest: null,
    });
    for (const patch of [
      { accountId: "other-account" },
      { policyDigest: "ef".repeat(32) },
      { releaseSha: "01".repeat(32) },
    ] as const) {
      expect(
        decideLiveCapitalEnvelopePublicationV2({
          liveCapitalEnvelope: receipt,
          sourceMethodQualified: false,
          bound: bound(patch),
        }),
      ).toMatchObject({
        decision: "REFUSED",
        reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
        orderId: null,
      });
    }
  });

  it("does not put an amount default in the producer or the migration", () => {
    const source = [
      "lib/trader/risk/v2/live-capital-envelope-v2.ts",
      "lib/trader/risk/v2/live-capital-envelope-postgres.ts",
      "db/migrations_postgres/0225_trader_live_capital_envelope_v2.sql",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/capitalNotional\s*[:=]\s*["']/);
    expect(source).not.toMatch(/lossLimitNotional\s*[:=]\s*["']/);
    for (const line of source.split("\n")) {
      if (line.includes("capital_notional") || line.includes("loss_limit_notional")) {
        expect(line).not.toMatch(/DEFAULT/i);
      }
    }
  });
});
