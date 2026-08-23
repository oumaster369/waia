import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as treasury from "@/lib/waia-core/treasury";
import { WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED } from "@/lib/waia-core/treasury/admin/breath-port";
import {
  handleTreasuryAttributionsGet,
  handleTreasuryAttributionsPost,
  handleTreasuryBreathPreviewGet,
  handleTreasuryBudgetsPatch,
  handleTreasuryBudgetsPost,
  handleTreasuryCommitmentCommandsPost,
  handleTreasuryCommitmentsPost,
  handleTreasuryEvidenceGet,
  handleTreasuryEvidenceLinksPost,
  handleTreasuryEvidencePost,
  handleTreasuryFundingNeedsPatch,
  handleTreasuryFundingNeedsPost,
  handleTreasuryIdealBudgetCommandsPost,
  handleTreasuryIdealBudgetsPost,
  handleTreasuryInceptionsPost,
  handleTreasuryReconciliationsGet,
  handleTreasuryReconciliationsPatch,
  handleTreasuryRunwayPlanCommandsPost,
  handleTreasuryRunwayPlansGet,
  handleTreasuryRunwayPlansPost,
  handleTreasuryTransactionCommandsPost,
  handleTreasuryTransactionsGet,
  handleTreasuryTransactionsPost,
  handleTreasuryWatchedAddressesPatch,
  handleTreasuryWatchedAddressesPost,
} from "@/lib/waia-core/treasury/admin/handlers";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher";
import {
  ADMIN_USER,
  HUGE_MICROS,
  ORG_A,
  ORG_B,
  createWp4Bundle,
  createWp4Deps,
  errorCode,
  getRequest,
  jsonRequest,
  seedAdminEvidence,
} from "@/tests/unit/helpers/treasury-wp4";
import {
  seedObservation,
  seedWatcherTransaction,
  usdtAmount,
} from "@/tests/unit/helpers/treasury-wp2";

const MUTATE = ["admin.treasury.read", "admin.treasury.mutate"] as const;

function command(body: Record<string, unknown>) {
  return jsonRequest("/api/admin/treasury/transactions/commands", body);
}

describe("DEE-606 WP-4 transaction HTTP contracts", () => {
  it("21-22 list is org-scoped and hides other orgs", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: "100",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "a",
      }),
      deps,
    );
    await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_B,
        direction: "INFLOW",
        native_amount_atomic: "200",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "b",
      }),
      deps,
    );
    const listed = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      deps,
    );
    const rows = (listed.body as { transactions: { organizationId: string }[] }).transactions;
    expect(rows.every((row) => row.organizationId === ORG_A)).toBe(true);
    const foreign = await services.domain.repository.listTransactions({ organizationId: ORG_B });
    const hidden = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}&id=${foreign[0].id}`),
      deps,
    );
    expect(hidden.status).toBe(404);
  });

  it("23-25 mutate is required for draft, classify, and verify", async () => {
    const { services } = createWp4Bundle();
    const readOnly = createWp4Deps({ services, permissions: ["admin.treasury.read"] });
    const draftDenied = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: "1",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "nope",
      }),
      readOnly,
    );
    expect(draftDenied.status).toBe(403);
    await seedWatcherTransaction(services.domain.repository, {
      id: "w-class",
      organizationId: ORG_A,
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
    });
    const classifyDenied = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "classify",
        transaction_id: "w-class",
        reason: "classify",
        patch: { kind: "CONTRIBUTION", direction: "INFLOW", accounting_amount_micros: "1000000" },
      }),
      readOnly,
    );
    expect(classifyDenied.status).toBe(403);
    const verifyDenied = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "verify",
        transaction_id: "w-class",
        reason: "verify",
      }),
      readOnly,
    );
    expect(verifyDenied.status).toBe(403);
  });

  it("26-27 verify-before-confirm is rejected and verify after CONFIRMED passes", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    await seedWatcherTransaction(services.domain.repository, {
      id: "w-obs",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    await seedObservation(services.domain.repository, {
      id: "obs-observed",
      organizationId: ORG_A,
      transactionId: "w-obs",
      observationStatus: "OBSERVED",
      confirmationsObserved: 3,
    });
    const early = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "verify",
        transaction_id: "w-obs",
        reason: "too soon",
        force: true,
        skip_confirmation: true,
        admin_override: true,
      }),
      deps,
    );
    expect(early.status).toBe(409);
    await seedWatcherTransaction(services.domain.repository, {
      id: "w-ok",
      organizationId: ORG_A,
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    await seedObservation(services.domain.repository, {
      id: "obs-ok",
      organizationId: ORG_A,
      transactionId: "w-ok",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 20,
    });
    const ok = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "verify",
        transaction_id: "w-ok",
        reason: "confirmed",
      }),
      deps,
    );
    expect(ok.status).toBe(200);
    expect((ok.body as { transaction: { status: string } }).transaction.status).toBe("VERIFIED");
  });

  it("28-29 publication requires publish and mutate cannot DETAIL_PUBLIC", async () => {
    const { services } = createWp4Bundle();
    await seedWatcherTransaction(services.domain.repository, {
      id: "w-pub",
      organizationId: ORG_A,
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    const mutateOnly = createWp4Deps({ services, permissions: MUTATE });
    const denied = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "set_detail_publication",
        transaction_id: "w-pub",
        detail_publication: "DETAIL_PUBLIC",
        reason: "publish",
      }),
      mutateOnly,
    );
    expect(denied.status).toBe(403);
    const allowed = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "set_detail_publication",
        transaction_id: "w-pub",
        detail_publication: "DETAIL_PUBLIC",
        reason: "publish",
      }),
      createWp4Deps({ services }),
    );
    expect(allowed.status).toBe(200);
    expect(
      (allowed.body as { transaction: { detailPublication: string } }).transaction
        .detailPublication,
    ).toBe("DETAIL_PUBLIC");
  });

  it("30-32 reject/duplicate/reconciliation and correction preserve FSM and audit", async () => {
    const { services, audits } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    await seedWatcherTransaction(services.domain.repository, {
      id: "orig",
      organizationId: ORG_A,
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
    });
    const correction = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        kind: "CORRECTION",
        native_amount_atomic: "1",
        native_asset: "USDT",
        occurred_at: "2026-08-02T00:00:00.000Z",
        reason: "correction draft",
      }),
      deps,
    );
    const correctionId = (correction.body as { transaction: { id: string } }).transaction.id;
    const linked = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "link_correction",
        original_transaction_id: "orig",
        correction_transaction_id: correctionId,
        reason: "link",
      }),
      deps,
    );
    expect(linked.status).toBe(200);
    const original = await services.domain.repository.getTransaction(
      { organizationId: ORG_A },
      "orig",
    );
    expect(original?.status).toBe("RECONCILIATION_REQUIRED");
    expect(original?.kind).toBe("CONTRIBUTION");
    await seedWatcherTransaction(services.domain.repository, {
      id: "dup-src",
      organizationId: ORG_A,
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
    });
    const rejected = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "reject",
        transaction_id: "dup-src",
        reason: "no",
      }),
      deps,
    );
    expect((rejected.body as { transaction: { status: string } }).transaction.status).toBe(
      "REJECTED",
    );
    expect(audits.some((row) => row.action === "treasury.transaction.correction_link")).toBe(true);
    const revisions = await services.domain.repository.listRevisions(
      { organizationId: ORG_A },
      correctionId,
    );
    expect(revisions.length).toBeGreaterThan(0);
  });
});

describe("DEE-606 WP-4 commitment HTTP contracts", () => {
  it("33-41 commitment lifecycle, money strings, no committed aggregate, audit", async () => {
    const { services, audits } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    const created = await handleTreasuryCommitmentsPost(
      jsonRequest("/api/admin/treasury/commitments", {
        organization_id: ORG_A,
        amount_micros: HUGE_MICROS,
        purpose: "ops",
        committed: "1",
        reason: "draft",
      }),
      deps,
    );
    expect(created.status).toBe(400);
    const draft = await handleTreasuryCommitmentsPost(
      jsonRequest("/api/admin/treasury/commitments", {
        organization_id: ORG_A,
        amount_micros: HUGE_MICROS,
        purpose: "ops",
        reason: "draft",
      }),
      deps,
    );
    expect(draft.status).toBe(200);
    const id = (draft.body as { commitment: { id: string; amountMicros: string } }).commitment.id;
    expect((draft.body as { commitment: { amountMicros: string } }).commitment.amountMicros).toBe(
      HUGE_MICROS,
    );
    expect(
      (draft.body as { commitment: Record<string, unknown> }).commitment.committed,
    ).toBeUndefined();
    const approve = await handleTreasuryCommitmentCommandsPost(
      jsonRequest("/api/admin/treasury/commitments/commands", {
        organization_id: ORG_A,
        command: "approve",
        commitment_id: id,
        reason: "ok",
      }),
      deps,
    );
    expect((approve.body as { commitment: { status: string } }).commitment.status).toBe("APPROVED");
    const release = await handleTreasuryCommitmentCommandsPost(
      jsonRequest("/api/admin/treasury/commitments/commands", {
        organization_id: ORG_A,
        command: "release",
        commitment_id: id,
        reason: "go",
      }),
      deps,
    );
    expect((release.body as { commitment: { status: string } }).commitment.status).toBe("RELEASED");
    await seedWatcherTransaction(services.domain.repository, {
      id: "exp-1",
      organizationId: ORG_A,
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
    });
    const fulfill = await handleTreasuryCommitmentCommandsPost(
      jsonRequest("/api/admin/treasury/commitments/commands", {
        organization_id: ORG_A,
        command: "fulfill",
        commitment_id: id,
        fulfills_transaction_id: "exp-1",
        reason: "paid",
      }),
      deps,
    );
    expect((fulfill.body as { commitment: { status: string } }).commitment.status).toBe(
      "FULFILLED",
    );
    const illegal = await handleTreasuryCommitmentCommandsPost(
      jsonRequest("/api/admin/treasury/commitments/commands", {
        organization_id: ORG_A,
        command: "cancel",
        commitment_id: id,
        reason: "too late",
      }),
      deps,
    );
    expect(illegal.status).toBe(409);
    const cancelable = await handleTreasuryCommitmentsPost(
      jsonRequest("/api/admin/treasury/commitments", {
        organization_id: ORG_A,
        amount_micros: "2",
        purpose: "cancel",
        reason: "draft",
      }),
      deps,
    );
    const cancelId = (cancelable.body as { commitment: { id: string } }).commitment.id;
    await handleTreasuryCommitmentCommandsPost(
      jsonRequest("/api/admin/treasury/commitments/commands", {
        organization_id: ORG_A,
        command: "approve",
        commitment_id: cancelId,
        reason: "ok",
      }),
      deps,
    );
    const cancelled = await handleTreasuryCommitmentCommandsPost(
      jsonRequest("/api/admin/treasury/commitments/commands", {
        organization_id: ORG_A,
        command: "cancel",
        commitment_id: cancelId,
        reason: "stop",
      }),
      deps,
    );
    expect((cancelled.body as { commitment: { status: string } }).commitment.status).toBe(
      "CANCELLED",
    );
    expect(audits.some((row) => row.action === "treasury.commitment.create")).toBe(true);
    const revisions = await services.domain.repository.listCommitmentRevisions(
      { organizationId: ORG_A },
      id,
    );
    expect(revisions.length).toBeGreaterThan(0);
  });
});

describe("DEE-606 WP-4 watched addresses", () => {
  it("42-49 create/update rules, no watcher enable, no custody", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    const created = await handleTreasuryWatchedAddressesPost(
      jsonRequest("/api/admin/treasury/watched-addresses", {
        organization_id: ORG_A,
        network: "TRC-20",
        address: "TADDR",
        token_contract: "TUSDT",
        asset_code: "USDT",
        direction_scope: "BOTH",
        include_in_balance_recon: true,
        label: "hot",
        reason: "watch",
        private_key: "secret",
      }),
      deps,
    );
    expect(created.status).toBe(400);
    const ok = await handleTreasuryWatchedAddressesPost(
      jsonRequest("/api/admin/treasury/watched-addresses", {
        organization_id: ORG_A,
        network: "TRC-20",
        address: "TADDR",
        token_contract: "TUSDT",
        asset_code: "USDT",
        direction_scope: "BOTH",
        include_in_balance_recon: true,
        label: "hot",
        reason: "watch",
      }),
      deps,
    );
    expect(ok.status).toBe(200);
    const id = (ok.body as { watchedAddress: { id: string; organizationId: string } })
      .watchedAddress.id;
    expect(
      (ok.body as { watchedAddress: { organizationId: string } }).watchedAddress.organizationId,
    ).toBe(ORG_A);
    expect(
      JSON.stringify(ok.body).includes("private") || JSON.stringify(ok.body).includes("mnemonic"),
    ).toBe(false);
    const immutable = await handleTreasuryWatchedAddressesPatch(
      jsonRequest("/api/admin/treasury/watched-addresses", {
        organization_id: ORG_A,
        id,
        network: "OTHER",
        reason: "rewrite",
      }),
      deps,
    );
    expect(immutable.status).toBe(400);
    const updated = await handleTreasuryWatchedAddressesPatch(
      jsonRequest("/api/admin/treasury/watched-addresses", {
        organization_id: ORG_A,
        id,
        direction_scope: "INBOUND",
        include_in_balance_recon: false,
        label: "cold",
        is_active: false,
        reason: "tune",
      }),
      deps,
    );
    const row = (updated.body as { watchedAddress: Record<string, unknown> }).watchedAddress;
    expect(row.directionScope).toBe("INBOUND");
    expect(row.includeInBalanceRecon).toBe(false);
    expect(row.label).toBe("cold");
    expect(row.isActive).toBe(false);
    const enable = await handleTreasuryWatchedAddressesPost(
      jsonRequest("/api/admin/treasury/watched-addresses", {
        organization_id: ORG_A,
        network: "TRC-20",
        address: "TADDR2",
        token_contract: "TUSDT",
        asset_code: "USDT",
        direction_scope: "BOTH",
        label: "x",
        reason: "watch",
        TREASURY_WATCHER_ENABLED: true,
      }),
      deps,
    );
    expect(enable.status).toBe(400);
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
  });
});

describe("DEE-606 WP-4 budgets and funding needs", () => {
  it("50-56 planned/required amounts are bigint strings; aggregates rejected", async () => {
    const { services } = createWp4Bundle();
    const mutate = createWp4Deps({ services, permissions: MUTATE });
    const all = createWp4Deps({ services });
    const aggregates = await handleTreasuryBudgetsPost(
      jsonRequest("/api/admin/treasury/budgets", {
        organization_id: ORG_A,
        code: "OPS",
        title: "Ops",
        period_start: "2026-01-01",
        period_end: "2026-12-31",
        currency: "USD",
        planned_amount_micros: HUGE_MICROS,
        status: "DRAFT",
        funded: "1",
        reason: "plan",
      }),
      all,
    );
    expect(aggregates.status).toBe(400);
    const budget = await handleTreasuryBudgetsPost(
      jsonRequest("/api/admin/treasury/budgets", {
        organization_id: ORG_A,
        code: "OPS",
        title: "Ops",
        period_start: "2026-01-01",
        period_end: "2026-12-31",
        currency: "USD",
        planned_amount_micros: HUGE_MICROS,
        status: "DRAFT",
        reason: "plan",
      }),
      all,
    );
    expect(
      (budget.body as { budget: { plannedAmountMicros: string } }).budget.plannedAmountMicros,
    ).toBe(HUGE_MICROS);
    const budgetId = (budget.body as { budget: { id: string } }).budget.id;
    const publicDenied = await handleTreasuryBudgetsPatch(
      jsonRequest("/api/admin/treasury/budgets", {
        organization_id: ORG_A,
        id: budgetId,
        is_public: true,
        reason: "show",
      }),
      mutate,
    );
    expect(publicDenied.status).toBe(403);
    const publicOk = await handleTreasuryBudgetsPatch(
      jsonRequest("/api/admin/treasury/budgets", {
        organization_id: ORG_A,
        id: budgetId,
        is_public: true,
        reason: "show",
      }),
      all,
    );
    expect((publicOk.body as { budget: { isPublic: boolean } }).budget.isPublic).toBe(true);
    const fundedNeed = await handleTreasuryFundingNeedsPost(
      jsonRequest("/api/admin/treasury/funding-needs", {
        organization_id: ORG_A,
        title: "Need",
        required_amount_micros: "5",
        currency: "USD",
        status: "OPEN",
        funded_amount_micros: "1",
        reason: "need",
      }),
      all,
    );
    expect(fundedNeed.status).toBe(400);
    const need = await handleTreasuryFundingNeedsPost(
      jsonRequest("/api/admin/treasury/funding-needs", {
        organization_id: ORG_A,
        title: "Need",
        required_amount_micros: HUGE_MICROS,
        currency: "USD",
        status: "OPEN",
        reason: "need",
      }),
      all,
    );
    expect(
      (need.body as { fundingNeed: { requiredAmountMicros: string } }).fundingNeed
        .requiredAmountMicros,
    ).toBe(HUGE_MICROS);
    const badStatus = await handleTreasuryFundingNeedsPatch(
      jsonRequest("/api/admin/treasury/funding-needs", {
        organization_id: ORG_A,
        id: (need.body as { fundingNeed: { id: string } }).fundingNeed.id,
        status: "MADE_UP",
        reason: "no",
      }),
      all,
    );
    expect(badStatus.status).toBe(400);
    const cross = await handleTreasuryFundingNeedsPost(
      jsonRequest("/api/admin/treasury/funding-needs", {
        organization_id: ORG_B,
        title: "Need",
        required_amount_micros: "5",
        currency: "USD",
        status: "OPEN",
        budget_id: budgetId,
        reason: "cross",
      }),
      all,
    );
    expect(cross.status).toBe(400);
    expect(errorCode(cross)).toBe("CROSS_ORG_REFERENCE");
  });
});

describe("DEE-606 WP-4 ideal budget and runway", () => {
  it("57-65 no invented amounts, publish for activation, no snapshots or endsAt", async () => {
    const { services } = createWp4Bundle();
    const mutate = createWp4Deps({ services, permissions: MUTATE });
    const all = createWp4Deps({ services });
    const missing = await handleTreasuryIdealBudgetsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets", {
        organization_id: ORG_A,
        period_year: 2026,
        currency: "USD",
        reason: "no amount",
      }),
      all,
    );
    expect(missing.status).toBe(400);
    const draft = await handleTreasuryIdealBudgetsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets", {
        organization_id: ORG_A,
        period_year: 2026,
        currency: "USD",
        amount_micros: "100",
        reason: "human amount",
      }),
      all,
    );
    const idealId = (draft.body as { idealBudget: { id: string } }).idealBudget.id;
    const publishDenied = await handleTreasuryIdealBudgetCommandsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets/commands", {
        organization_id: ORG_A,
        command: "activate_public",
        id: idealId,
        reason: "go public",
      }),
      mutate,
    );
    expect(publishDenied.status).toBe(403);
    const published = await handleTreasuryIdealBudgetCommandsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets/commands", {
        organization_id: ORG_A,
        command: "activate_public",
        id: idealId,
        reason: "go public",
      }),
      all,
    );
    expect(
      (published.body as { idealBudget: { status: string; publicationState: string } }).idealBudget,
    ).toMatchObject({ status: "ACTIVE", publicationState: "PUBLIC" });
    const second = await handleTreasuryIdealBudgetsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets", {
        organization_id: ORG_A,
        period_year: 2026,
        currency: "USD",
        amount_micros: "200",
        reason: "second",
      }),
      all,
    );
    const secondId = (second.body as { idealBudget: { id: string } }).idealBudget.id;
    const conflict = await handleTreasuryIdealBudgetCommandsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets/commands", {
        organization_id: ORG_A,
        command: "activate_public",
        id: secondId,
        reason: "duplicate",
      }),
      all,
    );
    expect(conflict.status).toBe(409);
    const inferred = await handleTreasuryRunwayPlansPost(
      jsonRequest("/api/admin/treasury/runway-plans", {
        organization_id: ORG_A,
        currency: "USD",
        infer_from_history: true,
        reason: "infer",
      }),
      all,
    );
    expect(inferred.status).toBe(400);
    const runway = await handleTreasuryRunwayPlansPost(
      jsonRequest("/api/admin/treasury/runway-plans", {
        organization_id: ORG_A,
        currency: "USD",
        daily_burn_micros: "10",
        reason: "explicit burn",
      }),
      all,
    );
    const runwayId = (runway.body as { runwayPlan: { id: string } }).runwayPlan.id;
    const runwayDenied = await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ORG_A,
        command: "activate",
        id: runwayId,
        reason: "activate",
      }),
      mutate,
    );
    expect(runwayDenied.status).toBe(403);
    await handleTreasuryRunwayPlanCommandsPost(
      jsonRequest("/api/admin/treasury/runway-plans/commands", {
        organization_id: ORG_A,
        command: "activate",
        id: runwayId,
        reason: "activate",
      }),
      all,
    );
    const listed = await handleTreasuryRunwayPlansGet(
      getRequest(`/api/admin/treasury/runway-plans?organization_id=${ORG_A}`),
      all,
    );
    const body = listed.body as {
      runwaySnapshots: unknown[];
      runwayPlans: { endsAt?: unknown }[];
    };
    expect(body.runwaySnapshots).toEqual([]);
    expect(body.runwayPlans[0].endsAt).toBeUndefined();
  });
});

describe("DEE-606 WP-4 evidence, attribution, inception", () => {
  it("66-77 evidence fail-closed, link audit, attribution privacy, inception rules", async () => {
    const { services, audits } = createWp4Bundle();
    const mutate = createWp4Deps({ services, permissions: MUTATE });
    const all = createWp4Deps({ services });
    const upload = await handleTreasuryEvidencePost(
      jsonRequest("/api/admin/treasury/evidence", {
        organization_id: ORG_A,
        filename: "receipt.pdf",
      }),
      all,
    );
    expect(upload.status).toBe(503);
    expect(errorCode(upload)).toBe("EVIDENCE_STORAGE_NOT_CONFIGURED");
    await seedAdminEvidence(services, ORG_A, "ev-read");
    const read = await handleTreasuryEvidenceGet(
      getRequest(`/api/admin/treasury/evidence?organization_id=${ORG_A}&id=ev-read`),
      all,
    );
    expect(read.status).toBe(200);
    const draft = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        kind: "OPENING_BALANCE",
        native_amount_atomic: "10",
        native_asset: "USDT",
        accounting_amount_micros: "10",
        occurred_at: "2026-01-01T00:00:00.000Z",
        reason: "opening",
      }),
      all,
    );
    const txId = (draft.body as { transaction: { id: string } }).transaction.id;
    const linkDenied = await handleTreasuryEvidenceLinksPost(
      jsonRequest("/api/admin/treasury/evidence/links", {
        organization_id: ORG_A,
        command: "link",
        transaction_id: txId,
        evidence_object_id: "ev-read",
        reason: "link",
      }),
      createWp4Deps({ services, permissions: ["admin.treasury.read"] }),
    );
    expect(linkDenied.status).toBe(403);
    const linked = await handleTreasuryEvidenceLinksPost(
      jsonRequest("/api/admin/treasury/evidence/links", {
        organization_id: ORG_A,
        command: "link",
        transaction_id: txId,
        evidence_object_id: "ev-read",
        reason: "link",
      }),
      mutate,
    );
    expect(linked.status).toBe(200);
    expect(audits.some((row) => row.action === "treasury.evidence.link")).toBe(true);
    const publicDenied = await handleTreasuryEvidencePost(
      jsonRequest("/api/admin/treasury/evidence", {
        organization_id: ORG_A,
        id: "ev-read",
        visibility: "PUBLIC",
        reason: "show",
      }),
      mutate,
    );
    expect(publicDenied.status).toBe(403);
    await handleTreasuryEvidencePost(
      jsonRequest("/api/admin/treasury/evidence", {
        organization_id: ORG_A,
        id: "ev-read",
        visibility: "PUBLIC",
        reason: "show",
      }),
      all,
    );
    const stillPrivate = await services.domain.repository.getTransaction(
      { organizationId: ORG_A },
      txId,
    );
    expect(stillPrivate?.detailPublication).toBe("PRIVATE");
    const publicIdentity = await handleTreasuryAttributionsPost(
      jsonRequest("/api/admin/treasury/attributions", {
        organization_id: ORG_A,
        transaction_id: txId,
        status: "ATTRIBUTED",
        contributor_user_id: ADMIN_USER,
        consent_public_identity: true,
        reason: "attr",
      }),
      all,
    );
    expect(publicIdentity.status).toBe(400);
    const attr = await handleTreasuryAttributionsPost(
      jsonRequest("/api/admin/treasury/attributions", {
        organization_id: ORG_A,
        transaction_id: txId,
        status: "ATTRIBUTED",
        contributor_user_id: ADMIN_USER,
        reason: "attr",
      }),
      all,
    );
    expect(
      (attr.body as { attribution: { consentPublicIdentity: boolean; organizationId: string } })
        .attribution.consentPublicIdentity,
    ).toBe(false);
    const listed = await handleTreasuryAttributionsGet(
      getRequest(`/api/admin/treasury/attributions?organization_id=${ORG_A}`),
      all,
    );
    expect(listed.status).toBe(200);
    await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        kind: "OPENING_BALANCE",
        native_amount_atomic: "1000000",
        native_asset: "USDT",
        accounting_amount_micros: "1000000",
        occurred_at: "2026-01-01T00:00:00.000Z",
        reason: "opening2",
      }),
      all,
    );
    const opening = await services.domain.transactions.createManualDraft(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      {
        direction: "INFLOW",
        kind: "OPENING_BALANCE",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        ...usdtAmount(10_000_000n),
        reason: "opening",
      },
    );
    await services.domain.transactions.submitForReview(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      { transactionId: opening.id, reason: "review" },
    );
    await services.domain.transactions.classify(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      {
        transactionId: opening.id,
        reason: "classify",
        patch: { kind: "OPENING_BALANCE", direction: "INFLOW", ...usdtAmount(10_000_000n) },
      },
    );
    await seedAdminEvidence(services, ORG_A, "ev-open");
    await services.catalog.linkEvidence(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      { transactionId: opening.id, evidenceObjectId: "ev-open", reason: "evidence" },
    );
    const verified = await services.domain.transactions.verify(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      { transactionId: opening.id, reason: "verify" },
    );
    const created = await handleTreasuryInceptionsPost(
      jsonRequest("/api/admin/treasury/inceptions", {
        organization_id: ORG_A,
        command: "create_active",
        network: "TRC-20",
        token_contract: "TUSDT",
        asset_code: "USDT",
        inception_block: "100",
        watcher_start_block: "101",
        inception_time: "2026-01-01T00:00:00.000Z",
        opening_balance_transaction_id: verified.id,
        reason: "start",
      }),
      all,
    );
    expect(created.status).toBe(200);
    const firstId = (created.body as { inception: { id: string } }).inception.id;
    const second = await handleTreasuryInceptionsPost(
      jsonRequest("/api/admin/treasury/inceptions", {
        organization_id: ORG_A,
        command: "create_active",
        network: "TRC-20",
        token_contract: "TUSDT",
        asset_code: "USDT",
        inception_block: "200",
        watcher_start_block: "201",
        inception_time: "2026-02-01T00:00:00.000Z",
        opening_balance_transaction_id: verified.id,
        reason: "again",
      }),
      all,
    );
    expect(second.status).toBe(409);
    const opening2 = await services.domain.transactions.createManualDraft(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      {
        direction: "INFLOW",
        kind: "OPENING_BALANCE",
        occurredAt: new Date("2026-02-01T00:00:00.000Z"),
        ...usdtAmount(11_000_000n),
        reason: "opening2",
      },
    );
    await services.domain.transactions.submitForReview(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      { transactionId: opening2.id, reason: "review" },
    );
    await services.domain.transactions.classify(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      {
        transactionId: opening2.id,
        reason: "classify",
        patch: { kind: "OPENING_BALANCE", direction: "INFLOW", ...usdtAmount(11_000_000n) },
      },
    );
    await seedAdminEvidence(services, ORG_A, "ev-open-2");
    await services.catalog.linkEvidence(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      { transactionId: opening2.id, evidenceObjectId: "ev-open-2", reason: "evidence" },
    );
    const verified2 = await services.domain.transactions.verify(
      { organizationId: ORG_A },
      { actorType: "admin", actorUserId: ADMIN_USER },
      { transactionId: opening2.id, reason: "verify" },
    );
    const replaced = await handleTreasuryInceptionsPost(
      jsonRequest("/api/admin/treasury/inceptions", {
        organization_id: ORG_A,
        command: "replace_active",
        supersede_inception_id: firstId,
        network: "TRC-20",
        token_contract: "TUSDT",
        asset_code: "USDT",
        inception_block: "200",
        watcher_start_block: "201",
        inception_time: "2026-02-01T00:00:00.000Z",
        opening_balance_transaction_id: verified2.id,
        reason: "replace",
      }),
      all,
    );
    expect(replaced.status).toBe(200);
    const previous = await services.domain.repository.getInception(
      { organizationId: ORG_A },
      firstId,
    );
    expect(previous?.status).toBe("SUPERSEDED");
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
  });
});

describe("DEE-606 WP-4 recon and Breath boundary", () => {
  it("78-85 recon read-only, Breath unready, and DEE-617 public GET-only route", async () => {
    const { services } = createWp4Bundle();
    const readDenied = createWp4Deps({ services, permissions: "none" });
    const all = createWp4Deps({ services });
    await services.watcher.insertBalanceReconciliation({
      id: "recon-1",
      organizationId: ORG_A,
      ledgerInceptionId: null,
      asOfBlock: "99",
      asOfTime: new Date("2026-08-01T00:00:00.000Z"),
      observedOnchainBalanceAtomic: 9007199254740993n,
      accountingCashBalanceMicros: 5n,
      deltaMicros: 1n,
      explainedPendingMicros: 0n,
      unexplainedResidualMicros: 1n,
      status: "MISMATCH",
      toleranceMicros: 0n,
      evidenceObjectId: null,
      notes: null,
      createdBy: "watcher",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const denied = await handleTreasuryReconciliationsGet(
      getRequest(`/api/admin/treasury/reconciliations?organization_id=${ORG_A}`),
      readDenied,
    );
    expect(denied.status).toBe(403);
    const listed = await handleTreasuryReconciliationsGet(
      getRequest(`/api/admin/treasury/reconciliations?organization_id=${ORG_A}`),
      all,
    );
    const recon = (listed.body as { reconciliations: { observedOnchainBalanceAtomic: string }[] })
      .reconciliations[0];
    expect(recon.observedOnchainBalanceAtomic).toBe(HUGE_MICROS);
    const patched = await handleTreasuryReconciliationsPatch();
    expect(patched.status).toBe(405);
    const preview = await handleTreasuryBreathPreviewGet(
      getRequest(`/api/admin/treasury/breath-preview?organization_id=${ORG_A}`),
      all,
    );
    expect(preview.status).toBe(200);
    const previewBody = preview.body as {
      preview: { status: string; resources: unknown; currentFreeFunds: unknown };
    };
    expect(previewBody.preview.status).toBe("pending");
    expect(previewBody.preview.resources).toBeNull();
    expect(previewBody.preview.currentFreeFunds).toBeNull();
    expect(WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED).toBe(false);
    expect("getBreathPublicSnapshot" in treasury).toBe(true);
    const root = process.cwd();
    expect(existsSync(path.join(root, "app/api/treasury"))).toBe(false);
    expect(existsSync(path.join(root, "app/api/public/treasury"))).toBe(true);
    expect(existsSync(path.join(root, "app/api/breath"))).toBe(false);

    const publicRoute = readFileSync(
      path.join(root, "app/api/public/treasury/route.ts"),
      "utf8",
    );
    expect(publicRoute).toContain("export async function GET()");
    expect(publicRoute).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
});
