import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";
import { check } from "@/lib/trader/paper/research-understanding-v1/contract";

type Executor = Pick<WaiaPostgresDb, "execute">;
type Domain = "RECORDED_ACQUISITION_V1" | "SAVED_RESEARCH_V1";
type OwnershipDomain = "CAPITAL_LEGACY_V2" | Domain;
type ClaimInput = Readonly<{ organizationId: string; runtimeInstanceId: string; durationMs: number }>;
type Holder = Readonly<{ organizationId: string; runtimeInstanceId: string; leaseEpoch: number; leaseContentDigest: string;
  adjudicatedAtUtc: string; validUntilUtc: string; expectedPreviousDigest: string | null; durationMs: number }>;
const acquisitionBrand: unique symbol = Symbol("RECORDED_ACQUISITION_V1");
const savedBrand: unique symbol = Symbol("SAVED_RESEARCH_V1");
export type RecordedAcquisitionHolderV1 = Holder & Readonly<{ ownershipDomain: "RECORDED_ACQUISITION_V1"; [acquisitionBrand]: true }>;
export type SavedResearchHolderV1 = Holder & Readonly<{ ownershipDomain: "SAVED_RESEARCH_V1"; [savedBrand]: true }>;
const hex = /^[0-9a-f]{64}$/, uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const columns = "organizationId runtimeInstanceId leaseEpoch leaseContentDigest validUntilUtc ownershipDomain".split(" ");
type Head = Pick<Holder, "organizationId" | "runtimeInstanceId" | "leaseEpoch" | "leaseContentDigest" | "validUntilUtc"> & { ownershipDomain: Domain };
function keys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function epoch(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647; }
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** One fixed control allowance inside the invocation's original input ledger.
 * Stable version identities retain actual bytes, not merely their lengths.
 * The fixed owners create this once; no read helper constructs a replacement. */
export class NoncapitalControlReadBudget {
  private readonly bytes = new Map<string, string>();
  private readonly budget: ResearchReadBudget;
  constructor(shared: ResearchReadBudget) { this.budget = new ResearchReadBudget(4096, shared); }
  get total() { return this.budget.total; }
  assertDeadline() { this.budget.checkDeadline(); }
  admit(identity: readonly unknown[], content: string): void {
    this.assertDeadline();
    const key = canonicalizeSemanticJsonString(identity), prior = this.bytes.get(key);
    check(prior === undefined || prior === content, "CONTROL_VERSION_CONTENT_CONFLICT");
    this.budget.admit("noncapital_domain_control_v1", key, Buffer.byteLength(content, "utf8"), 4096);
    if (prior === undefined) this.bytes.set(key, content);
  }
}
// Fixed mappings are module-private; no exported selector/factory accepts a domain.
const domains = {
  RECORDED_ACQUISITION_V1: { key: 1_121_001, head: "trader_recorded_acquisition_lease_heads_v1", history: "trader_recorded_acquisition_lease_history_v1" },
  SAVED_RESEARCH_V1: { key: 1_126_001, head: "trader_saved_research_lease_heads_v1", history: "trader_saved_research_lease_history_v1" },
} as const;
async function lock(tx: Executor, org: string, domain: Domain) {
  check(uuid.test(org), "INVALID_ORGANIZATION");
  await tx.execute(sql`select pg_advisory_xact_lock(${domains[domain].key}::integer,hashtext(${org}::text))`);
}
export async function lockRecordedAcquisitionOrganizationV1(tx: Executor, organizationId: string) {
  await lock(tx, organizationId, "RECORDED_ACQUISITION_V1");
}
export async function lockSavedResearchOrganizationV1(tx: Executor, organizationId: string) {
  await lock(tx, organizationId, "SAVED_RESEARCH_V1");
}
async function now(tx: Executor) {
  const rows = await tx.execute<{ now: string }>(sql`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`);
  check(rows.length === 1 && timestamp(rows[0]!.now), "DATABASE_CLOCK_INVALID"); return rows[0]!.now;
}
async function head(tx: Executor, org: string, domain: Domain, forUpdate: boolean, control?: NoncapitalControlReadBudget): Promise<Head | null> {
  control?.assertDeadline();
  const table = sql.identifier(domains[domain].head);
  // Only the bounded scalar projection is returned. FOR UPDATE remains inside
  // the subquery so a replaced RR row raises its actual serialization refusal.
  const rows = await tx.execute<{ packet: string; bytes: number }>(sql`select packet,octet_length(packet)::integer as bytes from (
    select jsonb_build_object('ownershipDomain',${domain}::text,'organizationId',organization_id::text,
      'runtimeInstanceId',runtime_instance_id,'leaseEpoch',lease_epoch,'leaseContentDigest',content_digest,
      'validUntilUtc',to_char(valid_until_utc at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text as packet
    from ${table} where organization_id=${org}::uuid ${forUpdate ? sql`for update` : sql``}) as bounded_head`);
  control?.assertDeadline(); check(rows.length <= 1, "CONTROL_HEAD_CARDINALITY_CONFLICT");
  if (!rows.length) { control?.admit([domains[domain].head, org, "ABSENT"], "[]"); return null; }
  const row = rows[0]!;
  check(typeof row.packet === "string" && Number.isSafeInteger(row.bytes) && row.bytes === Buffer.byteLength(row.packet) && row.bytes <= 4096,
    "CONTROL_PACKET_BYTES_CONFLICT");
  const value: unknown = JSON.parse(row.packet);
  check(keys(value, columns) && value.organizationId === org && value.ownershipDomain === domain &&
    typeof value.runtimeInstanceId === "string" && value.runtimeInstanceId.trim() === value.runtimeInstanceId && value.runtimeInstanceId.length > 0 &&
    Buffer.byteLength(value.runtimeInstanceId) <= 1024 && epoch(value.leaseEpoch) && typeof value.leaseContentDigest === "string" &&
    hex.test(value.leaseContentDigest) && timestamp(value.validUntilUtc), "CONTROL_HEAD_SHAPE_CONFLICT");
  const identity = [domains[domain].head, org, value.runtimeInstanceId, value.leaseEpoch, value.leaseContentDigest];
  control?.admit(identity, JSON.stringify(row)); return Object.freeze(value) as Head;
}
async function assertCurrent(tx: Executor, holder: Holder, domain: Domain, control?: NoncapitalControlReadBudget) {
  await head(tx, holder.organizationId, domain, true, control);
  const observed = await now(tx);
  const current = await head(tx, holder.organizationId, domain, false, control);
  check(current && current.runtimeInstanceId === holder.runtimeInstanceId && current.leaseEpoch === holder.leaseEpoch &&
    current.leaseContentDigest === holder.leaseContentDigest && Date.parse(observed) <= Date.parse(current.validUntilUtc),
  "RUNTIME_CONTROL_LEASE_STALE_HOLDER");
  return observed;
}
/** Caller retains the fixed domain lock through real COMMIT/deferred fencing. */
export async function assertRecordedAcquisitionHolderWithinHeldTransactionV1(tx: Executor, holder: RecordedAcquisitionHolderV1) {
  check(holder[acquisitionBrand] === true && holder.ownershipDomain === "RECORDED_ACQUISITION_V1", "HOLDER_DOMAIN_CONFLICT");
  return assertCurrent(tx, holder, "RECORDED_ACQUISITION_V1");
}
export async function assertSavedResearchHolderWithinHeldTransactionV1(tx: Executor, holder: SavedResearchHolderV1, control: NoncapitalControlReadBudget) {
  check(holder[savedBrand] === true && holder.ownershipDomain === "SAVED_RESEARCH_V1", "HOLDER_DOMAIN_CONFLICT");
  return assertCurrent(tx, holder, "SAVED_RESEARCH_V1", control);
}
function capture(supplied: ClaimInput, maximum: number): ClaimInput {
  const input = Object.freeze({ organizationId: supplied.organizationId, runtimeInstanceId: supplied.runtimeInstanceId, durationMs: supplied.durationMs });
  check(uuid.test(input.organizationId) && typeof input.runtimeInstanceId === "string" && input.runtimeInstanceId.trim() === input.runtimeInstanceId &&
    input.runtimeInstanceId.length > 0 && Buffer.byteLength(input.runtimeInstanceId) <= 1024, "RUNTIME_CONTROL_LEASE_INVALID_IDENTITY");
  check(Number.isSafeInteger(input.durationMs) && input.durationMs > 0 && input.durationMs <= maximum, "RUNTIME_CONTROL_LEASE_INVALID_DURATION"); return input;
}
async function claim(tx: Executor, input: ClaimInput, domain: Domain, control?: NoncapitalControlReadBudget) {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '30s'`);
  await lock(tx, input.organizationId, domain);
  const current = await head(tx, input.organizationId, domain, true, control);
  const adjudicatedAtUtc = await now(tx);
  if (current && Date.parse(adjudicatedAtUtc) <= Date.parse(current.validUntilUtc)) return null;
  const body = Object.freeze({ schemaVersion: "waia.trader.noncapital_domain_lease.v1", ownershipDomain: domain,
    ...input, leaseEpoch: (current?.leaseEpoch ?? 0) + 1, expectedPreviousDigest: current?.leaseContentDigest ?? null,
    adjudicatedAtUtc, validUntilUtc: new Date(Date.parse(adjudicatedAtUtc) + input.durationMs).toISOString() });
  check(epoch(body.leaseEpoch), "RUNTIME_CONTROL_LEASE_EPOCH_EXHAUSTED");
  const bodyJson = canonicalizeSemanticJsonString(body), leaseContentDigest = computeSemanticSha256Hex(body);
  check(Buffer.byteLength(bodyJson) <= 4096, "CONTROL_LEASE_BODY_LIMIT_EXCEEDED");
  // Recheck within the same held transaction, retaining the existing bounded
  // claim's statement accounting and deterministic exact-head comparison.
  await lock(tx, input.organizationId, domain);
  const selected = await head(tx, input.organizationId, domain, true, control);
  check(canonicalizeSemanticJsonString(selected) === canonicalizeSemanticJsonString(current), "CONTROL_HEAD_CHANGED");
  const inserted = await tx.execute<{ content_digest: string }>(sql`insert into ${sql.identifier(domains[domain].history)}
    (organization_id,runtime_instance_id,lease_epoch,content_digest,prior_content_digest,adjudicated_at_utc,valid_until_utc,duration_ms,body_json)
    values (${input.organizationId}::uuid,${input.runtimeInstanceId},${body.leaseEpoch},${leaseContentDigest},${body.expectedPreviousDigest},
      ${body.adjudicatedAtUtc}::timestamptz,${body.validUntilUtc}::timestamptz,${input.durationMs},${bodyJson}) returning content_digest`);
  check(inserted.length === 1 && inserted[0]!.content_digest === leaseContentDigest, "CONTROL_LEASE_INSERT_REQUIRED");
  const table = sql.identifier(domains[domain].head);
  // Explicit UPDATE avoids a BEFORE INSERT first-epoch guard on an upsert's
  // conflicting candidate. Both branches submit exactly one guarded statement.
  const published = current ? await tx.execute<{ content_digest: string }>(sql`update ${table} set runtime_instance_id=${input.runtimeInstanceId},
    lease_epoch=${body.leaseEpoch},content_digest=${leaseContentDigest},valid_until_utc=${body.validUntilUtc}::timestamptz,updated_at=now()
    where organization_id=${input.organizationId}::uuid and content_digest=${current.leaseContentDigest} returning content_digest`)
    : await tx.execute<{ content_digest: string }>(sql`insert into ${table}(organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc)
      values (${input.organizationId}::uuid,${input.runtimeInstanceId},${body.leaseEpoch},${leaseContentDigest},${body.validUntilUtc}::timestamptz) returning content_digest`);
  check(published.length === 1 && published[0]!.content_digest === leaseContentDigest, "CONTROL_HEAD_INSERT_REQUIRED");
  const holder = Object.freeze({ ...input, leaseEpoch: body.leaseEpoch, leaseContentDigest, adjudicatedAtUtc,
    validUntilUtc: body.validUntilUtc, expectedPreviousDigest: body.expectedPreviousDigest });
  await assertCurrent(tx, holder, domain, control); return holder;
}
export async function claimRecordedAcquisitionWithinHeldTransactionV1(tx: Executor, supplied: ClaimInput): Promise<RecordedAcquisitionHolderV1 | null> {
  const holder = await claim(tx, capture(supplied, 2_147_483_647), "RECORDED_ACQUISITION_V1");
  return holder && Object.freeze({ ...holder, ownershipDomain: "RECORDED_ACQUISITION_V1", [acquisitionBrand]: true });
}
export async function claimSavedResearchWithinHeldTransactionV1(tx: Executor, supplied: ClaimInput,
  control: NoncapitalControlReadBudget): Promise<SavedResearchHolderV1 | null> {
  const holder = await claim(tx, capture(supplied, 120_000), "SAVED_RESEARCH_V1", control);
  return holder && Object.freeze({ ...holder, ownershipDomain: "SAVED_RESEARCH_V1", [savedBrand]: true });
}

type RootKind = "APPLICATION_ASSIGNMENT" | "APPLICATION" | "UNDERSTANDING_ASSIGNMENT";
type Root = Readonly<{ rootKind: RootKind; organizationId: string; keyDigest: string; ownershipDomain: OwnershipDomain;
  contentDigest: string; leaseEpoch: number; leaseDigest: string; present: true }>;
type ApplicationRoots = Readonly<{ organizationId: string; assignmentDigest: string; applicationId: string;
  researchSessionId: string; researchAssignmentDigest: string }>;
const roots = {
  APPLICATION_ASSIGNMENT: { table: "trader_research_application_assignments_v1", key: "assignment_digest" },
  APPLICATION: { table: "trader_research_applications_v1", key: "application_id" },
  UNDERSTANDING_ASSIGNMENT: { table: "trader_research_understanding_assignments_v1", key: "session_id" },
} as const;
const rootKeys = "rootKind organizationId keyDigest ownershipDomain contentDigest leaseEpoch leaseDigest present".split(" ");
function branch(kind: RootKind, org: string, key: string) {
  const source = roots[kind];
  return sql`select ${kind}::text as kind,jsonb_build_object('rootKind',${kind}::text,'organizationId',organization_id::text,
    'keyDigest',encode(sha256(convert_to(${sql.identifier(source.key)},'UTF8')),'hex'),'ownershipDomain',ownership_domain,
    'contentDigest',content_digest,'leaseEpoch',lease_epoch,'leaseDigest',lease_content_digest,'present',true) as value
    from ${sql.identifier(source.table)} where organization_id=${org}::uuid and ${sql.identifier(source.key)}=${key}`;
}
async function probe(tx: Executor, org: string, selectors: ReadonlyArray<readonly [RootKind, string]>, query: SQL, control: NoncapitalControlReadBudget) {
  control.assertDeadline(); check(uuid.test(org), "INVALID_ORGANIZATION");
  const rows = await tx.execute<{ packet: string; bytes: number }>(sql`select packet,octet_length(packet)::integer as bytes from (
    select coalesce(jsonb_agg(value order by kind),'[]'::jsonb)::text as packet from (${query}) as selected_roots) as bounded_roots`);
  control.assertDeadline(); check(rows.length === 1, "CONTROL_ROOT_CARDINALITY_CONFLICT");
  const row = rows[0]!;
  check(typeof row.packet === "string" && Number.isSafeInteger(row.bytes) && row.bytes === Buffer.byteLength(row.packet) && row.bytes <= 4096,
    "CONTROL_PACKET_BYTES_CONFLICT");
  const decoded: unknown = JSON.parse(row.packet); check(Array.isArray(decoded) && decoded.length <= selectors.length, "CONTROL_ROOT_CARDINALITY_CONFLICT");
  const seen = new Set<string>(), result = new Map<RootKind, Root>();
  for (const value of decoded) {
    check(keys(value, rootKeys) && typeof value.rootKind === "string" && !seen.has(value.rootKind), "CONTROL_ROOT_SHAPE_CONFLICT");
    const selector = selectors.find(([kind]) => kind === value.rootKind);
    check(selector && value.organizationId === org && value.keyDigest === sha256(selector[1]) && value.present === true &&
      (value.ownershipDomain === "CAPITAL_LEGACY_V2" || value.ownershipDomain === "SAVED_RESEARCH_V1") &&
      typeof value.contentDigest === "string" && hex.test(value.contentDigest) && epoch(value.leaseEpoch) &&
      typeof value.leaseDigest === "string" && hex.test(value.leaseDigest), "CONTROL_ROOT_SHAPE_CONFLICT");
    const kind = selector[0]; seen.add(kind);
    control.admit([roots[kind].table, org, selector[1], value.ownershipDomain, value.contentDigest, value.leaseEpoch, value.leaseDigest],
      canonicalizeSemanticJsonString(value)); result.set(kind, Object.freeze(value) as Root);
  }
  const versions = selectors.map(([kind, key]) => {
    const value = result.get(kind); if (!value) control.admit([roots[kind].table, org, key, "ABSENT"], "null");
    return [kind, key, value ? [value.ownershipDomain, value.contentDigest, value.leaseEpoch, value.leaseDigest] : null];
  });
  control.admit(["root-packet", org, versions], JSON.stringify(row)); return result;
}
/** The caller already checked the selected final result. No body is read here,
 * and no expected-domain/content predicate may turn a conflict into absence. */
export async function assertSavedApplicationRootsWithinHeldTransactionV1(tx: Executor, input: ApplicationRoots,
  operation: "apply" | "consume" | "complete-consumer", control: NoncapitalControlReadBudget) {
  const selectors = [["APPLICATION_ASSIGNMENT", input.assignmentDigest], ["APPLICATION", input.applicationId],
    ["UNDERSTANDING_ASSIGNMENT", input.researchSessionId]] as const;
  const found = await probe(tx, input.organizationId, selectors,
    sql.join(selectors.map(([kind, key]) => branch(kind, input.organizationId, key)), sql` union all `), control);
  const configuration = found.get("APPLICATION_ASSIGNMENT"), application = found.get("APPLICATION"), understanding = found.get("UNDERSTANDING_ASSIGNMENT");
  check((!configuration && operation === "apply") || configuration?.ownershipDomain === "SAVED_RESEARCH_V1", "ASSIGNMENT_DOMAIN_CONFLICT");
  check((!application && operation === "apply") || application?.ownershipDomain === "SAVED_RESEARCH_V1", "APPLICATION_DOMAIN_CONFLICT");
  check(understanding && understanding.contentDigest === input.researchAssignmentDigest, "ASSIGNMENT_IDENTITY_CONFLICT");
  if (operation === "complete-consumer") check(understanding.ownershipDomain === "SAVED_RESEARCH_V1", "ASSIGNMENT_DOMAIN_CONFLICT");
  return Object.freeze({ configuration, application, understanding });
}
export async function assertSavedUnderstandingRootWithinHeldTransactionV1(tx: Executor,
  input: Readonly<{ organizationId: string; researchSessionId: string; expectedAssignmentDigest?: string }>, control: NoncapitalControlReadBudget) {
  const found = await probe(tx, input.organizationId, [["UNDERSTANDING_ASSIGNMENT", input.researchSessionId]],
    branch("UNDERSTANDING_ASSIGNMENT", input.organizationId, input.researchSessionId), control);
  const assignment = found.get("UNDERSTANDING_ASSIGNMENT");
  check(!assignment || assignment.ownershipDomain === "SAVED_RESEARCH_V1", "ASSIGNMENT_DOMAIN_CONFLICT");
  check(!assignment || (input.expectedAssignmentDigest !== undefined && assignment.contentDigest === input.expectedAssignmentDigest), "ASSIGNMENT_IDENTITY_CONFLICT");
  return assignment;
}
