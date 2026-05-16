"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  className?: string;
};

export function AuthBlock({ initialOauthErrorCode = null, className = undefined }: AuthBlockProps) {
  const router = useRouter();
  const [mode, setMode] = React.useState<AuthUiMode>("createTwin");
  const [fullName, setFullName] = React.useState("");
  const [identity, setIdentity] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(() =>
    oauthErrorQueryMessage(initialOauthErrorCode ?? null),
  );
  const [confirmationNotice, setConfirmationNotice] = React.useState(false);
  const [status, setStatus] = React.useState<LandingAuthState>("VisitorIdle");

  const [oauthAvailabilityState, setOauthAvailabilityState] = React.useState<OauthAvailabilityState>({
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
            router.replace(path);
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

  const oauthReady =
    oauthAvailabilityState.kind === "ready" ? oauthAvailabilityState.map : null;

  const enabledOauthProviders: ReadonlyArray<AuthProvider> = oauthReady
    ? (Object.keys(oauthReady) as ReadonlyArray<AuthProvider>).filter((p) => oauthReady[p])
    : [];

  const primaryCtaLabel = isLoading ? "…" : mode === "createTwin" ? "Create your Twin" : "Sign in";

  const showInlineAlert = failureMessage != null;

  const fieldClass =
    "font-sans border-waia-divider/50 bg-waia-field/40 text-waia-fg-primary shadow-none placeholder:text-waia-fg-subtle/80 focus-visible:border-waia-accent-warm focus-visible:ring-2 focus-visible:ring-waia-accent-warm/30 aria-invalid:border-waia-danger aria-invalid:ring-waia-danger/25";

  return (
    <section
      data-testid="landing-auth"
      data-status={status}
      data-mode={mode}
      aria-label="WAIA authentication"
      aria-busy={isLoading}
      className={cn(
        "mx-auto flex w-full max-w-md flex-col gap-4 rounded-xl border border-waia-accent-warm-muted/25 font-sans",
        "bg-waia-field/50 p-6 text-waia-fg-muted shadow-waia-glow-warm backdrop-blur-[var(--waia-blur-veil-sm)] sm:p-8",
        "[box-shadow:inset_0_1px_0_oklch(0.92_0.05_82/0.14),var(--waia-shadow-glow-warm-soft)]",
        className,
      )}
    >
      <header className="flex flex-col gap-1 text-center">
        <h2 className="font-waia-serif text-xl font-medium leading-snug text-waia-accent-warm-muted sm:text-[1.3125rem]">
          {mode === "createTwin" ? "Create your AI-Twin" : "Sign in"}
        </h2>
        <p className="text-sm font-normal text-waia-fg-subtle">
          {mode === "createTwin"
            ? "Use your email to start partner preview onboarding."
            : "Welcome back. Sign in with the email on your WAIA account."}
        </p>
      </header>

      {confirmationNotice && mode === "signIn" ? (
        <div
          data-testid="landing-auth-email-confirmation"
          role="status"
          className="rounded-lg border border-waia-accent-warm-muted/20 bg-waia-field/40 px-3 py-2 text-sm font-normal text-waia-fg-muted leading-snug"
        >
          Account created. Check your inbox to confirm before signing in.
        </div>
      ) : null}

      <div className="flex justify-center rounded-lg border border-waia-divider/60 bg-waia-field/35 p-1 text-sm font-medium">
        <button
          type="button"
          data-testid="landing-auth-mode-create"
          onClick={() => switchMode("createTwin")}
          className={cn(
            "min-w-[7rem] flex-1 rounded-md px-3 py-2 transition-colors duration-waia-base ease-waia-settle",
            mode === "createTwin"
              ? "bg-waia-elevated/90 text-waia-accent-warm shadow-sm"
              : "text-waia-fg-subtle hover:text-waia-fg-muted",
          )}
        >
          Create Twin
        </button>
        <button
          type="button"
          data-testid="landing-auth-mode-sign-in"
          onClick={() => switchMode("signIn")}
          className={cn(
            "min-w-[7rem] flex-1 rounded-md px-3 py-2 transition-colors duration-waia-base ease-waia-settle",
            mode === "signIn"
              ? "bg-waia-elevated/90 text-waia-accent-warm shadow-sm"
              : "text-waia-fg-subtle hover:text-waia-fg-muted",
          )}
        >
          Sign in
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 font-sans" noValidate>
        {mode === "createTwin" ? (
          <label className="flex flex-col gap-1.5 text-sm font-normal">
            <span className="text-waia-fg-subtle">Your Name</span>
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
        <label className="flex flex-col gap-1.5 text-sm font-normal">
          <span className="text-waia-fg-subtle">Email</span>
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
        <label className="flex flex-col gap-1.5 text-sm font-normal">
          <span className="text-waia-fg-subtle">Password</span>
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
            <span data-testid="landing-auth-password-policy-hint" className="text-xs font-normal text-waia-fg-subtle">
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
          className={cn(
            "mt-2 w-full border border-waia-accent-warm/30 bg-waia-accent-warm font-sans font-medium text-waia-on-accent-warm shadow-none hover:bg-waia-accent-warm/88 focus-visible:border-waia-accent-warm focus-visible:ring-2 focus-visible:ring-waia-accent-warm/40",
            isLoading && "cursor-progress",
          )}
        >
          {primaryCtaLabel}
        </Button>
        {showInlineAlert ? (
          <p
            data-testid="landing-auth-error"
            role="alert"
            className="text-sm font-normal text-waia-danger-fg"
          >
            {failureMessage}
          </p>
        ) : null}
      </form>

      {oauthAvailabilityState.kind === "pending"
        ? null
        : oauthAvailabilityState.kind === "fetchFailed"
          ? (
              <p
                data-testid="landing-auth-oauth-availability-error"
                className="text-center text-xs font-normal text-waia-fg-subtle"
              >
                Couldn&apos;t load sign-in options. You can still use email above. Refresh the page to try again.
              </p>
            )
          : enabledOauthProviders.length > 0
            ? (
                <>
                  <div className="flex items-center gap-3 text-xs font-normal tracking-normal text-waia-fg-subtle">
                    <span aria-hidden="true" className="h-px flex-1 bg-waia-divider/80" />
                    <span data-testid="landing-auth-divider">Or continue with</span>
                    <span aria-hidden="true" className="h-px flex-1 bg-waia-divider/80" />
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
                        className="w-full border-waia-divider/70 bg-waia-field/35 font-sans font-medium text-waia-fg-muted hover:bg-waia-field/55 hover:text-waia-fg-primary focus-visible:border-waia-accent-warm focus-visible:ring-2 focus-visible:ring-waia-accent-warm/25"
                      >
                        {oauthLabel(provider)}
                      </Button>
                    ))}
                  </div>
                </>
              )
            : (
                <p
                  data-testid="landing-auth-oauth-unavailable"
                  className="text-center text-xs font-normal text-waia-fg-subtle"
                >
                  OAuth providers are not configured for this preview. Email sign-in works as usual above.
                </p>
              )}

      <p className="text-center text-sm font-normal text-waia-fg-subtle">
        {mode === "createTwin" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              data-testid="landing-auth-switch-to-sign-in"
              className="font-medium text-waia-accent-warm-muted underline underline-offset-4 transition-colors hover:text-waia-accent-warm"
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
              className="font-medium text-waia-accent-warm-muted underline underline-offset-4 transition-colors hover:text-waia-accent-warm"
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
