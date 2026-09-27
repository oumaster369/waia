import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { sql } from "drizzle-orm";
import * as s from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertOrgMembershipPostgres, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import { prepareHeldResearchReplay, HeldResearchAccounting, captureResearchReplaySelector, type ResearchRequest } from "../research-understanding-v1/held-replay";
import { APPLICATION_AUTHORITY, APPLICATION_PURPOSE, APPLICATION_SERVICE_ACTOR, APPLICATION_LIMITS as L,
  captureApplicationConfigurationV1, ResearchApplicationRefusal, applicationDigest as digest, applicationBytes, applicationTime, requireApplication as check,
  type ResearchApplicationConfigurationV1, type ResearchApplicationRelationV1 } from "./contract";
import { APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST } from "./computation-manifest";
import { assertCategoricalRegistrationV1, evaluateCategoricalApplicationMeaningV1, foldResearchApplicationRelationV1, selectResearchApplicationRelationV1 } from "./specification";
import { readApplicationRows, admitApplicationWriteRow, readApplicationRegistration, applicationScope, decodeApplicationBody, type ApplicationExecutor, type ApplicationRow } from "./bounded-read-postgres";
import { defineCanonicalMeasurementV1, identifyCanonicalMeasurementValueV1, type CanonicalMeasurementObservationLineageV1 } from "@/lib/trader/mi/measurement-lineage-v1";
import { persistCanonicalMeasurementDefinitionWithinHeldTransactionV1Postgres, persistCanonicalMeasurementValueLineageWithinHeldTransactionV1Postgres } from "@/lib/trader/mi/canonical-pit-service-postgres";
import { claimBoundedResearchRuntimeControlLeaseWithinHeldTransactionV2, lockRuntimeOrganizationV2, assertRuntimeDatabaseClockHolderV2,
  type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { assertEnvironment } from "../durable-noncapital/recorded-analysis-v1";

export type SavedApplicationRequest = {
  configuration: ResearchApplicationConfigurationV1; research: ResearchRequest;
  operation: "apply" | "consume" | "replay"; previousSourceSequence: number; currentSourceSequence: number; consumerSourceSequence?: number;
};
type Bound = ReturnType<ReturnType<typeof prepareHeldResearchReplay>["bindHeld"]>;
type Replay = NonNullable<Awaited<ReturnType<Bound["replay"]>>>;
type Actor = { kind: "SERVICE" | "USER"; id: string };
type Holder = DatabaseClockRuntimeHolderV2;
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const schemaVersion = (kind: string) => `waia.trader.research_application_${kind}.v1`;
const common = { authority: APPLICATION_AUTHORITY, purpose: APPLICATION_PURPOSE, commandManifestDigest: APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST } as const;
const canonical = (value: unknown) => canonicalizeSemanticJsonString(value);
const equal = (a: unknown, b: unknown, code: string) => check(digest(a) === digest(b), code);
function bounded(value: unknown, maximum: number, code = "APPLICATION_OUTPUT_LIMIT"): void { check(applicationBytes(value) <= maximum, code); }
const safeSequence = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Data capture only, before the first await. The caller supplies no actor/evaluator/output. */
export function captureSavedApplicationCommand(pool: postgres.Sql, context: OrgContext, request: SavedApplicationRequest) {
  check(typeof pool.begin === "function" && !("savepoint" in pool), "APPLICATION_ROOT_POOL_REQUIRED");
  bounded(request, L.assignment + 131_072 + 65_536, "APPLICATION_COMMAND_LIMIT");
  const input = structuredClone(request), c = captureApplicationConfigurationV1(input.configuration);
  check(Object.keys(input).every(k => ["configuration", "research", "operation", "previousSourceSequence", "currentSourceSequence", "consumerSourceSequence"].includes(k)), "APPLICATION_COMMAND_INVALID");
  check(["apply", "consume", "replay"].includes(input.operation), "APPLICATION_COMMAND_INVALID");
  const selected = captureResearchReplaySelector(context, input.research);
  check(c.organizationId === selected.context.organizationId && safeSequence(input.previousSourceSequence) && safeSequence(input.currentSourceSequence) &&
    input.currentSourceSequence === input.previousSourceSequence + 1, "APPLICATION_PAIR_INVALID");
  check(input.consumerSourceSequence === undefined || (safeSequence(input.consumerSourceSequence) && input.consumerSourceSequence > input.currentSourceSequence), "APPLICATION_CONSUMER_INVALID");
  check((input.operation !== "consume" || input.consumerSourceSequence !== undefined) &&
    (input.operation !== "apply" || input.consumerSourceSequence === undefined), "APPLICATION_OPERATION_INVALID");
  for (const n of [input.previousSourceSequence, input.currentSourceSequence, input.consumerSourceSequence].filter((v): v is number => v !== undefined))
    check(n >= selected.request.assignment.firstSourceSequence, "APPLICATION_RANGE_INVALID");
  return { context: selected.context, request: input, config: c,
    assignmentDigest: digest(c), applicationId: digest({ schemaVersion: schemaVersion("key"), organizationId: c.organizationId,
      assignmentDigest: digest(c), previousSourceSequence: input.previousSourceSequence, currentSourceSequence: input.currentSourceSequence }) };
}
function sourcePin(r: Replay) { return { sourceSessionId: r.session.sessionId, sourceSequence: r.sourceSequence, packetDigest: r.packet.contentDigest,
  completionDigest: r.completion.contentDigest, evaluationDigest: r.output.contentDigest, receiptId: r.output.receipt.id,
  receiptDigest: r.output.receipt.contentDigest, analysisPitAnchor: r.packet.analysisPitAnchor, scheduledBarCloseTime: r.packet.normalized.scheduledBarCloseTime,
  inputs: r.output.inputs, sourceIdentities: r.packet.sources.map(v => ({ receiptId: v.receipt.id, receiptDigest: v.receipt.contentDigest,
    sourceId: v.receipt.sourceId, observationId: v.receipt.observationId, observationDigest: v.receipt.observationContentDigest,
    trustAsOfReceiptId: v.receipt.trustAsOfReceiptId })), selectedRevisions: r.revisions.map(v => ({ id: v.id, contentDigest: v.contentDigest,
      eventTime: v.eventTime, availableAt: v.availableAt, ingestTime: v.ingestTime })) }; }
function featureWitness(r: Replay) {
  const inputs: Extract<CanonicalMeasurementObservationLineageV1, { observationSchemaVersion: "mi-canonical-pit-observation-v1" }>[] = [];
  for (const kind of ["ohlcv_bar", "quote_l1"] as const) {
    const index = r.packet.normalized.observations.findIndex(v => v.kind === kind && (kind !== "ohlcv_bar" || v.interval === "1m"));
    const source = r.packet.sources[index];
    if (!source?.observation || source.receipt.status !== "AVAILABLE") return null;
    const observation = source.observation as { id: string; contentDigest: string; sourceId: string; trustAsOfReceiptId: string;
      sourceTrustRevisionId: string; sourceTrustContentDigest: string };
    if (!observation.trustAsOfReceiptId || !observation.sourceTrustRevisionId || !observation.sourceTrustContentDigest) return null;
    inputs.push({ observationId: observation.id, observationContentDigest: observation.contentDigest, sourceId: observation.sourceId,
      observationKind: kind, observationSchemaVersion: "mi-canonical-pit-observation-v1", trustAsOfReceiptId: observation.trustAsOfReceiptId,
      trustRevisionId: observation.sourceTrustRevisionId, trustRevisionContentDigest: observation.sourceTrustContentDigest });
  }
  const payload = { schemaVersion: schemaVersion("feature_witness"), ...common, packetDigest: r.packet.contentDigest,
    fullBarsDigest: digest(r.packet.normalized.captured.bars), quoteDigest: digest(r.packet.normalized.quote), features: r.output.features };
  bounded(payload, L.featureWitness);
  const definition = defineCanonicalMeasurementV1({ organizationId: r.session.organizationId, category: "feature_transform",
    name: "Saved research FeatureSnapshot / categorical application v1", outputSchemaVersion: payload.schemaVersion,
    inputContracts: inputs.map(i => ({ observationKind: i.observationKind, observationSchemaVersion: i.observationSchemaVersion })) });
  const value = identifyCanonicalMeasurementValueV1({ organizationId: r.session.organizationId, definition, outputContentDigest: digest(payload), inputs });
  const witness = { payload, payloadCanonical: canonicalizeSemanticJsonString(payload), definition, value };
  bounded(witness, L.featureWitness); return witness;
}
type Witness = NonNullable<ReturnType<typeof featureWitness>>;
function applicationBody(c: ResearchApplicationConfigurationV1, id: string, actor: Actor, p: Replay, a: Replay,
  registration: Awaited<ReturnType<typeof readApplicationRegistration>>, recordedAt: string) {
  const witnesses = [featureWitness(p), featureWitness(a)];
  let meaning = evaluateCategoricalApplicationMeaningV1({ previous: p.output, current: a.output });
  if (meaning.direction && witnesses.some(v => !v)) meaning = { ...meaning, disposition: "UNASSESSED_LINEAGE", direction: null, relationKind: null };
  const evidenceBody = meaning.direction ? { schemaVersion: schemaVersion("evidence"), ...common, applicationId: id, assignmentDigest: digest(c),
    hypothesisId: c.hypothesisId, hypothesisKey: c.hypothesisKey, hypothesisDefinitionDigest: c.hypothesisDefinitionDigest,
    direction: meaning.direction, confidenceState: "NOT_ASSESSED" as const, specification: c.specification, bridge: c.bridge,
    previous: sourcePin(p), current: sourcePin(a), eventTime: a.packet.analysisPitAnchor, recordedTime: recordedAt } : null;
  const evidence = evidenceBody ? { ...evidenceBody, id: digest(evidenceBody), contentDigest: digest(evidenceBody) } : null;
  const relationBody = evidence && meaning.relationKind ? { schemaVersion: "waia.trader.research_application_relation.v1" as const, ...common,
    organizationId: c.organizationId, symbol: c.symbol, applicationId: id, evidenceId: evidence.id, hypothesisId: c.hypothesisId,
    hypothesisKey: c.hypothesisKey, hypothesisDefinitionDigest: c.hypothesisDefinitionDigest, assignmentDigest: digest(c), version: 1 as const,
    eventTime: a.packet.analysisPitAnchor, recordedTime: recordedAt, verified: false as const, confidenceState: "NOT_ASSESSED" as const, relationKind: meaning.relationKind } : null;
  const relation: ResearchApplicationRelationV1 | null = relationBody ? { ...relationBody, id: digest(relationBody), contentDigest: digest(relationBody) } : null;
  const value = { schemaVersion: schemaVersion("record"), ...common, organizationId: c.organizationId, applicationId: id, assignmentDigest: digest(c),
    configuration: c, actor, recordedAt, previous: sourcePin(p), current: sourcePin(a), registration: json(registration), meaning, evidence, relation, witnesses };
  bounded(value, L.application); return value;
}
export type SavedApplicationBody = ReturnType<typeof applicationBody>;
type AvailabilityBody = { schemaVersion: string; authority: typeof APPLICATION_AUTHORITY; purpose: typeof APPLICATION_PURPOSE;
  organizationId: string; applicationId: string; applicationDigest: string; availableAt: string; actor: Actor };
type ConsumptionBody = { schemaVersion: string; authority: typeof APPLICATION_AUTHORITY; purpose: typeof APPLICATION_PURPOSE;
  organizationId: string; applicationId: string; applicationDigest: string; assignmentDigest: string; availabilityDigest: string;
  consumer: ReturnType<typeof sourcePin>; sequence: number; previousConsumptionDigest: string | null; actor: Actor; recordedAt: string;
  registration: unknown; fold: ReturnType<typeof foldResearchApplicationRelationV1> | null; selection: ReturnType<typeof selectResearchApplicationRelationV1> | null;
  disposition: string };

/** One fixed invocation. Private transaction adapter has no callback injection into the public command. */
export function createSavedApplicationOwner(pool: postgres.Sql, context: OrgContext, supplied: SavedApplicationRequest) {
  const selected = captureSavedApplicationCommand(pool, context, supplied);
  const { config: c, request, applicationId: id, assignmentDigest } = selected;
  const accounting = new HeldResearchAccounting();
  const extra = accounting.budget(L.additionalAggregate);
  let holder: Holder | null = null;
  async function transaction<T>(mode: "read committed" | "repeatable read" | "repeatable read read only", work: (bound: Bound) => Promise<T>): Promise<T> {
    const prepared = prepareHeldResearchReplay(pool, accounting);
    accounting.reserveFinalization(1); accounting.beforeStatement(); // real driver's BEGIN
    const result = await pool.begin(`isolation level ${mode}`, async held => {
      try {
        const bound = prepared.bindHeld(held);
        await bound.executor.execute(sql`set local lock_timeout = '5s'`);
        await bound.executor.execute(sql`set local statement_timeout = '30s'`);
        const value = await work(bound); accounting.assertDeadline();
        accounting.beforeFinalizationStatement(); // callback succeeds: real driver sends COMMIT
        return value;
      } catch (error) {
        accounting.beforeFinalizationStatement(); // callback fails: real driver sends ROLLBACK
        throw error;
      }
    });
    accounting.assertDeadline(); return result as T;
  }
  async function actor(db: ApplicationExecutor): Promise<Actor> {
    const scope = await requireServiceOrgContext(selected.context, v => assertOrgMembershipPostgres(db as WaiaPostgresDb, v));
    accounting.assertDeadline();
    return scope.userId === undefined ? { kind: "SERVICE", id: APPLICATION_SERVICE_ACTOR } : { kind: "USER", id: scope.userId };
  }
  async function current(bound: Bound): Promise<string> {
    check(holder, "APPLICATION_HOLDER_REQUIRED");
    await lockRuntimeOrganizationV2(bound.executor, c.organizationId);
    const now = await assertRuntimeDatabaseClockHolderV2(bound.executor, holder);
    accounting.assertDeadline(); return now;
  }
  async function claim() {
    if (holder) return;
    try {
      holder = await transaction("read committed", b => claimBoundedResearchRuntimeControlLeaseWithinHeldTransactionV2(b.executor,
        { organizationId: c.organizationId, runtimeInstanceId: `research-application:${randomUUID()}`,
          durationMs: request.research.range.leaseDurationMs }));
    } catch (error) {
      // The owning claim promise has rejected: its real rollback precedes recovery.
      // Drizzle may wrap the PostgreSQL error once; no unrelated/unknown failure is swallowed.
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      const unique = (value: unknown) => typeof value === "object" && value !== null && "code" in value && value.code === "23505";
      if (unique(error) || unique(cause)) throw new ResearchApplicationRefusal("APPLICATION_LEASE_BUSY");
      throw error;
    }
    accounting.assertDeadline(); check(holder, "APPLICATION_LEASE_BUSY");
  }
  const holderColumns = () => { check(holder, "APPLICATION_HOLDER_REQUIRED"); return { runtimeInstanceId: holder.runtimeInstanceId,
    leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest }; };
  async function snapshot(bound: Bound, sequence: number) {
    const r = await bound.replay(selected.context, { ...request.research,
      range: { ...request.research.range, startSequence: sequence, count: 1 } }, sequence);
    check(r, "APPLICATION_SAVED_COMPLETION_MISSING");
    check(r.assignment.contentDigest === c.researchAssignmentDigest && r.assignment.researchSessionId === c.researchSessionId &&
      r.assignment.sourceSessionId === c.sourceSessionId && r.assignment.sourceConfigDigest === c.sourceConfigDigest &&
      r.assignment.organizationId === c.organizationId && r.assignment.accountId === c.accountId && r.assignment.symbol === c.symbol &&
      r.profile.id === c.profileId && r.profile.contentDigest === c.profileContentDigest &&
      r.output.declarations.computation === c.computation && r.output.declarations.computationManifestDigest === c.computationManifestDigest,
      "APPLICATION_SAVED_SCOPE_CONFLICT");
    accounting.assertDeadline(); return r;
  }
  async function selectedRegistry(db: ApplicationExecutor, at: string, cutoffs: string[]) {
    const r = await readApplicationRegistration(db, c, at, extra);
    assertCategoricalRegistrationV1(c, r, cutoffs); accounting.assertDeadline(); return r;
  }
  async function lockSources(db: ApplicationExecutor, values: Replay[]) {
    const sources = [...new Map(values.flatMap(r => r.packet.sources.flatMap(v => v.source ? [[(v.source as { id: string }).id, v.source] as const] : []))).entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [sourceId, saved] of sources) {
      const row = (await readApplicationRows(db, "source", applicationScope("source", c.organizationId, sourceId), extra, { lock: true }))[0]!;
      equal(row, saved, "APPLICATION_SOURCE_CHANGED");
    }
    const revisions = [...new Map(values.flatMap(r => r.revisions.map(v => [v.id, v] as const))).values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const revision of revisions) {
      const row = (await readApplicationRows(db, "revision", applicationScope("revision", c.organizationId, revision.id), extra, { lock: true }))[0]!;
      const { schemaVersion: _v, ...saved } = revision; void _v;
      equal(row, saved, "APPLICATION_TRUST_REVISION_CHANGED");
    }
  }
  async function audit(db: ApplicationExecutor, operation: "apply" | "availability" | "consume", body: { actor: Actor }, bodyDigest: string) {
    return writeAuditLogPostgres(db, { organizationId: c.organizationId, actorType: body.actor.kind === "USER" ? "user" : "service", actorId: body.actor.id,
      action: `trader.research_application.${operation}`, entityType: "trader_research_application", entityId: id,
      metadata: { operation, applicationId: id, assignmentDigest, bodyDigest, actor: body.actor, holder: holderColumns() } });
  }
  async function verifyAudit(db: ApplicationExecutor, operation: "apply" | "availability" | "consume", row: ApplicationRow, body: { actor: Actor }) {
    check(typeof row.auditId === "string", "APPLICATION_AUDIT_MISSING");
    const actual = (await readApplicationRows(db, "audit", applicationScope("audit", c.organizationId, row.auditId), extra))[0]!;
    equal(actual, { id: row.auditId, organizationId: c.organizationId, actorType: body.actor.kind === "USER" ? "user" : "service", actorId: body.actor.id,
      action: `trader.research_application.${operation}`, entityType: "trader_research_application", entityId: id,
      metadataJson: { operation, applicationId: id, assignmentDigest, bodyDigest: row.contentDigest, actor: body.actor,
        holder: { runtimeInstanceId: row.runtimeInstanceId, leaseEpoch: row.leaseEpoch, leaseContentDigest: row.leaseContentDigest } } }, "APPLICATION_AUDIT_CONFLICT");
  }
  async function witnesses(db: ApplicationExecutor, values: readonly (Witness | null)[], write: boolean) {
    for (const witness of values) {
      if (!witness) continue;
      const definitionRows = await readApplicationRows(db, "canonicalDefinition", applicationScope("canonicalDefinition", c.organizationId, witness.definition.id), extra, { optional: true });
      const valueRows = await readApplicationRows(db, "canonicalValue", applicationScope("canonicalValue", c.organizationId, witness.value.id), extra, { optional: true });
      const inputTable = s.traderMiCanonicalMeasurementValueInputV1;
      const inputRows = await readApplicationRows(db, "canonicalInput", sql`${inputTable.organizationId}=${c.organizationId} and ${inputTable.measurementValueId}=${witness.value.id}`, extra,
        { optional: true, maximum: L.selectedHistory, order: sql`${inputTable.inputOrdinal}` });
      if (definitionRows[0]) {
        const { inputContracts, ...fields } = witness.definition;
        equal(definitionRows[0], { ...fields, definitionJson: witness.definition, inputContractsJson: inputContracts }, "APPLICATION_CANONICAL_DEFINITION_CONFLICT");
      }
      if (valueRows[0]) equal(valueRows[0], { id: witness.value.id, organizationId: c.organizationId, definitionId: witness.value.definitionId,
        definitionContentDigest: witness.value.definitionContentDigest, outputContentDigest: witness.value.outputContentDigest, inputCount: witness.value.inputs.length,
        inputLineageJson: witness.value.inputs, authority: witness.value.authority, contentDigest: witness.value.contentDigest, schemaVersion: witness.value.schemaVersion }, "APPLICATION_CANONICAL_VALUE_CONFLICT");
      if (valueRows.length || inputRows.length) equal(inputRows, witness.value.inputs.map((v, inputOrdinal) => ({ ...v, organizationId: c.organizationId, measurementValueId: witness.value.id, inputOrdinal })), "APPLICATION_CANONICAL_INPUT_CONFLICT");
      if (write) {
        await persistCanonicalMeasurementDefinitionWithinHeldTransactionV1Postgres(db, selected.context, witness.definition);
        await persistCanonicalMeasurementValueLineageWithinHeldTransactionV1Postgres(db, selected.context, witness.value);
      } else check(definitionRows.length === 1 && valueRows.length === 1 && inputRows.length === witness.value.inputs.length, "APPLICATION_CANONICAL_DEPENDENCY_MISSING");
      accounting.assertDeadline();
    }
  }
  function projection(row: ApplicationRow, body: unknown, fields: ApplicationRow) {
    check(Number.isSafeInteger(row.leaseEpoch) && Number(row.leaseEpoch) > 0 && typeof row.runtimeInstanceId === "string" &&
      /^[0-9a-f]{64}$/.test(String(row.leaseContentDigest)), "APPLICATION_RECORDED_HOLDER_INVALID");
    equal(row, { organizationId: c.organizationId, contentDigest: digest(body), bodyJson: canonical(body),
      runtimeInstanceId: row.runtimeInstanceId, leaseEpoch: row.leaseEpoch, leaseContentDigest: row.leaseContentDigest, ...fields }, "APPLICATION_PROJECTION_CONFLICT");
  }
  async function assignment(db: ApplicationExecutor, activeActor: Actor, create: boolean) {
    const body = { schemaVersion: schemaVersion("assignment"), ...common, organizationId: c.organizationId, configuration: c, actor: activeActor };
    bounded(body, L.assignment);
    const existing = (await readApplicationRows(db, "assignment", applicationScope("assignment", c.organizationId, assignmentDigest), extra, { optional: true }))[0];
    if (existing) {
      equal(decodeApplicationBody(existing), body, "APPLICATION_ASSIGNMENT_CONFLICT");
      projection(existing, body, { assignmentDigest, researchSessionId: c.researchSessionId, researchAssignmentDigest: c.researchAssignmentDigest });
    } else {
      check(create, "APPLICATION_ASSIGNMENT_MISSING");
      const values = { organizationId: c.organizationId, assignmentDigest, contentDigest: digest(body), bodyJson: canonical(body),
        researchSessionId: c.researchSessionId, researchAssignmentDigest: c.researchAssignmentDigest, ...holderColumns() };
      await admitApplicationWriteRow(db, "assignment", values, extra);
      const inserted = await db.insert(s.traderResearchApplicationAssignmentsV1).values(values).returning({ id: s.traderResearchApplicationAssignmentsV1.assignmentDigest });
      check(inserted.length === 1, "APPLICATION_FENCED_INSERT_REQUIRED");
    }
  }
  async function replayApplication(bound: Bound, row: ApplicationRow, activeActor: Actor) {
    const body = decodeApplicationBody<SavedApplicationBody>(row);
    await assignment(bound.executor, activeActor, false);
    check(body.organizationId === c.organizationId && body.applicationId === id && body.assignmentDigest === assignmentDigest,
      "APPLICATION_SCOPE_CONFLICT");
    equal(body.actor, activeActor, "APPLICATION_ACTOR_CONFLICT"); equal(body.configuration, c, "APPLICATION_CONFIGURATION_CONFLICT");
    applicationTime(body.recordedAt);
    const p = await snapshot(bound, request.previousSourceSequence), a = await snapshot(bound, request.currentSourceSequence);
    check(applicationTime(body.recordedAt) > applicationTime(a.packet.analysisPitAnchor), "APPLICATION_RECORDED_TIME_INVALID");
    const registry = await selectedRegistry(bound.executor, body.recordedAt, [p.packet.analysisPitAnchor, a.packet.analysisPitAnchor, body.recordedAt]);
    const expected = applicationBody(c, id, activeActor, p, a, registry, body.recordedAt);
    equal(expected, body, "APPLICATION_REPLAY_CONFLICT");
    projection(row, body, { applicationId: id, assignmentDigest, previousSourceSequence: p.sourceSequence,
      currentSourceSequence: a.sourceSequence, recordedAt: body.recordedAt, auditId: row.auditId });
    await witnesses(bound.executor, body.witnesses, false); await verifyAudit(bound.executor, "apply", row, body);
    accounting.assertDeadline(); return { body, row, p, a };
  }
  async function loadApplication(bound: Bound, activeActor: Actor) {
    const row = (await readApplicationRows(bound.executor, "application", applicationScope("application", c.organizationId, id), extra, { optional: true }))[0];
    return row ? replayApplication(bound, row, activeActor) : null;
  }
  async function loadAvailability(db: ApplicationExecutor, app: NonNullable<Awaited<ReturnType<typeof loadApplication>>>) {
    const row = (await readApplicationRows(db, "availability", applicationScope("availability", c.organizationId, id), extra, { optional: true }))[0];
    if (!row) return null;
    const body = decodeApplicationBody<AvailabilityBody>(row);
    check(applicationTime(body.availableAt) >= applicationTime(app.body.recordedAt), "APPLICATION_AVAILABILITY_TIME_INVALID");
    equal(body, { schemaVersion: schemaVersion("availability"), ...common, organizationId: c.organizationId, applicationId: id,
      applicationDigest: app.row.contentDigest, availableAt: body.availableAt, actor: app.body.actor }, "APPLICATION_AVAILABILITY_CONFLICT");
    projection(row, body, { applicationId: id, applicationDigest: app.row.contentDigest, availableAt: body.availableAt, auditId: row.auditId });
    await verifyAudit(db, "availability", row, body); accounting.assertDeadline(); return { row, body };
  }
  function result(app: SavedApplicationBody, appDigest: string, available: AvailabilityBody, availabilityDigest: string,
    outcome: "COMMITTED" | "REPLAYED", consumption?: ConsumptionBody) {
    accounting.assertDeadline();
    return { status: "COMPLETE" as const, outcome, applicationId: id, applicationDigest: appDigest, availabilityDigest,
      disposition: consumption?.disposition ?? app.meaning.disposition, application: app, availability: available,
      consumption: consumption ?? null, consumptionDigest: consumption ? digest(consumption) : null };
  }
  async function consumeBody(bound: Bound, app: NonNullable<Awaited<ReturnType<typeof loadApplication>>>, available: NonNullable<Awaited<ReturnType<typeof loadAvailability>>>,
    activeActor: Actor, recordedAt: string, sequence: number, previousConsumptionDigest: string | null) {
    check(request.consumerSourceSequence !== undefined, "APPLICATION_CONSUMER_REQUIRED");
    const b = await snapshot(bound, request.consumerSourceSequence);
    check(applicationTime(recordedAt) >= applicationTime(b.packet.analysisPitAnchor), "APPLICATION_CONSUMPTION_TIME_INVALID");
    check(b.sourceSequence > app.a.sourceSequence && applicationTime(b.packet.analysisPitAnchor) > applicationTime(available.body.availableAt) &&
      applicationTime(b.packet.normalized.scheduledBarCloseTime) > applicationTime(app.a.packet.normalized.scheduledBarCloseTime), "APPLICATION_NOT_YET_AVAILABLE");
    const registry = await selectedRegistry(bound.executor, recordedAt, [b.packet.analysisPitAnchor, recordedAt]);
    const body: ConsumptionBody = { schemaVersion: schemaVersion("consumption"), ...common, organizationId: c.organizationId,
      applicationId: id, applicationDigest: String(app.row.contentDigest), assignmentDigest, availabilityDigest: String(available.row.contentDigest),
      consumer: sourcePin(b), sequence, previousConsumptionDigest, actor: activeActor, recordedAt, registration: json(registry),
      fold: app.body.relation ? foldResearchApplicationRelationV1(app.body.relation) : null,
      selection: app.body.relation ? selectResearchApplicationRelationV1({ config: c, applicationId: id, relation: app.body.relation,
        availabilityTime: available.body.availableAt, consumer: b.output }) : null,
      disposition: app.body.relation ? "ASSESSED" : "UNASSESSED_APPLICATION" };
    if (body.selection?.disposition === "UNASSESSED_ANTECEDENT") body.disposition = "UNASSESSED_ANTECEDENT";
    bounded(body, L.consumption); accounting.assertDeadline(); return { body, b };
  }
  async function predecessor(db: ApplicationExecutor, sequence: number, previous: string | null) {
    if (sequence === 0) { check(previous === null, "APPLICATION_CONSUMPTION_PREFIX_CONFLICT"); return; }
    check(safeSequence(sequence), "APPLICATION_CONSUMPTION_PREFIX_CONFLICT");
    const t = s.traderResearchApplicationConsumptionsV1;
    const rows = await readApplicationRows(db, "consumptionHead", sql`${t.organizationId}=${c.organizationId} and ${t.assignmentDigest}=${assignmentDigest} and ${t.sequence}=${sequence - 1}`, extra);
    check(rows[0]?.contentDigest === previous, "APPLICATION_CONSUMPTION_PREFIX_CONFLICT");
  }
  async function replayConsumption(bound: Bound, app: NonNullable<Awaited<ReturnType<typeof loadApplication>>>, available: NonNullable<Awaited<ReturnType<typeof loadAvailability>>>,
    activeActor: Actor, row: ApplicationRow) {
    const body = decodeApplicationBody<ConsumptionBody>(row);
    check(safeSequence(body.sequence), "APPLICATION_CONSUMPTION_PREFIX_CONFLICT");
    await predecessor(bound.executor, body.sequence, body.previousConsumptionDigest);
    const expected = await consumeBody(bound, app, available, activeActor, body.recordedAt, body.sequence, body.previousConsumptionDigest);
    equal(body, expected.body, "APPLICATION_CONSUMPTION_REPLAY_CONFLICT");
    projection(row, body, { assignmentDigest, applicationId: id, applicationDigest: app.row.contentDigest, availabilityDigest: available.row.contentDigest,
      consumerSourceSessionId: c.sourceSessionId, consumerSourceSequence: request.consumerSourceSequence, sequence: body.sequence,
      previousConsumptionDigest: body.previousConsumptionDigest, auditId: row.auditId });
    await verifyAudit(bound.executor, "consume", row, body); accounting.assertDeadline(); return body;
  }
  async function completed() {
    return transaction("repeatable read read only", async bound => {
      const activeActor = await actor(bound.executor);
      // Check the selected final stage before costly P/A/B replay. Missing work does
      // not replay a whole packet set twice or accidentally exhaust the invocation.
      const finalKind = request.consumerSourceSequence === undefined ? "availability" : "consumption";
      const finalRow = (await readApplicationRows(bound.executor, finalKind,
        applicationScope(finalKind, c.organizationId, id, request.consumerSourceSequence), extra, { optional: true }))[0];
      if (!finalRow) return null;
      const app = await loadApplication(bound, activeActor); check(app, "APPLICATION_DEPENDENCY_MISSING");
      const available = await loadAvailability(bound.executor, app); check(available, "APPLICATION_AVAILABILITY_MISSING");
      const consumption = finalKind === "consumption" ? await replayConsumption(bound, app, available, activeActor, finalRow) : undefined;
      return result(app.body, String(app.row.contentDigest), available.body, String(available.row.contentDigest), "REPLAYED", consumption);
    });
  }
  async function apply() {
    await transaction("repeatable read", async bound => {
      const activeActor = await actor(bound.executor); await current(bound);
      const existing = await loadApplication(bound, activeActor); if (existing) return;
      const p = await snapshot(bound, request.previousSourceSequence), a = await snapshot(bound, request.currentSourceSequence);
      await lockSources(bound.executor, [p, a]);
      const recordedAt = await current(bound);
      check(applicationTime(recordedAt) > applicationTime(a.packet.analysisPitAnchor), "APPLICATION_RECORDED_TIME_INVALID");
      const registry = await selectedRegistry(bound.executor, recordedAt, [p.packet.analysisPitAnchor, a.packet.analysisPitAnchor, recordedAt]);
      const body = applicationBody(c, id, activeActor, p, a, registry, recordedAt);
      await assignment(bound.executor, activeActor, true);
      await witnesses(bound.executor, body.witnesses, true);
      const auditId = await audit(bound.executor, "apply", body, digest(body));
      const values = { organizationId: c.organizationId, applicationId: id, assignmentDigest, previousSourceSequence: p.sourceSequence,
        currentSourceSequence: a.sourceSequence, recordedAt, contentDigest: digest(body), bodyJson: canonical(body), auditId, ...holderColumns() };
      await admitApplicationWriteRow(bound.executor, "application", values, extra);
      const inserted = await bound.executor.insert(s.traderResearchApplicationsV1).values(values).returning({ id: s.traderResearchApplicationsV1.applicationId });
      check(inserted.length === 1, "APPLICATION_FENCED_INSERT_REQUIRED"); await current(bound); accounting.assertDeadline();
    });
    return transaction("repeatable read", async bound => {
      const activeActor = await actor(bound.executor); await current(bound);
      const app = await loadApplication(bound, activeActor); check(app, "APPLICATION_DEPENDENCY_MISSING");
      let available = await loadAvailability(bound.executor, app);
      if (!available) {
        await lockSources(bound.executor, [app.p, app.a]);
        const availableAt = await current(bound); // observed only AFTER reading the prior committed application
        check(applicationTime(availableAt) >= applicationTime(app.body.recordedAt), "APPLICATION_AVAILABILITY_TIME_INVALID");
        const body: AvailabilityBody = { schemaVersion: schemaVersion("availability"), ...common, organizationId: c.organizationId, applicationId: id,
          applicationDigest: String(app.row.contentDigest), availableAt, actor: activeActor };
        bounded(body, L.projection);
        const auditId = await audit(bound.executor, "availability", body, digest(body));
        const values = { organizationId: c.organizationId, applicationId: id, applicationDigest: String(app.row.contentDigest), availableAt,
          contentDigest: digest(body), bodyJson: canonical(body), auditId, ...holderColumns() };
        await admitApplicationWriteRow(bound.executor, "availability", values, extra);
        const inserted = await bound.executor.insert(s.traderResearchApplicationAvailabilityV1).values(values).returning({ id: s.traderResearchApplicationAvailabilityV1.applicationId });
        check(inserted.length === 1, "APPLICATION_FENCED_INSERT_REQUIRED");
        available = { row: values, body }; await current(bound);
      }
      return result(app.body, String(app.row.contentDigest), available.body, String(available.row.contentDigest), "COMMITTED");
    });
  }
  async function consume() {
    return transaction("repeatable read", async bound => {
      const activeActor = await actor(bound.executor); await current(bound);
      const app = await loadApplication(bound, activeActor); check(app, "APPLICATION_DEPENDENCY_MISSING");
      const available = await loadAvailability(bound.executor, app); check(available, "APPLICATION_AVAILABILITY_MISSING");
      const old = (await readApplicationRows(bound.executor, "consumption", applicationScope("consumption", c.organizationId, id, request.consumerSourceSequence), extra, { optional: true }))[0];
      if (old) return result(app.body, String(app.row.contentDigest), available.body, String(available.row.contentDigest), "REPLAYED",
        await replayConsumption(bound, app, available, activeActor, old));
      const t = s.traderResearchApplicationConsumptionsV1;
      const head = (await readApplicationRows(bound.executor, "consumptionHead", applicationScope("consumptionHead", c.organizationId, assignmentDigest), extra,
        { optional: true, order: sql`${t.sequence} desc` }))[0];
      const sequence = head ? Number(head.sequence) + 1 : 0, previousConsumptionDigest = head ? String(head.contentDigest) : null;
      check(safeSequence(sequence), "APPLICATION_CONSUMPTION_PREFIX_CONFLICT");
      const recordedAt = await current(bound);
      const { body, b } = await consumeBody(bound, app, available, activeActor, recordedAt, sequence, previousConsumptionDigest);
      await lockSources(bound.executor, [app.p, app.a, b]);
      const auditId = await audit(bound.executor, "consume", body, digest(body));
      const values = { organizationId: c.organizationId, assignmentDigest, applicationId: id, applicationDigest: String(app.row.contentDigest),
        availabilityDigest: String(available.row.contentDigest), consumerSourceSessionId: c.sourceSessionId, consumerSourceSequence: b.sourceSequence,
        sequence, previousConsumptionDigest, contentDigest: digest(body), bodyJson: canonical(body), auditId, ...holderColumns() };
      await admitApplicationWriteRow(bound.executor, "consumption", values, extra);
      const inserted = await bound.executor.insert(t).values(values).returning({ sequence: t.sequence });
      check(inserted.length === 1, "APPLICATION_FENCED_INSERT_REQUIRED"); await current(bound);
      return result(app.body, String(app.row.contentDigest), available.body, String(available.row.contentDigest), "COMMITTED", body);
    });
  }
  return Object.freeze({ async execute() {
    assertEnvironment(); accounting.assertDeadline();
    const old = await completed(); accounting.assertDeadline(); if (old) return old;
    check(request.operation !== "replay", "APPLICATION_OPERATION_MISSING");
    await claim();
    const value = request.operation === "apply" ? await apply() : await consume();
    accounting.assertDeadline(); return value;
  } });
}
