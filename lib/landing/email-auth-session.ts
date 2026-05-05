/** Browser-only email auth against DEE-10 `/api/auth/sign-in` and `/api/auth/sign-up`. OAuth is wired in DEE-11+. */

import { safeInternalRedirectPath } from "@/lib/landing/safe-internal-redirect";

export type EmailAuthSessionResult =
  | { outcome: "success"; redirectPath: string }
  | { outcome: "failure"; debug?: { lastStatus?: number; lastJson?: unknown } };

type AuthOkBody = {
  ok: true;
  redirect: string;
};

export function parseAuthOkResponse(json: unknown): AuthOkBody | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (obj.ok !== true || typeof obj.redirect !== "string") return null;
  const redirect = safeInternalRedirectPath(obj.redirect);
  if (redirect == null) return null;
  return { ok: true, redirect };
}

async function parseResponseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Sign-in first; on non-success attempt sign-up (implicit registration UX). Same order as MVP landing contract. */
export async function establishEmailAuthSession(params: {
  email: string;
  password: string;
}): Promise<EmailAuthSessionResult> {
  const signIn = await fetch("/api/auth/sign-in", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });

  const signInJson = await parseResponseJsonSafe(signIn);
  if (signIn.ok) {
    const signedInOk = parseAuthOkResponse(signInJson);
    if (signedInOk) {
      return { outcome: "success", redirectPath: signedInOk.redirect };
    }
    return {
      outcome: "failure",
      debug: { lastStatus: signIn.status, lastJson: signInJson },
    };
  }

  const signUp = await fetch("/api/auth/sign-up", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });

  const signUpJson = await parseResponseJsonSafe(signUp);
  if (signUp.ok) {
    const signedUpOk = parseAuthOkResponse(signUpJson);
    if (signedUpOk) {
      return { outcome: "success", redirectPath: signedUpOk.redirect };
    }
    return {
      outcome: "failure",
      debug: { lastStatus: signUp.status, lastJson: signUpJson },
    };
  }

  return {
    outcome: "failure",
    debug: { lastStatus: signUp.status, lastJson: signUpJson },
  };
}
