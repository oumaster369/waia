import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwinDialogueWorkspace } from "@/components/dashboard/twin-dialogue-workspace";

describe("optional Twin product guide", () => {
  afterEach(() => vi.restoreAllMocks());
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Using WAIA" }));
  it("opens without starting formation or sending a message", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<TwinDialogueWorkspace hasMeaningfulExchange={false} />);
    open();
    const guide = screen.getByRole("region", { name: "Using WAIA" });
    expect(guide).toBeVisible();
    expect(within(guide).getByRole("heading", { name: "Using WAIA" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Message to Twin" })).toBeDisabled();
    expect(screen.getByRole("log")).not.toContainElement(guide);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves unsent draft and saved history, returning focus on close", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(
      <TwinDialogueWorkspace
        hasMeaningfulExchange
        initialTwinDialogueTurns={[{ id: "saved", role: "user", text: "Existing thought" }]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Message to Twin" });
    fireEvent.change(input, { target: { value: "An unsent thought" } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Messages and retries" }));
    expect(screen.getByRole("heading", { name: "When a message does not send" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Return to conversation" }));
    expect(screen.queryByRole("region", { name: "Using WAIA" })).not.toBeInTheDocument();
    expect(input).toHaveValue("An unsent thought");
    expect(screen.getByRole("log")).toHaveTextContent("Existing thought");
    expect(screen.getByRole("button", { name: "Using WAIA" })).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("closes with Escape and does not promote planned features", () => {
    render(<TwinDialogueWorkspace hasMeaningfulExchange />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Other features" }));
    const guide = screen.getByRole("region", { name: "Using WAIA" });
    expect(guide).toHaveTextContent("not a live social network");
    expect(guide).toHaveTextContent("not available from this guide");
    expect(guide.querySelector("a")).toBeNull();
    fireEvent.keyDown(guide, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Using WAIA" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Using WAIA" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
  it("explains progress without granting completeness, authority or billing", () => {
    render(<TwinDialogueWorkspace hasMeaningfulExchange />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Progress and privacy" }));
    expect(screen.getByRole("region", { name: "Using WAIA" })).toHaveTextContent(
      "not a measure of your worth",
    );
    fireEvent.click(screen.getByRole("button", { name: "Costs and subscription" }));
    expect(screen.getByRole("region", { name: "Using WAIA" })).toHaveTextContent(
      "explicit confirmation",
    );
    expect(screen.getByRole("note", { name: "AI Twin subscription terms" })).toBeVisible();
  });
});
