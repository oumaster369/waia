import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  TwinDialogueWorkspace,
  TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
} from "@/components/dashboard/twin-dialogue-workspace";

describe("TwinDialogueWorkspace POST submit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountWorkspace(hasMeaningfulExchange = false) {
    render(<TwinDialogueWorkspace hasMeaningfulExchange={hasMeaningfulExchange} />);
  }

  it("appends persisted user message and assistant placeholder on 200 response", async () => {
    const userTurn = {
      id: "server-user-turn-id",
      sequence: 42,
      role: "user" as const,
      content: "Hi from test",
      createdAt: "2026-01-02T03:04:05.000Z",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          userTurn,
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    mountWorkspace(false);
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: " Hi from test " },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-msg-user-0")).toHaveTextContent("Hi from test");
    });

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-send")).toHaveAttribute("aria-busy", "false");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "second message" },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userTurn: {
            id: "turn-2",
            sequence: 43,
            role: "user" as const,
            content: "second message",
            createdAt: "2026-01-02T03:05:05.000Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));
    await waitFor(() => expect(screen.getByText("second message")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/twin-dialogue/turn"),
      expect.objectContaining({
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("shows an auth-safe message when the API returns UNAUTHORIZED", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Session required." } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    mountWorkspace(false);
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "lost session" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-dialogue-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dashboard-twin-dialogue-error")).toHaveTextContent(
      /Sign in required to save/i,
    );
    expect(screen.getByTestId("dashboard-twin-message-input")).toHaveValue("lost session");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userTurn: {
            id: "ok-id",
            sequence: 1,
            role: "user",
            content: "lost session",
            createdAt: "2026-01-02T00:00:00.000Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));
    await waitFor(() =>
      expect(screen.queryByTestId("dashboard-twin-dialogue-error")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("lost session")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces EMPTY_MESSAGE envelope from API then succeeds on retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "EMPTY_MESSAGE",
            message: "message must not be empty or whitespace.",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    mountWorkspace(false);
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-dialogue-error")).toHaveTextContent(
        /message must not be empty/i,
      );
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userTurn: {
            id: "fix-id",
            sequence: 11,
            role: "user",
            content: "anything",
            createdAt: "2026-01-02T00:01:00.000Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));
    await waitFor(() =>
      expect(screen.queryByTestId("dashboard-twin-dialogue-error")).not.toBeInTheDocument(),
    );
  });

  it("disables textarea and shows Sending state during request", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchDeferred = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchDeferred as Promise<Response>);

    mountWorkspace(false);
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "blocked" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sending/i })).toBeDisabled();
      expect(screen.getByTestId("dashboard-twin-message-input")).toBeDisabled();
      expect(screen.getByTestId("dashboard-twin-send")).toHaveAttribute("aria-busy", "true");
    });

    resolveFetch!(
      new Response(
        JSON.stringify({
          userTurn: {
            id: "delayed",
            sequence: 99,
            role: "user",
            content: "blocked",
            createdAt: "2026-01-02T00:02:00.000Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-send")).toHaveAttribute("aria-busy", "false");
      expect(screen.getByTestId("dashboard-twin-send")).toHaveTextContent(/^Send$/);
      expect(screen.getByTestId("dashboard-twin-message-input")).not.toBeDisabled();
    });
    expect(screen.getByTestId("dashboard-twin-send")).toBeDisabled();
  });
});
