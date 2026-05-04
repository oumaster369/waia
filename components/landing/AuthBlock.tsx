"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isLikelyEmail, normalizeEmail } from "@/lib/auth/email";
import { establishEmailAuthSession } from "@/lib/landing/email-auth-session";
import { cn } from "@/lib/utils";

/** Email/password uses `/api/auth/*` (DEE-10). SSO uses `/api/auth/oauth/{provider}/start` (DEE-11). */
const FAILURE_MESSAGE = "Не удалось войти. Попробуйте ещё раз.";

export type LandingAuthState =
  | "VisitorIdle"
  | "AuthInProgress"
  | "AuthFailure"
  | "AuthenticatedRedirect";

type AuthProvider = "google" | "apple" | "telegram";

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: "Войти через Google",
  apple: "Войти через Apple ID",
  telegram: "Войти через Telegram",
};

export function AuthBlock() {
  const router = useRouter();
  const [identity, setIdentity] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [status, setStatus] = React.useState<LandingAuthState>("VisitorIdle");

  const beginOAuthProvider = React.useCallback((p: AuthProvider) => {
    if (status === "AuthInProgress" || status === "AuthenticatedRedirect") {
      return;
    }
    setStatus("AuthInProgress");
    globalThis.location.assign(`/api/auth/oauth/${p}/start`);
  }, [status]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (status === "AuthInProgress" || status === "AuthenticatedRedirect") {
        return;
      }
      const emailNorm = normalizeEmail(identity);
      if (!isLikelyEmail(emailNorm)) {
        setStatus("AuthFailure");
        return;
      }
      setStatus("AuthInProgress");
      try {
        const result = await establishEmailAuthSession({ email: emailNorm, password });
        if (result.outcome === "success") {
          const path = result.redirectPath;
          setStatus("AuthenticatedRedirect");
          queueMicrotask(() => {
            router.replace(path);
          });
          return;
        }

        setPassword("");
        setStatus("AuthFailure");
      } catch {
        setPassword("");
        setStatus("AuthFailure");
      }
    },
    [identity, password, router, status],
  );

  const isLoading = status === "AuthInProgress";
  const isRedirectTerminal = status === "AuthenticatedRedirect";
  const interactionLocked = isLoading || isRedirectTerminal;
  const hasError = status === "AuthFailure";

  return (
    <section
      data-testid="landing-auth"
      data-status={status}
      aria-label="WAIA sign in"
      aria-busy={isLoading}
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">Email или имя</span>
          <Input
            data-testid="landing-auth-identity"
            name="identity"
            type="text"
            autoComplete="username"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
            disabled={interactionLocked}
            aria-invalid={hasError || undefined}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">Пароль</span>
          <Input
            data-testid="landing-auth-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={interactionLocked}
            aria-invalid={hasError || undefined}
          />
        </label>
        <Button
          data-testid="landing-auth-submit"
          type="submit"
          size="lg"
          disabled={interactionLocked}
          aria-disabled={interactionLocked || undefined}
          className={cn("mt-2 w-full", isLoading && "cursor-progress")}
        >
          {isLoading ? "…" : "Войти"}
        </Button>
        {hasError && (
          <p
            data-testid="landing-auth-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {FAILURE_MESSAGE}
          </p>
        )}
      </form>
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span data-testid="landing-auth-divider">или</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        {(Object.keys(PROVIDER_LABELS) as ReadonlyArray<AuthProvider>).map((provider) => (
          <Button
            key={provider}
            data-testid={`landing-auth-provider-${provider}`}
            type="button"
            variant="outline"
            size="lg"
            onClick={() => beginOAuthProvider(provider)}
            disabled={interactionLocked}
            aria-disabled={interactionLocked || undefined}
            className="w-full"
          >
            {PROVIDER_LABELS[provider]}
          </Button>
        ))}
      </div>
    </section>
  );
}
