import { TwinDialogueWorkspace } from "@/components/dashboard/twin-dialogue-workspace";
import type { ModeId } from "@/components/dashboard/types";
import type { DashboardClientProps } from "@/lib/dashboard/types";

export type DashboardDialogueAreaProps = {
  model: DashboardClientProps;
  selectedMode: ModeId;
};

export function DashboardDialogueArea({ model, selectedMode }: DashboardDialogueAreaProps) {
  const { diaryTabUnlocked, societyTabUnlocked, readyForSocialization, showFinalTwinCompletionState } =
    model;

  const lockedBanner = (
    <p data-testid="dashboard-workspace-locked-note" className="text-muted-foreground text-sm">
      This workspace is locked. Complete the requirements in Twin mode first.
    </p>
  );

  if (selectedMode === "diary") {
    if (!diaryTabUnlocked) {
      return (
        <section data-testid="dashboard-dialogue-area" className="flex flex-1 flex-col p-6">
          {lockedBanner}
        </section>
      );
    }

    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Diary workspace"
      >
        <p data-testid="dashboard-diary-placeholder">Diary workspace (stub — DEE-54).</p>
      </section>
    );
  }

  if (selectedMode === "society") {
    if (!societyTabUnlocked) {
      return (
        <section data-testid="dashboard-dialogue-area" className="flex flex-1 flex-col p-6">
          {lockedBanner}
        </section>
      );
    }

    return (
      <section
        data-testid="dashboard-dialogue-area"
        className="flex min-h-0 flex-1 flex-col gap-4 p-6"
        aria-label="Society workspace"
      >
        <p data-testid="dashboard-society-placeholder">Society workspace (stub — DEE-55).</p>
      </section>
    );
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
