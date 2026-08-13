import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type postgres from "postgres";

import { FORECAST_V2_STORAGE_TABLES } from "./storage-scale-postgres-v1";

const VALIDATION_COMPOSE_PATH = "docker-compose.postgres-validate.yml";

export type A3PostgresEnvironmentFieldClassV1 = "STORAGE_IDENTITY_REQUIRED" | "DIAGNOSTIC_ONLY";

export const A3_POSTGRES_ENVIRONMENT_FIELD_CLASS: Readonly<
  Record<string, A3PostgresEnvironmentFieldClassV1>
> = {
  serverVersion: "STORAGE_IDENTITY_REQUIRED",
  serverVersionNum: "STORAGE_IDENTITY_REQUIRED",
  blockSize: "STORAGE_IDENTITY_REQUIRED",
  dataChecksums: "STORAGE_IDENTITY_REQUIRED",
  serverEncoding: "STORAGE_IDENTITY_REQUIRED",
  databaseCollate: "STORAGE_IDENTITY_REQUIRED",
  databaseCtype: "STORAGE_IDENTITY_REQUIRED",
  defaultTableAccessMethod: "STORAGE_IDENTITY_REQUIRED",
  validationComposeDigestHex: "STORAGE_IDENTITY_REQUIRED",
  dockerImageReference: "STORAGE_IDENTITY_REQUIRED",
  dockerImageId: "STORAGE_IDENTITY_REQUIRED",
  relationStorageOptions: "STORAGE_IDENTITY_REQUIRED",
  /** Session-mutated during PHASE-01 measurement; not storage-identity authority. */
  operationalSettings: "DIAGNOSTIC_ONLY",
};

export type A3PostgresOperationalSettingsV1 = {
  synchronousCommit: string;
  workMem: string;
};

export type A3PostgresMeasurementEnvironmentV1 = {
  schemaVersion: "a3-postgres-measurement-environment/v1";
  serverVersion: string;
  serverVersionNum: string;
  blockSize: string;
  dataChecksums: string;
  serverEncoding: string;
  databaseCollate: string;
  databaseCtype: string;
  defaultTableAccessMethod: string;
  validationComposeDigestHex: string;
  dockerImageReference: string;
  dockerImageId: string;
  relationStorageOptions: readonly {
    relname: string;
    reloptions: string | null;
    tablespace: string;
  }[];
  operationalSettings: A3PostgresOperationalSettingsV1;
  postgresMeasurementEnvironmentDigest: string;
};

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function digestValidationCompose(repoRoot: string): string {
  return createHash("sha256")
    .update(readFileSync(join(repoRoot, VALIDATION_COMPOSE_PATH)))
    .digest("hex");
}

function resolveDockerImageIdentity(): { reference: string; id: string } {
  try {
    const id = execSync("docker inspect waia-postgres-validate-1 --format '{{.Image}}'", {
      encoding: "utf8",
    }).trim();
    const reference = execSync(
      "docker inspect waia-postgres-validate-1 --format '{{.Config.Image}}'",
      { encoding: "utf8" },
    ).trim();
    return {
      reference: reference.length > 0 ? reference : "unknown",
      id: id.length > 0 ? id : "unknown",
    };
  } catch {
    return { reference: "unknown", id: "unknown" };
  }
}

/**
 * PostgreSQL `SHOW <name>` returns a single-column row whose column name equals
 * the setting name (e.g. `server_version`), not `v` or `version`.
 */
export function readPostgresShowSetting(
  row: Record<string, unknown> | undefined,
  settingName: string,
): string {
  if (!row) {
    return "unknown";
  }
  const direct = row[settingName];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  // Defensive: some drivers may lowercase keys.
  const lower = row[settingName.toLowerCase()];
  if (typeof lower === "string" && lower.length > 0) {
    return lower;
  }
  return "unknown";
}

async function showSetting(sql: postgres.Sql, settingName: string): Promise<string> {
  // Identifier cannot be parameterized; whitelist callers.
  const rows = (await sql.unsafe(`SHOW ${settingName}`)) as Record<string, unknown>[];
  return readPostgresShowSetting(rows[0], settingName);
}

export async function capturePostgresMeasurementEnvironment(
  sql: postgres.Sql,
  repoRoot: string,
): Promise<A3PostgresMeasurementEnvironmentV1> {
  const serverVersion = await showSetting(sql, "server_version");
  const serverVersionNum = await showSetting(sql, "server_version_num");
  const blockSize = await showSetting(sql, "block_size");
  const dataChecksums = await showSetting(sql, "data_checksums");
  const serverEncoding = await showSetting(sql, "server_encoding");
  const defaultTableAccessMethod = await showSetting(sql, "default_table_access_method");

  const dbLocale = await sql<{ datcollate: string; datctype: string }[]>`
    SELECT datcollate, datctype
    FROM pg_database
    WHERE datname = current_database()
  `;

  const relationStorageOptions = await sql<
    { relname: string; reloptions: string | null; tablespace: string }[]
  >`
    SELECT
      c.relname,
      array_to_string(c.reloptions, ',') AS reloptions,
      COALESCE(ts.spcname, 'pg_default') AS tablespace
    FROM pg_class c
    LEFT JOIN pg_tablespace ts ON ts.oid = c.reltablespace
    WHERE c.relname = ANY(${FORECAST_V2_STORAGE_TABLES as unknown as string[]})
    ORDER BY c.relname
  `;

  const operationalSettings: A3PostgresOperationalSettingsV1 = {
    synchronousCommit: await showSetting(sql, "synchronous_commit"),
    workMem: await showSetting(sql, "work_mem"),
  };

  const docker = resolveDockerImageIdentity();
  const validationComposeDigestHex = digestValidationCompose(repoRoot);

  const comparabilityBody = [
    "a3-postgres-measurement-environment/v1",
    `server_version_num=${serverVersionNum}`,
    `block_size=${blockSize}`,
    `data_checksums=${dataChecksums}`,
    `server_encoding=${serverEncoding}`,
    `database_collate=${dbLocale[0]?.datcollate ?? "unknown"}`,
    `database_ctype=${dbLocale[0]?.datctype ?? "unknown"}`,
    `default_table_access_method=${defaultTableAccessMethod}`,
    `validation_compose_digest=${validationComposeDigestHex}`,
    `docker_image_id=${docker.id}`,
    ...relationStorageOptions.map(
      (row) =>
        `relation=${row.relname};reloptions=${row.reloptions ?? ""};tablespace=${row.tablespace}`,
    ),
  ].join("\n");

  return {
    schemaVersion: "a3-postgres-measurement-environment/v1",
    serverVersion,
    serverVersionNum,
    blockSize,
    dataChecksums,
    serverEncoding,
    databaseCollate: dbLocale[0]?.datcollate ?? "unknown",
    databaseCtype: dbLocale[0]?.datctype ?? "unknown",
    defaultTableAccessMethod,
    validationComposeDigestHex,
    dockerImageReference: docker.reference,
    dockerImageId: docker.id,
    relationStorageOptions,
    operationalSettings,
    postgresMeasurementEnvironmentDigest: sha256Hex(comparabilityBody),
  };
}
