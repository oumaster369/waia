import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DashboardTopBlock } from "@/components/dashboard/top-block";
import { buildIndicatorPresentation } from "@/lib/dashboard/indicator-ui";
import { parseIndicatorVector } from "@/lib/readiness";

describe("DashboardTopBlock", () => {
  it("below 100%: header uses threshold semantics; indicator tiles expose data-threshold only", () => {
    const indicators = parseIndicatorVector([33, 33, 33, 33, 33, 33]);
    const indicatorPresentation = buildIndicatorPresentation(indicators);

    render(
      <DashboardTopBlock
        avatarStatusText="AI-Twin workspace · Test"
        indicatorPresentation={indicatorPresentation}
        totalCompletionPercent={33}
      />,
    );

    const header = screen.getByTestId("dashboard-top-block");
    expect(header).not.toHaveAttribute("data-formation-complete");

    const valuesTile = screen.getByTestId("dashboard-indicator-values");
    expect(valuesTile).toHaveAttribute("data-threshold", "medium");
    expect(valuesTile).not.toHaveAttribute("data-formation-complete");

    expect(screen.getByTestId("dashboard-avatar-status-block")).not.toHaveAttribute(
      "data-formation-complete",
    );
    expect(screen.getByTestId("dashboard-avatar-readiness-percent")).toHaveTextContent("33%");
  });

  it("at 100%: formation-complete data attrs on header, tiles, and avatar block", () => {
    const indicators = parseIndicatorVector([100, 100, 100, 100, 100, 100]);
    const indicatorPresentation = buildIndicatorPresentation(indicators);

    render(
      <DashboardTopBlock
        avatarStatusText="AI-Twin formation complete · Test"
        indicatorPresentation={indicatorPresentation}
        totalCompletionPercent={100}
      />,
    );

    const header = screen.getByTestId("dashboard-top-block");
    expect(header).toHaveAttribute("data-formation-complete", "true");

    const goalsTile = screen.getByTestId("dashboard-indicator-goals");
    expect(goalsTile).toHaveAttribute("data-formation-complete", "true");
    expect(goalsTile).not.toHaveAttribute("data-threshold");

    expect(screen.getByTestId("dashboard-avatar-status-block")).toHaveAttribute(
      "data-formation-complete",
      "true",
    );
    expect(screen.getByTestId("dashboard-avatar-readiness-percent")).toHaveTextContent("100%");
  });
});
