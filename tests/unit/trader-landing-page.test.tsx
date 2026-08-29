import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { TraderLandingPage } from "@/components/trader/public/trader-landing-page";

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

describe("TraderLandingPage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { pathname: "/", search: "" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ google: false, apple: false, telegram: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    routerReplace.mockReset();
  });

  it("renders a minimal Trader-only hero with the real auth form opened in sign-in mode", async () => {
    render(<TraderLandingPage />);

    expect(screen.getByTestId("trader-landing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /See clearly.*Act only when justified/i,
    );
    expect(screen.getByTestId("trader-landing-auth-hero")).toContainElement(
      screen.getByTestId("landing-auth"),
    );
    expect(screen.getByTestId("landing-auth")).toHaveAttribute("data-mode", "signIn");
    expect(screen.getByRole("region", { name: "AI-TRADER authentication" })).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-identity")).toHaveAttribute("type", "email");
    expect(screen.getByTestId("landing-auth-password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.queryByTestId("landing-auth-full-name")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Sign in");
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "https://waia.life/support",
    );

    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-oauth-unavailable")).toBeInTheDocument();
    });
  });

  it("states safety boundaries without fabricated results or secret collection", () => {
    render(<TraderLandingPage />);

    expect(screen.getByTestId("trader-landing-posture")).toHaveTextContent(
      /Paper-first.*live and capital gates remain closed/i,
    );
    expect(document.body).toHaveTextContent(/does not promise profit/i);
    expect(document.body).toHaveTextContent(/Exchange access is configured only after sign-in/i);
    expect(document.body.textContent ?? "").not.toMatch(/API key|secret key|guaranteed return/i);
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "https://waia.life/support",
    );
  });

  it("keeps OAuth error presentation inside the existing authentication component", () => {
    render(<TraderLandingPage initialOauthErrorCode="state_invalid" />);

    expect(screen.getByTestId("landing-auth-error")).toHaveAttribute("role", "alert");
  });
});
