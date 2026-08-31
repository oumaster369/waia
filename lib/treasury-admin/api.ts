import type { TreasuryApiError, TreasuryApiResult } from "@/lib/treasury-admin/types";

export const TREASURY_REQUEST_TIMEOUT_MS = 20_000;

function errorFromBody(
  status: number,
  body: unknown,
): { ok: false; status: number; code: string; message: string } {
  const error =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: string; message?: string } }).error
      : undefined;
  return {
    ok: false,
    status,
    code: error?.code ?? "REQUEST_FAILED",
    message: error?.message ?? "Request failed.",
  };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function treasuryRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<TreasuryApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TREASURY_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const body = await parseJson(response);
    if (!response.ok) {
      return errorFromBody(response.status, body);
    }
    return { ok: true, data: body as T };
  } catch (cause) {
    const timedOut = controller.signal.aborted && !init?.signal?.aborted;
    return {
      ok: false,
      status: timedOut ? 504 : 503,
      code: timedOut ? "REQUEST_TIMEOUT" : "REQUEST_UNAVAILABLE",
      message: timedOut
        ? "The Finance service did not answer in time. Please retry."
        : cause instanceof Error
          ? cause.message
          : "The Finance service is unavailable.",
    };
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function requireOrganizationId(organizationId: string | null | undefined): string {
  const id = organizationId?.trim();
  if (!id) {
    throw new Error("organization_id is required");
  }
  return id;
}

export function missingOrganizationResult(): TreasuryApiError {
  return {
    ok: false,
    status: 400,
    code: "ORGANIZATION_ID_REQUIRED",
    message: "organization_id is required.",
  };
}

export function withOrganizationQuery(
  path: string,
  organizationId: string,
  extra?: Record<string, string | undefined | null>,
): string {
  const url = new URL(path, "http://local.invalid");
  url.searchParams.set("organization_id", requireOrganizationId(organizationId));
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }
  return `${url.pathname}${url.search}`;
}

export async function treasuryGet<T>(
  path: string,
  organizationId: string,
  extra?: Record<string, string | undefined | null>,
): Promise<TreasuryApiResult<T>> {
  return treasuryRequest<T>(withOrganizationQuery(path, organizationId, extra));
}

export async function treasuryJson<T>(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<TreasuryApiResult<T>> {
  if (typeof body.organization_id !== "string" || body.organization_id.trim() === "") {
    return {
      ok: false,
      status: 400,
      code: "ORGANIZATION_ID_REQUIRED",
      message: "organization_id is required.",
    };
  }
  return treasuryRequest<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
