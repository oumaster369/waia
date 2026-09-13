import "server-only";
import { observationBindingSchema, parseAccountObservation, sameObservationBinding } from "./validation";
import type { AccountObservation, ObservationBinding } from "./types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export type ObservationReadDependencies = Readonly<{
  getUserId(signal: AbortSignal): Promise<string | null>;
  hasTraderAccess(userId: string, organizationId: string, signal: AbortSignal): Promise<boolean>;
  hasOrgMembership(userId: string, organizationId: string, signal: AbortSignal): Promise<boolean>;
  hasOperatorAccess(userId: string, organizationId: string, signal: AbortSignal): Promise<boolean>;
  /** Must consult current stored metadata, never echo the caller's requested identity. */
  resolveActiveBinding(scope: Pick<ObservationBinding, "organizationId" | "credentialId" | "exchangeAccountId">,
    userId: string, signal: AbortSignal): Promise<ObservationBinding | null>;
  readLatest(binding: ObservationBinding, signal: AbortSignal): Promise<AccountObservation | null>;
}>;
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const error = (status: number) => Response.json({ error: "ACCOUNT_OBSERVATION_UNAVAILABLE" }, { status, headers });

/** Shared Admin/tenant HTTP adapter. No exchange credential access.
 * Every poll independently validates session/entitlement/membership/account and rechecks before return.
 * 204 means missing; it never means a successfully observed zero balance.
 */
export async function handleAccountObservationGet(request: Request,
  surface: "tenant" | "admin", deps: ObservationReadDependencies,
  mode: "observation" | "binding" = "observation"): Promise<Response> {
  if (request.method !== "GET") return error(405);
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) abort.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<Response>(resolve => {
      timer = setTimeout(() => { abort.abort(); resolve(error(503)); }, 5000);
    });
    const execute = async (): Promise<Response> => {
      const userId = await deps.getUserId(abort.signal);
      if (!userId) return error(401);
      const url = new URL(request.url);
      const keys = mode === "observation" ?
        ["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"] :
        [...(surface === "admin" ? ["organizationId"] : []), "credentialId", "exchangeAccountId"];
      if (keys.some(k => url.searchParams.getAll(k).length !== 1) ||
        [...url.searchParams.keys()].some(k => !keys.includes(k))) return error(400);
      const params = Object.fromEntries(url.searchParams);
      const parsed = mode === "observation" ? observationBindingSchema.safeParse(params) :
        observationBindingSchema.omit({ credentialRevision: true, configurationRevision: true }).safeParse({
          ...params, organizationId: surface === "tenant" ? personalOrganizationIdFromUserId(userId) : params.organizationId,
        });
      if (!parsed.success) return error(400);
      const scope = parsed.data;
      async function allowed(): Promise<boolean> {
        if (abort.signal.aborted || await deps.getUserId(abort.signal) !== userId ||
          !await deps.hasTraderAccess(userId!, scope.organizationId, abort.signal) ||
          !await deps.hasOrgMembership(userId!, scope.organizationId, abort.signal) ||
          (surface === "admin" && !await deps.hasOperatorAccess(userId!, scope.organizationId, abort.signal))) return false;
        return true;
      }
      if (!await allowed()) return error(403);
      const current = await deps.resolveActiveBinding(scope, userId, abort.signal);
      if (!await allowed()) return error(403);
      if (!current) return mode === "binding" ? new Response(null, { status: 204, headers }) : error(403);
      const binding = observationBindingSchema.parse(current);
      if (binding.organizationId !== scope.organizationId || binding.credentialId !== scope.credentialId ||
        binding.exchangeAccountId !== scope.exchangeAccountId) return error(403);
      if (mode === "binding") return Response.json(binding, { headers });
      if (!sameObservationBinding(binding, observationBindingSchema.parse(scope))) return error(403);
      const stored = await deps.readLatest(binding, abort.signal);
      if (!await allowed()) return error(403);
      const after = await deps.resolveActiveBinding(binding, userId, abort.signal);
      if (!after || !sameObservationBinding(after, binding)) return error(403);
      if (abort.signal.aborted) return error(503);
      if (!stored) return new Response(null, { status: 204, headers });
      const o = parseAccountObservation(stored);
      if (!sameObservationBinding(binding, o.binding)) return error(503);
      return Response.json(o, { headers });
    };
    return await Promise.race([execute().catch(() => error(503)), timeout]);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    abort.abort();
  }
}
