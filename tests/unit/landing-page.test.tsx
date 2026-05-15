import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthBlock } from "@/components/landing/AuthBlock";
import { LandingPageContent } from "@/components/landing/landing-page-content";

const { mockReplace, mockLocationAssign } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockLocationAssign: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oauthAvailableResponse() {
  return jsonResponse({ google: true, apple: true, telegram: true }, 200);
}

function fetchWithOauthAvailability(
  resolver: (input: RequestInfo | URL) => Response | Promise<Response>,
) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/auth/oauth/availability")) {
      return Promise.resolve(oauthAvailableResponse());
    }
    return Promise.resolve(resolver(input));
  });
}

describe("LandingPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability(() => {
        throw new Error("Unexpected fetch in LandingPage test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderLandingPage() {
    render(<LandingPageContent />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-divider")).toBeInTheDocument();
    });
  }

  it("renders all five blocks in order", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-hero")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth")).toBeInTheDocument();
    expect(screen.getByTestId("landing-context")).toBeInTheDocument();
    expect(screen.getByTestId("landing-modules")).toBeInTheDocument();
    expect(screen.getByTestId("landing-closing")).toBeInTheDocument();
  });

  it("renders the canonical Hero copy", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-hero-tagline")).toHaveTextContent("Between you and you");
    expect(screen.getByTestId("landing-hero-positioning")).toHaveTextContent(
      /blur between thought and feeling/i,
    );
  });

  it("renders the canonical Context copy", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-context-anchor")).toHaveTextContent(
      "You're in the WAIA space.",
    );
    expect(screen.getByTestId("landing-context-description")).toHaveTextContent(/modular AI ecosystem/i);
  });

  it("renders the canonical Closing copy", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-closing-anchor")).toHaveTextContent("Stay aligned.");
    expect(screen.getByTestId("landing-closing-narrative")).toHaveTextContent(
      /First with yourself/i,
    );
  });

  it("renders all three module cards in fixed order with canonical copy", async () => {
    await renderLandingPage();
    const aiTwin = screen.getByTestId("landing-module-ai-twin");
    const business = screen.getByTestId("landing-module-3p-business");
    const marketplace = screen.getByTestId("landing-module-ai-marketplace");
    expect(aiTwin).toBeInTheDocument();
    expect(business).toBeInTheDocument();
    expect(marketplace).toBeInTheDocument();
    expect(screen.getByTestId("landing-module-ai-twin-description")).toHaveTextContent(/personal digital twin/i);
    expect(screen.getByTestId("landing-module-3p-business-description")).toHaveTextContent(
      /Provision, Promotion, and Production/i,
    );
    expect(screen.getByTestId("landing-module-ai-marketplace-description")).toHaveTextContent(
      /economic and marketplace/i,
    );
  });

  it("never renders an AI-Trader card per DEE-8 §9.4", async () => {
    await renderLandingPage();
    expect(screen.queryByText(/AI-Trader/i)).not.toBeInTheDocument();
  });

  it("renders Create Twin as default email CTA plus OAuth when availability returns providers", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create Twin");
    expect(screen.getByTestId("landing-auth-divider")).toHaveTextContent(/or continue with/i);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts in VisitorIdle with empty fields and no error", async () => {
    vi.stubGlobal("fetch", fetchWithOauthAvailability(() => oauthAvailableResponse()));

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-provider-google")).toBeInTheDocument();
    });
    const block = screen.getByTestId("landing-auth");
    expect(block.dataset.status).toBe("VisitorIdle");
    expect(block.dataset.mode).toBe("createTwin");
    expect(screen.getByTestId("landing-auth-display-name")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-identity")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-password")).toHaveValue("");
    expect(screen.queryByTestId("landing-auth-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-submit")).not.toBeDisabled();
  });

  it("transitions VisitorIdle -> AuthInProgress -> AuthFailure on sign-up rejection in Create mode", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability((input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/sign-up")) {
          return jsonResponse({ error: { code: "WEAK_PASSWORD" } }, 400);
        }
        return oauthAvailableResponse();
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create Twin");
    });
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
    expect(screen.getByTestId("landing-auth-error")).toHaveTextContent(/at least 8 characters/i);
    expect(screen.getByTestId("landing-auth-identity")).toHaveValue("test@example.com");
    expect(screen.getByTestId("landing-auth-password")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-submit")).not.toBeDisabled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("navigates after sign-up success from Create mode", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability((input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/sign-up")) {
          return jsonResponse({ ok: true, redirect: "/dashboard" }, 201);
        }
        return oauthAvailableResponse();
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create Twin");
    });
    fireEvent.change(screen.getByTestId("landing-auth-identity"), {
      target: { value: "ok@example.com" },
    });
    fireEvent.change(screen.getByTestId("landing-auth-password"), {
      target: { value: "password12" },
    });
    fireEvent.click(screen.getByTestId("landing-auth-submit"));

    const block = screen.getByTestId("landing-auth");

    await waitFor(() => {
      expect(block.dataset.status).toBe("AuthenticatedRedirect");
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("transitions to Sign in mode and uses sign-in-only flow", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability((input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/sign-in")) {
          return jsonResponse({ ok: true, redirect: "/dashboard" }, 200);
        }
        return oauthAvailableResponse();
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-mode-sign-in")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("landing-auth-mode-sign-in"));

    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Sign in");
    });

    fireEvent.change(screen.getByTestId("landing-auth-identity"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.change(screen.getByTestId("landing-auth-password"), {
      target: { value: "securepass12" },
    });
    fireEvent.click(screen.getByTestId("landing-auth-submit"));

    const block = screen.getByTestId("landing-auth");

    await waitFor(() => {
      expect(block.dataset.status).toBe("AuthenticatedRedirect");
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/auth/sign-in", expect.any(Object));
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).not.toContain("/api/auth/sign-up");
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("surfaces oauth_error query param and clears it with replaceState", async () => {
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: {
        pathname: "/",
        search: "?oauth_error=OAUTH_DENIED",
      },
    });

    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability(() => {
        throw new Error("Unexpected fetch");
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("landing-auth-error").textContent).toMatch(/cancelled|isn/i);
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("shows email confirmation notice and switches to Sign in after sign-up needs confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability((input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/sign-up")) {
          return jsonResponse(
            { ok: true, needsEmailConfirmation: true, redirect: "/dashboard" },
            201,
          );
        }
        return oauthAvailableResponse();
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create Twin");
    });
    fireEvent.change(screen.getByTestId("landing-auth-identity"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByTestId("landing-auth-password"), {
      target: { value: "password12" },
    });
    fireEvent.click(screen.getByTestId("landing-auth-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-email-confirmation")).toBeInTheDocument();
    });
    const block = screen.getByTestId("landing-auth");
    expect(block.dataset.mode).toBe("signIn");
    expect(block.dataset.status).toBe("VisitorIdle");
    expect(screen.queryByTestId("landing-auth-error")).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows password policy hint only in Create Twin mode", async () => {
    vi.stubGlobal("fetch", fetchWithOauthAvailability(() => oauthAvailableResponse()));

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-provider-google")).toBeInTheDocument();
    });
    expect(screen.getByTestId("landing-auth-password-policy-hint")).toHaveTextContent(/8 characters/);
    fireEvent.click(screen.getByTestId("landing-auth-mode-sign-in"));
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Sign in");
    });
    expect(screen.queryByTestId("landing-auth-password-policy-hint")).not.toBeInTheDocument();
  });

  it("shows neutral copy when OAuth availability fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/oauth/availability")) {
          return Promise.reject(new Error("network"));
        }
        return Promise.reject(new Error("Unexpected fetch"));
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-oauth-availability-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("landing-auth-oauth-availability-error")).toHaveTextContent(
      /Couldn.*t load sign-in options/i,
    );
    expect(screen.queryByTestId("landing-auth-oauth-unavailable")).not.toBeInTheDocument();
  });

  it("shows preview message when server reports all OAuth providers disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/oauth/availability")) {
          return Promise.resolve(
            jsonResponse({ google: false, apple: false, telegram: false }, 200),
          );
        }
        return Promise.reject(new Error("Unexpected fetch"));
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-oauth-unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("landing-auth-oauth-availability-error")).not.toBeInTheDocument();
  });

  describe("OAuth start navigation", () => {
    beforeEach(() => {
      mockLocationAssign.mockClear();
      vi.stubGlobal("fetch", fetchWithOauthAvailability(() => oauthAvailableResponse()));
      vi.stubGlobal("location", {
        assign: mockLocationAssign,
        replace: vi.fn(),
        reload: vi.fn(),
        href: "http://localhost/",
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const providerCases = [
      ["Google", "google"],
      ["Apple ID", "apple"],
      ["Telegram", "telegram"],
    ] as const;

    providerCases.forEach(([label, provider]) => {
      it(`assigns ${label} SSO to the WAIA OAuth start route`, async () => {
        render(<AuthBlock />);
        await waitFor(() => {
          expect(screen.getByTestId(`landing-auth-provider-${provider}`)).toBeInTheDocument();
        });
        fireEvent.click(screen.getByTestId(`landing-auth-provider-${provider}`));
        expect(screen.getByTestId("landing-auth").dataset.status).toBe("AuthInProgress");
        expect(mockLocationAssign).toHaveBeenCalledWith(`/api/auth/oauth/${provider}/start`);
      });
    });
  });
});
