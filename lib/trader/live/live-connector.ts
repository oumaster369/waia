import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { writeOrganizationCredentialKillSwitchPostgres } from "@/lib/trader/execution/v2/credential-gate-kill";
import { createExchangeConnector } from "@/lib/trader/connectors/registry";
import type { CredentialService } from "@/lib/trader/credentials/types";
import { assertLiveHtxExecutionAdmission } from "@/lib/trader/live/live-htx-execution-admission";
import {
  requireHtxStoredPermissionMetadata,
  resolveHtxSecureCredential,
  toHtxExchangeConnectorConfig,
} from "@/lib/trader/security/htx-secure-credential-resolver";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type CreateLiveHtxConnectorInput = {
  context: OrgContext;
  credentialId: string;
  credentialService: CredentialService;
  fetchImpl?: typeof fetch;
  telemetrySink?: WaiaTraderTelemetrySink;
  /** When set, a credential refusal writes the organization kill switch. */
  killSwitchDb?: Pick<WaiaPostgresDb, "select" | "insert" | "update" | "execute"> &
    Partial<Pick<WaiaPostgresDb, "transaction">>;
};

/** Build a validated HTX live connector from stored credentials (CLI/host path only). */
export async function createLiveHtxConnector(
  input: CreateLiveHtxConnectorInput,
): Promise<ExchangeConnector> {
  const scoped = requireOrgContext(input.context.organizationId);
  const metadata = await input.credentialService.listCredentialMetadata(scoped);
  const credential = metadata.find((row) => row.id === input.credentialId) ?? null;
  const activeHtx =
    credential && credential.status === "active" && credential.venue === "htx" ? credential : null;
  const credentialView = (row: NonNullable<typeof activeHtx>) => ({
    status: row.status,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    permissionMetadata: row.permissionMetadata,
  });
  const writeKillSwitch = input.killSwitchDb
    ? async (reason: "LIVE_HTX_CREDENTIAL_ABSENT" | "LIVE_HTX_CREDENTIAL_READ_ONLY") => {
        const gateReason =
          reason === "LIVE_HTX_CREDENTIAL_READ_ONLY"
            ? "CREDENTIAL_NOT_TRADE_SCOPED"
            : "CREDENTIAL_REQUIRED";
        return writeOrganizationCredentialKillSwitchPostgres(
          input.killSwitchDb!,
          scoped.organizationId,
          gateReason,
        );
      }
    : undefined;
  await assertLiveHtxExecutionAdmission({
    organizationId: scoped.organizationId,
    credentialId: input.credentialId,
    credential: activeHtx ? credentialView(activeHtx) : null,
    sink: input.telemetrySink,
    writeKillSwitch,
  });
  if (!activeHtx) {
    throw new Error("[trader/live] active HTX credential not found");
  }

  requireHtxStoredPermissionMetadata({
    purpose: "trade",
    venue: activeHtx.venue,
    exchangeAccountId: activeHtx.exchangeAccountId,
    permissionMetadata: activeHtx.permissionMetadata,
  });

  const decrypted = await input.credentialService.getDecryptedCredentials(
    scoped,
    input.credentialId,
  );
  const resolved = resolveHtxSecureCredential({
    purpose: "trade",
    venue: activeHtx.venue,
    exchangeAccountId: activeHtx.exchangeAccountId,
    credentials: decrypted,
    permissionMetadata: activeHtx.permissionMetadata,
  });
  const connector = createExchangeConnector("htx", {
    credentials: toHtxExchangeConnectorConfig(resolved),
    fetchImpl: input.fetchImpl,
    expectedSpotAccountId: resolved.spotAccountId,
  });
  const validation = await connector.validateCredentials({
    apiKey: resolved.apiKey,
    apiSecret: resolved.apiSecret,
  });
  if (!validation.valid || validation.accountId !== resolved.spotAccountId) {
    throw new Error("[trader/live] HTX exact stored account admission failed");
  }
  const account = await connector.getAccountInfo();
  if (
    account.accountId !== resolved.spotAccountId ||
    account.venue !== "htx" ||
    account.marketType !== "spot" ||
    !account.permissions.includes("read") ||
    !account.permissions.includes("trade") ||
    account.permissions.some((scope) => scope !== "read" && scope !== "trade")
  ) {
    throw new Error("[trader/live] HTX fresh trade permission admission failed");
  }
  const placeOrder = connector.placeOrder.bind(connector);
  const drop = (connector as ExchangeConnector & { dropInMemoryCredentials?: () => void })
    .dropInMemoryCredentials;
  connector.placeOrder = async (order) => {
    const latest = await input.credentialService.listCredentialMetadata(scoped);
    const row = latest.find((item) => item.id === input.credentialId) ?? null;
    const stillActive = row && row.status === "active" && row.venue === "htx" ? row : null;
    try {
      await assertLiveHtxExecutionAdmission({
        organizationId: scoped.organizationId,
        credentialId: input.credentialId,
        credential: stillActive ? credentialView(stillActive) : null,
        sink: input.telemetrySink,
        writeKillSwitch,
      });
    } catch (error) {
      drop?.call(connector);
      throw error;
    }
    return placeOrder(order);
  };
  return connector;
}

export function createLiveConnectorForMode(
  liveConnector: ExchangeConnector,
): (executionMode: "live" | "mock" | "paper") => ExchangeConnector {
  return (executionMode) => {
    if (executionMode === "live") {
      return liveConnector;
    }
    throw new Error(
      `[trader/live] unsupported execution mode for live connector factory: ${executionMode}`,
    );
  };
}
