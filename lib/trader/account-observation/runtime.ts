import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";
import { createPostgresObservationRepository } from "./postgres-repository";
import { createAccountObservationService } from "./service";
import { createObservationScheduler } from "./scheduler";
import { observationBindingSchema } from "./validation";
import { accountObservationClock } from "./clock";
import { htxObservationCoverageSchema, htxV5ObservationConfigurationSchema } from "./coverage";
import {
  HTX_DERIVATIVES_ACCOUNT_FAMILIES,
  HTX_DERIVATIVES_FILL_CONTRACT_LIMIT,
  isHtxDerivativesFillContract,
} from "./derivatives/types";
import type {
  AccountObservationReader,
  ObservationBinding,
  ObservationClock,
  ObservationConfig,
} from "./types";
import { HTX_V5_READ_BUDGET_MS } from "./types";


const configurationSchema = z
  .object({
    symbols: z
      .array(z.string().regex(/^[A-Z0-9]{2,32}$/))
      .min(1)
      .max(32),
    pollIntervalMs: z.number().int().min(1000).max(86400000),
    maxBackoffMs: z.number().int().min(1000).max(86400000),
    readTimeoutMs: z.number().int().min(100).max(60000),
    leaseTtlMs: z.number().int().min(1000).max(3600000),
    htxCoverage: htxObservationCoverageSchema.optional(),
    existingKeyReadConsentId: z.string().uuid().optional(),
    htxDerivativesFamilies: z
      .array(z.enum(HTX_DERIVATIVES_ACCOUNT_FAMILIES))
      .min(1)
      .max(HTX_DERIVATIVES_ACCOUNT_FAMILIES.length)
      .optional(),
    htxDerivativesFillContracts: z
      .array(
        z
          .object({
            family: z.enum(HTX_DERIVATIVES_ACCOUNT_FAMILIES),
            contract: z.string().regex(/^[A-Z0-9-]{1,64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(HTX_DERIVATIVES_FILL_CONTRACT_LIMIT)
      .optional(),
    htxV5: htxV5ObservationConfigurationSchema.optional(),
  })
  .strict()
  .refine((c) => {
    const fills = c.htxDerivativesFillContracts ?? [];
    const families = new Set(c.htxDerivativesFamilies ?? []);
    return (
      new Set(c.symbols).size === c.symbols.length &&
      new Set(c.htxDerivativesFamilies ?? []).size === (c.htxDerivativesFamilies?.length ?? 0) &&
      new Set(fills.map((item) => `${item.family}\u0000${item.contract}`)).size === fills.length &&
      new Set(c.htxV5?.fillContracts ?? []).size === (c.htxV5?.fillContracts?.length ?? 0) &&
      fills.every(
        (item) =>
          families.has(item.family) && isHtxDerivativesFillContract(item.family, item.contract),
      ) &&
      c.maxBackoffMs >= c.pollIntervalMs &&
      c.leaseTtlMs >
        c.readTimeoutMs *
          (3 + c.symbols.length + (c.htxDerivativesFamilies?.length ?? 0) + fills.length) +
        (c.htxV5?.enabled ? HTX_V5_READ_BUDGET_MS : 0)
    );
  });

/** Stable configuration identity. A timing/symbol/HTX coverage change cannot keep the old revision.
 * Hashing configuration is NOT Human authorization or permission to access a credential.
 */
export function createObservationConfiguration(
  input: Omit<ObservationConfig, "revision">,
): ObservationConfig {
  const config = configurationSchema.parse(input);
  // The explicit existing-key authorization covers the fixed spot/V5 GET owners.
  // Legacy derivatives readers retain their original exact read-only admission.
  if (config.existingKeyReadConsentId && config.htxDerivativesFamilies?.length) {
    throw new Error("existing-key consent does not authorize legacy derivatives readers");
  }
  if (config.htxV5 && (!config.htxV5.enabled &&
      (config.htxV5.fillContracts !== undefined || config.htxV5.expectedHtxUid !== undefined) ||
    new Set(config.htxV5.fillContracts ?? []).size !== (config.htxV5.fillContracts?.length ?? 0))) {
    throw new Error("invalid V5 observation configuration");
  }
  if (config.htxDerivativesFillContracts) {
    config.htxDerivativesFillContracts.sort((left, right) => {
      const family =
        HTX_DERIVATIVES_ACCOUNT_FAMILIES.indexOf(left.family) -
        HTX_DERIVATIVES_ACCOUNT_FAMILIES.indexOf(right.family);
      return (
        family || (left.contract < right.contract ? -1 : left.contract > right.contract ? 1 : 0)
      );
    });
  }
  if (config.htxV5?.financialHistory &&
    (config.htxDerivativesFamilies?.length || config.existingKeyReadConsentId === config.htxV5.financialHistory.scopeId))
    throw new Error("ACCOUNT_OBSERVATION_INVALID_FINANCIAL_SCOPE");
  config.htxV5?.fillContracts?.sort();
  const revision = "sha256:" + createHash("sha256").update(JSON.stringify(config)).digest("hex");
  return Object.freeze({
    ...config,
    symbols: Object.freeze([...config.symbols]),
    ...(config.htxDerivativesFamilies
      ? { htxDerivativesFamilies: Object.freeze([...config.htxDerivativesFamilies]) }
      : {}),
    ...(config.htxDerivativesFillContracts
      ? {
          htxDerivativesFillContracts: Object.freeze(
            config.htxDerivativesFillContracts.map((item) => Object.freeze({ ...item })),
          ),
        }
      : {}),
    ...(config.htxCoverage ? { htxCoverage: Object.freeze({ ...config.htxCoverage }) } : {}),
    ...(config.htxV5 ? { htxV5: Object.freeze({ ...config.htxV5,
      ...(config.htxV5.fillContracts ? { fillContracts: Object.freeze([...config.htxV5.fillContracts]) } : {}),
      ...(config.htxV5.financialHistory ? { financialHistory: Object.freeze({ ...config.htxV5.financialHistory }) } : {}),
    }) } : {}),
    revision,
  });
}

export type ObservationAssignment = Readonly<{
  binding: ObservationBinding;
  config: ObservationConfig;
}>;
export type ObservationRuntimeEvent =
  | "COLLECTION_FAILED"
  | "ASSIGNMENTS_FAILED"
  | "COLLECTION_COMMITTED";

/** Explicit recurring composition, independent of browsers and historical execution.
 * Caller owns a bounded dedicated PostgreSQL pool and supplies separately authorized
 * assignments/credential opener. This module cannot provision accounts, decrypt secrets,
 * create authority, discover arbitrary accounts, submit orders or change deployment.
 * No work starts on import/construction. Await run(signal), then close the caller's pool.
 */
export function createPostgresAccountObservationRuntime(
  input: Readonly<{
    sql: Sql;
    loadAssignments(signal: AbortSignal): Promise<readonly ObservationAssignment[]>;
    openReader(binding: ObservationBinding, signal: AbortSignal): Promise<AccountObservationReader>;
    settleReader?(binding: ObservationBinding): Promise<void>;
    report(event: ObservationRuntimeEvent): void;
    ownerId?: string;
    clock?: ObservationClock;
    intervalMs?: number;
    iterationTimeoutMs?: number;
    maxAccounts?: number;
  }>,
) {
  const repository = createPostgresObservationRepository(input.sql);
  const clock = input.clock ?? accountObservationClock;
  const ownerId = input.ownerId ?? "account-observer-" + randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(ownerId))
    throw new Error("ACCOUNT_OBSERVATION_INVALID_OWNER");
  const maxAccounts = input.maxAccounts ?? 20;
  const iterationTimeoutMs = input.iterationTimeoutMs ?? 300000;
  let assignments = new Map<string, ObservationAssignment>();
  const key = (binding: ObservationBinding) => JSON.stringify(binding);
  const scheduler = createObservationScheduler(
    {
      clock,
      report: input.report,
      async loadAssignments(signal) {
        // Replace atomically only after the entire trusted list validates. No first-wins ambiguity.
        assignments = new Map();
        const raw = await input.loadAssignments(signal);
        if (signal.aborted) return [];
        if (!Array.isArray(raw) || raw.length > maxAccounts)
          throw new Error("ACCOUNT_OBSERVATION_ASSIGNMENT_LIMIT");
        const next = new Map<string, ObservationAssignment>();
        const accounts = new Set<string>();
        for (const assignment of raw) {
          const binding = Object.freeze(observationBindingSchema.parse(assignment.binding));
          const { revision, ...parameters } = assignment.config;
          const config = createObservationConfiguration(parameters);
          if (
            revision !== config.revision ||
            binding.configurationRevision !== config.revision ||
            config.leaseTtlMs > iterationTimeoutMs
          )
            throw new Error("ACCOUNT_OBSERVATION_CONFIG_MISMATCH");
          const account = JSON.stringify([binding.organizationId, binding.exchangeAccountId]);
          if (accounts.has(account)) throw new Error("ACCOUNT_OBSERVATION_AMBIGUOUS_ASSIGNMENT");
          accounts.add(account);
          next.set(key(binding), Object.freeze({ binding, config }));
        }
        assignments = next;
        return [...next.values()].map((a) => a.binding);
      },
      async tick(binding, signal) {
        const assignment = assignments.get(key(binding));
        if (!assignment) return { status: "FENCED" };
        const service = createAccountObservationService(
          { repository, clock, openReader: input.openReader, settleReader: input.settleReader,
            newObservationId: randomUUID },
          assignment.config,
        );
        return service.tick(assignment.binding, ownerId, signal);
      },
    },
    { maxAccounts, iterationTimeoutMs, intervalMs: input.intervalMs ?? 1000 },
  );
  return Object.freeze({ run: scheduler.run });
}
