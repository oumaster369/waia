"use client";

import { useState } from "react";

import { DashboardDialogueArea } from "@/components/dashboard/dialogue-area";
import { DashboardModeTabs } from "@/components/dashboard/mode-tabs";
import { DashboardTopBlock } from "@/components/dashboard/top-block";
import type { DashboardShellDemoSnapshot, ModeId } from "@/components/dashboard/types";

export type DashboardShellProps = {
  snapshot: DashboardShellDemoSnapshot;
};

export function DashboardShell({ snapshot }: DashboardShellProps) {
  const [selectedMode, setSelectedMode] = useState<ModeId>("twin");
  const diaryLocked = snapshot.totalCompletionPercent < 60;
  const societyLocked = !snapshot.socializationCompleted;

  return (
    <div data-testid="dashboard-shell-main" className="flex flex-1 flex-col min-h-0 min-w-0">
      <DashboardTopBlock snapshot={snapshot} />
      <DashboardModeTabs
        diaryLocked={diaryLocked}
        societyLocked={societyLocked}
        selectedMode={selectedMode}
        onSelectMode={(mode) => {
          setSelectedMode(mode);
        }}
      />
      <div className="flex min-h-[16rem] flex-1 bg-background">
        <DashboardDialogueArea snapshot={snapshot} selectedMode={selectedMode} />
      </div>
    </div>
  );
}
