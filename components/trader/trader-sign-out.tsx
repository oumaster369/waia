"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/** Full navigation clears the mounted account views and their observation effects. */
function returnToLanding() {
  window.location.replace("/");
}

export function TraderSignOut({ onSignedOut = returnToLanding }: { onSignedOut?: () => void }) {
  const inFlight = useRef(false);
  const activeRequest = useRef<{ controller: AbortController; timeout: number } | null>(null);
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    const request = activeRequest.current;
    activeRequest.current = null;
    if (request) {
      window.clearTimeout(request.timeout);
      request.controller.abort();
    }
  }, []);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const request = { controller, timeout };
    activeRequest.current = request;
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (activeRequest.current !== request) return;
      if (!response.ok) throw new Error("Sign-out request rejected");
      const result: unknown = await response.json();
      if (activeRequest.current !== request) return;
      if (controller.signal.aborted) throw new Error("Sign-out acknowledgement expired");
      if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) {
        throw new Error("Sign-out not acknowledged");
      }
      onSignedOut();
      // Keep locked until navigation removes this view; no second submission.
    } catch {
      if (activeRequest.current !== request) return;
      setError("Sign out could not be confirmed. Please retry; do not assume your session has ended.");
      inFlight.current = false;
      setPending(false);
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }

  return (
    <div className="flex max-w-sm flex-col items-start gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending}
        aria-busy={pending} aria-describedby={error ? errorId : undefined}
        onClick={() => void signOut()}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {error ? <p id={errorId} role="alert" className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
