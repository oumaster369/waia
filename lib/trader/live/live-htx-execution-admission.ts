import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  emitTraderTelemetry,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";
import { requireHtxStoredPermissionMetadata } from "@/lib/trader/security/htx-secure-credential-resolver";

export const LIVE_HTX_EXECUTION_ADMISSION_REASONS = [
  "LIVE_HTX_CREDENTIAL_ABSENT",
  "LIVE_HTX_CREDENTIAL_READ_ONLY",
] as const;

export type LiveHtxExecutionAdmissionReason =
  (typeof LIVE_HTX_EXECUTION_ADMISSION_REASONS)[number];

export class LiveHtxExecutionAdmissionError extends Error {
  readonly killState = "TRIPPED" as const;

  constructor(readonly code: LiveHtxExecutionAdmissionReason) {
    super(code);
    this.name = "LiveHtxExecutionAdmissionError";
  }
}

export type LiveHtxExecutionCredentialView = Readonly<{
  status: string;
  venue: string;
  exchangeAccountId: string;
  permissionMetadata: Record<string, unknown> | null;
}>;

export type LiveHtxExecutionAdmission =
  | Readonly<{ decision: "ADMITTED" }>
  | Readonly<{
      decision: "REFUSED";
      reason: LiveHtxExecutionAdmissionReason;
      killState: "TRIPPED";
    }>;

function refused(reason: LiveHtxExecutionAdmissionReason): LiveHtxExecutionAdmission {
  return Object.freeze({ decision: "REFUSED", reason, killState: "TRIPPED" });
}

function metadataAllows(
  purpose: "read" | "trade",
  credential: LiveHtxExecutionCredentialView,
): boolean {
  try {
    requireHtxStoredPermissionMetadata({
      purpose,
      venue: credential.venue,
      exchangeAccountId: credential.exchangeAccountId,
      permissionMetadata: credential.permissionMetadata,
    });
    return true;
  } catch (error) {
    if (error instanceof HtxConnectorValidationError) return false;
    throw error;
  }
}

/**
 * Live execution may post only with an active HTX credential whose stored
 * metadata already includes trade. Absence and read-only both refuse.
 * This function does not read secrets and does not call the exchange.
 */
export function classifyLiveHtxExecutionAdmission(input: {
  credentialId: string | null | undefined;
  credential: LiveHtxExecutionCredentialView | null;
}): LiveHtxExecutionAdmission {
  const credentialId = input.credentialId?.trim() ?? "";
  const credential = input.credential;
  if (
    !credentialId ||
    !credential ||
    credential.status !== "active" ||
    credential.venue !== "htx" ||
    credential.exchangeAccountId.trim().length === 0
  ) {
    return refused("LIVE_HTX_CREDENTIAL_ABSENT");
  }
  if (metadataAllows("trade", credential)) return Object.freeze({ decision: "ADMITTED" });
  if (metadataAllows("read", credential)) return refused("LIVE_HTX_CREDENTIAL_READ_ONLY");
  return refused("LIVE_HTX_CREDENTIAL_ABSENT");
}

/**
 * Fail closed before any exchange POST. Emits kill-state telemetry and throws.
 * `placeOrder`, when supplied, is not called.
 */
export function assertLiveHtxExecutionAdmission(input: {
  organizationId: string;
  credentialId: string | null | undefined;
  credential: LiveHtxExecutionCredentialView | null;
  sink?: WaiaTraderTelemetrySink;
  placeOrder?: () => Promise<unknown>;
}): void {
  const verdict = classifyLiveHtxExecutionAdmission(input);
  if (verdict.decision === "ADMITTED") return;
  emitTraderTelemetry(
    {
      event: "waia_trader_event",
      kind: "execution",
      organization_id: input.organizationId,
      outcome: verdict.reason,
      severity: "critical",
      kill_state: verdict.killState,
      error_class: "LiveHtxExecutionAdmissionError",
    },
    input.sink,
  );
  void input.placeOrder;
  throw new LiveHtxExecutionAdmissionError(verdict.reason);
}
