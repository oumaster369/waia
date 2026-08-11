import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthBlock } from "@/components/landing/AuthBlock";
import { LandingPageContent } from "@/components/landing/landing-page-content";
import { BreathRunwayPulse } from "@/components/landing/visuals/breath-runway-pulse";
import { getBreathPublicSnapshot } from "@/lib/landing/breath-public";
import { LEGCO_RESEARCH_URL, WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const { mockReplace, mockLocationAssign, routerStub } = vi.hoisted(() => {
  const mockReplace = vi.fn();
  return {
    mockReplace,
    mockLocationAssign: vi.fn(),
    routerStub: { replace: mockReplace },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
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
    mockReplace.mockClear();
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: {
        pathname: "/",
        search: "",
      },
    });
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

  it("renders hero definition, auth, Breath, and core narrative sections", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-hero")).toBeInTheDocument();
    expect(screen.getByTestId("landing-hero-definition-text")).toHaveTextContent(
      /human-centered AI environment/i,
    );
    expect(screen.getByTestId("landing-auth")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath")).toBeInTheDocument();
    expect(screen.getByTestId("landing-ai-twin")).toBeInTheDocument();
    expect(screen.getByTestId("landing-living-legacy")).toBeInTheDocument();
    expect(screen.getByTestId("landing-society")).toBeInTheDocument();
    expect(screen.getByTestId("landing-ai-trader")).toBeInTheDocument();
    expect(screen.getByTestId("landing-epistemic")).toBeInTheDocument();
    expect(screen.getByTestId("landing-how-built")).toBeInTheDocument();
    expect(screen.getByTestId("landing-final-cta")).toBeInTheDocument();
  });

  it("loads prepared hero web assets (desktop fallback + mobile source)", async () => {
    await renderLandingPage();
    const img = screen.getByTestId("landing-hero-image");
    expect(img).toHaveAttribute("src", "/brand/heap_comp_1.webp");
    const mobileSource = screen.getByTestId("landing-hero-source-mobile");
    expect(mobileSource).toHaveAttribute("srcset", "/brand/head_mobile_1.webp");
  });

  it("exposes Breath pending contract without invented financial figures", async () => {
    await renderLandingPage();
    const snapshot = getBreathPublicSnapshot();
    expect(snapshot.status).toBe("pending");
    expect(snapshot.resources.entered).toBeNull();
    expect(screen.getByTestId("landing-breath-status")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("landing-breath-resource-entered")).toHaveTextContent(
      /Not yet published/i,
    );
    expect(screen.getByTestId("landing-breath-github-primary")).toHaveAttribute(
      "href",
      WAIA_PUBLIC_GITHUB_URL,
    );
    expect(screen.getByTestId("landing-breath-github-secondary")).toHaveAttribute(
      "href",
      WAIA_PUBLIC_GITHUB_URL,
    );
  });

  it("links LEGCO research and GitHub from How WAIA Is Built and final CTA", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-how-built-legco-cta")).toHaveAttribute(
      "href",
      LEGCO_RESEARCH_URL,
    );
    expect(screen.getByTestId("landing-how-built-github-cta")).toHaveAttribute(
      "href",
      WAIA_PUBLIC_GITHUB_URL,
    );
    expect(screen.getByTestId("landing-final-cta-register")).toHaveAttribute("href", "#register");
    expect(screen.getByTestId("landing-final-cta-breath")).toHaveAttribute(
      "href",
      "#breath-of-waia",
    );
    expect(screen.getByTestId("landing-breath-interstitial-cta")).toHaveAttribute(
      "href",
      "#breath-of-waia",
    );
  });

  it("renders AI-TRADER with Product Constitution claim discipline", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-ai-trader-identity")).toHaveTextContent(
      /knowledge|observation becomes hypothesis/i,
    );
    expect(screen.getByTestId("landing-ai-trader-restraint")).toHaveTextContent(
      /not trading is the correct outcome/i,
    );
    expect(screen.getByTestId("landing-ai-trader-boundary")).toHaveTextContent(
      /No promise of profit/i,
    );
    expect(screen.queryByTestId("landing-ai-trader-readiness-percent")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-ai-trader-readiness-scale")).toBeInTheDocument();
  });

  it("does not render fabricated readiness percentages anywhere on the homepage", async () => {
    await renderLandingPage();
    expect(document.body.textContent || "").not.toMatch(/\d+%/);
    expect(screen.queryByTestId("landing-ai-twin-readiness-percent")).not.toBeInTheDocument();
  });

  it("renders qualitative maturity facets for AI-TWIN", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-ai-twin-readiness-label")).toHaveTextContent(/Operational/i);
    expect(screen.getByTestId("landing-ai-twin-progression")).toHaveTextContent(
      /Mirror → Model → Observer → Co-Researcher/,
    );
    expect(screen.getByTestId("landing-ai-twin-purpose")).toHaveTextContent(/co-researcher/i);
  });

  it("renders corrected 3P, Marketplace, and Breath contract surfaces", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-business-3p-provision")).toHaveTextContent(
      /Market research/i,
    );
    expect(screen.getByTestId("landing-business-3p-promotion")).toHaveTextContent(
      /Marketing strategy/i,
    );
    expect(screen.getByTestId("landing-business-3p-production")).toHaveTextContent(
      /Product and service creation/i,
    );
    expect(screen.getByTestId("landing-ai-marketplace-waia-path")).toHaveTextContent(/Need →/i);
    expect(screen.getByTestId("landing-breath-stage")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-budget")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-runway")).toHaveAttribute(
      "data-runway-state",
      "pending",
    );
    expect(screen.getByTestId("landing-breath-runway-value")).toHaveTextContent(
      /Runway awaiting first ledger publication/i,
    );
    expect(screen.getByTestId("landing-breath-runway-pulse")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-runway-svg")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-runway-wave")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-runway-wave").getAttribute("d")).toMatch(/c /i);
    expect(screen.getByTestId("landing-breath-runway-now")).toHaveTextContent(/^NOW$/i);
    expect(screen.getByTestId("landing-breath-runway-end")).toHaveTextContent(/^RUNWAY$/i);
    expect(screen.getByTestId("landing-breath-runway-ticks-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-breath-runway-ticks")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-runway")).not.toHaveAttribute("data-runway-percent");
    expect(screen.getByTestId("landing-breath-updated-value")).toHaveTextContent(
      /Awaiting first ledger publication/i,
    );
    expect(screen.getByTestId("landing-breath-methodology").textContent ?? "").not.toMatch(
      /DEE-\d+/i,
    );
    expect(screen.getByTestId("landing-breath").textContent ?? "").not.toMatch(/DEE-\d+/i);
    expect(screen.getByTestId("landing-breath-support-cta")).toHaveTextContent(
      "KEEP WAIA BREATHING",
    );
    expect(screen.getByTestId("landing-breath-support-cta")).toBeDisabled();
    expect(screen.getByTestId("landing-breath-support")).toHaveAttribute(
      "data-support-status",
      "pending",
    );
    expect(screen.getByTestId("landing-breath-support-pending")).toHaveTextContent(
      /Support channel will open/i,
    );
    expect(screen.getByTestId("landing-breath-inflows-empty")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-outflows-empty")).toBeInTheDocument();
    expect(screen.getByTestId("landing-living-legacy-example")).toHaveTextContent(/grandchild/i);
  });

  it("renders published runway ticks derived only from supplied runway contract", () => {
    render(
      <BreathRunwayPulse
        status="published"
        runway={{ value: 84, unit: "days", periodLabel: null }}
      />,
    );
    expect(screen.getByTestId("landing-breath-runway")).toHaveAttribute(
      "data-runway-state",
      "published",
    );
    expect(screen.getByTestId("landing-breath-runway-value")).toHaveTextContent("84 days");
    expect(screen.getByTestId("landing-breath-runway-end")).toHaveTextContent(/^RUNWAY END$/i);
    expect(screen.getByTestId("landing-breath-runway-ticks")).toBeInTheDocument();
    expect(screen.getByTestId("landing-breath-runway-tick-0")).toHaveTextContent("0 days");
    expect(screen.getByTestId("landing-breath-runway-tick-21")).toHaveTextContent("21 days");
    expect(screen.getByTestId("landing-breath-runway-tick-84")).toHaveTextContent("84 days");
    expect(screen.queryByTestId("landing-breath-runway-ticks-pending")).not.toBeInTheDocument();
  });

  it("renders B1 diagrams and B2 Twin/Legacy final artwork without scaffold language", async () => {
    await renderLandingPage();

    expect(screen.getByTestId("landing-breath-media")).toHaveAttribute(
      "data-media-slot",
      "diagram",
    );
    expect(screen.getByTestId("landing-society-media")).toHaveAttribute(
      "data-media-slot",
      "diagram",
    );
    expect(screen.getByTestId("landing-ai-trader-media")).toHaveAttribute(
      "data-media-slot",
      "diagram",
    );
    expect(screen.getByTestId("landing-how-built-media")).toHaveAttribute(
      "data-media-slot",
      "diagram",
    );
    expect(screen.getByTestId("landing-ai-marketplace-diagram")).toHaveAttribute(
      "data-media-slot",
      "diagram-inline",
    );
    expect(document.getElementById("mkt-arrow-dim")).not.toBeNull();
    expect(document.getElementById("mkt-arrow-gold")).not.toBeNull();

    const twin = screen.getByTestId("landing-ai-twin-media");
    expect(twin).toHaveAttribute("data-media-slot", "final-art");
    const twinImg = screen.getByTestId("landing-ai-twin-media-image");
    expect(twinImg).toHaveAttribute("src", "/landing/visuals/ai-twin.webp");
    expect(twinImg).toHaveAttribute(
      "alt",
      "A human presence and a related digital presence meet at a soft threshold, suggesting AI-TWIN as a co-researcher.",
    );
    expect(twinImg).toHaveAttribute("width", "1120");
    expect(twinImg).toHaveAttribute("height", "1400");

    const legacy = screen.getByTestId("landing-living-legacy-media");
    expect(legacy).toHaveAttribute("data-media-slot", "final-art");
    const legacyImg = screen.getByTestId("landing-living-legacy-media-image");
    expect(legacyImg).toHaveAttribute("src", "/landing/visuals/living-legacy.webp");
    expect(legacyImg).toHaveAttribute(
      "alt",
      "A present human, a preserved layer of lived experience, and a later generation connected through continuity of meaning.",
    );

    expect(screen.queryByTestId("landing-human-bridge-media")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-business-3p-media")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-business-3p-pillars")).toBeInTheDocument();
    expect(screen.getByTestId("landing-epistemic-method-steps")).toHaveTextContent(/Observation/);
    expect(screen.getByTestId("landing-ai-trader-media")).toHaveTextContent(/NO TRADE/);

    const main = screen.getByTestId("landing");
    expect(main.textContent).not.toMatch(
      /Human-approved production|Final artwork reserved|DEE-608/i,
    );
    expect(main.querySelector('[data-media-slot="final-art-ready"]')).toBeNull();
  });

  it("renders Create Twin as default email CTA plus OAuth when availability returns providers", async () => {
    await renderLandingPage();
    expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create your Twin");
    expect(screen.getByTestId("landing-auth-divider")).toHaveTextContent("Or continue with");
    expect(screen.getByTestId("landing-auth-provider-google")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-provider-apple")).toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-provider-telegram")).toBeInTheDocument();
  });
});

describe("module readiness methodology", () => {
  it("uses qualitative primary labels without invented percentages", () => {
    expect(getModuleReadiness("business-3p").primaryLabel).toBe("Concept");
    expect(getModuleReadiness("ai-marketplace").primaryLabel).toBe("Concept");
    expect(getModuleReadiness("waia-dev-os").primaryLabel).toBe("Operational");
    expect(getModuleReadiness("ai-twin").primaryLabel).toBe("Operational");
    expect(getModuleReadiness("ai-twin")).not.toHaveProperty("percent");
  });
});

describe("AuthBlock state machine", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: {
        pathname: "/",
        search: "",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts in VisitorIdle with empty fields and no error", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability(() => oauthAvailableResponse()),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-provider-google")).toBeInTheDocument();
    });
    const block = screen.getByTestId("landing-auth");
    expect(block.dataset.status).toBe("VisitorIdle");
    expect(block.dataset.mode).toBe("createTwin");
    expect(screen.getByTestId("landing-auth-full-name")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-identity")).toHaveValue("");
    expect(screen.getByTestId("landing-auth-password")).toHaveValue("");
    expect(screen.queryByTestId("landing-auth-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-auth-submit")).not.toBeDisabled();
  });

  it("blocks Create Twin submit when name is empty without calling sign-up", async () => {
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/auth/oauth/availability")) {
        return Promise.resolve(oauthAvailableResponse());
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create your Twin");
    });

    fireEvent.change(screen.getByTestId("landing-auth-identity"), {
      target: { value: "n@example.com" },
    });
    fireEvent.change(screen.getByTestId("landing-auth-password"), {
      target: { value: "password12" },
    });
    fireEvent.click(screen.getByTestId("landing-auth-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-error")).toHaveTextContent(/Enter your name/i);
    });
    expect(fetchSpy.mock.calls.map((c) => c[0])).not.toContain("/api/auth/sign-up");
  });

  it("transitions VisitorIdle -> AuthInProgress -> AuthFailure on sign-up rejection in Create mode", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability((input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/sign-up")) {
          return jsonResponse({ error: { code: "WEAK_PASSWORD" } }, 400);
        }
        return oauthAvailableResponse();
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create your Twin");
    });
    fireEvent.change(screen.getByTestId("landing-auth-full-name"), {
      target: { value: "Test User" },
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
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/auth/sign-up")) {
          return jsonResponse({ ok: true, redirect: "/dashboard" }, 201);
        }
        return oauthAvailableResponse();
      }),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create your Twin");
    });
    fireEvent.change(screen.getByTestId("landing-auth-full-name"), {
      target: { value: "Ok User" },
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
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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

  it("surfaces oauth_error and clears query via replaceState", async () => {
    mockReplace.mockClear();
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

    render(<AuthBlock initialOauthErrorCode="OAUTH_DENIED" />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("landing-auth-error").textContent).toMatch(/cancelled|isn/i);
    await waitFor(() => {
      expect(window.history.replaceState).toHaveBeenCalledWith(window.history.state, "", "/");
    });
  });

  it("shows email confirmation notice and switches to Sign in after sign-up needs confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability((input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
      expect(screen.getByTestId("landing-auth-submit")).toHaveTextContent("Create your Twin");
    });
    fireEvent.change(screen.getByTestId("landing-auth-full-name"), {
      target: { value: "New User" },
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
    vi.stubGlobal(
      "fetch",
      fetchWithOauthAvailability(() => oauthAvailableResponse()),
    );

    render(<AuthBlock />);
    await waitFor(() => {
      expect(screen.getByTestId("landing-auth-provider-google")).toBeInTheDocument();
    });
    expect(screen.getByTestId("landing-auth-password-policy-hint")).toHaveTextContent(
      /8 characters/,
    );
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
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
      vi.stubGlobal(
        "fetch",
        fetchWithOauthAvailability(() => oauthAvailableResponse()),
      );
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
      ["Apple", "apple"],
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
