import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { miHypothesisLifecycleStateValues } from "@/lib/trader/mi/hypothesis.types";
import type { PgColumn } from "drizzle-orm/pg-core";
import * as s from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ResearchReadBudget } from "../research-understanding-v1/bounded-source-postgres";
import type { ApplicationRegistrationReadSetV1 } from "./specification";
import { APPLICATION_LIMITS as L, applicationDigest, ResearchApplicationRefusal, requireApplication as check, type ResearchApplicationConfigurationV1 } from "./contract";

export type ApplicationExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;
const common = "organizationId contentDigest bodyJson runtimeInstanceId leaseEpoch leaseContentDigest";
const specs = {
  assignment: [s.traderResearchApplicationAssignmentsV1, `${common} assignmentDigest researchSessionId researchAssignmentDigest`, L.assignment],
  application: [s.traderResearchApplicationsV1, `${common} applicationId assignmentDigest previousSourceSequence currentSourceSequence recordedAt auditId`, L.application],
  availability: [s.traderResearchApplicationAvailabilityV1, `${common} applicationId applicationDigest availableAt auditId`, L.projection],
  consumption: [s.traderResearchApplicationConsumptionsV1, `${common} assignmentDigest applicationId applicationDigest availabilityDigest consumerSourceSessionId consumerSourceSequence sequence previousConsumptionDigest auditId`, L.consumption],
  consumptionHead: [s.traderResearchApplicationConsumptionsV1, "organizationId assignmentDigest sequence contentDigest", L.projection],
  hypothesis: [s.traderMiHypothesis, "id organizationId hypothesisKind hypothesisKey name schemaVersion definitionJson definitionDigest supersedesJson versionSeq revisionOf authoredBy createdAt", L.registration],
  versions: [s.traderMiHypothesis, "id organizationId hypothesisKey versionSeq definitionDigest createdAt", L.projection],
  lifecycle: [s.traderMiHypothesisLifecycle, "id organizationId hypothesisId hypothesisKey lifecycleState rationale recordedBy seq contentDigest createdAt", L.projection],
  measurement: [s.traderMiMeasurement, "id organizationId measurementKind measurementKey name schemaVersion definitionJson definitionDigest versionSeq revisionOf authoredBy createdAt", L.measurement],
  canonicalDefinition: [s.traderMiCanonicalMeasurementDefinitionV1, "id organizationId category name inputContractsJson outputSchemaVersion authority definitionJson contentDigest schemaVersion", L.registration],
  canonicalValue: [s.traderMiCanonicalMeasurementValueV1, "id organizationId definitionId definitionContentDigest outputContentDigest inputCount inputLineageJson authority contentDigest schemaVersion", L.featureWitness],
  canonicalInput: [s.traderMiCanonicalMeasurementValueInputV1, "organizationId measurementValueId inputOrdinal observationId observationKind observationSchemaVersion observationContentDigest sourceId trustAsOfReceiptId trustRevisionId trustRevisionContentDigest", L.projection],
  audit: [s.auditLogs, "id organizationId actorType actorId action entityType entityId metadataJson", L.projection],
  source: [s.traderMiSource, "id organizationId venue feedKind symbol", L.projection],
  revision: [s.traderMiSourceTrust, "id organizationId sourceId trustScore rationale recordedBy eventTime availableAt ingestTime revisionOf revisionSeq contentDigest createdAt", L.registration],
} as const;
export type ApplicationReadKind = keyof typeof specs;
export type ApplicationRow = Record<string, unknown>;

/** Internal fixed projections only. Admission precedes body transfer. No caller SQL enters the owner. */
export async function readApplicationRows(db: ApplicationExecutor, kind: ApplicationReadKind, where: SQL,
  budget: ResearchReadBudget, options: { maximum?: number; order?: SQL; optional?: boolean; lock?: boolean } = {}): Promise<ApplicationRow[]> {
  const [table, names, cap] = specs[kind];
  const maximum = options.maximum ?? 1;
  check(Number.isSafeInteger(maximum) && maximum >= 1 && maximum <= L.selectedHistory, "APPLICATION_ROW_COUNT_INVALID");
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const projected = names.split(" ").map(name => {
    check(columns[name], "APPLICATION_PROJECTION_INVALID");
    return sql`${columns[name]} as ${sql.identifier(name)}`;
  });
  const inner = sql`select ${sql.join(projected, sql`, `)} from ${table} where ${where}
    ${options.order ? sql`order by ${options.order}` : sql``} limit ${kind === "consumptionHead" && options.order ? 1 : maximum + 1}`;
  const identity = kind === "assignment" ? ["organizationId", "assignmentDigest"]
    : kind === "consumption" || kind === "consumptionHead" ? ["organizationId", "assignmentDigest", "sequence"]
      : kind === "application" || kind === "availability" ? ["organizationId", "applicationId"]
        : kind === "canonicalInput" ? ["organizationId", "measurementValueId", "inputOrdinal"] : ["id"];
  const key = sql`jsonb_build_array(${sql.join(identity.map(n => sql`${sql.identifier("bounded_row")}.${sql.identifier(n)}`), sql`, `)})::text`;
  budget.checkDeadline();
  const metadata = await db.execute<{ identity: string; bytes: number; projectionDigest: string }>(sql`select ${key} as identity,
    octet_length(to_jsonb(bounded_row)::text)::integer as bytes,
    encode(sha256(convert_to(to_jsonb(bounded_row)::text,'UTF8')),'hex') as "projectionDigest" from (${inner}) bounded_row`);
  budget.checkDeadline();
  check(metadata.length <= maximum && (options.optional || metadata.length > 0), "APPLICATION_ROW_SET_REFUSED");
  for (const row of metadata) budget.admit(getTableName(table), row.identity, row.bytes, cap, kind);
  if (!metadata.length) return [];
  // The same projection, including actual SQL size/digest, is rechecked before parsing bodyJson.
  const body = await db.execute<ApplicationRow>(sql`select bounded_row.*,
    ${key} as "__identity", octet_length(to_jsonb(bounded_row)::text)::integer as "__bytes",
    encode(sha256(convert_to(to_jsonb(bounded_row)::text,'UTF8')),'hex') as "__digest" from (${inner}) bounded_row`);
  budget.checkDeadline();
  check(body.length === metadata.length, "APPLICATION_ROW_SET_CHANGED");
  const result = body.map(row => {
    const m = metadata.find(v => v.identity === row.__identity);
    check(m && m.bytes === row.__bytes && m.projectionDigest === row.__digest, "APPLICATION_ROW_CHANGED");
    const { __identity: _i, __bytes: _b, __digest: _d, ...value } = row; void _i; void _b; void _d;
    // execute() returns the native driver's int8 strings, bypassing column
    // mapFromDriverValue. Preserve exact safe sequence identity, never rounding.
    for (const field of ["previousSourceSequence", "currentSourceSequence", "consumerSourceSequence", "sequence"]) if (field in value) {
      const raw = value[field];
      check((typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) ||
        (typeof raw === "string" && /^(0|[1-9][0-9]*)$/.test(raw) && Number.isSafeInteger(Number(raw))), "APPLICATION_INTEGER_INVALID");
      value[field] = Number(raw);
    }
    for (const field of ["createdAt", "eventTime", "availableAt", "ingestTime", "recordedAt"]) if (value[field] != null) {
      const date = new Date(value[field] as string); check(Number.isFinite(date.getTime()), "APPLICATION_TIMESTAMP_INVALID"); value[field] = date.toISOString();
    }
    return value;
  });
  if (options.lock) {
    // Locks run only after the row sizes are admitted; returned lock projection is scalar.
    const locked = await db.execute<{ identity: string }>(sql`select ${columns.id}::text as identity from ${table} where ${where}
      order by ${columns.id} for share`);
    budget.checkDeadline();
    check(locked.length === result.length && result.every(v => locked.some(l => l.identity === v.id)), "APPLICATION_LOCK_SET_CHANGED");
    // In RR, a concurrently changed locked row raises a serialization error. The caller
    // also compares all retained fields below; a claimed unchanged digest is insufficient.
  }
  return result;
}
export function applicationScope(kind: ApplicationReadKind, org: string, key: string | number, second?: string | number) {
  const t = getTableColumns(specs[kind][0]) as Record<string, PgColumn>;
  const column = kind === "assignment" || kind === "consumptionHead" ? t.assignmentDigest : kind === "consumption" ? t.applicationId :
    kind === "application" || kind === "availability" ? t.applicationId : t.id;
  return sql`${t.organizationId} = ${org} and ${column} = ${key}${second === undefined ? sql`` : sql` and ${t.consumerSourceSequence} = ${second}`}`;
}
export function decodeApplicationBody<T>(row: ApplicationRow): T {
  check(typeof row.bodyJson === "string" && typeof row.contentDigest === "string", "APPLICATION_BODY_INVALID");
  let body: unknown;
  try { body = JSON.parse(row.bodyJson); } catch { throw new ResearchApplicationRefusal("APPLICATION_BODY_INVALID"); }
  check(body && typeof body === "object" && !Array.isArray(body) && applicationDigest(body) === row.contentDigest, "APPLICATION_BODY_CONFLICT");
  return body as T;
}
export async function readApplicationRegistration(db: ApplicationExecutor, c: ResearchApplicationConfigurationV1,
  at: string, budget: ResearchReadBudget): Promise<ApplicationRegistrationReadSetV1> {
  const h = s.traderMiHypothesis, l = s.traderMiHypothesisLifecycle;
  const hypothesis = (await readApplicationRows(db, "hypothesis", applicationScope("hypothesis", c.organizationId, c.hypothesisId), budget))[0]!;
  const measurement = (await readApplicationRows(db, "measurement", applicationScope("measurement", c.organizationId, c.measurementId), budget))[0]!;
  const versions = await readApplicationRows(db, "versions", sql`${h.organizationId}=${c.organizationId} and ${h.hypothesisKey}=${c.hypothesisKey} and ${h.createdAt}<=${at}::timestamptz`, budget,
    { maximum: L.selectedHistory, order: sql`${h.versionSeq}, ${h.id}` });
  const lifecycles = await readApplicationRows(db, "lifecycle", sql`${l.organizationId}=${c.organizationId} and ${l.hypothesisKey}=${c.hypothesisKey} and ${l.createdAt}<=${at}::timestamptz`, budget,
    { maximum: L.selectedHistory, order: sql`${l.seq}, ${l.id}` });
  const text = z.string(), sequence = z.number().int().positive().safe();
  const createdAt = z.string().datetime().transform(value => new Date(value));
  const identity = { id: text, organizationId: text, createdAt };
  const version = z.object({ ...identity, hypothesisKey: text, versionSeq: sequence, definitionDigest: text }).strict();
  const hypothesisRow = z.object({ ...version.shape, hypothesisKind: z.literal("market_claim"), name: text,
    schemaVersion: z.literal("mi-hypothesis-v1"), definitionJson: text, supersedesJson: text.nullable(),
    revisionOf: text.nullable(), authoredBy: text }).strict();
  const measurementRow = z.object({ ...identity, measurementKind: z.literal("feature_transform"), measurementKey: text,
    name: text, schemaVersion: z.literal("mi-measurement-v1"), definitionJson: text, definitionDigest: text,
    versionSeq: sequence, revisionOf: text.nullable(), authoredBy: text }).strict();
  const lifecycleRow = z.object({ ...identity, hypothesisId: text, hypothesisKey: text, lifecycleState: z.enum(miHypothesisLifecycleStateValues),
    rationale: text, recordedBy: text, seq: sequence, contentDigest: text }).strict();
  const result = z.object({ hypothesis: hypothesisRow, measurement: measurementRow, versions: z.array(version), lifecycles: z.array(lifecycleRow) })
    .safeParse({ hypothesis, measurement, versions, lifecycles });
  check(result.success, "APPLICATION_REGISTRATION_ROW_INVALID"); return result.data;
}


/** Fixed owner-generated row only. Charge precisely the stored reader's projection,
 * including body-string escaping, audit and holder columns, before the fenced INSERT. */
export async function admitApplicationWriteRow(db: ApplicationExecutor,
  kind: "assignment" | "application" | "availability" | "consumption", row: ApplicationRow, budget: ResearchReadBudget): Promise<void> {
  const [table, names, cap] = specs[kind], keys = names.split(" ");
  check(Object.keys(row).length === keys.length && keys.every(k => Object.hasOwn(row, k)), "APPLICATION_WRITE_PROJECTION_INVALID");
  check(typeof row.bodyJson === "string" && Buffer.byteLength(row.bodyJson, "utf8") <= cap, "APPLICATION_OUTPUT_LIMIT");
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const fields = keys.flatMap(key => [sql`${key}::text`, sql`${row[key]}::${sql.raw(columns[key]!.getSQLType())}`]);
  const identityKeys = kind === "assignment" ? ["organizationId", "assignmentDigest"]
    : kind === "consumption" ? ["organizationId", "assignmentDigest", "sequence"] : ["organizationId", "applicationId"];
  const identity = sql`jsonb_build_array(${sql.join(identityKeys.map(key => sql`${row[key]}::${sql.raw(columns[key]!.getSQLType())}`), sql`, `)})::text`;
  budget.checkDeadline();
  const metadata = await db.execute<{ identity: string; bytes: number }>(sql`select ${identity} as identity,
    octet_length(jsonb_build_object(${sql.join(fields, sql`, `)})::text)::integer as bytes`);
  budget.checkDeadline(); check(metadata.length === 1 && typeof metadata[0]!.identity === "string", "APPLICATION_WRITE_PROJECTION_INVALID");
  // Use PostgreSQL's exact jsonb-array text, including separators, just like the stored reader.
  budget.admit(getTableName(table), metadata[0]!.identity, metadata[0]!.bytes, cap, kind);
}
