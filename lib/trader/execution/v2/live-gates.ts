import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";
import { resolveOrg0OrganizationId } from "@/lib/trader/live/org0-allowlist";
import { requireHtxStoredPermissionMetadata } from "@/lib/trader/security/htx-secure-credential-resolver";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Every live Execution V2 bind must pass all of these. A missing gate refuses.
 * This check does not decrypt credentials and does not enable live trading.
 */
export const EXECUTION_V2_LIVE_GATE_REASONS = [
  "LIVE_MODE_REQUIRED",
  "ORG0_ALLOWLIST_UNSET",
  "ORG0_NOT_ALLOWLISTED",
  "LIVE_ENABLE_ABSENT",
  "LIVE_ENABLE_NOT_ENABLED",
  "LIVE_NOTIONAL_CAP_NOT_POSITIVE",
  "STRATEGY_CONTEXT_ABSENT",
  "PROMOTION_NOT_EFFECTIVE",
  "PROMOTION_VERSION_MISMATCH",
  "CREDENTIAL_REQUIRED",
  "CREDENTIAL_NOT_TRADE_SCOPED",
  "LIVE_NOTIONAL_CAP_EXCEEDED",
] as const;

export type ExecutionV2LiveGateReason = (typeof EXECUTION_V2_LIVE_GATE_REASONS)[number];

export class ExecutionV2LiveGateRefusedError extends Error {
  constructor(readonly reason: ExecutionV2LiveGateReason) {
    super(`Execution V2 live gate refused: ${reason}`);
    this.name = "ExecutionV2LiveGateRefusedError";
  }
}

export type ExecutionV2LiveGateCredential = Readonly<{
  status: string;
  venue: string;
  exchangeAccountId: string;
  permissionMetadata: Record<string, unknown> | null;
}>;

export type ExecutionV2LiveGateFacts = Readonly<{
  executionMode: "mock" | "paper" | "live";
  organizationId: string;
  org0OrganizationId: string | null;
  liveEnable: Readonly<{ state: string; maxNotionalCap: string }> | null;
  strategyId: string | null;
  strategyVersion: string | null;
  promotion: Readonly<{ strategyId: string; strategyVersion: string; state: string }> | null;
  credentialId: string | null;
  credential: ExecutionV2LiveGateCredential | null;
  requestedNotional: string;
}>;

export type ExecutionV2LiveGateVerdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: ExecutionV2LiveGateReason }>;

export type ExecutionV2LiveGateRequest = Readonly<{
  executionMode: "mock" | "paper" | "live";
  credentialId: string | null;
  strategyId?: string | null;
  strategyVersion?: string | null;
  plan: Readonly<{ approvedNotionalCeiling: string }>;
}>;

type LiveGateExecutor = Pick<WaiaPostgresDb, "select" | "execute">;

function refuse(reason: ExecutionV2LiveGateReason): ExecutionV2LiveGateVerdict {
  return Object.freeze({ ok: false, reason });
}

function blank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function tradeScopeAccepted(credential: ExecutionV2LiveGateCredential): boolean {
  try {
    requireHtxStoredPermissionMetadata({
      purpose: "trade",
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

/** Pure fail-closed classification. Any absent or unfit gate refuses. */
export function evaluateExecutionV2LiveGates(
  facts: ExecutionV2LiveGateFacts,
): ExecutionV2LiveGateVerdict {
  if (facts.executionMode !== "live") return refuse("LIVE_MODE_REQUIRED");
  if (facts.org0OrganizationId === null) return refuse("ORG0_ALLOWLIST_UNSET");
  if (facts.org0OrganizationId !== facts.organizationId) return refuse("ORG0_NOT_ALLOWLISTED");
  if (!facts.liveEnable) return refuse("LIVE_ENABLE_ABSENT");
  if (facts.liveEnable.state !== "ENABLED") return refuse("LIVE_ENABLE_NOT_ENABLED");

  try {
    if (compareDecimal(facts.liveEnable.maxNotionalCap, "0") <= 0) {
      return refuse("LIVE_NOTIONAL_CAP_NOT_POSITIVE");
    }
  } catch {
    return refuse("LIVE_NOTIONAL_CAP_NOT_POSITIVE");
  }

  const strategyId = facts.strategyId?.trim() ?? "";
  const strategyVersion = facts.strategyVersion?.trim() ?? "";
  if (!strategyId || !strategyVersion) return refuse("STRATEGY_CONTEXT_ABSENT");
  if (
    !facts.promotion ||
    facts.promotion.state !== "EFFECTIVE" ||
    facts.promotion.strategyId !== strategyId
  ) {
    return refuse("PROMOTION_NOT_EFFECTIVE");
  }
  if (facts.promotion.strategyVersion !== strategyVersion) {
    return refuse("PROMOTION_VERSION_MISMATCH");
  }

  if (blank(facts.credentialId) || !facts.credential) return refuse("CREDENTIAL_REQUIRED");
  if (
    facts.credential.status !== "active" ||
    facts.credential.venue !== "htx" ||
    blank(facts.credential.exchangeAccountId)
  ) {
    return refuse("CREDENTIAL_REQUIRED");
  }
  if (!tradeScopeAccepted(facts.credential)) return refuse("CREDENTIAL_NOT_TRADE_SCOPED");

  try {
    if (compareDecimal(facts.requestedNotional, facts.liveEnable.maxNotionalCap) > 0) {
      return refuse("LIVE_NOTIONAL_CAP_EXCEEDED");
    }
  } catch {
    return refuse("LIVE_NOTIONAL_CAP_EXCEEDED");
  }

  return Object.freeze({ ok: true });
}

export function parseStoredPermissionMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Zero or several EFFECTIVE rows are not a promotion. Exactly one row is
 * passed through so a version mismatch stays distinct from absence.
 */
export function assembleExecutionV2LiveGateFacts(
  input: Readonly<{
    executionMode: ExecutionV2LiveGateFacts["executionMode"];
    organizationId: string;
    org0OrganizationId: string | null;
    requestedNotional: string;
    strategyId: string | null;
    strategyVersion: string | null;
    credentialId: string | null;
    liveEnable: ExecutionV2LiveGateFacts["liveEnable"];
    effectivePromotions: readonly NonNullable<ExecutionV2LiveGateFacts["promotion"]>[];
    credential: ExecutionV2LiveGateCredential | null;
  }>,
): ExecutionV2LiveGateFacts {
  return Object.freeze({
    executionMode: input.executionMode,
    organizationId: input.organizationId,
    org0OrganizationId: input.org0OrganizationId,
    liveEnable: input.liveEnable,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    promotion: input.effectivePromotions.length === 1 ? input.effectivePromotions[0]! : null,
    credentialId: input.credentialId,
    credential: blank(input.credentialId) ? null : input.credential,
    requestedNotional: input.requestedNotional,
  });
}

/**
 * Authoritative live-gate read. Selects no encrypted credential payload.
 * `lock_timeout` is set inside the caller's transaction before the row locks.
 */
export async function assertExecutionV2LiveGatesPostgres(
  executor: LiveGateExecutor,
  context: OrgContext,
  request: ExecutionV2LiveGateRequest,
  env?: Record<string, unknown>,
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);
  await executor.execute(sql`select set_config('lock_timeout', '5s', true)`);

  const liveRows = await executor
    .select({
      state: pgSchema.traderOrgLiveEnable.state,
      maxNotionalCap: pgSchema.traderOrgLiveEnable.maxNotionalCap,
    })
    .from(pgSchema.traderOrgLiveEnable)
    .where(eq(pgSchema.traderOrgLiveEnable.organizationId, scoped.organizationId))
    .limit(1)
    .for("update");

  const strategyId = request.strategyId?.trim() ?? "";
  const promotionRows = strategyId
    ? await executor
        .select({
          strategyId: pgSchema.traderStrategyPromotionRecords.strategyId,
          strategyVersion: pgSchema.traderStrategyPromotionRecords.strategyVersion,
          state: pgSchema.traderStrategyPromotionRecords.state,
        })
        .from(pgSchema.traderStrategyPromotionRecords)
        .where(
          and(
            eq(pgSchema.traderStrategyPromotionRecords.organizationId, scoped.organizationId),
            eq(pgSchema.traderStrategyPromotionRecords.strategyId, strategyId),
            eq(pgSchema.traderStrategyPromotionRecords.state, "EFFECTIVE"),
          ),
        )
        .limit(2)
        .for("update")
    : [];

  const credentialId = request.credentialId?.trim() ?? "";
  const credentialRows = credentialId
    ? await executor
        .select({
          status: pgSchema.exchangeCredentials.status,
          venue: pgSchema.exchangeCredentials.venue,
          exchangeAccountId: pgSchema.exchangeCredentials.exchangeAccountId,
          permissionMetadata: pgSchema.exchangeCredentials.permissionMetadata,
        })
        .from(pgSchema.exchangeCredentials)
        .where(
          and(
            eq(pgSchema.exchangeCredentials.id, credentialId),
            eq(pgSchema.exchangeCredentials.organizationId, scoped.organizationId),
          ),
        )
        .limit(1)
        .for("update")
    : [];

  const credentialRow = credentialRows[0] ?? null;
  const verdict = evaluateExecutionV2LiveGates(
    assembleExecutionV2LiveGateFacts({
      executionMode: request.executionMode,
      organizationId: scoped.organizationId,
      org0OrganizationId: resolveOrg0OrganizationId(env),
      requestedNotional: request.plan.approvedNotionalCeiling,
      strategyId: request.strategyId ?? null,
      strategyVersion: request.strategyVersion ?? null,
      credentialId: request.credentialId,
      liveEnable: liveRows[0]
        ? { state: liveRows[0].state, maxNotionalCap: liveRows[0].maxNotionalCap }
        : null,
      effectivePromotions: promotionRows,
      credential: credentialRow
        ? {
            status: credentialRow.status,
            venue: credentialRow.venue,
            exchangeAccountId: credentialRow.exchangeAccountId,
            permissionMetadata: parseStoredPermissionMetadata(credentialRow.permissionMetadata),
          }
        : null,
    }),
  );
  if (!verdict.ok) throw new ExecutionV2LiveGateRefusedError(verdict.reason);
}
