import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TwinMobileDisclosure } from "@/components/dashboard/twin-mobile-disclosure";

describe("Twin mobile disclosure", () => {
  it("connects its control to a single mounted panel and preserves child state", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(
      <TwinMobileDisclosure label="Twin progress">
        <input aria-label="Synthetic retained state" defaultValue="Unsent thought" />
      </TwinMobileDisclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Twin progress" });
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveClass("hidden", "md:block");
    const input = screen.getByLabelText("Synthetic retained state");
    fireEvent.change(input, { target: { value: "Keep me" } });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveClass("hidden");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Synthetic retained state")).toBe(input);
    expect(input).toHaveValue("Keep me");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes on Escape from inside and restores focus to its own control", () => {
    render(
      <TwinMobileDisclosure label="WAIA menu">
        <a href="/dashboard">My Twin</a>
      </TwinMobileDisclosure>,
    );
    const trigger = screen.getByRole("button", { name: "WAIA menu" });
    fireEvent.click(trigger);
    const link = screen.getByRole("link");
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("keeps navigation and progress disclosure independent with unique ids", () => {
    render(
      <>
        <TwinMobileDisclosure label="WAIA menu">Navigation</TwinMobileDisclosure>
        <TwinMobileDisclosure label="Twin progress">Indicators</TwinMobileDisclosure>
      </>,
    );
    const menu = screen.getByRole("button", { name: "WAIA menu" });
    const progress = screen.getByRole("button", { name: "Twin progress" });
    expect(menu.getAttribute("aria-controls")).not.toBe(progress.getAttribute("aria-controls"));
    fireEvent.click(menu);
    expect(progress).toHaveAttribute("aria-expanded", "false");
  });
});
