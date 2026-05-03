/** Browser-only email auth against DEE-10 `/api/auth/sign-in` and `/api/auth/sign-up`. OAuth is wired in DEE-11+. */

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
  return { ok: true, redirect: obj.redirect };
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
  const signedInOk = parseAuthOkResponse(signInJson);
  if (signIn.ok && signedInOk) {
    return { outcome: "success", redirectPath: signedInOk.redirect };
  }

  const signUp = await fetch("/api/auth/sign-up", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });

  const signUpJson = await parseResponseJsonSafe(signUp);
  const signedUpOk = parseAuthOkResponse(signUpJson);
  if (signUp.ok && signedUpOk) {
    return { outcome: "success", redirectPath: signedUpOk.redirect };
  }

  return {
    outcome: "failure",
    debug: { lastStatus: signUp.status, lastJson: signUpJson },
  };
}
