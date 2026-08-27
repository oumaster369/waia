import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb, type WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { PostgresDisposeOutcome } from "@/db/postgres-client";
import type { WaiaRuntimeRouteOutcome } from "@/lib/observability/waia-runtime-route-telemetry";
import {
  PublicTreasuryBindingError,
  resolvePublicTreasuryOrganization,
} from "@/lib/waia-core/treasury/public/binding";
import { createPostgresPublicTreasuryFactsRepository } from "@/lib/waia-core/treasury/public/postgres-repository";
import { derivePublicTreasuryProjection } from "@/lib/waia-core/treasury/public/projection";
import type { PublicTreasuryFactsRepository } from "@/lib/waia-core/treasury/public/repository.types";
import type { PublicTreasuryProjection } from "@/lib/waia-core/treasury/public/types";

export type PublicTreasuryHttpResult = {
  status: number;
  body: PublicTreasuryProjection | { error: { code: string; message: string } };
  outcome: WaiaRuntimeRouteOutcome;
  waiaDbBackend?: WaiaRuntimeDb["kind"];
  errorClass?: string;
  pgCloseOutcome?: PostgresDisposeOutcome;
};

export type PublicTreasuryHttpDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  getRuntimeDb?: () => Promise<WaiaRuntimeDb>;
  disposeRuntimeDb?: (
    runtime: WaiaRuntimeDb | undefined,
  ) => Promise<PostgresDisposeOutcome | undefined>;
  openFacts?: (
    runtime: Extract<WaiaRuntimeDb, { kind: "postgres" }>,
  ) => PublicTreasuryFactsRepository;
  now?: () => Date;
  transactionOffset?: number;
  transactionLimit?: number;
};

function unavailable(
  code: string,
  message: string,
  outcome: WaiaRuntimeRouteOutcome,
  runtime?: WaiaRuntimeDb,
  errorClass?: string,
): PublicTreasuryHttpResult {
  return {
    status: 503,
    body: { error: { code, message } },
    outcome,
    waiaDbBackend: runtime?.kind,
    errorClass,
  };
}
export async function handlePublicTreasuryGet(
  deps: PublicTreasuryHttpDeps = {},
): Promise<PublicTreasuryHttpResult> {
  const getRuntime = deps.getRuntimeDb ?? getWaiaRuntimeDb;
  const disposeRuntime = deps.disposeRuntimeDb ?? disposeWaiaRuntimeDb;
  let runtime: WaiaRuntimeDb | undefined;
  let result: PublicTreasuryHttpResult;
  try {
    const context = resolvePublicTreasuryOrganization(deps.env ?? process.env);
    runtime = await getRuntime();
    if (runtime.kind !== "postgres") {
      result = unavailable(
        "TREASURY_BACKEND_UNAVAILABLE",
        "Public Treasury data is not available.",
        "config_error",
        runtime,
        "TreasuryBackendUnavailable",
      );
    } else {
      const facts = deps.openFacts
        ? deps.openFacts(runtime)
        : createPostgresPublicTreasuryFactsRepository(runtime.db);
      result = {
        status: 200,
        body: derivePublicTreasuryProjection(
          await facts.loadFacts(context),
          deps.now?.() ?? new Date(),
          {
            transactionOffset: deps.transactionOffset,
            transactionLimit: deps.transactionLimit,
          },
        ),
        outcome: "success",
        waiaDbBackend: "postgres",
      };
    }
  } catch (error) {
    result =
      error instanceof PublicTreasuryBindingError
        ? unavailable(
            error.code,
            "Public Treasury data is not configured.",
            "config_error",
            runtime,
            error.name,
          )
        : unavailable(
            "PUBLIC_TREASURY_UNAVAILABLE",
            "Public Treasury data is temporarily unavailable.",
            "internal_error",
            runtime,
            error instanceof Error ? error.name : "Error",
          );
  } finally {
    const pgCloseOutcome = await disposeRuntime(runtime);
    if (pgCloseOutcome) result!.pgCloseOutcome = pgCloseOutcome;
  }
  return result;
}
