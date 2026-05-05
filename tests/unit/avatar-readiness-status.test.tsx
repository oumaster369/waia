import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AvatarReadinessStatusBlock } from "@/components/dashboard/avatar-readiness-status";

describe("AvatarReadinessStatusBlock", () => {
  it("renders circular avatar placeholder with label", () => {
    render(
      <AvatarReadinessStatusBlock
        statusText="Status line"
        readinessPercent={50}
        placeholderLabel="Photo soon"
      />,
    );
    const placeholder = screen.getByTestId("dashboard-avatar-placeholder");
    expect(placeholder).toHaveClass("rounded-full");
    expect(placeholder).toHaveAttribute("aria-label", "Photo soon");
    expect(screen.getByTestId("dashboard-avatar-status-block")).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("Photo soon");
  });

  it("renders status text", () => {
    render(
      <AvatarReadinessStatusBlock statusText="AI-Twin workspace · Alex" readinessPercent={33} />,
    );
    expect(screen.getByTestId("dashboard-avatar-status-text")).toHaveTextContent(
      "AI-Twin workspace · Alex",
    );
  });

  it("renders readiness percent rounded and clamped", () => {
    const { rerender } = render(
      <AvatarReadinessStatusBlock statusText="x" readinessPercent={41.7} />,
    );
    expect(screen.getByTestId("dashboard-avatar-readiness-percent")).toHaveTextContent("42%");

    rerender(<AvatarReadinessStatusBlock statusText="x" readinessPercent={150} />);
    expect(screen.getByTestId("dashboard-avatar-readiness-percent")).toHaveTextContent("100%");

    rerender(<AvatarReadinessStatusBlock statusText="x" readinessPercent={NaN} />);
    expect(screen.getByTestId("dashboard-avatar-readiness-percent")).toHaveTextContent("0%");
  });

  it("applies formation-complete chrome when isFormationComplete", () => {
    render(
      <AvatarReadinessStatusBlock
        statusText="AI-Twin formation complete · Alex"
        readinessPercent={100}
        isFormationComplete
      />,
    );
    const block = screen.getByTestId("dashboard-avatar-status-block");
    expect(block).toHaveAttribute("data-formation-complete", "true");

    const placeholder = screen.getByTestId("dashboard-avatar-placeholder");
    expect(placeholder).toHaveClass("ring-2");
    expect(placeholder).toHaveClass("rounded-full");

    expect(screen.getByTestId("dashboard-avatar-status-text")).toHaveClass("font-medium");
  });
});
