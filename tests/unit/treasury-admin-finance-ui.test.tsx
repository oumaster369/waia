import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MoneyText } from "@/components/treasury/admin/money-text";
import { PublicationPill } from "@/components/treasury/admin/status-pills";
import { FactValue } from "@/components/treasury/admin/fact-value";
import { UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { publicPreviewFields, operatorPreviewDiagnostics } from "@/lib/treasury-admin/preview";
import { requireOrganizationId, withOrganizationQuery } from "@/lib/treasury-admin/api";
import { classifyMoneyFact } from "@/lib/treasury-admin/facts";
import type { BreathAdminPreviewDto } from "@/lib/treasury-admin/types";

describe("treasury-admin publication rendering", () => {
  it("distinguishes PRIVATE, DETAIL_PUBLIC, and SUPERSEDED", () => {
    const { rerender } = render(<PublicationPill state="PRIVATE" />);
    expect(screen.getByTestId("publication-state-PRIVATE")).toHaveTextContent("Private");
    rerender(<PublicationPill state="DETAIL_PUBLIC" />);
    expect(screen.getByTestId("publication-state-DETAIL_PUBLIC")).toHaveTextContent(
      "Public detail",
    );
    rerender(<PublicationPill state="SUPERSEDED" />);
    expect(screen.getByTestId("publication-state-SUPERSEDED")).toHaveTextContent("Superseded");
  });
});

describe("treasury-admin fact kinds", () => {
  it("distinguishes zero, null, pending, and unavailable", () => {
    expect(classifyMoneyFact("0")).toBe("zero");
    expect(classifyMoneyFact(null)).toBe("null");
    render(<MoneyText micros="0" />);
    expect(screen.getByTestId("money-zero")).toHaveTextContent("$0.00");
    render(<MoneyText micros={null} />);
    expect(screen.getByTestId("money-null")).toBeInTheDocument();
    render(<FactValue kind="pending" reason="IDEAL_BUDGET_MISSING" />);
    expect(screen.getByTestId("fact-pending")).toHaveTextContent("Pending");
    render(<UnavailableState code="EVIDENCE_STORAGE_NOT_CONFIGURED" />);
    expect(screen.getByTestId("finance-unavailable")).toHaveTextContent(
      "Evidence object storage is not configured",
    );
  });

  it("renders signed negative remaining", () => {
    render(<MoneyText micros="-1000000" />);
    expect(screen.getByTestId("money-negative")).toHaveTextContent("-$1.00");
  });
});

describe("treasury-admin preview mapping", () => {
  it("maps public fields without recomputing money", () => {
    const preview = {
      status: "pending",
      lastUpdatedAt: null,
      stageLabel: null,
      work: null,
      methodologyNote: null,
      idealAnnualBudget: null,
      resources: {
        entered: "2",
        spent: "1",
        remaining: "-3",
        allocated: "4",
        neededNext: null,
      },
      currentFreeFunds: "5",
      budget: null,
      runway: { status: "pending" },
      recentActivity: [],
      pendingReasons: ["BREATH_DISABLED"],
      componentStatus: {
        breathEnabled: false,
        idealBudget: "missing",
        materialReconciliation: false,
        balanceReconciliation: "missing",
        budget: "absent",
        fundingNeed: "absent",
        verifiedFinancialComplete: true,
      },
      reconciliationGate: { latestId: null, status: null, createdAt: null },
      runwayStatus: { status: "pending", reason: null, snapshotId: null },
    } satisfies BreathAdminPreviewDto;
    expect(publicPreviewFields(preview).resources?.remaining).toBe("-3");
    expect(publicPreviewFields(preview).currentFreeFunds).toBe("5");
    expect(operatorPreviewDiagnostics(preview).pendingReasons).toEqual(["BREATH_DISABLED"]);
  });
});

describe("treasury-admin organization scoping", () => {
  it("refuses missing organization_id and always sets the query param", () => {
    expect(() => requireOrganizationId(null)).toThrow(/organization_id/);
    expect(withOrganizationQuery("/api/admin/treasury/transactions", "org-a")).toContain(
      "organization_id=org-a",
    );
  });
});
