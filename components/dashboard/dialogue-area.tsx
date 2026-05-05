import { DiaryWorkspace } from "@/components/dashboard/diary-workspace";
import { SocietyWorkspace } from "@/components/dashboard/society-workspace";
import { TwinDialogueWorkspace } from "@/components/dashboard/twin-dialogue-workspace";
import type { ModeId } from "@/components/dashboard/types";
import type { DashboardClientProps } from "@/lib/dashboard/types";
import type { TwinTabPresentation } from "@/lib/dashboard/twin-unlock-tab-ui";

export type DashboardDialogueAreaProps = {
  model: DashboardClientProps;
  selectedMode: ModeId;
  tabPresentations: Record<ModeId, TwinTabPresentation>;
};

function GrowthWorkspaceGate({ presentation }: { presentation: TwinTabPresentation }) {
  return (
    <div
      data-testid="dashboard-workspace-growth-gate"
      className="max-w-2xl space-y-3 rounded-xl border border-border bg-accent/30 p-5"
    >
      <p className="text-foreground text-base font-medium leading-relaxed">{presentation.journeyLine}</p>
      {presentation.hint ? (
        <p className="text-muted-foreground text-sm leading-relaxed">{presentation.hint}</p>
      ) : null}
      {presentation.detail ? (
        <p className="text-muted-foreground text-sm leading-relaxed">{presentation.detail}</p>
      ) : null}
    </div>
  );
}

export function DashboardDialogueArea({
  model,
  selectedMode,
  tabPresentations,
}: DashboardDialogueAreaProps) {
  const { readyForSocialization, showFinalTwinCompletionState } = model;
  const pres = tabPresentations[selectedMode];

  function renderLockedWorkspace(aria: string) {
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex flex-1 flex-col gap-4 p-6"
        aria-label={aria}
      >
        <GrowthWorkspaceGate presentation={pres} />
      </section>
    );
  }

  if (selectedMode === "predictions") {
    if (!pres.unlocked) {
      return renderLockedWorkspace("Predictions workspace gated");
    }
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Predictions workspace"
      >
        <p data-testid="dashboard-predictions-placeholder">Predictions workspace (stub — roadmap).</p>
      </section>
    );
  }

  if (selectedMode === "personality_insights") {
    if (!pres.unlocked) {
      return renderLockedWorkspace("Personality Insights workspace gated");
    }
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Personality Insights workspace"
      >
        <p data-testid="dashboard-personality-insights-placeholder">
          Personality Insights workspace (stub — roadmap).
        </p>
      </section>
    );
  }

  if (selectedMode === "diary") {
    if (!pres.unlocked) {
      return renderLockedWorkspace("Diary workspace gated");
    }

    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Diary workspace"
      >
        <DiaryWorkspace initialEntries={model.initialDiaryEntries} />
      </section>
    );
  }

  if (selectedMode === "society") {
    if (!pres.unlocked) {
      return renderLockedWorkspace("Society workspace gated");
    }

    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Society workspace"
      >
        <SocietyWorkspace model={model} />
      </section>
    );
  }

  // Twin (twin_chat feature)
  if (!pres.unlocked) {
    return renderLockedWorkspace("Twin workspace gated");
  }

  if (!model.hasMeaningfulExchange) {
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Twin dialogue empty state"
      >
        <TwinDialogueWorkspace
          hasMeaningfulExchange={model.hasMeaningfulExchange}
          initialTwinDialogueTurns={model.initialTwinDialogueTurns}
        />
      </section>
    );
  }

  if (readyForSocialization) {
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Twin dialogue with Socialization stub"
      >
        <TwinDialogueWorkspace
          hasMeaningfulExchange={model.hasMeaningfulExchange}
          initialTwinDialogueTurns={model.initialTwinDialogueTurns}
        />
        <div
          data-testid="dashboard-socialization-placeholder"
          className="rounded-xl border border-border bg-accent/40 p-4 text-sm"
        >
          Socialization action surface (stub — behaviour and copy owned by DEE-53).
        </div>
      </section>
    );
  }

  if (model.socializationCompleted && model.finalStateMessageShown) {
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Twin dialogue final steady state"
      >
        <TwinDialogueWorkspace
          hasMeaningfulExchange={model.hasMeaningfulExchange}
          initialTwinDialogueTurns={model.initialTwinDialogueTurns}
        />
      </section>
    );
  }

  if (model.socializationCompleted) {
    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Twin dialogue after Socialization before final flag"
      >
        <TwinDialogueWorkspace
          hasMeaningfulExchange={model.hasMeaningfulExchange}
          initialTwinDialogueTurns={model.initialTwinDialogueTurns}
        />
        {showFinalTwinCompletionState && (
          <div
            data-testid="dashboard-final-message-placeholder"
            className="rounded-xl border border-border bg-accent/40 p-4 text-sm"
          >
            Final-state confirmation banner (shows once until finalStateMessageStored — DEE-21).
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      data-testid="dashboard-dialogue-area"
      className="flex min-h-0 flex-1 flex-col gap-4 p-6"
      aria-label="Twin dialogue active state"
    >
      <TwinDialogueWorkspace
        hasMeaningfulExchange={model.hasMeaningfulExchange}
        initialTwinDialogueTurns={model.initialTwinDialogueTurns}
      />
    </section>
  );
}
