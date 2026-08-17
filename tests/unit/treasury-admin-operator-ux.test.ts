import { describe, expect, it } from "vitest";

import {
  treasuryDetailPublicationEnum,
  treasuryProvenanceEnum,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
  treasuryTxStatusEnum,
} from "@/db/core-enums";
import {
  TREASURY_DIRECTION_OPTIONS,
  TREASURY_KIND_OPTIONS,
  TREASURY_PROVENANCE_OPTIONS,
  TREASURY_PUBLICATION_OPTIONS,
  TREASURY_STATUS_OPTIONS,
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
} from "@/lib/treasury-admin/canonical";
import {
  buildClassifyCommandPatch,
  buildManualDraftPostBody,
} from "@/lib/treasury-admin/manual-draft";
import {
  buildTransactionListQueryParams,
  emptyTransactionFilters,
} from "@/lib/treasury-admin/tx-filter-query";
import { canExposeDetailPublicAction } from "@/lib/treasury-admin/publication";
import { transactionActionAffordances } from "@/lib/treasury-admin/tx-actions";

describe("DEE-616 canonical operator controls", () => {
  it("exposes exactly the Core direction and kind domains", () => {
    expect(TREASURY_DIRECTION_OPTIONS.map((option) => option.value)).toEqual([
      ...treasuryTxDirectionEnum,
    ]);
    expect(TREASURY_KIND_OPTIONS.map((option) => option.value)).toEqual([...treasuryTxKindEnum]);
    expect(TREASURY_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      ...treasuryTxStatusEnum,
    ]);
    expect(TREASURY_PUBLICATION_OPTIONS.map((option) => option.value)).toEqual([
      ...treasuryDetailPublicationEnum,
    ]);
    expect(TREASURY_PROVENANCE_OPTIONS.map((option) => option.value)).toEqual([
      ...treasuryProvenanceEnum,
    ]);
    expect(TREASURY_KIND_OPTIONS.map((option) => option.value as string)).not.toContain(
      "UNCATEGORIZED",
    );
  });

  it("keeps USDT V1 decimals at 6", () => {
    expect(TREASURY_USDT_V1_ASSET).toBe("USDT");
    expect(TREASURY_USDT_V1_DECIMALS).toBe(6);
  });
});

describe("DEE-616 manual draft POST body", () => {
  const base = {
    organizationId: "org-a",
    direction: "INFLOW",
    kind: "",
    humanAmount: "125.50",
    occurredAtIso: "2026-08-02T00:00:00.000Z",
    purpose: "Seed grant",
    budgetId: "b1",
    fundingNeedId: "n1",
    correctsTransactionId: "tx-1",
    reason: "Manual inflow",
  };

  it("allows unclassified kind as null and submits canonical IDs not labels", () => {
    const result = buildManualDraftPostBody(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.kind).toBeNull();
    expect(result.body.direction).toBe("INFLOW");
    expect(result.body.native_amount_atomic).toBe("125500000");
    expect(result.body.native_decimals).toBe(6);
    expect(result.body.native_asset).toBe("USDT");
    expect(result.body.budget_id).toBe("b1");
    expect(result.body.funding_need_id).toBe("n1");
    expect(result.body.corrects_transaction_id).toBe("tx-1");
    expect(result.body.purpose).toBe("Seed grant");
    expect(result.body).not.toHaveProperty("category");
    expect(result.body).not.toHaveProperty("projectModule");
    expect(result.body).not.toHaveProperty("milestoneStage");
  });

  it("submits canonical kind strings when classified", () => {
    const result = buildManualDraftPostBody({ ...base, kind: "CONTRIBUTION" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.kind).toBe("CONTRIBUTION");
  });

  it("rejects invented kind or direction values", () => {
    expect(buildManualDraftPostBody({ ...base, direction: "IN" }).ok).toBe(false);
    expect(buildManualDraftPostBody({ ...base, kind: "GRANT" }).ok).toBe(false);
  });
});

describe("DEE-616 classify patch semantics", () => {
  it("keeps category, purpose, project module, and milestone free-form", () => {
    const patch = buildClassifyCommandPatch({
      kind: "",
      direction: "OUTFLOW",
      fundBucketCode: "UNASSIGNED",
      purpose: "custom purpose",
      category: "custom-category",
      projectModule: "custom-module",
      milestoneStage: "custom-milestone",
      budgetId: "b1",
      fundingNeedId: "n1",
      accountingAmountMicros: "1000000",
      description: "",
      internalNotes: "",
      publicDescription: "",
      counterpartyDisplay: "",
      publishCounterparty: false,
    });
    expect(patch.kind).toBeNull();
    expect(patch.direction).toBe("OUTFLOW");
    expect(patch.category).toBe("custom-category");
    expect(patch.purpose).toBe("custom purpose");
    expect(patch.projectModule).toBe("custom-module");
    expect(patch.milestoneStage).toBe("custom-milestone");
    expect(patch.budgetId).toBe("b1");
    expect(patch.fundingNeedId).toBe("n1");
  });
});

describe("DEE-616 transaction filter query", () => {
  it("submits existing server params and canonical enum values", () => {
    const filters = emptyTransactionFilters();
    filters.direction = "INFLOW";
    filters.kind = "CONTRIBUTION";
    filters.status = "NEEDS_REVIEW";
    filters.detail_publication = "PRIVATE";
    filters.provenance = "MANUAL";
    filters.budget_id = "b1";
    filters.category = "grant";
    const params = buildTransactionListQueryParams(filters);
    expect(params).toEqual({
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      status: "NEEDS_REVIEW",
      detail_publication: "PRIVATE",
      provenance: "MANUAL",
      budget_id: "b1",
      category: "grant",
    });
    expect(params).not.toHaveProperty("funding_need_id");
  });

  it("maps needs reconciliation to the existing alias without a conflicting status", () => {
    const filters = emptyTransactionFilters();
    filters.status = "NEEDS_REVIEW";
    filters.needs_reconciliation = "true";
    const params = buildTransactionListQueryParams(filters);
    expect(params.needs_reconciliation).toBe("true");
    expect(params.status).toBeUndefined();
  });

  it("always includes organization_id only through the API helper contract", () => {
    const filters = emptyTransactionFilters();
    filters.direction = "OUTFLOW";
    expect(buildTransactionListQueryParams(filters)).toEqual({ direction: "OUTFLOW" });
  });
});

describe("DEE-616 lifecycle and publication invariants", () => {
  it("keeps DETAIL_PUBLIC VERIFIED-only and does not auto-publish on verify", () => {
    expect(canExposeDetailPublicAction("VERIFIED")).toBe(true);
    expect(canExposeDetailPublicAction("CLASSIFIED")).toBe(false);
    expect(canExposeDetailPublicAction("MANUAL_DRAFT")).toBe(false);
    expect(
      transactionActionAffordances("MANUAL_DRAFT").some(
        (action) => action.command === "set_detail_publication",
      ),
    ).toBe(false);
    expect(
      transactionActionAffordances("MANUAL_DRAFT").some((action) => action.command === "verify"),
    ).toBe(false);
    expect(
      transactionActionAffordances("VERIFIED").some((action) => action.command === "verify"),
    ).toBe(false);
  });
});
