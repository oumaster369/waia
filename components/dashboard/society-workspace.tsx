"use client";

import { useMemo, useState } from "react";

import {
  resolveTwinProfileForSocietyPreview,
  resolveTwinReadinessForSociety,
} from "@/components/dashboard/society-preview-model";
import type { DashboardClientProps } from "@/lib/dashboard/types";
import type { TwinSocietyContractInput } from "@/lib/reasoning/twin-society-contract";
import {
  buildSocietyContentMap,
  deriveSocializationStatus,
  getSocializationAction,
} from "@/lib/reasoning/twin-society-contract";

export type SocietyWorkspaceProps = {
  model: DashboardClientProps;
  /** Optional overrides for UI-only socialization lifecycle (defaults to internal preview state). */
  socializationInProgress?: boolean;
};

export function SocietyWorkspace({
  model,
  socializationInProgress: socializationInProgressProp,
}: SocietyWorkspaceProps) {
  const [previewRunning, setPreviewRunning] = useState(false);

  const readiness = useMemo(() => resolveTwinReadinessForSociety(model), [model]);
  const profile = useMemo(() => resolveTwinProfileForSocietyPreview(model), [model]);

  const socializationInProgress =
    socializationInProgressProp !== undefined ? socializationInProgressProp : previewRunning;

  const contractInput: TwinSocietyContractInput = useMemo(
    () => ({
      profile,
      readiness,
      socializationCompleted: model.socializationCompleted,
      socializationInProgress,
    }),
    [model.socializationCompleted, profile, readiness, socializationInProgress],
  );

  const contentMap = useMemo(() => buildSocietyContentMap(contractInput), [contractInput]);
  const action = useMemo(() => getSocializationAction(contractInput), [contractInput]);
  const derivedStatus = useMemo(() => deriveSocializationStatus(contractInput), [contractInput]);

  return (
    <section
      data-testid="dashboard-society-workspace"
      aria-label="Society private preview workspace"
      className="flex max-h-full min-h-0 flex-col gap-4 overflow-y-auto"
    >
      <header className="space-y-1">
        <h2 className="text-foreground text-lg font-semibold leading-tight">
          Society preview (private)
        </h2>
        <p data-testid="society-socialization-status" className="text-muted-foreground text-sm">
          Socialization status: {derivedStatus.replaceAll("_", " ")}
        </p>
      </header>

      <div
        className="space-y-2 rounded-xl border border-border bg-accent/40 p-4"
        data-testid="society-profile-card"
      >
        <p data-testid="society-profile-title" className="text-foreground text-base font-medium">
          {contentMap.profileCard.title}
        </p>
        <p
          data-testid="society-profile-description"
          className="text-muted-foreground text-sm leading-relaxed"
        >
          {contentMap.profileCard.shortDescription}
        </p>
        <p data-testid="society-profile-tone" className="text-muted-foreground text-sm">
          Tone: {contentMap.profileCard.tone}
        </p>
        <p data-testid="society-profile-traits" className="text-muted-foreground text-sm">
          Traits: {contentMap.profileCard.traitSummary}
        </p>
      </div>

      <p
        data-testid="society-readiness-badge"
        className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground"
      >
        {contentMap.readinessBadge}
      </p>

      <div className="space-y-3 rounded-xl border border-amber-500/35 bg-muted/30 p-4">
        <h3 className="text-foreground text-sm font-medium">Privacy boundaries (v1)</h3>
        <p
          data-testid="society-visibility-notice"
          className="text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap"
        >
          {contentMap.visibilityNotice}
        </p>
      </div>

      <p data-testid="society-next-action" className="text-foreground text-sm leading-relaxed">
        {contentMap.nextAction}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          data-testid="society-start-preview-button"
          className={[
            "inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
            action.allowed
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          ].join(" ")}
          aria-disabled={!action.allowed}
          disabled={!action.allowed}
          onClick={() => {
            if (action.allowed) {
              setPreviewRunning(true);
            }
          }}
        >
          Start Society preview
        </button>
        <p
          data-testid="society-socialization-reason"
          className="text-muted-foreground flex-1 text-sm leading-relaxed"
        >
          {action.reason}
        </p>
      </div>
    </section>
  );
}
