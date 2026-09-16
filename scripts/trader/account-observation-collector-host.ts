/**
 * DEE-1015: executable production collector for the merged DEE-960/978/979 account-observation
 * subsystem. This is the consumer half of `services/ai-trader-account-observation-host`.
 *
 * It composes, and never reimplements, `createAccountObservationHost`: trusted manifest validation
 * → database resource admission → protected credential service → the existing configured HTX
 * observation runtime → recurring run → bounded drain. It owns no scheduler, lease or cadence logic,
 * grants no order/cancel/amend/transfer/withdraw capability, and never accepts plaintext exchange
 * credentials as input.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import {
  parseAccountObservationAssignmentManifest,
  type TrustedAccountObservationAssignments,
} from "@/lib/trader/account-observation/assignment-manifest";
import {
  createAccountObservationHost,
  type ObservationCredentialResource,
  type ObservationHostEvent,
  type ObservationSqlResource,
} from "@/lib/trader/account-observation/host";
import { observationPoolLimits } from "@/lib/trader/account-observation/host-role-probe";
import { createCredentialService } from "@/lib/trader/credentials/credential-service";
import { createPostgresExchangeCredentialRepository } from "@/lib/trader/credentials/repository-adapters";
import { isProductionDeployment } from "@/lib/trader/security/deployment-tier";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";

export const ACCOUNT_OBSERVATION_COLLECTOR_SERVICE = "ai-trader-account-observation-host";
export const ACCOUNT_OBSERVATION_COLLECTOR_STARTED =
  "waia.account_observation_collector.started.v1";

/** Each purpose has a separately provisioned, non-interchangeable LOGIN. */
export const ACCOUNT_OBSERVATION_LOGIN_ROLES = Object.freeze({
  collector: "waia_account_observer_login",
  reader: "waia_account_observation_reader_login",
  credential: "waia_account_observation_credential_login",
} as const);

export type AccountObservationCollectorRefusal =
  | "CLI_ENVIRONMENT"
  | "WAIA_RELEASE_SHA"
  | "WAIA_OBSERVATION_OWNER_ID"
  | "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST"
  | "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256"
  | "DATABASE_URL_REQUIRED"
  | "DATABASE_URL_INVALID"
  | "DATABASE_LOGIN_ROLE"
  | "DATABASE_RESOURCE_NOT_DISTINCT"
  | "WAIA_OBSERVATION_MASTER_KEY"
  | "MANIFEST_UNREADABLE";

export class AccountObservationCollectorError extends Error {
  constructor(code: AccountObservationCollectorRefusal | string) {
    super(`ACCOUNT_OBSERVATION_COLLECTOR_REFUSED:${code}`);
    this.name = "AccountObservationCollectorError";
  }
}

function refuse(code: AccountObservationCollectorRefusal): never {
  throw new AccountObservationCollectorError(code);
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, key: AccountObservationCollectorRefusal & string): string {
  const value = env[key]?.trim();
  if (!value) refuse(key);
  return value;
}

/** Non-secret runtime identity, safe to log and serialize in full. */
export type AccountObservationCollectorConfig = Readonly<{
  service: typeof ACCOUNT_OBSERVATION_COLLECTOR_SERVICE;
  releaseSha: string;
  ownerId: string;
  manifestPath: string;
  manifestSha256: string;
  collectorDatabaseUrl: string;
  readerDatabaseUrl: string;
  credentialDatabaseUrl: string;
}>;

export type AccountObservationCollectorRuntime = Readonly<{
  config: AccountObservationCollectorConfig;
  /** Closure over the captured environment; the key never enters `config`. */
  masterKeySecretGetter(): Promise<string>;
}>;

function databaseUrl(env: Env, key: string, expectedLogin: string): string {
  const value = env[key]?.trim();
  if (!value) refuse("DATABASE_URL_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    refuse("DATABASE_URL_INVALID");
  }
  const protocol = parsed.protocol.toLowerCase();
  if ((protocol !== "postgres:" && protocol !== "postgresql:") || !parsed.hostname) {
    refuse("DATABASE_URL_INVALID");
  }
  if (decodeURIComponent(parsed.username) !== expectedLogin) refuse("DATABASE_LOGIN_ROLE");
  return value;
}

/** Complete environment validation with no I/O: nothing may open before this returns. */
export function parseAccountObservationCollectorRuntime(
  env: Env,
): AccountObservationCollectorRuntime {
  if (env.WAIA_TRADER_CLI !== "1") refuse("CLI_ENVIRONMENT");

  const releaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) refuse("WAIA_RELEASE_SHA");

  const ownerId = required(env, "WAIA_OBSERVATION_OWNER_ID");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(ownerId)) refuse("WAIA_OBSERVATION_OWNER_ID");

  const manifestPath = required(env, "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST");
  // Already normalized and absolute, so `..` cannot walk the deployed path away from the
  // reviewed manifest location.
  if (
    !isAbsolute(manifestPath) ||
    manifestPath.includes("\0") ||
    resolve(manifestPath) !== manifestPath ||
    manifestPath === "/"
  ) {
    refuse("WAIA_OBSERVATION_ASSIGNMENT_MANIFEST");
  }
  const manifestSha256 = required(env, "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(manifestSha256)) refuse("WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256");

  const collectorDatabaseUrl = databaseUrl(
    env,
    "WAIA_OBSERVATION_COLLECTOR_DATABASE_URL",
    ACCOUNT_OBSERVATION_LOGIN_ROLES.collector,
  );
  const readerDatabaseUrl = databaseUrl(
    env,
    "WAIA_OBSERVATION_READER_DATABASE_URL",
    ACCOUNT_OBSERVATION_LOGIN_ROLES.reader,
  );
  const credentialDatabaseUrl = databaseUrl(
    env,
    "WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL",
    ACCOUNT_OBSERVATION_LOGIN_ROLES.credential,
  );
  const urls = [collectorDatabaseUrl, readerDatabaseUrl, credentialDatabaseUrl];
  if (new Set(urls).size !== urls.length) refuse("DATABASE_RESOURCE_NOT_DISTINCT");

  const masterKey = required(env, "WAIA_OBSERVATION_MASTER_KEY");
  let decoded: Buffer;
  try {
    decoded = Buffer.from(masterKey, "base64");
  } catch {
    refuse("WAIA_OBSERVATION_MASTER_KEY");
  }
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== masterKey) {
    refuse("WAIA_OBSERVATION_MASTER_KEY");
  }

  return Object.freeze({
    config: Object.freeze({
      service: ACCOUNT_OBSERVATION_COLLECTOR_SERVICE,
      releaseSha,
      ownerId,
      manifestPath,
      manifestSha256,
      collectorDatabaseUrl,
      readerDatabaseUrl,
      credentialDatabaseUrl,
    }),
    async masterKeySecretGetter() {
      return masterKey;
    },
  });
}

function openObservationSql(url: string, purpose: "collector" | "reader") {
  return async (
    _signal: AbortSignal,
    limits: typeof observationPoolLimits,
  ): Promise<ObservationSqlResource> => {
    const sql = postgres(url, {
      ...limits,
      connection: { application_name: `waia-account-observation-${purpose}` },
      onnotice: () => {},
    });
    return Object.freeze({
      sql,
      async dispose() {
        await sql.end({ timeout: 5 });
      },
    });
  };
}

/** Third, deliberately separate resource: the collector/reader logins are attested to have no
 * ciphertext access, so envelope decryption needs its own credential-capable login. */
function openObservationCredentialService(runtime: AccountObservationCollectorRuntime) {
  return async (): Promise<ObservationCredentialResource> => {
    const sql = postgres(runtime.config.credentialDatabaseUrl, {
      max: 2,
      connect_timeout: 3,
      max_lifetime: 300,
      prepare: false,
      connection: { application_name: "waia-account-observation-credential" },
      onnotice: () => {},
    });
    try {
      const provider = await SecretsStoreMasterKeyProvider.create({
        secretGetter: () => runtime.masterKeySecretGetter(),
        productionReady: isProductionDeployment(),
      });
      const service = createCredentialService({
        repository: createPostgresExchangeCredentialRepository(drizzle(sql, { schema: pgSchema })),
        // Observation only decrypts; an audit write from this runtime is a contract violation.
        writeAudit: () => {
          throw new Error("ACCOUNT_OBSERVATION_AUDIT_WRITE_FORBIDDEN");
        },
        createProvider: async () => provider,
      });
      return Object.freeze({
        service,
        async dispose() {
          await sql.end({ timeout: 5 });
        },
      });
    } catch (error) {
      await sql.end({ timeout: 5 }).catch(() => {});
      throw error;
    }
  };
}

export type AccountObservationCollectorDependencies = Readonly<{
  env?: Env;
  signal: AbortSignal;
  readManifest?(path: string): string;
  openCollector?: ReturnType<typeof openObservationSql>;
  openReader?: ReturnType<typeof openObservationSql>;
  openCredentialService?(signal: AbortSignal): Promise<ObservationCredentialResource>;
  fetchImpl?: typeof fetch;
  clock?: typeof accountObservationClock;
  report?(event: ObservationHostEvent): void;
  onStarted?(
    started: Readonly<{
      assignments: number;
      manifestSha256: string;
      releaseSha: string;
      stop(): Promise<void>;
    }>,
  ): void;
}>;

/** One host per process. Returns after the existing bounded drain has completed. */
export async function runAccountObservationCollector(
  dependencies: AccountObservationCollectorDependencies,
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const runtime = parseAccountObservationCollectorRuntime(env);
  const { config } = runtime;

  const read = dependencies.readManifest ?? ((path: string) => readFileSync(path, "utf8"));
  let manifestText: string;
  try {
    manifestText = read(config.manifestPath);
  } catch {
    refuse("MANIFEST_UNREADABLE");
  }
  const trusted: TrustedAccountObservationAssignments = parseAccountObservationAssignmentManifest(
    manifestText,
    { expectedDigest: config.manifestSha256, expectedReleaseSha: config.releaseSha },
  );

  const report =
    dependencies.report ??
    ((event: ObservationHostEvent) => {
      process.stdout.write(`[${ACCOUNT_OBSERVATION_COLLECTOR_SERVICE}] ${event}\n`);
    });
  const host = createAccountObservationHost({
    configured: trusted.configured,
    host: trusted.host,
    ownerId: config.ownerId,
    intervalMs: trusted.intervalMs,
    iterationTimeoutMs: trusted.iterationTimeoutMs,
    openTimeoutMs: trusted.openTimeoutMs,
    shutdownTimeoutMs: trusted.shutdownTimeoutMs,
    openCollector:
      dependencies.openCollector ?? openObservationSql(config.collectorDatabaseUrl, "collector"),
    openReader: dependencies.openReader ?? openObservationSql(config.readerDatabaseUrl, "reader"),
    openCredentialService:
      dependencies.openCredentialService ?? openObservationCredentialService(runtime),
    fetchImpl: dependencies.fetchImpl ?? fetch,
    clock: dependencies.clock ?? accountObservationClock,
    report,
  });

  dependencies.onStarted?.(
    Object.freeze({
      assignments: trusted.configured.length,
      manifestSha256: trusted.digest,
      releaseSha: config.releaseSha,
      stop: () => host.stop(),
    }),
  );

  await host.run(dependencies.signal);
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return invoked === resolve(fileURLToPath(import.meta.url));
}

async function main(): Promise<void> {
  const controller = new AbortController();
  let stopping = false;
  let stopHost: (() => Promise<void>) | undefined;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(
      `[${ACCOUNT_OBSERVATION_COLLECTOR_SERVICE}] ${signal} received; draining\n`,
    );
    controller.abort();
    void stopHost?.().catch(() => {});
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  let identity:
    | Readonly<{ assignments: number; manifestSha256: string; releaseSha: string }>
    | undefined;
  await runAccountObservationCollector({
    signal: controller.signal,
    onStarted(started) {
      stopHost = started.stop;
      identity = Object.freeze({
        assignments: started.assignments,
        manifestSha256: started.manifestSha256,
        releaseSha: started.releaseSha,
      });
    },
    report(event) {
      process.stdout.write(`[${ACCOUNT_OBSERVATION_COLLECTOR_SERVICE}] ${event}\n`);
      // Report readiness only once the existing host has actually opened and attested
      // every owned resource, never merely because configuration parsed.
      if (event === "HOST_STARTED" && identity) {
        process.send?.({ type: ACCOUNT_OBSERVATION_COLLECTOR_STARTED, ...identity });
      }
    },
  });
}

if (isMainModule()) {
  main().then(
    () => {
      process.exitCode = 0;
    },
    (error: unknown) => {
      // Only fixed refusal/failure codes; never a secret-bearing dependency payload.
      const message =
        error instanceof AccountObservationCollectorError ||
        (error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message))
          ? error.message
          : "ACCOUNT_OBSERVATION_COLLECTOR_REFUSED:UNCLASSIFIED";
      process.stderr.write(`[${ACCOUNT_OBSERVATION_COLLECTOR_SERVICE}] ${message}\n`);
      process.exitCode = 1;
    },
  );
}
