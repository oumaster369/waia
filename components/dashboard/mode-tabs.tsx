"use client";

import { Button } from "@/components/ui/button";

import type { ModeId } from "@/components/dashboard/types";

export type DashboardModeTabsProps = {
  selectedMode: ModeId;
  onSelectMode: (mode: ModeId) => void;
  diaryLocked: boolean;
  societyLocked: boolean;
};

export function DashboardModeTabs({
  selectedMode,
  onSelectMode,
  diaryLocked,
  societyLocked,
}: DashboardModeTabsProps) {
  const tabs: { id: ModeId; label: string; locked: boolean }[] = [
    { id: "twin", label: "Twin", locked: false },
    { id: "diary", label: "Diary", locked: diaryLocked },
    { id: "society", label: "Society", locked: societyLocked },
  ];

  return (
    <div
      role="tablist"
      aria-label="Workspace modes"
      data-testid="dashboard-mode-tabs"
      className="flex flex-wrap gap-2 border-border border-b bg-background px-6 py-3"
    >
      {tabs.map((tab) => {
        const isSelected = selectedMode === tab.id;
        const onClick = () => {
          if (tab.locked) {
            return;
          }
          onSelectMode(tab.id);
        };

        return (
          <Button
            key={tab.id}
            data-testid={`mode-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-disabled={tab.locked}
            disabled={tab.locked}
            variant={isSelected ? "secondary" : "ghost"}
            size="sm"
            onClick={onClick}
            className={tab.locked ? "opacity-70" : undefined}
          >
            {tab.label}
            {tab.locked ? " (locked)" : ""}
          </Button>
        );
      })}
    </div>
  );
}
