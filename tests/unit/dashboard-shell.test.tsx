import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import type { DashboardShellDemoSnapshot } from "@/components/dashboard/types";
import { DEFAULT_DEMO_SNAPSHOT } from "@/components/dashboard/types";

function snap(overrides: Partial<DashboardShellDemoSnapshot>): DashboardShellDemoSnapshot {
  return {
    ...DEFAULT_DEMO_SNAPSHOT,
    ...overrides,
    indicatorPercents:
      overrides.indicatorPercents ?? DEFAULT_DEMO_SNAPSHOT.indicatorPercents,
  };
}

describe("DashboardSidebar", () => {
  it("renders brand, identity, and Sign out linking to landing", () => {
    render(<DashboardSidebar identityLabel="Alex" />);
    expect(screen.getByTestId("dashboard-sidebar-brand")).toHaveTextContent("WAIA");
    expect(screen.getByTestId("dashboard-sidebar-identity")).toHaveTextContent("Alex");
    const signOut = screen.getByTestId("dashboard-sidebar-sign-out");
    expect(signOut).toHaveAttribute("href", "/");
  });

  it("does not expose mode navigation rows (dashboard shell §6.3)", () => {
    render(<DashboardSidebar identityLabel="x" />);
    expect(screen.queryByRole("navigation", { name: /Twin/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Dashboard$/i)).not.toBeInTheDocument();
  });
});

describe("DashboardShell", () => {
  it("defaults to Twin tab selected with Diary and Society tabs disabled for new stub user", () => {
    render(<DashboardShell snapshot={DEFAULT_DEMO_SNAPSHOT} />);
    const twin = screen.getByTestId("mode-tab-twin");
    const diary = screen.getByTestId("mode-tab-diary");
    const society = screen.getByTestId("mode-tab-society");

    expect(twin).toHaveAttribute("aria-selected", "true");
    expect(diary).toHaveAttribute("aria-selected", "false");
    expect(society).toHaveAttribute("aria-selected", "false");
    expect(diary).toBeDisabled();
    expect(society).toBeDisabled();

    expect(screen.getByTestId("dashboard-dialogue-area")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-invitation-placeholder")).toBeInTheDocument();
  });

  it("unlocks Diary when total readiness reaches 60%", () => {
    render(<DashboardShell snapshot={snap({ totalCompletionPercent: 61 })} />);
    const diary = screen.getByTestId("mode-tab-diary");
    expect(diary).not.toBeDisabled();
  });

  it("locks Society until socialization succeeds (soc boolean), even at 100% readiness", () => {
    render(
      <DashboardShell
        snapshot={snap({
          totalCompletionPercent: 100,
          indicatorPercents: [100, 100, 100, 100, 100, 100],
          hasMeaningfulExchange: true,
          socializationCompleted: false,
        })}
      />,
    );
    expect(screen.getByTestId("mode-tab-society")).toBeDisabled();
    expect(screen.getByTestId("dashboard-socialization-placeholder")).toBeInTheDocument();
  });

  it("shows Society workspace stub after socialization succeeds", () => {
    render(
      <DashboardShell
        snapshot={snap({
          totalCompletionPercent: 100,
          hasMeaningfulExchange: true,
          socializationCompleted: true,
        })}
      />,
    );
    const societyTab = screen.getByTestId("mode-tab-society");
    expect(societyTab).not.toBeDisabled();
    fireEvent.click(societyTab);
    expect(screen.getByTestId("dashboard-society-placeholder")).toBeInTheDocument();
  });

  it("switches Dialogue Area away from Diary when Twin tab is clicked", () => {
    render(
      <DashboardShell
        snapshot={snap({
          totalCompletionPercent: 65,
          hasMeaningfulExchange: true,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("mode-tab-diary"));
    expect(screen.getByTestId("dashboard-diary-placeholder")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mode-tab-twin"));
    expect(screen.getByTestId("dashboard-twin-active-stub")).toBeInTheDocument();
  });

  it("surfaces Final-state banner placeholder when socialization done and flag not stored", () => {
    render(
      <DashboardShell
        snapshot={snap({
          totalCompletionPercent: 100,
          hasMeaningfulExchange: true,
          socializationCompleted: true,
          finalStateMessageShown: false,
        })}
      />,
    );
    expect(screen.getByTestId("dashboard-final-message-placeholder")).toBeInTheDocument();
  });

  it("renders Twin steady state after Socialization once final-state flag persisted", () => {
    render(
      <DashboardShell
        snapshot={snap({
          totalCompletionPercent: 100,
          hasMeaningfulExchange: true,
          socializationCompleted: true,
          finalStateMessageShown: true,
        })}
      />,
    );
    expect(screen.queryByTestId("dashboard-final-message-placeholder")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/final steady state/i)).toBeInTheDocument();
  });
});
