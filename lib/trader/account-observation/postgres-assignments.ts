import "server-only";
import type { Sql } from "postgres";
import { createPostgresObservationReader } from "./postgres-reader";
import { createObservationConfiguration, type ObservationAssignment } from "./runtime";
import { observationBindingSchema } from "./validation";
import type { ObservationBinding } from "./types";

/** Filter explicitly authorized, exact-revision targets through current DB state.
 * Manifest bindings are the operator envelope. Additional live enrollments come from
 * collection-state rows that already exist for active HTX credentials with that envelope
 * revision — never from request parameters. A DB match alone is not venue/key admission.
 * Use its functions as runtime.loadAssignments and opener.authorizeOpen. */
export function createPostgresObservationAssignmentSource(
  sql: Sql,
  configured: readonly ObservationAssignment[],
  collectorSql?: Sql,
) {
  if (!Array.isArray(configured) || configured.length > 20)
    throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENT_LIMIT");
  const approved = new Map<string, ObservationAssignment>();
  const accounts = new Set<string>();
  const key = (b: ObservationBinding) => JSON.stringify(b);
  const accountKey = (b: ObservationBinding) =>
    JSON.stringify([b.organizationId, b.exchangeAccountId]);
  for (const item of configured) {
    const binding = Object.freeze(observationBindingSchema.parse(item.binding));
    const { revision, ...parameters } = item.config;
    const config = createObservationConfiguration(parameters);
    const account = accountKey(binding);
    if (
      revision !== config.revision ||
      binding.configurationRevision !== config.revision ||
      accounts.has(account)
    )
      throw new Error("ACCOUNT_OBSERVATION_INVALID_ASSIGNMENT");
    accounts.add(account);
    approved.set(key(binding), Object.freeze({ binding, config }));
  }
  // Only a spot envelope can admit self-service inventory, regardless of manifest order.
  const envelope = [...approved.values()].find(item => !item.config.htxDerivativesFamilies?.length);
  const reader = createPostgresObservationReader(sql);
  let loading = false;
  let live = new Map<string, ObservationAssignment>();
  const cancelled = (signal: AbortSignal) => {
    if (signal.aborted) throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENTS_CANCELLED");
  };
  const current = async (assignment: ObservationAssignment, signal: AbortSignal) => {
    cancelled(signal);
    const result = await reader.isCurrentAssignment(assignment.binding, assignment.config.symbols);
    cancelled(signal);
    return result;
  };
  async function inventory(signal: AbortSignal): Promise<readonly ObservationAssignment[]> {
    // A spot self-service configuration match cannot grant derivatives family
    // access or displace exact manifest-listed assignments from the bounded list.
    if (!collectorSql || !envelope || envelope.config.htxDerivativesFamilies?.length) return [];
    cancelled(signal);
    try {
      const rows = await collectorSql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE waia_account_observation_inventory");
        await tx.unsafe("SET LOCAL statement_timeout = '3000ms'");
        await tx.unsafe("SET LOCAL lock_timeout = '1000ms'");
        return tx<
          {
            organization_id: string;
            credential_id: string;
            exchange_account_id: string;
            credential_revision: string;
            configuration_revision: string;
            symbols: unknown;
          }[]
        >`
          SELECT organization_id, credential_id, exchange_account_id,
            credential_revision, configuration_revision, symbols
          FROM public.trader_account_observation_spot_inventory(
            ${envelope.config.revision},
            ${tx.json(envelope.config.symbols)}::jsonb)`;
      });
      cancelled(signal);
      const extra: ObservationAssignment[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const symbols = Array.isArray(row.symbols)
          ? row.symbols.filter((item): item is string => typeof item === "string")
          : [];
        if (JSON.stringify(symbols) !== JSON.stringify(envelope.config.symbols)) continue;
        const binding = observationBindingSchema.parse({
          organizationId: row.organization_id,
          credentialId: row.credential_id,
          exchangeAccountId: row.exchange_account_id,
          credentialRevision: row.credential_revision,
          configurationRevision: row.configuration_revision,
        });
        const account = accountKey(binding);
        if (seen.has(account)) continue;
        seen.add(account);
        extra.push(Object.freeze({ binding: Object.freeze(binding), config: envelope.config }));
      }
      if (extra.length > 20) throw new Error("ACCOUNT_OBSERVATION_INVENTORY_OVERFLOW");
      return extra;
    } catch (error) {
      if (error instanceof Error && error.message === "ACCOUNT_OBSERVATION_ASSIGNMENTS_CANCELLED")
        throw error;
      live.clear();
      throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENTS_FAILED");
    }
  }
  return Object.freeze({
    async loadAssignments(signal: AbortSignal): Promise<readonly ObservationAssignment[]> {
      if (loading) throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENTS_BUSY");
      loading = true;
      try {
        cancelled(signal);
        const next = new Map<string, ObservationAssignment>();
        const seenAccounts = new Set<string>();
        const add = (assignment: ObservationAssignment) => {
          const account = accountKey(assignment.binding);
          if (seenAccounts.has(account) || next.size >= 20) return;
          seenAccounts.add(account);
          next.set(key(assignment.binding), assignment);
        };
        // Reserve scheduler capacity for exact operator assignments, including
        // futures accounts when the first assignment is a spot-only envelope.
        for (const assignment of approved.values()) {
          if (await current(assignment, signal)) add(assignment);
        }
        for (const assignment of await inventory(signal)) {
          if (seenAccounts.has(accountKey(assignment.binding)) || next.size >= 20) continue;
          if (await current(assignment, signal)) add(assignment);
        }
        live = next;
        return Object.freeze([...next.values()]);
      } finally {
        loading = false;
      }
    },
    async authorizeOpen(input: ObservationBinding, signal: AbortSignal): Promise<boolean> {
      cancelled(signal);
      const parsed = observationBindingSchema.parse(input);
      const assignment = live.get(key(parsed)) ?? approved.get(key(parsed));
      return assignment ? current(assignment, signal) : false;
    },
  });
}
