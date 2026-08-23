import { describe, expect, it } from "vitest";

import { derivePublicTreasuryProjection } from "@/lib/waia-core/treasury/public/projection";
import { publicTreasuryPendingReasons } from "@/lib/waia-core/treasury/public/types";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import {
  NOW,
  ORG_A,
  USER_A,
  createPublishedPublicTreasuryFacts,
} from "@/tests/unit/helpers/treasury-public";

describe("DEE-617 public Treasury projection", () => {
  it("publishes exactly the three Breath facts plus matching budget, safe ledger, needs and Patrons", async () => {
    const projection = derivePublicTreasuryProjection(
      await createPublishedPublicTreasuryFacts(),
      NOW,
    );

    expect(projection.breath).toEqual({
      status: "published",
      pendingReasons: [],
      availableAmountMicros: "25000000",
      availableCurrency: "USD",
      runway: {
        status: "published",
        asOf: NOW.toISOString(),
        endsAt: "2026-09-07T12:00:00.000Z",
      },
      annualBudgetAmountMicros: "120000000",
      annualBudgetCurrency: "USD",
      lastUpdatedAt: NOW.toISOString(),
    });
    expect(Object.keys(projection.breath).sort()).toEqual(
      [
        "status",
        "pendingReasons",
        "availableAmountMicros",
        "availableCurrency",
        "runway",
        "annualBudgetAmountMicros",
        "annualBudgetCurrency",
        "lastUpdatedAt",
      ].sort(),
    );

    expect(projection.budget).toMatchObject({
      status: "published",
      year: 2026,
      currency: "USD",
      annualBudgetAmountMicros: "120000000",
    });
    expect(projection.budget.months).toHaveLength(12);
    expect(projection.budget.months.find((row) => row.month === "2026-08")).toMatchObject({
      categories: [
        {
          code: "DEVELOPMENT",
          name: "Development",
          groupName: "Development",
          budgetMicros: "10000000",
          spentMicros: "5000000",
          remainingMicros: "5000000",
        },
      ],
    });

    expect(projection.transactions).toEqual([
      {
        occurredAt: NOW.toISOString(),
        amountMicros: "-5000000",
        currency: "USD",
        categoryName: "Development",
        categoryGroup: "Development",
        projectName: "WAIA Core",
        description: "Public engineering expense",
      },
    ]);
    expect(projection.fundingNeeds).toEqual([
      {
        title: "Core development",
        explanation: "Fund the next development milestone.",
        targetStage: "Foundation",
        status: "PARTIALLY_FUNDED",
        currency: "USD",
        requiredAmountMicros: "50000000",
        fundedAmountMicros: "20000000",
        remainingAmountMicros: "30000000",
      },
    ]);
    expect(projection.patrons).toMatchObject({
      status: "published",
      totalContributedAmountMicros: "30000000",
      currency: "USD",
      patrons: [
        {
          displayName: "Alice",
          contributedAmountMicros: "20000000",
          share: {
            numeratorMicros: "20000000",
            denominatorMicros: "30000000",
            partsPerMillion: "666666",
          },
        },
      ],
      privateSupport: {
        contributedAmountMicros: "10000000",
        share: {
          numeratorMicros: "10000000",
          denominatorMicros: "30000000",
          partsPerMillion: "333333",
        },
      },
    });

    const json = JSON.stringify(projection);
    expect(json).not.toContain("PRIVATE");
    expect(json).not.toContain("alice@example.com");
    expect(json).not.toContain("supplier name");
    expect(json).not.toContain(USER_A);
    expect(json).not.toContain("transactionId");
    expect(json).not.toContain("counterparty");
    expect(json).not.toContain("account");
    expect(json).not.toContain("internalNotes");
    expect(json).not.toMatch(/ownership|governance|voting|profit|security/i);
  });

  it("fails closed without publication prerequisites and never renders fake zeroes", async () => {
    const facts = await createPublishedPublicTreasuryFacts();
    facts.settings = facts.settings ? { ...facts.settings, breathEnabled: false } : null;
    const projection = derivePublicTreasuryProjection(facts, NOW);

    expect(projection.breath).toMatchObject({
      status: "pending",
      availableAmountMicros: null,
      availableCurrency: null,
      annualBudgetAmountMicros: null,
      annualBudgetCurrency: null,
      runway: { status: "pending" },
      pendingReasons: [publicTreasuryPendingReasons.PUBLICATION_DISABLED],
    });
    expect(projection.budget).toMatchObject({ status: "pending", months: [] });
    expect(projection.transactions).toEqual([]);
    expect(projection.fundingNeeds).toEqual([]);
    expect(projection.patrons).toMatchObject({ status: "pending", patrons: [] });
  });

  it("keeps truthful money but marks runway pending when no current read-only snapshot exists", async () => {
    const facts = await createPublishedPublicTreasuryFacts();
    facts.runwaySnapshots[0] = {
      ...facts.runwaySnapshots[0]!,
      inputDigest: "stale-digest",
    };
    const projection = derivePublicTreasuryProjection(facts, NOW);

    expect(projection.breath).toMatchObject({
      status: "pending",
      availableAmountMicros: "25000000",
      annualBudgetAmountMicros: "120000000",
      runway: { status: "pending" },
      pendingReasons: [publicTreasuryPendingReasons.RUNWAY_UNAVAILABLE],
    });
    expect(facts.runwaySnapshots).toHaveLength(1);
  });

  it("withholds category history when it no longer matches the approved annual snapshot", async () => {
    const facts = await createPublishedPublicTreasuryFacts();
    facts.idealBudgets[0] = { ...facts.idealBudgets[0]!, amountMicros: 121_000_000n };
    const projection = derivePublicTreasuryProjection(facts, NOW);

    expect(projection.breath.annualBudgetAmountMicros).toBe("121000000");
    expect(projection.budget).toEqual({
      status: "pending",
      year: null,
      currency: null,
      annualBudgetAmountMicros: null,
      months: [],
    });
  });

  it("moves unconsented support into the private aggregate and fails Patron identity on ambiguity", async () => {
    const privateFacts = await createPublishedPublicTreasuryFacts();
    privateFacts.attributions = privateFacts.attributions.map((row) => ({
      ...row,
      consentPublicIdentity: false,
    }));
    const privateProjection = derivePublicTreasuryProjection(privateFacts, NOW);
    expect(privateProjection.patrons.patrons).toEqual([]);
    expect(privateProjection.patrons.privateSupport?.contributedAmountMicros).toBe("30000000");

    const ambiguousFacts = await createPublishedPublicTreasuryFacts();
    ambiguousFacts.attributions.push({
      ...ambiguousFacts.attributions[0]!,
      id: "61700000-0000-4000-8000-000000000099",
      status: "ANONYMOUS",
      contributorUserId: null,
      consentPublicIdentity: false,
    });
    const ambiguous = derivePublicTreasuryProjection(ambiguousFacts, NOW);
    expect(ambiguous.patrons).toMatchObject({
      status: "pending",
      patrons: [],
      privateSupport: null,
    });
  });

  it("bounds the public transaction ledger and rejects mixed-organization facts", async () => {
    const facts = await createPublishedPublicTreasuryFacts();
    const template = facts.transactions.find(
      (row) => row.detailPublication === "DETAIL_PUBLIC",
    )!;
    const additions: TreasuryTransactionRecord[] = Array.from({ length: 105 }, (_, index) => ({
      ...template,
      id: `public-${String(index).padStart(3, "0")}`,
      recordContentDigest: `public-digest-${String(index).padStart(3, "0")}`,
      occurredAt: new Date(NOW.getTime() - (index + 1) * 1_000),
      verifiedAt: new Date(NOW.getTime() - (index + 1) * 1_000),
      updatedAt: new Date(NOW.getTime() - (index + 1) * 1_000),
    }));
    facts.transactions.push(...additions);
    expect(derivePublicTreasuryProjection(facts, NOW).transactions).toHaveLength(100);

    const mixed = await createPublishedPublicTreasuryFacts();
    mixed.transactions[0] = {
      ...mixed.transactions[0]!,
      organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    };
    expect(() => derivePublicTreasuryProjection(mixed, NOW)).toThrow(
      "Public Treasury facts must belong to one organization",
    );
    expect(mixed.organizationId).toBe(ORG_A);
  });
});
