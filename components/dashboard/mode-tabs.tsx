"use client";

import { Button } from "@/components/ui/button";

import type { ModeId } from "@/components/dashboard/types";
import { TAB_ORDER } from "@/components/dashboard/types";
import type { TwinTabPresentation } from "@/lib/dashboard/twin-unlock-tab-ui";

export type DashboardModeTabsProps = {
  selectedMode: ModeId;
  onSelectMode: (mode: ModeId) => void;
  tabPresentations: Record<ModeId, TwinTabPresentation>;
};

export function DashboardModeTabs({
  selectedMode,
  onSelectMode,
  tabPresentations,
}: DashboardModeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Workspace modes"
      data-testid="dashboard-mode-tabs"
      className="flex flex-wrap gap-2 border-border border-b bg-background px-6 py-3"
    >
      {TAB_ORDER.map((id) => {
        const pres = tabPresentations[id];
        const clickable = pres.unlocked;
        const isSelected = selectedMode === id;
        const dataState = clickable ? "unlocked" : "locked";

        const onClick = () => {
          if (!clickable) {
            return;
          }
          onSelectMode(id);
        };

        return (
          <Button
            key={id}
            data-testid={`mode-tab-${id}`}
            data-state={dataState}
            data-phase={pres.phase}
            data-journey-line={pres.journeyLine}
            {...(pres.hint != null ? { "data-hint": pres.hint } : {})}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-disabled={!clickable}
            disabled={!clickable}
            variant={isSelected ? "secondary" : "ghost"}
            size="sm"
            onClick={onClick}
            className={
              !clickable ? "cursor-not-allowed opacity-60 text-muted-foreground" : undefined
            }
          >
            {pres.label}
          </Button>
        );
      })}
    </div>
  );
}
