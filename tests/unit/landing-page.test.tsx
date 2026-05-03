import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthBlock } from "@/components/landing/AuthBlock";
import { LandingPageContent } from "@/components/landing/landing-page-content";

const { mockReplace } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

describe("LandingPage", () => {
  it("renders all five blocks in order", () => {
    render(<LandingPageContent />);
    expect(screen.getByTestId("landing-hero")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth")).toBeInTheDocument();
    expect(screen.getByTestId("landing-context")).toBeInTheDocument();
    expect(screen.getByTestId("landing-modules")).toBeInTheDocument();
    expect(screen.getByTestId("landing-closing")).toBeInTheDocument();
  });

  it("renders the canonical Hero copy verbatim", () => {
    render(<LandingPageContent />);
    expect(screen.getByTestId("landing-hero-tagline")).toHaveTextContent(
      "Между тобой. И тобой.",
    );
    expect(screen.getByTestId("landing-hero-positioning")).toHaveTextContent(
      "WAIA соединяет тебя с тобой, чтобы ты был согласован с другими.",
    );
  });

  it("renders the canonical Context copy verbatim", () => {
    render(<LandingPageContent />);
    expect(screen.getByTestId("landing-context-anchor")).toHaveTextContent(
      "Вы здесь, в пространстве WAIA.",
    );
    expect(screen.getByTestId("landing-context-description")).toHaveTextContent(
      "WAIA — это модульная AI-экосистема: персональный AI-Twin, бизнес-слой, финансовый слой и маркетплейс. Сначала ты создаёшь свой AI-Twin, дальше открываются остальные слои.",
    );
  });

  it("renders the canonical Closing copy verbatim", () => {
    render(<LandingPageContent />);
    expect(screen.getByTestId("landing-closing-anchor")).toHaveTextContent(
      "Всё согласовано.",
    );
    expect(screen.getByTestId("landing-closing-narrative")).toHaveTextContent(
      "Сначала ты согласован с собой, затем с другими, затем с системой. WAIA выстраивает эту последовательность.",
    );
  });

  it("renders all three module cards in fixed order with canonical copy", () => {
    render(<LandingPageContent />);
    const aiTwin = screen.getByTestId("landing-module-ai-twin");
    const business = screen.getByTestId("landing-module-3p-business");
    const marketplace = screen.getByTestId("landing-module-ai-marketplace");
    expect(aiTwin).toBeInTheDocument();
    expect(business).toBeInTheDocument();
    expect(marketplace).toBeInTheDocument();
    expect(
      screen.getByTestId("landing-module-ai-twin-description"),
    ).toHaveTextContent(
      "Твой персональный цифровой двойник, который растёт через диалог и дневник.",
    );
    expect(
      screen.getByTestId("landing-module-3p-business-description"),
    ).toHaveTextContent(
      "Бизнес-слой WAIA по логике Provision, Promotion, Production.",
    );
    expect(
      screen.getByTestId("landing-module-ai-marketplace-description"),
    ).toHaveTextContent(
      "Экономический и маркетплейс-слой WAIA-экосистемы.",
    );
  });

  it("never renders an AI-Trader card per DEE-8 §9.4", () => {
    render(<LandingPageContent />);
    expect(screen.queryByText(/AI-Trader/i)).not.toBeInTheDocument();
  });

  it("renders the canonical Auth Block CTA, divider, and provider buttons", () => {
    render(<LandingPageContent />);
    expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Войти");
    expect(screen.getByTestId("landing-auth-divider")).toHaveTextContent("или");
    expect(screen.getByTestId("landing-auth-provider-google")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-provider-apple")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-provider-telegram")).toBeInTheDocument();
  });
});

describe("AuthBlock state machine", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in VisitorIdle with empty fields and no error", () => {
    render(<AuthBlock />);
    const block = screen.getByTestId("landing-auth");
    expect(block.dataset.status).toBe("VisitorIdle");
    expect(screen.getByTestId("landing-auth-identity")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-password")).toHaveValue("");
    expect(screen.queryByTestId("landing-auth-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-submit")).not.toBeDisabled();
  });

  it("transitions VisitorIdle -> AuthInProgress -> AuthFailure on submit when server rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: "WEAK_PASSWORD" } }), { status: 400 }),
        ),
    );

    render(<AuthBlock />);
    fireEvent.change(screen.getByTestId("landing-auth-identity"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByTestId("landing-auth-password"), {
      target: { value: "short" },
    });

    fireEvent.click(screen.getByTestId("landing-auth-submit"));

    const block = screen.getByTestId("landing-auth");
    expect(block.dataset.status).toBe("AuthInProgress");

    await waitFor(() => {
      expect(block.dataset.status).toBe("AuthFailure");
    });

    expect(screen.getByTestId("landing-auth-error")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-identity")).toHaveValue("test@example.com");
    expect(screen.getByTestId("landing-auth-password")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-submit")).not.toBeDisabled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects to dashboard when sign-in succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, redirect: "/dashboard" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    render(<AuthBlock />);
    fireEvent.change(screen.getByTestId("landing-auth-identity"), {
      target: { value: "ok@example.com" },
    });
    fireEvent.change(screen.getByTestId("landing-auth-password"), {
      target: { value: "password12" },
    });
    fireEvent.click(screen.getByTestId("landing-auth-submit"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("OAuth stub", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("transitions to AuthInProgress when an OAuth provider button is clicked", () => {
      render(<AuthBlock />);
      fireEvent.click(screen.getByTestId("landing-auth-provider-telegram"));
      const block = screen.getByTestId("landing-auth");
      expect(block.dataset.status).toBe("AuthInProgress");
      expect(screen.getByTestId("landing-auth-provider-telegram")).toBeDisabled();
    });

    it("falls through to AuthFailure after OAuth stub timer", () => {
      render(<AuthBlock />);
      fireEvent.click(screen.getByTestId("landing-auth-provider-telegram"));
      act(() => {
        vi.runAllTimers();
      });
      expect(screen.getByTestId("landing-auth").dataset.status).toBe("AuthFailure");
    });
  });
});
