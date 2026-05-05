"use client";

import { useState } from "react";

import { DashboardDialogueArea } from "@/components/dashboard/dialogue-area";
import { DashboardModeTabs } from "@/components/dashboard/mode-tabs";
import { DashboardTopBlock } from "@/components/dashboard/top-block";
import type { ModeId } from "@/components/dashboard/types";
import { resolveDashboardTwinGrowth } from "@/components/dashboard/twin-growth-placeholder";
import type { DashboardClientProps } from "@/lib/dashboard/types";
import { buildDashboardTabPresentations } from "@/lib/dashboard/twin-unlock-tab-ui";

export type DashboardShellProps = {
  model: DashboardClientProps;
};

export function DashboardShell({ model }: DashboardShellProps) {
  const [selectedMode, setSelectedMode] = useState<ModeId>("twin");
  const twinGrowthResolved = resolveDashboardTwinGrowth(model);
  const tabPresentations = buildDashboardTabPresentations(twinGrowthResolved);

  return (
    <div data-testid="dashboard-shell-main" className="flex flex-1 flex-col min-h-0 min-w-0">
      <DashboardTopBlock
        avatarStatusText={model.avatarStatusText}
        indicatorPresentation={model.indicatorPresentation}
        totalCompletionPercent={model.totalCompletionPercent}
      />
      <DashboardModeTabs
        tabPresentations={tabPresentations}
        selectedMode={selectedMode}
        onSelectMode={(mode) => {
          setSelectedMode(mode);
        }}
      />
      <div className="flex min-h-[16rem] flex-1 bg-background">
        <DashboardDialogueArea
          model={model}
          tabPresentations={tabPresentations}
          selectedMode={selectedMode}
        />
      </div>
    </div>
  );
}
