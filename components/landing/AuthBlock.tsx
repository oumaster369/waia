"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isLikelyEmail, normalizeEmail } from "@/lib/auth/email";

// Provisional placeholder until DEE-12 wires real auth and `design` finalises copy.
const FAILURE_MESSAGE = "Не удалось войти. Попробуйте ещё раз.";

/** OAuth buttons remain stub-only (DEE-10 scope). Short delay preserves observable state transitions. */
const PROVIDER_STUB_MS = 0;

type LandingState = "VisitorIdle" | "AuthInProgress" | "AuthFailure";

type AuthProvider = "google" | "apple" | "telegram";

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: "Войти через Google",
  apple: "Войти через Apple ID",
  telegram: "Войти через Telegram",
};

type AuthOkResponse = {
  ok: true;
  redirect: string;
};

function isAuthSuccess(json: unknown): json is AuthOkResponse {
  if (typeof json !== "object" || json === null) return false;
  const obj = json as Record<string, unknown>;
  return obj.ok === true && typeof obj.redirect === "string";
}

type SessionEstablishResult =
  | { outcome: "success"; redirectPath: string }
  | { outcome: "failure" };

async function establishSessionViaEmail(params: {
  email: string;
  password: string;
}): Promise<SessionEstablishResult> {
  const signIn = await fetch("/api/auth/sign-in", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });

  let signInJson: unknown;
  try {
    signInJson = await signIn.json();
  } catch {
    signInJson = null;
  }

  if (signIn.ok && isAuthSuccess(signInJson)) {
    return {
      outcome: "success",
      redirectPath:
        typeof (signInJson as AuthOkResponse).redirect === "string"
          ? (signInJson as AuthOkResponse).redirect
          : "/dashboard",
    };
  }

  const signUp = await fetch("/api/auth/sign-up", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });

  let signUpJson: unknown;
  try {
    signUpJson = await signUp.json();
  } catch {
    signUpJson = null;
  }

  if (signUp.ok && isAuthSuccess(signUpJson)) {
    return {
      outcome: "success",
      redirectPath:
        typeof (signUpJson as AuthOkResponse).redirect === "string"
          ? (signUpJson as AuthOkResponse).redirect
          : "/dashboard",
    };
  }

  return { outcome: "failure" };
}

export function AuthBlock() {
  const router = useRouter();
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

  const resetProviderStubTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finishProviderStub = React.useCallback(() => {
    setPassword("");
    setStatus("AuthFailure");
    timerRef.current = null;
  }, []);

  const beginOAuthStub = React.useCallback(() => {
    setStatus("AuthInProgress");
    resetProviderStubTimer();
    timerRef.current = setTimeout(finishProviderStub, PROVIDER_STUB_MS);
  }, [finishProviderStub, resetProviderStubTimer]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (status === "AuthInProgress") {
        return;
      }
      const emailNorm = normalizeEmail(identity);
      if (!isLikelyEmail(emailNorm)) {
        setStatus("AuthFailure");
        return;
      }
      setStatus("AuthInProgress");
      try {
        const result = await establishSessionViaEmail({ email: emailNorm, password });
        if (result.outcome === "success") {
          router.replace(result.redirectPath || "/dashboard");
          return;
        }

        setPassword("");
        setStatus("AuthFailure");
      } catch {
        setPassword("");
        setStatus("AuthFailure");
      }    },
    [identity, password, router, status],
  );

  const handleProviderClick = React.useCallback(() => {
    if (status === "AuthInProgress") {
      return;
    }
    beginOAuthStub();
  }, [beginOAuthStub, status]);

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
