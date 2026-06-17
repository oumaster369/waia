import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  TwinDialogueWorkspace,
  TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
  TWIN_FIRST_START_FRAMING_COPY,
  TWIN_OPENING_WELCOME_MESSAGE,
  TWIN_PENDING_REPLY_LABEL,
} from "@/components/dashboard/twin-dialogue-workspace";

const FORBIDDEN_UI_DENYLIST = [
  "journey",
  "adventure",
  "discover",
  "soul",
  "awaken",
  "true self",
  "destiny",
  "meant to",
  "calling",
  "energy",
  "story begins",
  "how can i help",
  "let's get started",
  "i'm here to help",
  "your safe space",
  "supports 100+",
  "100+ languages",
  "ai-powered",
] as const;

function assertDenylistAbsent(raw: string): void {
  const lower = raw.toLowerCase();
  for (const t of FORBIDDEN_UI_DENYLIST) {
    expect(lower).not.toContain(t);
  }
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("TwinDialogueWorkspace POST submit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountWorkspace(hasMeaningfulExchange = false, initialTwinDialogueTurns = []) {
    render(
      <TwinDialogueWorkspace
        hasMeaningfulExchange={hasMeaningfulExchange}
        initialTwinDialogueTurns={initialTwinDialogueTurns}
      />,
    );
  }

  function clickStartRitual() {
    fireEvent.click(screen.getByTestId("dashboard-twin-start-cta"));
  }

  it("first-start framing and welcome copy avoid doctrine-forbidden phrasing", () => {
    mountWorkspace(false);
    const inv = screen.getByTestId("dashboard-twin-invitation-placeholder");
    assertDenylistAbsent(inv.textContent ?? "");
    assertDenylistAbsent(TWIN_FIRST_START_FRAMING_COPY);
    assertDenylistAbsent(TWIN_OPENING_WELCOME_MESSAGE);
    assertDenylistAbsent(TWIN_PENDING_REPLY_LABEL);

    const lower = (inv.textContent ?? "").toLowerCase();
    expect(lower).not.toContain("stub");
    expect(inv.textContent ?? "").not.toContain("stream here once wired");
    expect(inv.textContent ?? "").not.toContain("dialogue service connects");

    clickStartRitual();
    const welcome = screen.getByTestId("dashboard-twin-welcome-bubble");
    expect(normalizeWs(welcome.textContent ?? "")).toBe(normalizeWs(TWIN_OPENING_WELCOME_MESSAGE));
    assertDenylistAbsent(welcome.textContent ?? "");
  });

  it("shows Start CTA when no meaningful exchange and no persisted turns; hides after meaningful exchange", () => {
    const { unmount } = render(<TwinDialogueWorkspace hasMeaningfulExchange={false} />);
    expect(screen.getByTestId("dashboard-twin-start-cta")).toBeInTheDocument();
    unmount();
    render(<TwinDialogueWorkspace hasMeaningfulExchange />);
    expect(screen.queryByTestId("dashboard-twin-start-cta")).not.toBeInTheDocument();
  });

  it("clicking Start shows welcome bubble, focuses textarea, and hides invitation card", async () => {
    mountWorkspace(false);
    const input = screen.getByRole("textbox", { name: "Message to Twin" });
    expect(input).toBeDisabled();
    clickStartRitual();
    expect(screen.queryByTestId("dashboard-twin-invitation-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-welcome-bubble")).toBeInTheDocument();
    expect(screen.getByLabelText("Twin")).toBeInTheDocument();
    expect(input).not.toBeDisabled();
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(screen.getByTestId("dashboard-twin-message-list")).toHaveAttribute(
      "data-slot",
      "waia-surface",
    );
  });

  it("does not send welcome text in the Twin turn POST body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          userTurn: {
            id: "u1",
            sequence: 1,
            role: "user",
            content: "e2e-safe-user-payload-xyz",
            createdAt: "2026-01-02T03:04:05.000Z",
          },
          assistantTurn: {
            id: "a1",
            sequence: 2,
            role: "assistant",
            content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
            createdAt: "2026-01-02T03:04:05.010Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    mountWorkspace(false);
    clickStartRitual();
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "e2e-safe-user-payload-xyz" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const opts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(opts.body)) as { message: string };
    expect(body.message).toBe("e2e-safe-user-payload-xyz");
    expect(body.message).not.toContain("Welcome.");
    expect(String(opts.body)).not.toContain("address you");
  });

  it("does not show welcome bubble when SSR seeds initial turns", () => {
    render(
      <TwinDialogueWorkspace
        hasMeaningfulExchange={false}
        initialTwinDialogueTurns={[{ id: "seed-u", role: "user", text: "From SSR" }]}
      />,
    );
    expect(screen.queryByTestId("dashboard-twin-welcome-bubble")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-twin-start-cta")).not.toBeInTheDocument();
  });

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
          assistantTurn: {
            id: "server-assistant-turn-id",
            sequence: userTurn.sequence + 1,
            role: "assistant",
            content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
            createdAt: "2026-01-02T03:04:05.010Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    mountWorkspace(false);
    clickStartRitual();
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
          assistantTurn: {
            id: "turn-2-asst",
            sequence: 44,
            role: "assistant" as const,
            content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
            createdAt: "2026-01-02T03:05:05.010Z",
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Session required." } }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userTurn: {
              id: "ok-id",
              sequence: 1,
              role: "user",
              content: "lost session",
              createdAt: "2026-01-02T00:00:00.000Z",
            },
            assistantTurn: {
              id: "ok-asst",
              sequence: 2,
              role: "assistant",
              content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
              createdAt: "2026-01-02T00:00:00.010Z",
            },
            twinSignals: { hasMeaningfulExchange: true },
            assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    mountWorkspace(false);
    clickStartRitual();
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
    expect(screen.getByTestId("dashboard-twin-message-input")).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("dashboard-twin-dialogue-error")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("lost session")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces EMPTY_MESSAGE envelope from API then succeeds on retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "EMPTY_MESSAGE",
              message: "message must not be empty or whitespace.",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userTurn: {
              id: "fix-id",
              sequence: 11,
              role: "user",
              content: "anything",
              createdAt: "2026-01-02T00:01:00.000Z",
            },
            assistantTurn: {
              id: "fix-asst",
              sequence: 12,
              role: "assistant",
              content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
              createdAt: "2026-01-02T00:01:00.010Z",
            },
            twinSignals: { hasMeaningfulExchange: true },
            assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    mountWorkspace(false);
    clickStartRitual();
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-dialogue-error")).toHaveTextContent(
        /message must not be empty/i,
      );
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument());

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(screen.queryByTestId("dashboard-twin-dialogue-error")).not.toBeInTheDocument(),
    );
  });

  it("user bubble appears immediately, input clears, pending indicator visible while request in flight", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchDeferred = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(fetchDeferred as Promise<Response>);

    mountWorkspace(false);
    clickStartRitual();
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "blocked" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    expect(screen.getByTestId("dashboard-twin-msg-user-0")).toHaveTextContent("blocked");
    expect(screen.getByTestId("dashboard-twin-message-input")).toHaveValue("");
    expect(screen.getByTestId("dashboard-twin-pending-reply")).toHaveTextContent(
      TWIN_PENDING_REPLY_LABEL,
    );
    expect(screen.getByTestId("dashboard-twin-pending-reply")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Sending$/ })).toBeDisabled();
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
          assistantTurn: {
            id: "delayed-asst",
            sequence: 100,
            role: "assistant",
            content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
            createdAt: "2026-01-02T00:02:00.010Z",
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
    expect(screen.queryByTestId("dashboard-twin-pending-reply")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-twin-msg-user-0")).not.toHaveAttribute("data-pending");
    expect(screen.getByTestId("dashboard-twin-send")).toBeDisabled();
  });

  it("on failure marks user bubble with data-failed and Retry resubmits with same idempotency key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "no" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    mountWorkspace(false);
    clickStartRitual();
    fireEvent.change(screen.getByTestId("dashboard-twin-message-input"), {
      target: { value: "once" },
    });
    fireEvent.click(screen.getByTestId("dashboard-twin-send"));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-twin-msg-user-0")).toHaveAttribute(
        "data-failed",
        "true",
      );
    });

    const firstBody = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)) as {
      message: string;
      idempotencyKey: string;
    };
    const idem = firstBody.idempotencyKey;

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userTurn: {
            id: "srv-u",
            sequence: 1,
            role: "user",
            content: "once",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          assistantTurn: {
            id: "srv-a",
            sequence: 2,
            role: "assistant",
            content: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
            createdAt: "2026-01-01T00:00:00.001Z",
          },
          twinSignals: { hasMeaningfulExchange: true },
          assistantPlaceholder: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    fireEvent.click(screen.getByTestId(`dashboard-twin-retry-${idem}`));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const secondBody = JSON.parse(String((fetchSpy.mock.calls[1]?.[1] as RequestInit).body)) as {
      idempotencyKey: string;
    };
    expect(secondBody.idempotencyKey).toBe(idem);
  });

  it("renders persisted initial turns from initialTwinDialogueTurns", () => {
    render(
      <TwinDialogueWorkspace
        hasMeaningfulExchange
        initialTwinDialogueTurns={[
          { id: "seed-u", role: "user", text: "From SSR" },
          { id: "seed-a", role: "assistant", text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE },
        ]}
      />,
    );

    expect(screen.getByText("From SSR")).toBeInTheDocument();
    expect(screen.getByText(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-twin-invitation-placeholder")).not.toBeInTheDocument();
  });
});
