"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Provisional placeholder until DEE-12 wires real auth and `design` finalises copy.
const FAILURE_MESSAGE = "Не удалось войти. Попробуйте ещё раз.";

// Mocked latency for the local-stub flow. No network is contacted; this exists
// only so the VisitorIdle -> AuthInProgress -> AuthFailure transition is observable.
const STUB_DELAY_MS = 800;

type LandingState = "VisitorIdle" | "AuthInProgress" | "AuthFailure";

type AuthProvider = "google" | "apple" | "telegram";

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: "Войти через Google",
  apple: "Войти через Apple ID",
  telegram: "Войти через Telegram",
};

export function AuthBlock() {
  const [identity, setIdentity] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [status, setStatus] = React.useState<LandingState>("VisitorIdle");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const beginStubbedSubmission = React.useCallback(() => {
    setStatus("AuthInProgress");
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setPassword("");
      setStatus("AuthFailure");
      timerRef.current = null;
    }, STUB_DELAY_MS);
  }, []);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (status === "AuthInProgress") {
        return;
      }
      beginStubbedSubmission();
    },
    [status, beginStubbedSubmission],
  );

  const handleProviderClick = React.useCallback(() => {
    if (status === "AuthInProgress") {
      return;
    }
    beginStubbedSubmission();
  }, [status, beginStubbedSubmission]);

  const isLoading = status === "AuthInProgress";
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
            disabled={isLoading}
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
            disabled={isLoading}
            aria-invalid={hasError || undefined}
          />
        </label>
        <Button
          data-testid="landing-auth-submit"
          type="submit"
          size="lg"
          disabled={isLoading}
          aria-disabled={isLoading || undefined}
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
            onClick={handleProviderClick}
            disabled={isLoading}
            aria-disabled={isLoading || undefined}
            className="w-full"
          >
            {PROVIDER_LABELS[provider]}
          </Button>
        ))}
      </div>
    </section>
  );
}
