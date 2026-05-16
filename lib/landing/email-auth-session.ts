/** Browser-only email auth against DEE-10 `/api/auth/sign-in` and `/api/auth/sign-up`. OAuth is wired in DEE-11+. */

import { createAbortTimeout } from "@/lib/http/create-abort-timeout";
import { safeInternalRedirectPath } from "@/lib/landing/safe-internal-redirect";

export type EmailAuthSessionResult =
  | { outcome: "success"; redirectPath: string }
  | { outcome: "needsEmailConfirmation" }
  | { outcome: "failure"; debug?: { lastStatus?: number; lastJson?: unknown } };

type AuthOkBody = {
  ok: true;
  redirect: string;
};

export function parseAuthOkResponse(json: unknown): AuthOkBody | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (obj.ok !== true || typeof obj.redirect !== "string") return null;
  /** Supabase email confirmation flow — no session cookie yet */
  if (obj.needsEmailConfirmation === true) return null;
  const redirect = safeInternalRedirectPath(obj.redirect);
  if (redirect == null) return null;
  return { ok: true, redirect };
}

/** Supabase sign-up returning HTTP success without session until email is confirmed. */
export function parseNeedsEmailConfirmation(json: unknown): boolean {
  if (typeof json !== "object" || json === null) return false;
  const obj = json as Record<string, unknown>;
  return obj.ok === true && obj.needsEmailConfirmation === true;
}

async function parseResponseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function postAuthJson(path: string, email: string, password: string): Promise<{
  response: Response;
  json: unknown;
}> {
  const { signal, cancel } = createAbortTimeout(25_000);
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal,
    });
    const json = await parseResponseJsonSafe(response);
    return { response, json };
  } finally {
    cancel();
  }
}

async function postSignUpJson(email: string, password: string, fullName: string): Promise<{
  response: Response;
  json: unknown;
}> {
  const { signal, cancel } = createAbortTimeout(25_000);
  try {
    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName }),
      signal,
    });
    const json = await parseResponseJsonSafe(response);
    return { response, json };
  } finally {
    cancel();
  }
}

/** Sign-in only — used when the user chose “Sign in”. */
export async function establishEmailSignInOnly(params: {
  email: string;
  password: string;
}): Promise<EmailAuthSessionResult> {
  const { response, json } = await postAuthJson(
    "/api/auth/sign-in",
    params.email,
    params.password,
  );
  if (response.ok) {
    const parsed = parseAuthOkResponse(json);
    if (parsed) {
      return { outcome: "success", redirectPath: parsed.redirect };
    }
  }
  return { outcome: "failure", debug: { lastStatus: response.status, lastJson: json } };
}

/** Sign-up only — used when the user chose “Create your Twin”. Does not fall back to sign-in. */
export async function establishEmailSignUpOnly(params: {
  email: string;
  password: string;
  fullName: string;
}): Promise<EmailAuthSessionResult> {
  const { response, json } = await postSignUpJson(params.email, params.password, params.fullName);
  if (response.ok) {
    if (parseNeedsEmailConfirmation(json)) {
      return { outcome: "needsEmailConfirmation" };
    }
    const parsed = parseAuthOkResponse(json);
    if (parsed) {
      return { outcome: "success", redirectPath: parsed.redirect };
    }
  }
  return { outcome: "failure", debug: { lastStatus: response.status, lastJson: json } };
}

/** Sign-in first; on non-success attempt sign-up (implicit registration UX). Legacy combined path. */
export async function establishEmailAuthSession(params: {
  email: string;
  password: string;
}): Promise<EmailAuthSessionResult> {
  const { response: signIn, json: signInJson } = await postAuthJson(
    "/api/auth/sign-in",
    params.email,
    params.password,
  );
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

  const { response: signUp, json: signUpJson } = await postAuthJson(
    "/api/auth/sign-up",
    params.email,
    params.password,
  );
  if (signUp.ok) {
    if (parseNeedsEmailConfirmation(signUpJson)) {
      return { outcome: "needsEmailConfirmation" };
    }
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
