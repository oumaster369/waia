import { describe, expect, it } from "vitest";

import { allowedTreasuryTxTransitions } from "@/lib/waia-core/treasury/transaction-fsm";
import {
  canEditAccountingMeaning,
  isVerifiedFinancialLocked,
  transactionActionAffordances,
  TX_FSM_TRANSITIONS,
} from "@/lib/treasury-admin/tx-actions";
import { canExposeDetailPublicAction } from "@/lib/treasury-admin/publication";
import type { AccountingStatus } from "@/lib/treasury-admin/publication";

const STATUSES: AccountingStatus[] = [
  "DETECTED",
  "MANUAL_DRAFT",
  "NEEDS_REVIEW",
  "CLASSIFIED",
  "VERIFIED",
  "RECONCILIATION_REQUIRED",
  "REJECTED",
  "DUPLICATE",
];

describe("treasury-admin FSM affordances", () => {
  it("mirrors canonical transaction FSM transitions", () => {
    for (const status of STATUSES) {
      expect([...TX_FSM_TRANSITIONS[status]]).toEqual([...allowedTreasuryTxTransitions(status)]);
    }
  });

  it("hides DETAIL_PUBLIC unless VERIFIED", () => {
    for (const status of STATUSES) {
      const hasPublish = transactionActionAffordances(status).some(
        (action) => action.command === "set_detail_publication",
      );
      expect(hasPublish).toBe(status === "VERIFIED");
      expect(canExposeDetailPublicAction(status)).toBe(status === "VERIFIED");
    }
  });

  it("omits verify except from CLASSIFIED", () => {
    expect(
      transactionActionAffordances("CLASSIFIED").some((action) => action.command === "verify"),
    ).toBe(true);
    expect(
      transactionActionAffordances("NEEDS_REVIEW").some((action) => action.command === "verify"),
    ).toBe(false);
  });

  it("locks verified/terminal financial meaning", () => {
    expect(isVerifiedFinancialLocked("VERIFIED")).toBe(true);
    expect(isVerifiedFinancialLocked("REJECTED")).toBe(true);
    expect(canEditAccountingMeaning("NEEDS_REVIEW")).toBe(true);
    expect(canEditAccountingMeaning("VERIFIED")).toBe(false);
  });
});
