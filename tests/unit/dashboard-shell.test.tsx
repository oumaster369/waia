import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardDialogueArea } from "@/components/dashboard/dialogue-area";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { TAB_ORDER } from "@/components/dashboard/types";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/components/dashboard/twin-dialogue-workspace";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import {
  DEFAULT_READINESS_INPUT,
  DEFAULT_TWIN_DIALOGUE_SIGNALS,
} from "@/lib/dashboard/readiness-snapshot-default";
import {
  buildDashboardTabPresentations,
  FEATURE_GROWTH_CATALOG,
  tabUiForbiddenPhraseRegex,
} from "@/lib/dashboard/twin-unlock-tab-ui";
import { resolveDashboardTwinGrowth } from "@/components/dashboard/twin-growth-placeholder";
import type { ReadinessInput } from "@/lib/readiness";
import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";
import type { TwinUnlockState } from "@/lib/dashboard/twin-unlock-api.types";
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
  it("renders brand, identity, and Sign out control", () => {
    render(<DashboardSidebar identityLabel="Alex" />);
    expect(screen.getByTestId("dashboard-sidebar-brand")).toHaveTextContent("WAIA");
    expect(screen.getByTestId("dashboard-sidebar-identity")).toHaveTextContent("Alex");
    const signOut = screen.getByTestId("dashboard-sidebar-sign-out");
    expect(signOut).toHaveAttribute("type", "button");
  });

  it("does not expose mode navigation rows (dashboard shell §6.3)", () => {
    render(<DashboardSidebar identityLabel="x" />);
    expect(screen.queryByRole("navigation", { name: /Twin/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Dashboard$/i)).not.toBeInTheDocument();
  });
});

describe("DashboardShell", () => {
  it("defaults to Twin tab selected with non-Twin tabs disabled for new stub user (five-tab order)", () => {
    const model = buildTestModel();
    const r = computeReadinessResult({
      indicators: DEFAULT_READINESS_INPUT.indicators,
      socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
      finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
    });
    expect(model.diaryTabUnlocked).toBe(r.diaryTabUnlocked);
    expect(model.societyTabUnlocked).toBe(r.societyTabUnlocked);

    const { container } = render(<DashboardShell model={model} />);
    expect(container.textContent ?? "").not.toMatch(tabUiForbiddenPhraseRegex());

    const twin = screen.getByTestId("mode-tab-twin");
    const diary = screen.getByTestId("mode-tab-diary");
    const predictions = screen.getByTestId("mode-tab-predictions");
    const personality = screen.getByTestId("mode-tab-personality_insights");
    const society = screen.getByTestId("mode-tab-society");

    expect(TAB_ORDER.map((id) => screen.getByTestId(`mode-tab-${id}`))).toEqual([
      twin,
      diary,
      predictions,
      personality,
      society,
    ]);

    expect(twin).toHaveAttribute("aria-selected", "true");
    expect(diary).toHaveAttribute("aria-selected", "false");
    expect(predictions).toHaveAttribute("aria-selected", "false");
    expect(personality).toHaveAttribute("aria-selected", "false");
    expect(society).toHaveAttribute("aria-selected", "false");

    expect(twin).not.toBeDisabled();
    expect(diary).toBeDisabled();
    expect(predictions).toBeDisabled();
    expect(personality).toBeDisabled();
    expect(society).toBeDisabled();

    expect(diary).toHaveAttribute("data-state", "locked");
    expect(predictions).toHaveAttribute("data-state", "locked");
    expect(personality).toHaveAttribute("data-state", "locked");
    expect(society).toHaveAttribute("data-state", "locked");
    expect(twin).toHaveAttribute("data-phase", "unlocked");
    expect(diary).toHaveAttribute("data-phase");
    expect(predictions).toHaveAttribute("data-phase");

    expect(screen.getByTestId("dashboard-dialogue-area")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-invitation-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-message-list")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-message-input")).toBeInTheDocument();
  });

  it("shows mandated growth journey lines for Predictions / Personality when placeholder-locked", () => {
    const model = buildTestModel();
    const tabPresentations = buildDashboardTabPresentations(resolveDashboardTwinGrowth(model));

    const { unmount } = render(
      <DashboardDialogueArea
        model={model}
        selectedMode="predictions"
        tabPresentations={tabPresentations}
      />,
    );
    expect(screen.getByTestId("dashboard-workspace-growth-gate")).toHaveTextContent(
      FEATURE_GROWTH_CATALOG.predictions.journeyLine,
    );
    unmount();

    render(
      <DashboardDialogueArea
        model={model}
        selectedMode="personality_insights"
        tabPresentations={tabPresentations}
      />,
    );
    expect(screen.getByTestId("dashboard-workspace-growth-gate")).toHaveTextContent(
      FEATURE_GROWTH_CATALOG.personality_insights.journeyLine,
    );
  });

  it("does not surface forbidden phrasing in RTL layout wrapper", () => {
    const model = buildTestModel();
    const { container } = render(
      <div dir="rtl">
        <DashboardShell model={model} />
      </div>,
    );
    expect(container.textContent ?? "").not.toMatch(tabUiForbiddenPhraseRegex());
  });

  it("respects optional SSR twinGrowth unlock flags (hand-built bundle)", () => {
    const model = buildTestModel({}, { hasMeaningfulExchange: true });
    const readiness: TwinReadinessResult = {
      schemaVersion: "twin-readiness-v1",
      overall: 0.95,
      level: "high",
      scores: {
        baseModel: 0.9,
        memory: 0.85,
        patterns: 0.8,
        contradictions: 0.75,
        consistency: 0.85,
        feedback: 0.82,
      },
    };
    const unlockState: TwinUnlockState = {
      diary: { unlocked: true, reason: "ready" },
      personality_insights: { unlocked: true, reason: "ready" },
      predictions: { unlocked: true, reason: "ready" },
      society: { unlocked: false, reason: "not yet" },
      twin_chat: { unlocked: true, reason: "ready" },
    };
    render(<DashboardShell model={{ ...model, twinGrowth: { readiness, unlockState } }} />);
    expect(screen.getByTestId("mode-tab-predictions")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("mode-tab-predictions"));
    expect(screen.getByTestId("dashboard-predictions-placeholder")).toBeInTheDocument();
  });

  it("maps six indicators to data-threshold bands and shows deterministic hints", () => {
    const model = buildTestModel({ indicators: [0, 33, 67, 100, 0, 100] });
    render(<DashboardShell model={model} />);
    expect(screen.getByTestId("dashboard-indicator-values")).toHaveAttribute("data-threshold", "low");
    expect(screen.getByTestId("dashboard-indicator-behavior")).toHaveAttribute("data-threshold", "medium");
    expect(screen.getByTestId("dashboard-indicator-thinking")).toHaveAttribute("data-threshold", "medium");
    expect(screen.getByTestId("dashboard-indicator-emotions")).toHaveAttribute("data-threshold", "high");
    expect(screen.getByTestId("dashboard-indicator-interests")).toHaveAttribute("data-threshold", "low");
    expect(screen.getByTestId("dashboard-indicator-goals")).toHaveAttribute("data-threshold", "high");
    expect(screen.getByText(/Share a guiding principle/i)).toBeInTheDocument();
  });

  it("updates Values indicator threshold when readiness vector rerenders", () => {
    const low = buildTestModel({ indicators: [0, 33, 33, 33, 33, 33] });
    const high = buildTestModel({ indicators: [100, 33, 33, 33, 33, 33] });
    const { rerender } = render(<DashboardShell model={low} />);
    expect(screen.getByTestId("dashboard-indicator-values")).toHaveAttribute("data-threshold", "low");
    rerender(<DashboardShell model={high} />);
    expect(screen.getByTestId("dashboard-indicator-values")).toHaveAttribute("data-threshold", "high");
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
    expect(screen.getByTestId("dashboard-twin-dialogue-workspace")).toBeInTheDocument();
  });

  it("does not show empty Twin invitation when hasMeaningfulExchange is already true", () => {
    const model = buildTestModel({}, { hasMeaningfulExchange: true });
    render(<DashboardShell model={model} />);
    expect(screen.queryByTestId("dashboard-twin-invitation-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-dialogue-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-message-input")).toBeInTheDocument();
  });

  it("appends Twin stub assistant reply after the user submits a draft", async () => {
    const userTurn = {
      id: "persisted-user-msg-id",
      sequence: 1,
      role: "user" as const,
      content: "Hello twin",
      createdAt: new Date().toISOString(),
    };
    const successBody = {
      userTurn,
      assistantTurn: {
        id: "persisted-assistant-msg-id",
        sequence: userTurn.sequence + 1,
        role: "assistant" as const,
        content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        createdAt: new Date().toISOString(),
      },
      twinSignals: { hasMeaningfulExchange: true },
      assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const model = buildTestModel();
    render(<DashboardShell model={model} />);
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "Hello twin" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByText("Hello twin")).toBeInTheDocument();
      expect(screen.getByText(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE)).toBeInTheDocument();
    });
    expect(screen.getByTestId("dashboard-twin-msg-user-0")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-msg-assistant-1")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/twin-dialogue/turn"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const opts = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(opts.body))).toEqual(
      expect.objectContaining({
        message: "Hello twin",
      }),
    );
    expect(JSON.parse(String(opts.body))).toMatchObject({
      idempotencyKey: expect.any(String),
    });

    fetchMock.mockRestore();
  });

  it("renders Twin dialogue messages hydrated from initialTwinDialogueTurns on the model", () => {
    const model = buildTestModel({}, { hasMeaningfulExchange: true });
    render(
      <DashboardShell
        model={{
          ...model,
          initialTwinDialogueTurns: [
            { id: "ssr-user", role: "user", text: "Hydrated hi" },
            { id: "ssr-asst", role: "assistant", text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE },
          ],
        }}
      />,
    );

    expect(screen.getByText("Hydrated hi")).toBeInTheDocument();
    expect(screen.getByText(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE)).toBeInTheDocument();
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
