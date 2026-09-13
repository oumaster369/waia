import "server-only";
import type { Sql } from "postgres";
import { createPostgresObservationReader } from "./postgres-reader";
import { createObservationConfiguration, type ObservationAssignment } from "./runtime";
import { observationBindingSchema } from "./validation";
import type { ObservationBinding } from "./types";

/** Filter explicitly authorized, exact-revision targets through current DB state.
 * No all-account scan, key access, assignment creation or automatic reauthorization
 * on rotation. The supplied list must come from trusted operator provisioning,
 * never request parameters. A DB match alone is not venue/key admission.
 * Use its functions as runtime.loadAssignments and opener.authorizeOpen. */
export function createPostgresObservationAssignmentSource(sql: Sql, configured: readonly ObservationAssignment[]) {
  if (!Array.isArray(configured) || configured.length > 20) throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENT_LIMIT");
  const approved = new Map<string, ObservationAssignment>();
  const accounts = new Set<string>();
  const key = (b: ObservationBinding) => JSON.stringify(b);
  for (const item of configured) {
    const binding = Object.freeze(observationBindingSchema.parse(item.binding));
    const { revision, ...parameters } = item.config;
    const config = createObservationConfiguration(parameters);
    const account = JSON.stringify([binding.organizationId, binding.exchangeAccountId]);
    if (revision !== config.revision || binding.configurationRevision !== config.revision || accounts.has(account))
      throw new Error("ACCOUNT_OBSERVATION_INVALID_ASSIGNMENT");
    accounts.add(account); approved.set(key(binding), Object.freeze({ binding, config }));
  }
  const reader = createPostgresObservationReader(sql);
  let loading = false;
  const cancelled = (signal: AbortSignal) => {
    if (signal.aborted) throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENTS_CANCELLED");
  };
  const current = async (assignment: ObservationAssignment, signal: AbortSignal) => {
    cancelled(signal);
    const result = await reader.isCurrentAssignment(assignment.binding, assignment.config.symbols);
    // Cancellation never publishes a late DB result. SQL timeouts bound in-flight
    // queries; the owner supplies a bounded pool/connect timeout as for the reader.
    cancelled(signal); return result;
  };
  return Object.freeze({
    async loadAssignments(signal: AbortSignal): Promise<readonly ObservationAssignment[]> {
      if (loading) throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENTS_BUSY");
      loading = true;
      try {
        cancelled(signal);
        const result: ObservationAssignment[] = [];
        for (const assignment of approved.values()) if (await current(assignment, signal)) result.push(assignment);
        return Object.freeze(result);
      } finally { loading = false; }
    },
    async authorizeOpen(input: ObservationBinding, signal: AbortSignal): Promise<boolean> {
      cancelled(signal);
      const assignment = approved.get(key(observationBindingSchema.parse(input)));
      return assignment ? current(assignment, signal) : false;
    },
  });
}
