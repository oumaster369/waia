"use client";

import { useState } from "react";

import { DashboardDialogueArea } from "@/components/dashboard/dialogue-area";
import { DashboardModeTabs } from "@/components/dashboard/mode-tabs";
import { DashboardTopBlock } from "@/components/dashboard/top-block";
import type { DashboardClientProps } from "@/lib/dashboard/types";
import type { ModeId } from "@/components/dashboard/types";

export type DashboardShellProps = {
  model: DashboardClientProps;
};

export function DashboardShell({ model }: DashboardShellProps) {
  const [selectedMode, setSelectedMode] = useState<ModeId>("twin");

  return (
    <div data-testid="dashboard-shell-main" className="flex flex-1 flex-col min-h-0 min-w-0">
      <DashboardTopBlock
        indicators={model.indicators}
        totalCompletionPercent={model.totalCompletionPercent}
      />
      <DashboardModeTabs
        diaryTabUnlocked={model.diaryTabUnlocked}
        societyTabUnlocked={model.societyTabUnlocked}
        selectedMode={selectedMode}
        onSelectMode={(mode) => {
          setSelectedMode(mode);
        }}
      />
      <div className="flex min-h-[16rem] flex-1 bg-background">
        <DashboardDialogueArea model={model} selectedMode={selectedMode} />
      </div>
    </div>
  );
}
