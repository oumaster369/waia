import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { handleAccountObservationGet } from "@/lib/trader/account-observation/read-handler";
import { createAccountObservationRouteDependencies } from "@/lib/trader/account-observation/route";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { handleAdminConnectedAccountsGet } from "@/lib/trader/credentials/admin-connected-accounts-handler";
import type { ConnectedHtxAccountDto } from "@/lib/trader/credentials/connected-accounts.types";
import {
  buildFleetPortfolio,
  type FleetAccountRef,
  type FleetObservationRead,
} from "./fleet-portfolio";

/** Read-side composition only. Each observation stays inside its own RLS scope. */
export async function handleAdminFleetPortfolioGet(
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const listed = await handleAdminConnectedAccountsGet(deps);
  if (listed.status !== 200 || !listed.body || Array.isArray(listed.body)) return listed;
  const accounts = accountsFrom(listed.body);
  const context = createAccountObservationRouteDependencies();
  try {
    const portfolio = await buildFleetPortfolio({
      accounts,
      read: (account, signal) => readScopedObservation(context.deps, account, signal),
    });
    return adminSuccess(portfolio, listed.waiaDbBackend);
  } finally {
    await context.dispose();
  }
}

function accountsFrom(body: Record<string, unknown>): FleetAccountRef[] {
  const rows = body.accounts;
  if (!Array.isArray(rows)) return [];
  return rows.filter(isAccount).map((row) => ({
    organizationId: row.organizationId,
    accountName: row.accountName,
    credentialId: row.credentialId,
    exchangeAccountId: row.exchangeAccountId,
  }));
}

function isAccount(value: unknown): value is ConnectedHtxAccountDto {
  if (!value || typeof value !== "object") return false;
  const row = value as ConnectedHtxAccountDto;
  return row.venue === "htx" && row.status === "active" && typeof row.organizationId === "string";
}

async function readScopedObservation(
  deps: Parameters<typeof handleAccountObservationGet>[2],
  account: FleetAccountRef,
  signal: AbortSignal,
): Promise<FleetObservationRead> {
  const bindingParams = new URLSearchParams({
    organizationId: account.organizationId,
    credentialId: account.credentialId,
    exchangeAccountId: account.exchangeAccountId,
  });
  const bindingResponse = await handleAccountObservationGet(
    new Request(`http://localhost/binding?${bindingParams}`, { signal }),
    "admin",
    deps,
    "binding",
  );
  if (bindingResponse.status === 204) return { ok: true, observation: null };
  if (!bindingResponse.ok) return { ok: false, reason: `HTTP_${bindingResponse.status}` };
  const binding = (await bindingResponse.json()) as Record<string, string>;
  const observationParams = new URLSearchParams(binding);
  const observationResponse = await handleAccountObservationGet(
    new Request(`http://localhost/observation?${observationParams}`, { signal }),
    "admin",
    deps,
  );
  if (observationResponse.status === 204) return { ok: true, observation: null };
  if (!observationResponse.ok) return { ok: false, reason: `HTTP_${observationResponse.status}` };
  return { ok: true, observation: parseAccountObservation(await observationResponse.json()) };
}
