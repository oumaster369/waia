import { createPerRequestPostgresRuntime, POSTGRES_CLOSE_GRACE_TIMEOUT_S } from "@/db/postgres-client";
import { getResolvedWaiaDbRuntimeConfig } from "@/db/runtime-backend";
import { catchUpExecutionRealityV2Postgres, type ExecutionRealityDeliveryResult } from "./execution-report-delivery-postgres";
import { captureDeliveryInput, ExecutionRealityDeliveryRefusal } from "./execution-report-delivery-proof";

export function parseExecutionRealityDeliveryArgs(args: readonly string[]) {
  const fields = new Map<string, string>();
  const flags = ["--organization-id", "--account-id", "--execution-attempt-id"];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (!flags.includes(key) || fields.has(key) || !value || value.startsWith("--")) {
      throw new ExecutionRealityDeliveryRefusal("INVALID_INPUT");
    }
    fields.set(key, value);
  }
  return captureDeliveryInput({ organizationId: fields.get(flags[0]!)!,
    accountId: fields.get(flags[1]!)!, executionAttemptId: fields.get(flags[2]!)! });
}

/** Real Node entry. The only acquired capability is its own PostgreSQL client;
 * tests replace modules, never inject a provider/writer into this public API. */
export async function runExecutionRealityDeliveryCli(args: readonly string[] = process.argv.slice(2)) {
  let runtime: ReturnType<typeof createPerRequestPostgresRuntime> | undefined;
  let cleanup: "NOT_ACQUIRED" | "CLOSED" | "CLOSE_FAILED" = "NOT_ACQUIRED";
  let result: ExecutionRealityDeliveryResult;
  try {
    const input = parseExecutionRealityDeliveryArgs(args);
    if (process.env.WAIA_TRADER_CLI !== "1") {
      result = { status: "REFUSED", code: "CLI_GATE_REQUIRED", newDeliveryCommitted: false };
    } else if (getResolvedWaiaDbRuntimeConfig().backend !== "postgres") {
      result = { status: "REFUSED", code: "POSTGRES_REQUIRED", newDeliveryCommitted: false };
    } else {
      runtime = createPerRequestPostgresRuntime();
      result = await catchUpExecutionRealityV2Postgres(runtime.db, input);
    }
  } catch (error) {
    result = error instanceof ExecutionRealityDeliveryRefusal
      ? { status: "REFUSED", code: error.code, newDeliveryCommitted: false }
      : runtime
        ? { status: "COMMIT_OUTCOME_UNKNOWN", code: "COMMIT_OUTCOME_UNKNOWN",
            newDeliveryCommitted: "UNKNOWN", retry: "REPEAT_REPORT_DELIVERY_ONLY" }
        : { status: "REFUSED", code: "RUNTIME_CONFIGURATION_INVALID", newDeliveryCommitted: false };
  } finally {
    // Clear ownership before await: rejection cannot retry disposal of this handle.
    const owned = runtime;
    runtime = undefined;
    if (owned) {
      try { await owned._sql.end({ timeout: POSTGRES_CLOSE_GRACE_TIMEOUT_S }); cleanup = "CLOSED"; }
      catch { cleanup = "CLOSE_FAILED"; }
    }
  }
  const output = { result, cleanup };
  process.exitCode = cleanup === "CLOSE_FAILED" || result.status === "FAILED" || result.status === "COMMIT_OUTCOME_UNKNOWN"
    ? 1 : result.status === "REFUSED" ? 2 : 0;
  try { process.stdout.write(`${JSON.stringify(output)}\n`); }
  catch { process.exitCode = 1; }
  return output;
}
