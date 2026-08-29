"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LANDING_PRIMARY_CTA_CLASS } from "@/components/landing/landing-primary-cta";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";
import { isLikelyEmail, normalizeEmail } from "@/lib/auth/email";
import {
  establishEmailSignInOnly,
  establishEmailSignUpOnly,
} from "@/lib/landing/email-auth-session";
import { oauthErrorQueryMessage } from "@/lib/landing/oauth-error-copy";
import { createAbortTimeout } from "@/lib/http/create-abort-timeout";
import { OAUTH_ERROR_QUERY } from "@/lib/oauth/oauth-error-codes";
import { cn } from "@/lib/utils";

type AuthProvider = "google" | "apple" | "telegram";

const CREATE_FAILURE_GENERIC =
  "We couldn't finish creating your account. Try again. If this keeps happening, contact support.";
const SIGN_IN_FAILURE_GENERIC = "Couldn't sign you in. Check your email and password.";
const EMAIL_TAKEN_HINT =
  "That email already has an account. Use Sign in instead, or choose another email.";
const INVALID_EMAIL_HINT = "Enter a valid email address.";
const NAME_REQUIRED_HINT = "Enter your name.";

function weakPasswordHint(): string {
  return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
}

type OauthAvailability = Record<AuthProvider, boolean>;

const EMPTY_AVAILABILITY: OauthAvailability = {
  google: false,
  apple: false,
  telegram: false,
};

type OauthAvailabilityState =
  | { kind: "pending" }
  | { kind: "ready"; map: OauthAvailability }
  | { kind: "fetchFailed" };

function oauthLabel(provider: AuthProvider): string {
  switch (provider) {
    case "google":
      return "Continue with Google";
    case "apple":
      return "Continue with Apple";
    default:
      return "Continue with Telegram";
  }
}

function readEmailTaken(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const err = (json as { error?: { code?: unknown } }).error;
  return err?.code === "EMAIL_TAKEN";
}

function readWeakPassword(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const err = (json as { error?: { code?: unknown } }).error;
  return err?.code === "WEAK_PASSWORD";
}

export type LandingAuthState =
  | "VisitorIdle"
  | "AuthInProgress"
  | "AuthFailure"
  | "AuthenticatedRedirect";

type AuthUiMode = "createTwin" | "signIn";

type AuthBlockProps = {
  /** Wired from `app/page` server `searchParams` when present (OAuth redirect failures). */
  initialOauthErrorCode?: string | null;
  /** Keeps the shared auth authority while allowing host-specific entry posture. */
  initialMode?: AuthUiMode;
  context?: "waia" | "trader";
  className?: string;
};

export function AuthBlock({
  initialOauthErrorCode = null,
  initialMode = "createTwin",
  context = "waia",
  className = undefined,
}: AuthBlockProps) {
  const router = useRouter();
  const [mode, setMode] = React.useState<AuthUiMode>(initialMode);
  const [fullName, setFullName] = React.useState("");
  const [identity, setIdentity] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(() =>
    oauthErrorQueryMessage(initialOauthErrorCode ?? null),
  );
  const [confirmationNotice, setConfirmationNotice] = React.useState(false);
  const [status, setStatus] = React.useState<LandingAuthState>("VisitorIdle");

  const [oauthAvailabilityState, setOauthAvailabilityState] =
    React.useState<OauthAvailabilityState>({
      kind: "pending",
    });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(OAUTH_ERROR_QUERY)) return;
    params.delete(OAUTH_ERROR_QUERY);
    const qs = params.toString();
    const path = window.location.pathname;
    const nextUrl = qs ? `${path}?${qs}` : path;
    /** `router.replace` here triggers Next.js dev overlay on hydration. */
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const { signal, cancel } = createAbortTimeout(12_000);

    fetch("/api/auth/oauth/availability", {
      method: "GET",
      credentials: "same-origin",
      signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (typeof payload !== "object" || payload === null) {
          setOauthAvailabilityState({ kind: "ready", map: { ...EMPTY_AVAILABILITY } });
          return;
        }
        const o = payload as Record<string, unknown>;
        const next = {
          google: o.google === true,
          apple: o.apple === true,
          telegram: o.telegram === true,
        };
        setOauthAvailabilityState({ kind: "ready", map: next as OauthAvailability });
      })
      .catch(() => {
        if (!cancelled) {
          setOauthAvailabilityState({ kind: "fetchFailed" });
        }
      })
      .finally(() => cancel());

    return () => {
      cancelled = true;
      cancel();
    };
  }, []);

  const beginOAuthProvider = React.useCallback(
    (p: AuthProvider) => {
      if (status === "AuthInProgress" || status === "AuthenticatedRedirect") {
        return;
      }
      setStatus("AuthInProgress");
      globalThis.location.assign(`/api/auth/oauth/${p}/start`);
    },
    [status],
  );

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (status === "AuthInProgress" || status === "AuthenticatedRedirect") {
        return;
      }
      setFailureMessage(null);
      if (mode === "createTwin") {
        const trimmedName = fullName.trim();
        if (trimmedName.length === 0) {
          setFailureMessage(NAME_REQUIRED_HINT);
          setStatus("AuthFailure");
          return;
        }
      }

      const emailNorm = normalizeEmail(identity);
      if (!isLikelyEmail(emailNorm)) {
        setFailureMessage(INVALID_EMAIL_HINT);
        setStatus("AuthFailure");
        return;
      }

      setStatus("AuthInProgress");
      try {
        const result =
          mode === "createTwin"
            ? await establishEmailSignUpOnly({
                email: emailNorm,
                password,
                fullName: fullName.trim(),
              })
            : await establishEmailSignInOnly({ email: emailNorm, password });
        if (result.outcome === "success") {
          const path = result.redirectPath;
          setConfirmationNotice(false);
          setStatus("AuthenticatedRedirect");
          queueMicrotask(() => {
            if (path.startsWith("http://") || path.startsWith("https://")) {
              globalThis.location.assign(path);
            } else {
              router.replace(path);
            }
          });
          return;
        }

        if (result.outcome === "needsEmailConfirmation") {
          setConfirmationNotice(true);
          setMode("signIn");
          setFullName("");
          setPassword("");
          setFailureMessage(null);
          setStatus("VisitorIdle");
          return;
        }

        let message: string;
        const lastJson = result.debug?.lastJson;
        if (mode === "createTwin") {
          if (readEmailTaken(lastJson)) {
            message = EMAIL_TAKEN_HINT;
          } else if (readWeakPassword(lastJson)) {
            message = weakPasswordHint();
          } else {
            message = CREATE_FAILURE_GENERIC;
          }
        } else {
          message = SIGN_IN_FAILURE_GENERIC;
        }

        setFailureMessage(message);
        setPassword("");
        setStatus("AuthFailure");
      } catch {
        setFailureMessage(mode === "createTwin" ? CREATE_FAILURE_GENERIC : SIGN_IN_FAILURE_GENERIC);
        setPassword("");
        setStatus("AuthFailure");
      }
    },
    [fullName, identity, mode, password, router, status],
  );

  const switchMode = React.useCallback((next: AuthUiMode) => {
    setMode(next);
    setFailureMessage(null);
    if (next === "createTwin") {
      setConfirmationNotice(false);
    }
    if (next === "signIn") {
      setFullName("");
    }
    setStatus("VisitorIdle");
    setPassword("");
  }, []);

  const isLoading = status === "AuthInProgress";
  const isRedirectTerminal = status === "AuthenticatedRedirect";
  const interactionLocked = isLoading || isRedirectTerminal;

  const oauthReady = oauthAvailabilityState.kind === "ready" ? oauthAvailabilityState.map : null;

  const enabledOauthProviders: ReadonlyArray<AuthProvider> = oauthReady
    ? (Object.keys(oauthReady) as ReadonlyArray<AuthProvider>).filter((p) => oauthReady[p])
    : [];

  const primaryCtaLabel = isLoading ? "…" : mode === "createTwin" ? "Create your Twin" : "Sign in";

  const showInlineAlert = failureMessage != null;

  const fieldClass =
    "h-12 min-h-12 rounded-xl border border-[rgba(215,195,155,0.32)] bg-[rgba(3,8,19,0.5)] px-3.5 text-[0.9375rem] font-normal font-sans text-[rgba(246,242,235,0.96)] shadow-none outline-none transition-[box-shadow,border-color] placeholder:text-[rgba(175,170,160,0.72)] focus-visible:border-[rgba(224,198,130,0.55)] focus-visible:ring-2 focus-visible:ring-[rgba(212,184,122,0.22)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[rgba(232,110,100,0.55)] aria-invalid:ring-2 aria-invalid:ring-[rgba(232,100,90,0.18)]";

  return (
    <section
      data-testid="landing-auth"
      data-status={status}
      data-mode={mode}
      aria-label={context === "trader" ? "AI-TRADER authentication" : "WAIA authentication"}
      aria-busy={isLoading}
      className={cn(
        "mx-auto flex w-full max-w-[560px] flex-col gap-5 rounded-2xl border p-6 font-sans sm:gap-6 sm:p-8",
        "border-[rgba(218,200,160,0.38)] bg-[rgba(3,8,19,0.68)] backdrop-blur-[14px]",
        "shadow-[inset_0_1px_0_rgba(255,252,245,0.11),0_0_0_1px_rgba(255,255,255,0.04),0_28px_56px_-16px_rgba(0,0,0,0.5),0_0_72px_-24px_rgba(190,155,85,0.14)]",
        className,
      )}
    >
      <header className="flex flex-col gap-2 text-center">
        <h2 className="font-waia-serif text-[1.35rem] leading-snug font-medium tracking-tight text-[#e8dcc4] sm:text-[1.5rem]">
          {mode === "createTwin"
            ? "Create your AI-Twin"
            : context === "trader"
              ? "Sign in to AI-TRADER"
              : "Sign in"}
        </h2>
        <p className="text-sm leading-relaxed font-normal text-[rgba(210,204,195,0.9)]">
          {mode === "createTwin"
            ? "Use your email to start partner preview onboarding."
            : context === "trader"
              ? "Use the email on your WAIA account. Access remains subject to your Trader entitlement."
              : "Welcome back. Sign in with the email on your WAIA account."}
        </p>
      </header>

      {confirmationNotice && mode === "signIn" ? (
        <div
          data-testid="landing-auth-email-confirmation"
          role="status"
          className="rounded-xl border border-[rgba(218,200,160,0.3)] bg-[rgba(3,8,19,0.45)] px-3.5 py-2.5 text-sm leading-snug font-normal text-[rgba(220,214,205,0.92)]"
        >
          Account created. Check your inbox to confirm before signing in.
        </div>
      ) : null}

      <div className="flex justify-center rounded-xl border border-[rgba(215,195,155,0.28)] bg-[rgba(3,8,19,0.45)] p-1 text-sm font-semibold tracking-tight">
        <button
          type="button"
          data-testid="landing-auth-mode-create"
          onClick={() => switchMode("createTwin")}
          className={cn(
            "min-w-[7.5rem] flex-1 rounded-lg px-3 py-2.5 transition-all duration-200 ease-out",
            mode === "createTwin"
              ? "bg-[rgba(10,14,24,0.96)] text-[#d4b87a] shadow-[inset_0_0_0_1px_rgba(212,184,122,0.4),0_0_20px_-6px_rgba(200,160,80,0.18)]"
              : "text-[rgba(215,210,200,0.9)] hover:bg-[rgba(255,255,255,0.045)] hover:text-[rgba(236,232,224,0.98)]",
          )}
        >
          Create Twin
        </button>
        <button
          type="button"
          data-testid="landing-auth-mode-sign-in"
          onClick={() => switchMode("signIn")}
          className={cn(
            "min-w-[7.5rem] flex-1 rounded-lg px-3 py-2.5 transition-all duration-200 ease-out",
            mode === "signIn"
              ? "bg-[rgba(10,14,24,0.96)] text-[#d4b87a] shadow-[inset_0_0_0_1px_rgba(212,184,122,0.4),0_0_20px_-6px_rgba(200,160,80,0.18)]"
              : "text-[rgba(215,210,200,0.9)] hover:bg-[rgba(255,255,255,0.045)] hover:text-[rgba(236,232,224,0.98)]",
          )}
        >
          Sign in
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 font-sans" noValidate>
        {mode === "createTwin" ? (
          <label className="flex flex-col gap-2 text-sm font-normal">
            <span className="text-[0.8125rem] font-medium tracking-wide text-[rgba(232,228,218,0.92)]">
              Your Name
            </span>
            <Input
              data-testid="landing-auth-full-name"
              name="fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              disabled={interactionLocked}
              aria-invalid={showInlineAlert ? true : undefined}
              className={fieldClass}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-2 text-sm font-normal">
          <span className="text-[0.8125rem] font-medium tracking-wide text-[rgba(232,228,218,0.92)]">
            Email
          </span>
          <Input
            data-testid="landing-auth-identity"
            name="identity"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
            disabled={interactionLocked}
            aria-invalid={showInlineAlert ? true : undefined}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-normal">
          <span className="text-[0.8125rem] font-medium tracking-wide text-[rgba(232,228,218,0.92)]">
            Password
          </span>
          <Input
            data-testid="landing-auth-password"
            name="password"
            type="password"
            autoComplete={mode === "createTwin" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={interactionLocked}
            aria-invalid={showInlineAlert ? true : undefined}
            className={fieldClass}
          />
          {mode === "createTwin" ? (
            <span
              data-testid="landing-auth-password-policy-hint"
              className="text-xs font-normal text-[rgba(188,182,172,0.88)]"
            >
              Use at least {PASSWORD_MIN_LENGTH} characters.
            </span>
          ) : null}
        </label>
        <Button
          data-testid="landing-auth-submit"
          type="submit"
          size="lg"
          disabled={interactionLocked}
          aria-disabled={interactionLocked || undefined}
          className={cn(LANDING_PRIMARY_CTA_CLASS, "mt-1 w-full", isLoading && "cursor-progress")}
        >
          {primaryCtaLabel}
        </Button>
        {showInlineAlert ? (
          <p
            data-testid="landing-auth-error"
            role="alert"
            className="text-sm leading-snug font-normal text-[rgba(255,182,168,0.95)]"
          >
            {failureMessage}
          </p>
        ) : null}
      </form>

      {oauthAvailabilityState.kind === "pending" ? null : oauthAvailabilityState.kind ===
        "fetchFailed" ? (
        <p
          data-testid="landing-auth-oauth-availability-error"
          className="text-center text-xs leading-relaxed font-normal text-[rgba(195,190,180,0.82)]"
        >
          Couldn&apos;t load sign-in options. You can still use email above. Refresh the page to try
          again.
        </p>
      ) : enabledOauthProviders.length > 0 ? (
        <>
          <div className="flex items-center gap-3 text-xs font-normal tracking-normal text-[rgba(190,185,175,0.8)]">
            <span aria-hidden="true" className="h-px flex-1 bg-[rgba(218,200,160,0.25)]" />
            <span data-testid="landing-auth-divider">Or continue with</span>
            <span aria-hidden="true" className="h-px flex-1 bg-[rgba(218,200,160,0.25)]" />
          </div>
          <div className="flex flex-col gap-2">
            {enabledOauthProviders.map((provider) => (
              <Button
                key={provider}
                data-testid={`landing-auth-provider-${provider}`}
                type="button"
                variant="outline"
                size="lg"
                onClick={() => beginOAuthProvider(provider)}
                disabled={interactionLocked}
                aria-disabled={interactionLocked || undefined}
                className="h-12 min-h-12 w-full rounded-xl border-[rgba(218,200,160,0.32)] bg-[rgba(3,8,19,0.35)] font-sans text-[0.9375rem] font-semibold text-[rgba(232,228,220,0.95)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(248,244,238,0.98)] focus-visible:border-[rgba(224,198,130,0.5)] focus-visible:ring-2 focus-visible:ring-[rgba(212,184,122,0.2)]"
              >
                {oauthLabel(provider)}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p
          data-testid="landing-auth-oauth-unavailable"
          className="text-center text-xs leading-relaxed font-normal text-[rgba(195,190,180,0.78)]"
        >
          OAuth providers are not configured for this preview. Email sign-in works as usual above.
        </p>
      )}

      <p className="text-center text-sm leading-relaxed font-normal text-[rgba(205,200,190,0.88)]">
        {mode === "createTwin" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              data-testid="landing-auth-switch-to-sign-in"
              className="font-semibold text-[#dcc69a] underline decoration-[rgba(220,198,154,0.5)] underline-offset-4 transition-colors hover:text-[#ecd9b0]"
              onClick={() => switchMode("signIn")}
            >
              Sign in
            </button>
          </>
        ) : (
          <>
            New to WAIA?{" "}
            <button
              type="button"
              data-testid="landing-auth-switch-to-create-twin"
              className="font-semibold text-[#dcc69a] underline decoration-[rgba(220,198,154,0.5)] underline-offset-4 transition-colors hover:text-[#ecd9b0]"
              onClick={() => switchMode("createTwin")}
            >
              Create your Twin
            </button>
          </>
        )}
      </p>
    </section>
  );
}
