import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DashboardDialogueArea } from "@/components/dashboard/dialogue-area";
import { SocietyWorkspace } from "@/components/dashboard/society-workspace";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { resolveDashboardTwinGrowth } from "@/components/dashboard/twin-growth-placeholder";
import { SOCIETY_VISIBILITY_NOTICE_V1 } from "@/lib/dashboard/twin-society-api.types";
import { buildDashboardTabPresentations } from "@/lib/dashboard/twin-unlock-tab-ui";
import { tabUiForbiddenPhraseRegex } from "@/lib/dashboard/twin-unlock-tab-ui";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import {
  DEFAULT_READINESS_INPUT,
  DEFAULT_TWIN_DIALOGUE_SIGNALS,
} from "@/lib/dashboard/readiness-snapshot-default";

import type { ReadinessInput } from "@/lib/readiness/types";

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
    "Taylor",
  );
}

describe("SocietyWorkspace (DEE-55)", () => {
  it("when Society tab is locked, shows GrowthWorkspaceGate only (no SocietyWorkspace)", () => {
    const model = buildTestModel({}, { hasMeaningfulExchange: true });
    const tabs = buildDashboardTabPresentations(resolveDashboardTwinGrowth(model));
    expect(tabs.society.unlocked).toBe(false);

    render(
      <DashboardDialogueArea model={model} selectedMode="society" tabPresentations={tabs} />,
    );
    expect(screen.getByTestId("dashboard-workspace-growth-gate")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-society-workspace")).not.toBeInTheDocument();
  });

  it("when unlocked, renders workspace with profile surfaces and visibility copy", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
      },
      { hasMeaningfulExchange: true },
    );
    render(<SocietyWorkspace model={model} />);

    expect(screen.getByTestId("dashboard-society-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("society-profile-card")).toBeInTheDocument();
    expect(screen.getByTestId("society-profile-title")).toHaveTextContent("Taylor");
    expect(screen.getByTestId("society-readiness-badge")).toBeInTheDocument();
    expect(screen.getByTestId("society-visibility-notice")).toHaveTextContent(SOCIETY_VISIBILITY_NOTICE_V1);
    const combo = `${screen.getByTestId("dashboard-society-workspace").textContent ?? ""}`;
    expect(combo.toLowerCase()).toContain("private");
    expect(combo.toLowerCase()).not.toMatch(/publish(ing)?\s+(to\s+)?a\s+public/i);
    expect(combo).not.toMatch(tabUiForbiddenPhraseRegex());
  });

  it("enables Start button when readiness allows ready_to_start and socialization incomplete", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: false,
      },
      { hasMeaningfulExchange: true },
    );

    render(<SocietyWorkspace model={model} />);
    const btn = screen.getByTestId("society-start-preview-button");
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    expect(screen.getByTestId("society-socialization-status")).toHaveTextContent(/socializing/i);
    expect(btn).toBeDisabled();
  });

  it("shows disabled Start and reason when Twin is already socialized", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
      },
      { hasMeaningfulExchange: true },
    );
    render(<SocietyWorkspace model={model} />);
    expect(screen.getByTestId("society-start-preview-button")).toBeDisabled();
    expect(screen.getByTestId("society-socialization-reason")).toHaveTextContent(/completed/i);
  });

  it("disables Start when readiness is below high (not_ready)", () => {
    const model = buildTestModel(
      {
        indicators: [0, 0, 0, 33, 0, 0],
        socializationCompleted: false,
      },
      { hasMeaningfulExchange: true },
    );
    render(<SocietyWorkspace model={model} />);
    expect(screen.getByTestId("society-start-preview-button")).toBeDisabled();
    expect(screen.getByTestId("society-socialization-reason")).toHaveTextContent(/high/i);
  });

  it("Shell: unlocked Society selects workspace content", () => {
    const model = buildTestModel(
      {
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
      },
      { hasMeaningfulExchange: true },
    );
    render(<DashboardShell model={model} />);
    fireEvent.click(screen.getByTestId("mode-tab-society"));
    expect(screen.getByTestId("dashboard-society-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("society-visibility-notice")).toBeVisible();
  });
});
