import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { WaiaSurface } from "@/components/waia/waia-surface";

describe("WaiaSurface", () => {
  it("renders raised variant with WAIA radius and shadcn bridge tokens", () => {
    render(
      <WaiaSurface variant="raised" data-testid="surface-raised">
        Panel
      </WaiaSurface>,
    );
    const el = screen.getByTestId("surface-raised");
    expect(el).toHaveAttribute("data-slot", "waia-surface");
    expect(el.className).toContain("rounded-waia-surface");
    expect(el.className).toContain("border-border");
    expect(el.className).toContain("bg-muted/10");
  });

  it("renders invitation variant with ceremonial radius and dashed border", () => {
    render(
      <WaiaSurface variant="invitation" data-testid="surface-invitation">
        Invite
      </WaiaSurface>,
    );
    const el = screen.getByTestId("surface-invitation");
    expect(el.className).toContain("rounded-waia-ceremonial");
    expect(el.className).toContain("border-dashed");
    expect(el.className).toContain("bg-muted/20");
  });

  it("renders elevated variant with WAIA semantic tokens", () => {
    render(
      <WaiaSurface variant="elevated" data-testid="surface-elevated">
        Elevated
      </WaiaSurface>,
    );
    const el = screen.getByTestId("surface-elevated");
    expect(el.className).toContain("bg-waia-elevated");
    expect(el.className).toContain("border-waia-divider");
  });

  it("forwards ref to the underlying div", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(
      <WaiaSurface ref={ref} data-testid="surface-ref">
        Ref target
      </WaiaSurface>,
    );
    expect(ref.current).toBe(screen.getByTestId("surface-ref"));
  });
});
