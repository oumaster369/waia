import { describe, expect, it } from "vitest";

import { accountingStatusLabel, parseHumanSignedAmount } from "@/lib/treasury-admin/ledger";
import { buildCentralLedgerPostBody } from "@/lib/treasury-admin/manual-draft";

const base = {
  organizationId: "org-a",
  status: "NEEDS_REVIEW" as const,
  humanAmount: "-125.50",
  occurredAtIso: "2026-08-21T10:00:00.000Z",
  currency: "USDT",
  counterpartyId: "cp-1",
  accountId: "account-1",
  categoryId: "category-1",
  projectId: "project-1",
  notes: "Vendor invoice",
  reason: "Manual entry",
};

describe("DEE-619 signed Human amount", () => {
  it("derives outgoing and incoming meaning without floating point", () => {
    expect(parseHumanSignedAmount("-1.000001")).toEqual({
      ok: true,
      micros: "-1000001",
      magnitudeMicros: "1000001",
      direction: "OUTFLOW",
    });
    expect(parseHumanSignedAmount("2.5")).toEqual({
      ok: true,
      micros: "2500000",
      magnitudeMicros: "2500000",
      direction: "INFLOW",
    });
  });

  it("rejects zero, exponent notation, grouping, and excess precision", () => {
    expect(parseHumanSignedAmount("0").ok).toBe(false);
    expect(parseHumanSignedAmount("1e3").ok).toBe(false);
    expect(parseHumanSignedAmount("1,000").ok).toBe(false);
    expect(parseHumanSignedAmount("1.0000001").ok).toBe(false);
  });
});

describe("DEE-619 central ledger body", () => {
  it("submits signed amount and stable catalog IDs without a direction control", () => {
    const result = buildCentralLedgerPostBody(base, { now: new Date("2026-08-21T09:00:00.000Z") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      organization_id: "org-a",
      status: "NEEDS_REVIEW",
      signed_amount_micros: "-125500000",
      native_amount_atomic: "125500000",
      native_decimals: 6,
      native_asset: "USDT",
      counterparty_id: "cp-1",
      account_id: "account-1",
      category_id: "category-1",
      project_id: "project-1",
      notes: "Vendor invoice",
    });
    expect(result.body).not.toHaveProperty("direction");
  });

  it("requires an account and keeps Planned future-only", () => {
    expect(buildCentralLedgerPostBody({ ...base, accountId: "" }).ok).toBe(false);
    expect(
      buildCentralLedgerPostBody(
        { ...base, status: "PLANNED", occurredAtIso: "2026-08-21T08:00:00.000Z" },
        { now: new Date("2026-08-21T09:00:00.000Z") },
      ).ok,
    ).toBe(false);
    expect(
      buildCentralLedgerPostBody(
        { ...base, status: "PLANNED", occurredAtIso: "2026-08-22T08:00:00.000Z" },
        { now: new Date("2026-08-21T09:00:00.000Z") },
      ).ok,
    ).toBe(true);
  });
});

describe("DEE-619 simplified status labels", () => {
  it("groups intermediate accounting states behind Requires review", () => {
    expect(accountingStatusLabel("DETECTED")).toBe("Requires review");
    expect(accountingStatusLabel("CLASSIFIED")).toBe("Requires review");
    expect(accountingStatusLabel("RECONCILIATION_REQUIRED")).toBe("Requires review");
    expect(accountingStatusLabel("VERIFIED")).toBe("Verified");
    expect(accountingStatusLabel("PLANNED")).toBe("Planned");
  });
});
