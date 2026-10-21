import "server-only";
import {
  observationBindingSchema,
  parseAccountObservation,
  sameObservationBinding,
} from "./validation";
import {
  financialHistoryRequestSchema,
  financialHistoryResponseSchema,
  assertFinancialHistoryResponse,
  type FinancialHistoryRequest,
  type FinancialHistoryResponse,
} from "./financial-history";
import type { AccountObservation, ObservationBinding } from "./types";
import type { ObservationFailureTrace } from "./failure-stage";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export type ObservationReadDependencies = Readonly<{
  failureTrace?: ObservationFailureTrace;
  getUserId(signal: AbortSignal): Promise<string | null>;
  hasTraderAccess(userId: string, organizationId: string, signal: AbortSignal): Promise<boolean>;
  hasOrgMembership(userId: string, organizationId: string, signal: AbortSignal): Promise<boolean>;
  hasOperatorAccess(userId: string, organizationId: string, signal: AbortSignal): Promise<boolean>;
  /** True only when this organization is inside the admin connected-account list scope. */
  isAdminListedOrganization(organizationId: string, signal: AbortSignal): Promise<boolean>;
  /** Must consult current stored metadata, never echo the caller's requested identity. */
  resolveActiveBinding(
    scope: Pick<ObservationBinding, "organizationId" | "credentialId" | "exchangeAccountId">,
    userId: string,
    signal: AbortSignal,
  ): Promise<ObservationBinding | null>;
  readFinancialHistory?(
    input: FinancialHistoryRequest,
    signal: AbortSignal,
  ): Promise<FinancialHistoryResponse | null>;
  readLatest(binding: ObservationBinding, signal: AbortSignal): Promise<AccountObservation | null>;
}>;
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
// Only an authorized configuration-only transition may trigger binding rediscovery.
function configurationChanged(a: ObservationBinding, b: ObservationBinding): boolean {
  return (
    a.organizationId === b.organizationId &&
    a.credentialId === b.credentialId &&
    a.exchangeAccountId === b.exchangeAccountId &&
    a.credentialRevision === b.credentialRevision &&
    a.configurationRevision !== b.configurationRevision
  );
}
const error = (status: number) =>
  Response.json(
    {
      error:
        status === 409 ? "ACCOUNT_OBSERVATION_BINDING_CHANGED" : "ACCOUNT_OBSERVATION_UNAVAILABLE",
    },
    { status, headers },
  );

/** Shared Admin/tenant HTTP adapter. No exchange credential access.
 * Every poll independently validates session, entitlement and account, then rechecks before return.
 * Admin requires operator permission on the target organization, not membership,
 * and only for an organization the connected-account list would return.
 * Tenant requires membership and never operator permission.
 * 204 means missing; it never means a successfully observed zero balance.
 */
export async function handleAccountObservationGet(
  request: Request,
  surface: "tenant" | "admin",
  deps: ObservationReadDependencies,
  mode: "observation" | "binding" | "financial-history" = "observation",
): Promise<Response> {
  const trace = deps.failureTrace;
  const abort = new AbortController();
  const fail = (status: number) => {
    // Cancellation does not establish that access was revoked. Keep it
    // fail-closed but retryable, including dependencies settling after abort.
    if (abort.signal.aborted && (status === 401 || status === 403)) status = 503;
    if (status === 503) trace?.report("THREW");
    else trace?.complete();
    return error(status);
  };
  if (request.method !== "GET") return fail(405);
  const cancel = () => abort.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) abort.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<Response>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        trace?.report("TIMEOUT");
        resolve(error(503));
      }, 5000);
    });
    const execute = async (): Promise<Response> => {
      if (abort.signal.aborted) return fail(503);
      trace?.enter("SESSION_INITIAL");
      const userId = await deps.getUserId(abort.signal);
      if (!userId) return fail(401);
      trace?.enter("REQUEST");
      const url = new URL(request.url);
      const keys =
        mode === "observation"
          ? [
              "organizationId",
              "credentialId",
              "exchangeAccountId",
              "credentialRevision",
              "configurationRevision",
            ]
          : [
              ...(surface === "admin" ? ["organizationId"] : []),
              "credentialId",
              "exchangeAccountId",
            ];
      const optionalKeys =
        mode === "financial-history" ? ["pageSize", "cursor", "windowStartMs", "windowEndMs"] : [];
      if (
        optionalKeys.some((k) => url.searchParams.getAll(k).length > 1) ||
        keys.some((k) => url.searchParams.getAll(k).length !== 1) ||
        [...url.searchParams.keys()].some((k) => !keys.includes(k) && !optionalKeys.includes(k))
      )
        return fail(400);
      const params = Object.fromEntries(
        [...url.searchParams].filter(([key]) => keys.includes(key)),
      );
      const numberParam = (key: string, fallback: number | null): number | null => {
        const value = url.searchParams.get(key);
        if (value === null) return fallback;
        if (!/^(0|[1-9]\d{0,15})$/.test(value)) throw new Error("INVALID_HISTORY_QUERY");
        return Number(value);
      };
      let historyOptions: Omit<FinancialHistoryRequest, "binding"> | undefined;
      if (mode === "financial-history") {
        try {
          historyOptions = {
            pageSize: numberParam("pageSize", 100)!,
            cursor: url.searchParams.get("cursor"),
            filters: {
              windowStartMs: numberParam("windowStartMs", null),
              windowEndMs: numberParam("windowEndMs", null),
            },
          };
          // Scope/binding validation follows authorization resolution; validate pagination now.
          financialHistoryRequestSchema.omit({ binding: true }).parse(historyOptions);
        } catch {
          return fail(400);
        }
      }
      const parsed =
        mode === "observation"
          ? observationBindingSchema.safeParse(params)
          : observationBindingSchema
              .omit({ credentialRevision: true, configurationRevision: true })
              .safeParse({
                ...params,
                organizationId:
                  surface === "tenant"
                    ? personalOrganizationIdFromUserId(userId)
                    : params.organizationId,
              });
      if (!parsed.success) return fail(400);
      const scope = parsed.data;
      async function allowed(): Promise<boolean> {
        if (abort.signal.aborted) return false;
        trace?.enter("SESSION_RECHECK");
        const currentUserId = await deps.getUserId(abort.signal);
        if (abort.signal.aborted || currentUserId !== userId) return false;
        trace?.enter("ENTITLEMENT");
        const hasTraderAccess = await deps.hasTraderAccess(
          userId!,
          scope.organizationId,
          abort.signal,
        );
        if (abort.signal.aborted || !hasTraderAccess) return false;
        // Admin is platform-operator authority on the target org, not membership.
        // Tenant stays membership-gated. RLS still binds the row to this exact account.
        if (surface === "admin") {
          trace?.enter("OPERATOR_PERMISSION");
          const hasOperatorAccess = await deps.hasOperatorAccess(
            userId!,
            scope.organizationId,
            abort.signal,
          );
          if (abort.signal.aborted || !hasOperatorAccess) return false;
          trace?.enter("ADMIN_LIST_SCOPE");
          const isAdminListed = await deps.isAdminListedOrganization(
            scope.organizationId,
            abort.signal,
          );
          return !abort.signal.aborted && isAdminListed;
        }
        trace?.enter("MEMBERSHIP");
        const hasOrgMembership = await deps.hasOrgMembership(
          userId!,
          scope.organizationId,
          abort.signal,
        );
        return !abort.signal.aborted && hasOrgMembership;
      }
      if (!(await allowed())) return fail(403);
      trace?.enter("PROJECTION_CONFIG");
      const current = await deps.resolveActiveBinding(scope, userId, abort.signal);
      if (!(await allowed())) return fail(403);
      if (!current)
        return mode === "binding" ? new Response(null, { status: 204, headers }) : fail(403);
      trace?.enter("BINDING_VALIDATION");
      const binding = observationBindingSchema.parse(current);
      if (
        binding.organizationId !== scope.organizationId ||
        binding.credentialId !== scope.credentialId ||
        binding.exchangeAccountId !== scope.exchangeAccountId
      )
        return fail(403);
      if (mode === "binding") return Response.json(binding, { headers });
      if (
        mode === "observation" &&
        !sameObservationBinding(binding, observationBindingSchema.parse(scope))
      )
        return fail(
          configurationChanged(observationBindingSchema.parse(scope), binding) ? 409 : 403,
        );
      trace?.enter("PROJECTION_REQUEST");
      const historyRequest =
        mode === "financial-history"
          ? financialHistoryRequestSchema.parse({ binding, ...historyOptions })
          : null;
      const stored = historyRequest
        ? deps.readFinancialHistory
          ? await deps.readFinancialHistory(historyRequest, abort.signal)
          : (() => {
              throw new Error("HISTORY_UNAVAILABLE");
            })()
        : await deps.readLatest(binding, abort.signal);
      if (!(await allowed())) return fail(403);
      trace?.enter("PROJECTION_REQUEST");
      const after = await deps.resolveActiveBinding(binding, userId, abort.signal);
      if (!after || !sameObservationBinding(after, binding))
        return fail(after && configurationChanged(binding, after) ? 409 : 403);
      if (abort.signal.aborted) return fail(503);
      if (!stored) return new Response(null, { status: 204, headers });
      trace?.enter("OBSERVATION_VALIDATION");
      if (historyRequest) {
        const history = financialHistoryResponseSchema.parse(stored);
        assertFinancialHistoryResponse(historyRequest, history);
        return Response.json(history, { headers });
      }
      const o = parseAccountObservation(stored);
      if (!sameObservationBinding(binding, o.binding)) return fail(503);
      return Response.json(o, { headers });
    };
    const response = await Promise.race([execute().catch(() => fail(503)), timeout]);
    if (response.status !== 503) trace?.complete();
    return response;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    abort.abort();
  }
}
