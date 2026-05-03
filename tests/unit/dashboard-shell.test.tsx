import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import {
  DEFAULT_READINESS_INPUT,
  DEFAULT_TWIN_DIALOGUE_SIGNALS,
} from "@/lib/dashboard/readiness-snapshot-default";
import type { ReadinessInput } from "@/lib/readiness";
import { computeReadinessResult, parseIndicatorVector } from "@/lib/readiness";

function input(partial: Partial<ReadinessInput> & Pick<ReadinessInput, "indicators">): ReadinessInput {
  return {
    indicators: partial.indicators,
    socializationCompleted: partial.socializationCompleted ?? false,
    finalStateMessageShown: partial.finalStateMessageShown ?? false,
  };
}

function buildTestModel(
  readinessOverride: Partial<ReadinessInput> & { indicators?: ReadinessInput["indicators"] } = {},
  twinOverride: Partial<{ hasMeaningfulExchange: boolean }> = {},
) {
  const readinessInput: ReadinessInput = {
    indicators: readinessOverride.indicators ?? DEFAULT_READINESS_INPUT.indicators,
    socializationCompleted:
      readinessOverride.socializationCompleted ?? DEFAULT_READINESS_INPUT.socializationCompleted,
    finalStateMessageShown:
      readinessOverride.finalStateMessageShown ?? DEFAULT_READINESS_INPUT.finalStateMessageShown,
  };
  return buildDashboardViewModel(
    readinessInput,
    { ...DEFAULT_TWIN_DIALOGUE_SIGNALS, ...twinOverride },
    "Dev user",
  );
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
    const model = buildTestModel();
    const r = computeReadinessResult({
      indicators: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
      finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
    });
    expect(model.diaryTabUnlocked).toBe(r.diaryTabUnlocked);
    expect(model.societyTabUnlocked).toBe(r.societyTabUnlocked);

    render(<DashboardShell model={model} />);
    const twin = screen.getByTestId("mode-tab-twin");
    const diary = screen.getByTestId("mode-tab-diary");
    const society = screen.getByTestId("mode-tab-society");

    expect(twin).toHaveAttribute("aria-selected", "true");
    expect(diary).toHaveAttribute("aria-selected", "false");
    expect(society).toHaveAttribute("aria-selected", "false");
    expect(diary).toBeDisabled();
    expect(society).toBeDisabled();
    expect(diary).toHaveAttribute("data-state", "locked");
    expect(society).toHaveAttribute("data-state", "locked");

    expect(screen.getByTestId("dashboard-dialogue-area")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-invitation-placeholder")).toBeInTheDocument();
  });

  it("unlocks Diary when computeReadinessResult unlocks diary (total ≥ 60)", () => {
    const model = buildTestModel({
      indicators: [67, 67, 67, 67, 67, 33],
    });
    expect(
      computeReadinessResult(
        input({ indicators: parseIndicatorVector(model.indicators) }),
      ).diaryTabUnlocked,
    ).toBe(true);
    render(<DashboardShell model={model} />);
    const diary = screen.getByTestId("mode-tab-diary");
    expect(diary).not.toBeDisabled();
    expect(diary).toHaveAttribute("data-state", "unlocked");
  });

  it("locks Society until socialization succeeds, even at 100% readiness", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: false,
      },
      { hasMeaningfulExchange: true },
    );
    const r = computeReadinessResult(
      input({
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: false,
      }),
    );
    expect(r.societyTabUnlocked).toBe(false);
    expect(model.societyTabUnlocked).toBe(false);

    render(<DashboardShell model={model} />);
    expect(screen.getByTestId("mode-tab-society")).toBeDisabled();
    expect(screen.getByTestId("mode-tab-society")).toHaveAttribute("data-state", "locked");
    expect(screen.getByTestId("dashboard-socialization-placeholder")).toBeInTheDocument();
  });

  it("shows Society workspace stub after socialization succeeds", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
      },
      { hasMeaningfulExchange: true },
    );
    render(<DashboardShell model={model} />);
    const societyTab = screen.getByTestId("mode-tab-society");
    expect(societyTab).not.toBeDisabled();
    expect(societyTab).toHaveAttribute("data-state", "unlocked");
    fireEvent.click(societyTab);
    expect(screen.getByTestId("dashboard-society-placeholder")).toBeInTheDocument();
  });

  it("switches Dialogue Area away from Diary when Twin tab is clicked", () => {
    const model = buildTestModel(
      { indicators: [67, 67, 67, 67, 67, 33] },
      { hasMeaningfulExchange: true },
    );
    render(<DashboardShell model={model} />);
    fireEvent.click(screen.getByTestId("mode-tab-diary"));
    expect(screen.getByTestId("dashboard-diary-placeholder")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mode-tab-twin"));
    expect(screen.getByTestId("dashboard-twin-active-stub")).toBeInTheDocument();
  });

  it("surfaces Final-state banner when showFinalTwinCompletionState from readiness result", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
        finalStateMessageShown: false,
      },
      { hasMeaningfulExchange: true },
    );
    expect(
      computeReadinessResult(
        input({
          indicators: [100, 100, 100, 100, 100, 100],
          socializationCompleted: true,
          finalStateMessageShown: false,
        }),
      ).showFinalTwinCompletionState,
    ).toBe(true);

    render(<DashboardShell model={model} />);
    expect(screen.getByTestId("dashboard-final-message-placeholder")).toBeInTheDocument();
  });

  it("renders Twin steady state after Socialization once final-state flag persisted", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
        finalStateMessageShown: true,
      },
      { hasMeaningfulExchange: true },
    );
    render(<DashboardShell model={model} />);
    expect(screen.queryByTestId("dashboard-final-message-placeholder")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/final steady state/i)).toBeInTheDocument();
  });

  it("updates tab locks when readiness model props change (rerender)", () => {
    const lockedModel = buildTestModel({ indicators: [33, 33, 33, 33, 33, 33] });
    const unlockedModel = buildTestModel({ indicators: [67, 67, 67, 67, 67, 33] });

    expect(
      computeReadinessResult(
        input({ indicators: parseIndicatorVector(lockedModel.indicators) }),
      ).diaryTabUnlocked,
    ).toBe(false);
    expect(
      computeReadinessResult(
        input({ indicators: parseIndicatorVector(unlockedModel.indicators) }),
      ).diaryTabUnlocked,
    ).toBe(true);

    const { rerender } = render(<DashboardShell model={lockedModel} />);
    expect(screen.getByTestId("mode-tab-diary")).toHaveAttribute("data-state", "locked");

    rerender(<DashboardShell model={unlockedModel} />);
    expect(screen.getByTestId("mode-tab-diary")).not.toBeDisabled();
    expect(screen.getByTestId("mode-tab-diary")).toHaveAttribute("data-state", "unlocked");
  });
});
