import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  emitTraderTelemetry,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { AccountInfo } from "@/lib/trader/connectors/types";
import {
  writeOrganizationCredentialKillSwitchPostgres,
  writeOrganizationCredentialKillSwitchSqlite,
} from "@/lib/trader/execution/v2/credential-gate-kill";
import { createExchangeConnector } from "@/lib/trader/connectors/registry";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  assertLiveHtxExecutionAdmission,
  LiveHtxExecutionAdmissionError,
  type LiveHtxExecutionAdmissionReason,
} from "@/lib/trader/live/live-htx-execution-admission";
import {
  requireHtxStoredPermissionMetadata,
  resolveHtxSecureCredential,
  toHtxExchangeConnectorConfig,
} from "@/lib/trader/security/htx-secure-credential-resolver";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PostgresKillSwitchDb = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "execute"> &
  Partial<Pick<WaiaPostgresDb, "transaction">>;

export type LiveKillSwitchDb = PostgresKillSwitchDb | { readonly sqlite: WaiaDb };

export type LiveCredentialKillSwitchWriter = (
  reason: LiveHtxExecutionAdmissionReason,
) => Promise<"WRITTEN" | "ALREADY_ACTIVE">;

function isSqliteLiveKillSwitchDb(value: LiveKillSwitchDb): value is { readonly sqlite: WaiaDb } {
  return "sqlite" in value && !("execute" in value);
}

function dropInMemoryPlacementKey(connector: ExchangeConnector): void {
  const drop = (connector as ExchangeConnector & { dropInMemoryCredentials?: () => void })
    .dropInMemoryCredentials;
  drop?.call(connector);
}

/** Venue `getAccountInfo` says read-only while identity still matches the stored account. */
function venueReportedReadOnly(account: AccountInfo, spotAccountId: string): boolean {
  return (
    account.accountId === spotAccountId &&
    account.venue === "htx" &&
    account.marketType === "spot" &&
    account.permissions.includes("read") &&
    !account.permissions.includes("trade") &&
    account.permissions.every((scope) => scope === "read")
  );
}

export type CreateLiveHtxConnectorInput = {
  context: OrgContext;
  credentialId: string;
  credentialService: CredentialService;
  fetchImpl?: typeof fetch;
  telemetrySink?: WaiaTraderTelemetrySink;
  /**
   * When set, a credential refusal writes the organization kill switch.
   * Postgres callers pass the executor. The SQLite live CLI passes `{ sqlite }`.
   */
  killSwitchDb?: LiveKillSwitchDb;
  /** Test seam. Production callers pass `killSwitchDb` instead. */
  writeKillSwitch?: LiveCredentialKillSwitchWriter;
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
  const writeKillSwitch: LiveCredentialKillSwitchWriter | undefined = input.killSwitchDb
    ? async (reason) => {
        const gateReason =
          reason === "LIVE_HTX_CREDENTIAL_READ_ONLY"
            ? "CREDENTIAL_NOT_TRADE_SCOPED"
            : "CREDENTIAL_REQUIRED";
        const killSwitchDb = input.killSwitchDb!;
        if (isSqliteLiveKillSwitchDb(killSwitchDb)) {
          return writeOrganizationCredentialKillSwitchSqlite(
            killSwitchDb.sqlite,
            scoped.organizationId,
            gateReason,
          );
        }
        return writeOrganizationCredentialKillSwitchPostgres(
          killSwitchDb,
          scoped.organizationId,
          gateReason,
        );
      }
    : input.writeKillSwitch;
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
  try {
    const validation = await connector.validateCredentials({
      apiKey: resolved.apiKey,
      apiSecret: resolved.apiSecret,
    });
    if (!validation.valid || validation.accountId !== resolved.spotAccountId) {
      throw new Error("[trader/live] HTX exact stored account admission failed");
    }
    const account = await connector.getAccountInfo();
    if (venueReportedReadOnly(account, resolved.spotAccountId)) {
      let killSwitchWrite: "WRITTEN" | "ALREADY_ACTIVE" | "NOT_ATTEMPTED" = "NOT_ATTEMPTED";
      try {
        if (writeKillSwitch) {
          killSwitchWrite = await writeKillSwitch("LIVE_HTX_CREDENTIAL_READ_ONLY");
        }
      } catch (error) {
        throw new LiveHtxExecutionAdmissionError("LIVE_HTX_CREDENTIAL_READ_ONLY", {
          cause: error,
        });
      }
      emitTraderTelemetry(
        {
          event: "waia_trader_event",
          kind: "execution",
          organization_id: scoped.organizationId,
          outcome: "LIVE_HTX_CREDENTIAL_READ_ONLY",
          severity: "critical",
          kill_state_telemetry: "TRIPPED",
          kill_switch_write: killSwitchWrite,
          error_class: "LiveHtxExecutionAdmissionError",
        },
        input.telemetrySink,
      );
      throw new LiveHtxExecutionAdmissionError("LIVE_HTX_CREDENTIAL_READ_ONLY");
    }
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
    return connector;
  } catch (error) {
    dropInMemoryPlacementKey(connector);
    throw error;
  }
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
