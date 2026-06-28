import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { createExchangeConnector } from "@/lib/trader/connectors/registry";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  resolveHtxSecureCredential,
  toHtxExchangeConnectorConfig,
} from "@/lib/trader/security/htx-secure-credential-resolver";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type CreateLiveHtxConnectorInput = {
  context: OrgContext;
  credentialId: string;
  credentialService: CredentialService;
  fetchImpl?: typeof fetch;
};

/** Build a validated HTX live connector from stored credentials (CLI/host path only). */
export async function createLiveHtxConnector(
  input: CreateLiveHtxConnectorInput,
): Promise<ExchangeConnector> {
  const scoped = requireOrgContext(input.context.organizationId);
  const metadata = await input.credentialService.listCredentialMetadata(scoped);
  const credential = metadata.find((row) => row.id === input.credentialId);
  if (!credential || credential.status !== "active" || credential.venue !== "htx") {
    throw new Error("[trader/live] active HTX credential not found");
  }

  const decrypted = await input.credentialService.getDecryptedCredentials(
    scoped,
    input.credentialId,
  );
  const resolved = resolveHtxSecureCredential({
    venue: credential.venue,
    exchangeAccountId: credential.exchangeAccountId,
    credentials: decrypted,
    permissionMetadata: credential.permissionMetadata,
  });
  const connector = createExchangeConnector("htx", {
    credentials: toHtxExchangeConnectorConfig(resolved),
    fetchImpl: input.fetchImpl,
  });
  await connector.validateCredentials({
    apiKey: resolved.apiKey,
    apiSecret: resolved.apiSecret,
  });
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
