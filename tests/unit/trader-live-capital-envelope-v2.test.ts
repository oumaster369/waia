import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  decideLiveCapitalEnvelopePublicationV2,
  decideLiveCapitalEnvelopeWindowV2,
  readStoredSourceMethodQualifiedV2,
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
  it("keeps a missing envelope refused even when the human flag is true", () => {
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

  it("publishes only when the source method flag is explicitly true", () => {
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
    expect(unqualified).toMatchObject({
      decision: "REFUSED",
      reason: "SOURCE_METHOD_UNQUALIFIED",
      basisDigest: null,
      allowanceId: null,
      orderId: null,
    });
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
      "db/migrations_postgres/0226_trader_live_capital_envelope_v2.sql",
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

  it("refuses order sizing when a stored basis has no explicit source-method qualification", () => {
    const receipt = sealLiveCapitalEnvelopeV2(command);
    const unqualified = decideLiveCapitalEnvelopeWindowV2({
      liveCapitalEnvelope: receipt,
      bound: bound(),
      sourceMethodQualified: false,
    });
    expect(unqualified).toMatchObject({
      decision: "REFUSED",
      reason: "SOURCE_METHOD_UNQUALIFIED",
    });
    const qualified = decideLiveCapitalEnvelopeWindowV2({
      liveCapitalEnvelope: receipt,
      bound: bound(),
      sourceMethodQualified: true,
    });
    expect(qualified.decision).toBe("PUBLISHED");
    expect(readStoredSourceMethodQualifiedV2(null)).toBe(false);
    expect(
      readStoredSourceMethodQualifiedV2('{"schemaVersion":"live-capital-envelope-journal/v2"}'),
    ).toBe(false);
    expect(readStoredSourceMethodQualifiedV2('{"sourceMethodQualified":"true"}')).toBe(false);
    expect(readStoredSourceMethodQualifiedV2('{"sourceMethodQualified":true}')).toBe(true);
  });

  it("does not set sourceMethodQualified true anywhere outside tests", () => {
    const roots = ["lib", "app", "scripts", "services", "db"];
    const hits: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          if (entry === "node_modules" || entry === "tests") continue;
          visit(path);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs|sql)$/.test(entry)) continue;
        const body = readFileSync(path, "utf8");
        if (/sourceMethodQualified\s*:\s*true/.test(body)) hits.push(path);
      }
    };
    for (const root of roots) visit(root);
    expect(hits).toEqual([]);
    const producer = readFileSync("lib/trader/risk/v2/live-capital-envelope-postgres.ts", "utf8");
    expect(producer).toContain("sourceMethodQualified: input.sourceMethodQualified === true");
    expect(producer).not.toMatch(/sourceMethodQualified\s*:\s*true/);
  });
});
