import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DashboardModeTabs } from "@/components/dashboard/mode-tabs";
import type { ModeId } from "@/components/dashboard/types";
import type { TwinTabPresentation } from "@/lib/dashboard/twin-unlock-tab-ui";

function tabPres(
  base: Pick<TwinTabPresentation, "label" | "unlocked"> &
    Partial<Omit<TwinTabPresentation, "label" | "unlocked">>,
): TwinTabPresentation {
  const unlocked = base.unlocked;
  return {
    phase: base.phase ?? (unlocked ? "unlocked" : "locked"),
    unlocked,
    label: base.label,
    journeyLine: base.journeyLine ?? "fixture",
    hint: base.hint,
    detail: base.detail,
  };
}

/** Minimal presentations for every workspace tab slot (predictions / personality locked in fixtures). */
function tabRow(societyUnlocked: boolean): Record<ModeId, TwinTabPresentation> {
  return {
    twin: tabPres({ label: "Twin", unlocked: true }),
    diary: tabPres({ label: "Diary", unlocked: false }),
    predictions: tabPres({ label: "Predictions", unlocked: false }),
    personality_insights: tabPres({ label: "Personality Insights", unlocked: false }),
    society: tabPres({ label: "Society", unlocked: societyUnlocked }),
  };
}

describe("DashboardModeTabs", () => {
  it("Twin unlocked vs Diary locked: data-state and disabled wiring", () => {
    render(
      <DashboardModeTabs
        selectedMode="twin"
        onSelectMode={vi.fn()}
        tabPresentations={tabRow(false)}
        totalCompletionPercent={33}
        readyForSocialization={false}
      />,
    );

    const twinTab = screen.getByTestId("mode-tab-twin");
    expect(twinTab).toHaveAttribute("data-state", "unlocked");
    expect(twinTab).not.toBeDisabled();

    const diaryTab = screen.getByTestId("mode-tab-diary");
    expect(diaryTab).toHaveAttribute("data-state", "locked");
    expect(diaryTab).toBeDisabled();
    expect(diaryTab).toHaveAttribute("aria-disabled", "true");

    const societyTab = screen.getByTestId("mode-tab-society");
    expect(societyTab).not.toHaveAttribute("data-next-socialization-highlight");
  });

  it("case B: formation 100% but not ready — no Society highlight", () => {
    render(
      <DashboardModeTabs
        selectedMode="twin"
        onSelectMode={vi.fn()}
        tabPresentations={tabRow(false)}
        totalCompletionPercent={100}
        readyForSocialization={false}
      />,
    );

    expect(screen.getByTestId("mode-tab-society")).not.toHaveAttribute(
      "data-next-socialization-highlight",
    );
  });

  it("case C: formation complete + ready + Society still locked → next-step highlight", () => {
    render(
      <DashboardModeTabs
        selectedMode="twin"
        onSelectMode={vi.fn()}
        tabPresentations={tabRow(false)}
        totalCompletionPercent={100}
        readyForSocialization
      />,
    );

    expect(screen.getByTestId("mode-tab-society")).toHaveAttribute(
      "data-next-socialization-highlight",
      "true",
    );
  });

  it("case D: Society unlocked — highlight cleared even when formation and ready flags hold", () => {
    render(
      <DashboardModeTabs
        selectedMode="society"
        onSelectMode={vi.fn()}
        tabPresentations={tabRow(true)}
        totalCompletionPercent={100}
        readyForSocialization
      />,
    );

    expect(screen.getByTestId("mode-tab-society")).not.toHaveAttribute(
      "data-next-socialization-highlight",
    );
  });
});
