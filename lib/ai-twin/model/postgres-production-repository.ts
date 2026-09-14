import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import { withPostgresSerializableTransactionRetry } from "@/db/postgres-session-transaction";
import type {
  HumanClaimVersion,
  HumanCorrectionRecord,
  ModelCommand,
  ModelConsentGrant,
  ModelContext,
  ModelLedger,
  ModelObservation,
} from "./contracts";
import { parseConsentGrantIssuanceIntent, parseModelConsentGrant } from "./consent";
import { evaluatePersonalTwinModelAccess } from "./core-access";
import { createProductionTwinCoreAuthorityAdapter } from "./core-resolver-postgres";
import { applyModelCommand, createModelLedger, projectCurrentModel } from "./ledger";
import {
  planRetention,
  TWIN_NECESSITY_REVIEW_POLICY,
  TWIN_RETENTION_POLICY,
  type InitialHumanModelEndorsement,
  type NecessityReviewConfirmation,
} from "./lifecycle";
import { assertModelJsonData, type VersionedModelReference } from "./persistence-contracts";
import {
  TWIN_RIGHTS_OPERATION_POLICY,
  validateRightsOperationHistory,
  type RightsOperationHistory,
  type RightsOperationType,
  type RightsOperationValidationContext,
} from "./rights-operation";
import { twinPersonalScopePostgresPredicate } from "./scope-postgres";

type Context = Omit<ModelContext, "grants">;
type Tx = postgres.Sql;
type ObjectKind =
  | "observation"
  | "claim"
  | "correction"
  | "evidence_link"
  | "hypothesis"
  | "relation"
  | "knowledge_need";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) throw new Error(code);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function sameScope(a: Context["scope"], b: Context["scope"]): boolean {
  return a.organizationId === b.organizationId && a.subjectId === b.subjectId;
}
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}
function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
function observationTargetDigest(objectId: string): string {
  return `sha256:${createHash("sha256").update(objectId, "utf8").digest("hex")}`;
}
export const twinObservationTargetDigest = observationTargetDigest;
function consentLineageFingerprint(grant: ModelConsentGrant): string {
  return JSON.stringify(
    canonicalJson({
      id: grant.id,
      scope: grant.scope,
      purpose: grant.purpose,
      sources: grant.sources,
      mode: grant.mode,
      permittedUses: grant.permittedUses,
      disclosureBoundary: grant.disclosureBoundary,
      issuedAt: grant.issuedAt,
      temporalMode: grant.temporalMode,
      expiresAt: grant.expiresAt,
      retentionPolicyId: grant.retentionPolicyId,
    }),
  );
}
function validateConsentLineage(
  grants: readonly ModelConsentGrant[],
  scope: Context["scope"],
): void {
  const byId = new Map<string, ModelConsentGrant[]>();
  for (const grant of grants) {
    requireValue(sameScope(grant.scope, scope), "CONSENT_LINEAGE_INVALID");
    byId.set(grant.id, [...(byId.get(grant.id) ?? []), grant]);
  }
  for (const lineage of byId.values()) {
    lineage.sort((left, right) => left.version - right.version);
    const first = lineage[0];
    requireValue(first.version === 1 && first.revokedAt === null, "CONSENT_LINEAGE_INVALID");
    const fingerprint = consentLineageFingerprint(first);
    for (let index = 1; index < lineage.length; index += 1) {
      const previous = lineage[index - 1];
      const current = lineage[index];
      requireValue(
        current.version === previous.version + 1 &&
          previous.revokedAt === null &&
          current.revokedAt !== null &&
          consentLineageFingerprint(current) === fingerprint,
        "CONSENT_LINEAGE_INVALID",
      );
    }
  }
}
function assertContext(ctx: Context, humanOnly = false): void {
  createModelLedger(ctx.scope);
  requireValue(
    nonempty(ctx.purpose) &&
      Number.isFinite(Date.parse(ctx.now)) &&
      new Date(ctx.now).toISOString() === ctx.now,
  );
  requireValue(ctx.actor.subjectId === ctx.scope.subjectId, "SCOPE_MISMATCH");
  requireValue(["human", "model"].includes(ctx.actor.kind));
  if (humanOnly) requireValue(ctx.actor.kind === "human", "HUMAN_REQUIRED");
}

type ConsentRow = {
  grant_id: string;
  version: number;
  organization_id: string;
  subject_user_id: string;
  purpose: string;
  sources: ModelConsentGrant["sources"];
  mode: ModelConsentGrant["mode"];
  permitted_uses: ModelConsentGrant["permittedUses"];
  disclosure_boundary: ModelConsentGrant["disclosureBoundary"];
  issued_at: Date;
  temporal_mode: ModelConsentGrant["temporalMode"];
  expires_at: Date | null;
  revoked_at: Date | null;
  retention_policy_id: string;
};

function grantFromRow(row: ConsentRow): ModelConsentGrant {
  return parseModelConsentGrant({
    id: row.grant_id,
    version: row.version,
    scope: { organizationId: row.organization_id, subjectId: row.subject_user_id },
    purpose: row.purpose,
    sources: row.sources,
    mode: row.mode,
    permittedUses: row.permitted_uses,
    disclosureBoundary: row.disclosure_boundary,
    issuedAt: row.issued_at.toISOString(),
    temporalMode: row.temporal_mode,
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    retentionPolicyId: row.retention_policy_id,
  });
}

export type ProductionTwinRepositoryOptions = Readonly<{
  sql: postgres.Sql;
  resolveActorUserId: () => Promise<string | null>;
}>;

/** Normalized production persistence against 0209 `ai_twin_*` tables. Not mounted. */
export function createProductionTwinRepository(options: ProductionTwinRepositoryOptions) {
  const sql = options.sql;

  function snapshotData<T>(input: T): T {
    try {
      assertModelJsonData(input);
      const snapshot = freezeJson(structuredClone(input));
      assertModelJsonData(snapshot);
      return snapshot;
    } catch {
      throw new Error("INVALID_INPUT");
    }
  }
  function snapshotContext(supplied: Context, humanOnly: boolean): Context {
    const snapshot = snapshotData(supplied);
    assertContext(snapshot, humanOnly);
    return snapshot;
  }
  function scoped(tx: Tx, ctx: Context) {
    return twinPersonalScopePostgresPredicate(tx, ctx.scope);
  }
  async function withAccess<T>(
    supplied: Context,
    humanOnly: boolean,
    work: (tx: Tx, trusted: Context, authorityNow: string) => Promise<T>,
  ): Promise<T> {
    const snapshot = snapshotContext(supplied, humanOnly);
    const actorUserId = await options.resolveActorUserId();
    const authority = createProductionTwinCoreAuthorityAdapter({ actorUserId });
    return withPostgresSerializableTransactionRetry(sql, async (tx) => {
      const actor = (await authority.resolveAuthenticatedActor(tx)) as {
        actorClass: "human";
        actorUserId: string;
      };
      const request = Object.freeze({
        actor,
        organizationId: snapshot.scope.organizationId,
        subjectUserId: snapshot.scope.subjectId,
      });
      const resolved = await authority.resolveCurrentCoreAccess(tx, request);
      requireValue(
        request.actor.actorUserId === snapshot.scope.subjectId,
        "TWIN_PERSONAL_SUBJECT_MISMATCH",
      );
      const decision = evaluatePersonalTwinModelAccess(resolved);
      requireValue(
        decision.allowed &&
          decision.scope.organizationId === request.organizationId &&
          decision.scope.subjectId === request.subjectUserId &&
          decision.actor.subjectId === request.actor.actorUserId,
        decision.allowed ? "TWIN_CORE_CONTEXT_MISMATCH" : decision.reason,
      );
      const [{ now }] = await tx<{ now: string }[]>`select clock_timestamp()::text as now`;
      const trusted: Context = {
        ...snapshot,
        scope: Object.freeze({ ...decision.scope }),
        actor: Object.freeze({ ...snapshot.actor, subjectId: decision.scope.subjectId }),
      };
      await tx`select pg_advisory_xact_lock(hashtextextended(jsonb_build_array(${trusted.scope.organizationId}::text,${trusted.scope.subjectId}::text)::text,0))`;
      return work(tx, trusted, new Date(now).toISOString());
    });
  }
  async function consentLineage(tx: Tx, ctx: Context, id: string): Promise<ModelConsentGrant[]> {
    const rows = await tx<ConsentRow[]>`
      SELECT grant_id, version, organization_id, subject_user_id, purpose, sources, mode,
        permitted_uses, disclosure_boundary, issued_at, temporal_mode, expires_at, revoked_at,
        retention_policy_id
      FROM public.ai_twin_consent_grants
      WHERE ${scoped(tx, ctx)} AND grant_id = ${id}::uuid
      ORDER BY version
    `;
    const lineage = rows.map(grantFromRow);
    validateConsentLineage(lineage, ctx.scope);
    return lineage;
  }
  async function loadGrants(tx: Tx, ctx: Context): Promise<ModelConsentGrant[]> {
    const rows = await tx<ConsentRow[]>`
      SELECT grant_id, version, organization_id, subject_user_id, purpose, sources, mode,
        permitted_uses, disclosure_boundary, issued_at, temporal_mode, expires_at, revoked_at,
        retention_policy_id
      FROM public.ai_twin_consent_grants
      WHERE ${scoped(tx, ctx)}
      ORDER BY grant_id, version
    `;
    const grants = rows.map(grantFromRow);
    validateConsentLineage(grants, ctx.scope);
    return grants;
  }
  async function blockedObservationIds(tx: Tx, ctx: Context): Promise<Set<string>> {
    const rows = await tx<{ target_digest: string }[]>`
      SELECT o.target_digest
      FROM public.ai_twin_rights_operations o
      JOIN LATERAL (
        SELECT e.state
        FROM public.ai_twin_rights_operation_events e
        WHERE e.organization_id = o.organization_id
          AND e.subject_user_id = o.subject_user_id
          AND e.operation_id = o.operation_id
        ORDER BY e.sequence DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE ${twinPersonalScopePostgresPredicate(tx, ctx.scope, {
        organizationColumn: "o.organization_id",
        subjectColumn: "o.subject_user_id",
      })}
        AND o.operation_type IN ('WITHDRAW_USE', 'DELETE', 'ERASE')
        AND latest.state IN (
          'USE_BLOCKED', 'LIVE_REMOVAL_IN_PROGRESS', 'LIVE_REMOVED',
          'RESIDUAL_COPIES_PENDING', 'CLOSED'
        )
    `;
    const blocked = new Set(rows.map((row) => row.target_digest));
    const observations = await tx<{ object_id: string }[]>`
      SELECT object_id FROM public.ai_twin_observations WHERE ${scoped(tx, ctx)}
    `;
    return new Set(
      observations
        .filter((row) => blocked.has(observationTargetDigest(row.object_id)))
        .map((row) => row.object_id),
    );
  }
  async function insertObjectVersion(
    tx: Tx,
    ctx: Context,
    kind: ObjectKind,
    id: string,
    version: number,
    createdAt: string,
  ) {
    await tx`
      INSERT INTO public.ai_twin_object_versions (
        organization_id, subject_user_id, object_kind, object_id, version, purpose,
        created_at, retention_policy_id
      ) VALUES (
        ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${kind}, ${id},
        ${version}, ${ctx.purpose}, ${createdAt}, ${TWIN_RETENTION_POLICY}
      )
    `;
  }
  async function insertEvidenceLink(
    tx: Tx,
    ctx: Context,
    source: VersionedModelReference,
    target: VersionedModelReference,
    relationship: "supports" | "contradicts" | "contextualizes",
    reason: string,
  ) {
    const [existing] = await tx<{ object_id: string }[]>`
      SELECT object_id
      FROM public.ai_twin_evidence_links
      WHERE ${scoped(tx, ctx)}
        AND source_kind = ${source.kind} AND source_id = ${source.id}
        AND source_version = ${source.version} AND target_kind = ${target.kind}
        AND target_id = ${target.id} AND target_version = ${target.version}
        AND relationship = ${relationship}
    `;
    if (existing) return;
    const id = randomUUID();
    await insertObjectVersion(tx, ctx, "evidence_link", id, 1, ctx.now);
    await tx`
      INSERT INTO public.ai_twin_evidence_links (
        organization_id, subject_user_id, object_kind, object_id, version, purpose,
        created_at, retention_policy_id, source_kind, source_id, source_version,
        target_kind, target_id, target_version, relationship, reason
      ) VALUES (
        ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, 'evidence_link',
        ${id}, 1, ${ctx.purpose}, ${ctx.now}, ${TWIN_RETENTION_POLICY}, ${source.kind},
        ${source.id}, ${source.version}, ${target.kind}, ${target.id}, ${target.version},
        ${relationship}, ${reason}
      )
    `;
  }
  function currentGrant(
    grants: readonly ModelConsentGrant[],
    reference: { id: string; version: number },
    ctx: Context,
    authorityNow: string,
    source: ModelObservation["source"],
  ): ModelConsentGrant | null {
    const grant = grants
      .filter((candidate) => candidate.id === reference.id)
      .sort((left, right) => right.version - left.version)[0];
    if (
      !grant ||
      grant.version !== reference.version ||
      !sameScope(grant.scope, ctx.scope) ||
      grant.purpose !== ctx.purpose ||
      grant.mode !== "private_modelling" ||
      !grant.permittedUses.includes("productive_private_modelling") ||
      grant.disclosureBoundary !== "private_only" ||
      !grant.sources.includes(source) ||
      grant.retentionPolicyId !== TWIN_RETENTION_POLICY ||
      grant.issuedAt > authorityNow ||
      grant.revokedAt !== null ||
      !(
        (grant.temporalMode === "UNTIL_REVOKED" && grant.expiresAt === null) ||
        (grant.temporalMode === "EXPIRES_AT" &&
          grant.expiresAt !== null &&
          authorityNow < grant.expiresAt)
      )
    ) {
      return null;
    }
    return grant;
  }
  async function load(tx: Tx, ctx: Context, authorityNow: string) {
    const grants = await loadGrants(tx, ctx);
    const blocked = await blockedObservationIds(tx, ctx);
    const observationRows = await tx<
      {
        object_id: string;
        grant_id: string;
        grant_version: number;
        source: ModelObservation["source"];
        event_time: Date;
        recorded_at: Date;
        context: string;
        observation_text: string;
        projection_risks: ModelObservation["projectionRisks"];
        purpose: string;
        retention_policy_id: string;
      }[]
    >`
      SELECT object_id, grant_id, grant_version, source, event_time, recorded_at, context,
        observation_text, projection_risks, purpose, retention_policy_id
      FROM public.ai_twin_observations
      WHERE ${scoped(tx, ctx)} AND purpose = ${ctx.purpose}
      ORDER BY recorded_at, object_id
    `;
    const observations = observationRows
      .map(
        (row): ModelObservation => ({
          id: row.object_id,
          scope: ctx.scope,
          grant: { id: row.grant_id, version: row.grant_version },
          source: row.source,
          eventTime: row.event_time.toISOString(),
          context: row.context,
          text: row.observation_text,
          projectionRisks: row.projection_risks,
          epistemicKind: "self_report",
          purpose: row.purpose,
          recordedAt: row.recorded_at.toISOString(),
          retentionPolicyId: row.retention_policy_id,
        }),
      )
      .filter((observation) => {
        if (blocked.has(observation.id)) return false;
        const grant = currentGrant(
          grants,
          observation.grant,
          ctx,
          authorityNow,
          observation.source,
        );
        if (!grant || grant.issuedAt > observation.recordedAt) return false;
        const kind = observation.source === "diary" ? "diary" : "dialogue";
        return planRetention(
          {
            scope: ctx.scope,
            id: observation.id,
            revision: 1,
            kind,
            createdAt: observation.recordedAt,
            evidenceEligible: true,
            erasureRequestedAt: null,
          },
          {
            scope: ctx.scope,
            recordId: observation.id,
            recordRevision: 1,
            purpose: kind === "diary" ? "private_archive" : "dialogue",
            approvedBy: "human",
            validFrom: grant.issuedAt,
            validUntil: grant.expiresAt,
            revokedAt: grant.revokedAt,
            basisReference: `${grant.id}:${grant.version}`,
          },
          ctx.now,
        ).purposeUseAllowed;
      });
    const claimRows = await tx<
      {
        object_id: string;
        version: number;
        statement: string;
        domain: string;
        context: string;
        uncertainty: string;
        status: HumanClaimVersion["status"];
        basis: HumanClaimVersion["basis"];
        recorded_at: Date;
        purpose: string;
        supersedes_revision: number | null;
        human_correction_id: string | null;
      }[]
    >`
      SELECT object_id, version, statement, domain, context, uncertainty, status, basis,
        recorded_at, purpose, supersedes_revision, human_correction_id
      FROM public.ai_twin_claim_revisions
      WHERE ${scoped(tx, ctx)} AND purpose = ${ctx.purpose}
      ORDER BY object_id, version
    `;
    const links = await tx<
      {
        source_kind: string;
        source_id: string;
        target_kind: string;
        target_id: string;
        target_version: number;
      }[]
    >`
      SELECT source_kind, source_id, target_kind, target_id, target_version
      FROM public.ai_twin_evidence_links
      WHERE ${scoped(tx, ctx)}
    `;
    const claims: HumanClaimVersion[] = claimRows.map((row) => ({
      claimId: row.object_id,
      revision: row.version,
      scope: ctx.scope,
      statement: row.statement,
      domain: row.domain,
      context: row.context,
      uncertainty: row.uncertainty,
      observationIds: links
        .filter(
          (link) =>
            link.source_kind === "observation" &&
            link.target_kind === "claim" &&
            link.target_id === row.object_id &&
            link.target_version === row.version,
        )
        .map((link) => link.source_id),
      purpose: row.purpose,
      supersedesRevision: row.supersedes_revision,
      status: row.status,
      basis: row.basis,
      recordedAt: row.recorded_at.toISOString(),
      humanCorrectionId: row.human_correction_id,
    }));
    const correctionRows = await tx<
      {
        object_id: string;
        claim_id: string;
        previous_revision: number;
        action: HumanCorrectionRecord["action"];
        reason: string;
        statement: string | null;
        context: string | null;
        actor_subject_user_id: string;
        purpose: string;
        recorded_at: Date;
      }[]
    >`
      SELECT object_id, claim_id, previous_revision, action, reason, statement, context,
        actor_subject_user_id, purpose, recorded_at
      FROM public.ai_twin_human_corrections
      WHERE ${scoped(tx, ctx)} AND purpose = ${ctx.purpose}
      ORDER BY recorded_at, object_id
    `;
    const corrections: HumanCorrectionRecord[] = correctionRows.map((row) => ({
      id: row.object_id,
      claimId: row.claim_id,
      previousRevision: row.previous_revision,
      action: row.action,
      reason: row.reason,
      statement: row.statement,
      context: row.context,
      scope: ctx.scope,
      purpose: row.purpose,
      actorSubjectId: row.actor_subject_user_id,
      recordedAt: row.recorded_at.toISOString(),
    }));
    const receipts = await tx<{ request_id: string; fingerprint: string }[]>`
      SELECT request_id, fingerprint
      FROM public.ai_twin_command_receipts
      WHERE ${scoped(tx, ctx)} AND purpose = ${ctx.purpose}
    `;
    const times = [
      ...observations.map((row) => row.recordedAt),
      ...claims.map((row) => row.recordedAt),
      ...corrections.map((row) => row.recordedAt),
    ];
    const state: ModelLedger = {
      scope: ctx.scope,
      lastRecordedAt: times.length ? [...times].sort().at(-1)! : null,
      observations,
      claims,
      corrections,
      receipts: receipts.map((row) => ({
        requestId: row.request_id,
        fingerprint: row.fingerprint,
      })),
    };
    return { state, ctx: { ...ctx, grants } };
  }

  return {
    async issueConsent(ctx: Context, input: unknown): Promise<ModelConsentGrant> {
      ctx = snapshotContext(ctx, true);
      const intent = parseConsentGrantIssuanceIntent(input);
      requireValue(
        intent.purpose === ctx.purpose && intent.retentionPolicyId === TWIN_RETENTION_POLICY,
        "CONSENT_BINDING_UNAVAILABLE",
      );
      return withAccess(ctx, true, async (tx, ctx, authorityNow) => {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(["consent-issuance-v1", canonicalJson(intent)]))
          .digest("hex");
        const [prior] = await tx<
          { intent_fingerprint: string; grant_id: string; grant_version: number }[]
        >`
          SELECT intent_fingerprint, grant_id, grant_version
          FROM public.ai_twin_consent_issuance_receipts
          WHERE ${scoped(tx, ctx)}
            AND purpose = ${ctx.purpose}
            AND request_id = ${intent.requestId}::uuid
        `;
        if (prior) {
          requireValue(prior.intent_fingerprint === fingerprint, "CONSENT_REPLAY_CONFLICT");
          const stored = (await consentLineage(tx, ctx, prior.grant_id)).find(
            (grant) => grant.version === prior.grant_version,
          );
          requireValue(stored, "CONSENT_REPLAY_CORRUPT");
          return stored;
        }
        const expiresAt = intent.temporal.mode === "EXPIRES_AT" ? intent.temporal.expiresAt : null;
        requireValue(expiresAt === null || authorityNow < expiresAt, "CONSENT_EXPIRY_REQUIRED");
        const value: ModelConsentGrant = {
          id: randomUUID(),
          version: 1,
          scope: ctx.scope,
          purpose: intent.purpose,
          sources: intent.sources,
          mode: "private_modelling",
          permittedUses: intent.permittedUses,
          disclosureBoundary: intent.disclosureBoundary,
          issuedAt: authorityNow,
          temporalMode: intent.temporal.mode,
          expiresAt,
          revokedAt: null,
          retentionPolicyId: intent.retentionPolicyId,
        };
        await tx`
          INSERT INTO public.ai_twin_consent_grants (
            organization_id, subject_user_id, grant_id, version, purpose, sources, mode,
            permitted_uses, disclosure_boundary, issued_at, temporal_mode, expires_at,
            revoked_at, retention_policy_id
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${value.id}::uuid,
            1, ${value.purpose}, ${tx.json(value.sources)}, ${value.mode},
            ${tx.json(value.permittedUses)}, ${value.disclosureBoundary}, ${value.issuedAt},
            ${value.temporalMode}, ${value.expiresAt}, NULL, ${value.retentionPolicyId}
          )
        `;
        await tx`
          INSERT INTO public.ai_twin_consent_issuance_receipts (
            organization_id, subject_user_id, purpose, request_id, intent_fingerprint,
            grant_id, grant_version, created_at
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${ctx.purpose},
            ${intent.requestId}::uuid, ${fingerprint}, ${value.id}::uuid, 1, ${authorityNow}
          )
        `;
        return freezeJson(structuredClone(value));
      });
    },
    async revokeConsent(ctx: Context, input: unknown): Promise<void> {
      ctx = snapshotContext(ctx, true);
      assertModelJsonData(input);
      requireValue(
        input !== null &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input).length === 2 &&
          Object.hasOwn(input, "id") &&
          Object.hasOwn(input, "version"),
        "INVALID_CONSENT_REFERENCE",
      );
      const ref = input as { id: unknown; version: unknown };
      requireValue(
        typeof ref.id === "string" &&
          uuid.test(ref.id) &&
          Number.isSafeInteger(ref.version) &&
          (ref.version as number) > 0,
        "INVALID_CONSENT_REFERENCE",
      );
      await withAccess(ctx, true, async (tx, ctx, authorityNow) => {
        const current = (await consentLineage(tx, ctx, ref.id as string)).at(-1);
        requireValue(current, "CONSENT_UNAVAILABLE");
        requireValue(
          sameScope(current.scope, ctx.scope) &&
            current.purpose === ctx.purpose &&
            current.retentionPolicyId === TWIN_RETENTION_POLICY &&
            current.issuedAt <= authorityNow,
          "CONSENT_UNAVAILABLE",
        );
        if (current.version === (ref.version as number) + 1 && current.revokedAt !== null) return;
        requireValue(
          current.version === ref.version && current.revokedAt === null,
          "CONSENT_UNAVAILABLE",
        );
        const revoked = parseModelConsentGrant({
          ...current,
          version: current.version + 1,
          revokedAt: authorityNow,
        });
        await tx`
          INSERT INTO public.ai_twin_consent_grants (
            organization_id, subject_user_id, grant_id, version, purpose, sources, mode,
            permitted_uses, disclosure_boundary, issued_at, temporal_mode, expires_at,
            revoked_at, retention_policy_id
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${revoked.id}::uuid,
            ${revoked.version}, ${revoked.purpose}, ${tx.json(revoked.sources)}, ${revoked.mode},
            ${tx.json(revoked.permittedUses)}, ${revoked.disclosureBoundary}, ${revoked.issuedAt},
            ${revoked.temporalMode}, ${revoked.expiresAt}, ${revoked.revokedAt},
            ${revoked.retentionPolicyId}
          )
        `;
      });
    },
    async apply(ctx: Context, command: ModelCommand): Promise<void> {
      ctx = snapshotContext(ctx, false);
      command = snapshotData(command);
      requireValue(sameScope(command.scope, ctx.scope), "SCOPE_MISMATCH");
      if (command.kind === "observe") {
        requireValue(
          command.source === "dialogue" || command.source === "diary",
          "SOURCE_NOT_ADMITTED",
        );
      }
      await withAccess(ctx, false, async (tx, ctx, authorityNow) => {
        const loaded = await load(tx, ctx, authorityNow);
        if (command.kind === "observe") {
          const grant = currentGrant(
            loaded.ctx.grants,
            command.grant,
            ctx,
            authorityNow,
            command.source,
          );
          requireValue(grant?.retentionPolicyId === TWIN_RETENTION_POLICY, "POLICY_UNAVAILABLE");
        }
        const next = applyModelCommand(loaded.state, command, loaded.ctx);
        if (next === loaded.state) return;
        for (const observation of next.observations) {
          if (loaded.state.observations.some((row) => row.id === observation.id)) continue;
          await insertObjectVersion(
            tx,
            ctx,
            "observation",
            observation.id,
            1,
            observation.recordedAt,
          );
          await tx`
            INSERT INTO public.ai_twin_observations (
              organization_id, subject_user_id, object_kind, object_id, version, grant_id,
              grant_version, source, event_time, recorded_at, context, observation_text,
              projection_risks, epistemic_kind, purpose, retention_policy_id
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, 'observation',
              ${observation.id}, 1, ${observation.grant.id}::uuid, ${observation.grant.version},
              ${observation.source}, ${observation.eventTime}, ${observation.recordedAt},
              ${observation.context}, ${observation.text}, ${tx.json(observation.projectionRisks)},
              'self_report', ${observation.purpose}, ${observation.retentionPolicyId}
            )
          `;
        }
        for (const claim of next.claims) {
          if (
            loaded.state.claims.some(
              (row) => row.claimId === claim.claimId && row.revision === claim.revision,
            )
          ) {
            continue;
          }
          await insertObjectVersion(
            tx,
            ctx,
            "claim",
            claim.claimId,
            claim.revision,
            claim.recordedAt,
          );
          await tx`
            INSERT INTO public.ai_twin_claim_revisions (
              organization_id, subject_user_id, object_kind, object_id, version, statement,
              domain, context, uncertainty, status, basis, recorded_at, purpose,
              supersedes_revision, human_correction_id
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, 'claim',
              ${claim.claimId}, ${claim.revision}, ${claim.statement}, ${claim.domain},
              ${claim.context}, ${claim.uncertainty}, ${claim.status}, ${claim.basis},
              ${claim.recordedAt}, ${claim.purpose}, ${claim.supersedesRevision},
              ${claim.humanCorrectionId}
            )
          `;
          for (const observationId of claim.observationIds) {
            await insertEvidenceLink(
              tx,
              ctx,
              { ...ctx.scope, kind: "observation", id: observationId, version: 1 },
              { ...ctx.scope, kind: "claim", id: claim.claimId, version: claim.revision },
              "supports",
              "claim-observation-basis",
            );
          }
        }
        for (const correction of next.corrections) {
          if (loaded.state.corrections.some((row) => row.id === correction.id)) continue;
          await insertObjectVersion(tx, ctx, "correction", correction.id, 1, correction.recordedAt);
          await tx`
            INSERT INTO public.ai_twin_human_corrections (
              organization_id, subject_user_id, object_kind, object_id, version, claim_id,
              previous_revision, action, reason, statement, context, actor_subject_user_id,
              purpose, recorded_at
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, 'correction',
              ${correction.id}, 1, ${correction.claimId}, ${correction.previousRevision},
              ${correction.action}, ${correction.reason}, ${correction.statement},
              ${correction.context}, ${correction.actorSubjectId}::uuid, ${correction.purpose},
              ${correction.recordedAt}
            )
          `;
        }
        const receipt = next.receipts.at(-1)!;
        const targetKind =
          command.kind === "observe"
            ? "observation"
            : command.kind === "propose"
              ? "claim"
              : "correction";
        const targetId = command.kind === "propose" ? command.claimId : command.id;
        const targetVersion =
          command.kind === "propose"
            ? (next.claims.filter((claim) => claim.claimId === command.claimId).at(-1)?.revision ??
              1)
            : 1;
        await tx`
          INSERT INTO public.ai_twin_command_receipts (
            organization_id, subject_user_id, purpose, request_id, fingerprint, target_kind,
            target_id, target_version, created_at, retention_policy_id
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${ctx.purpose},
            ${receipt.requestId}, ${receipt.fingerprint}, ${targetKind}, ${targetId},
            ${targetVersion}, ${ctx.now}, ${TWIN_RETENTION_POLICY}
          )
        `;
      });
    },
    async current(ctx: Context) {
      ctx = snapshotContext(ctx, false);
      return withAccess(ctx, false, async (tx, ctx, authorityNow) => {
        const loaded = await load(tx, ctx, authorityNow);
        return projectCurrentModel(loaded.state, loaded.ctx);
      });
    },
    async history(ctx: Context): Promise<ModelLedger> {
      ctx = snapshotContext(ctx, false);
      return withAccess(ctx, false, async (tx, ctx, authorityNow) => {
        const loaded = await load(tx, ctx, authorityNow);
        const usable = new Set(loaded.state.observations.map((observation) => observation.id));
        const claims = loaded.state.claims.filter((claim) =>
          claim.observationIds.every((id) => usable.has(id)),
        );
        const claimIds = new Set(claims.map((claim) => claim.claimId));
        return {
          ...loaded.state,
          claims,
          corrections: loaded.state.corrections.filter((correction) =>
            claimIds.has(correction.claimId),
          ),
          receipts: [],
        };
      });
    },
    async recordEndorsement(
      ctx: Context,
      endorsement: InitialHumanModelEndorsement,
    ): Promise<void> {
      ctx = snapshotContext(ctx, true);
      endorsement = snapshotData(endorsement);
      requireValue(endorsement.confirmedBy.subjectId === ctx.scope.subjectId, "HUMAN_REQUIRED");
      await withAccess(ctx, true, async (tx, ctx) => {
        const [claim] = await tx<{ object_id: string }[]>`
          SELECT object_id FROM public.ai_twin_claim_revisions
          WHERE ${scoped(tx, ctx)}
            AND object_id = ${endorsement.target.recordId}
            AND version = ${endorsement.target.recordRevision}
        `;
        requireValue(claim, "CLAIM_UNAVAILABLE");
        await tx`
          INSERT INTO public.ai_twin_model_endorsements (
            organization_id, subject_user_id, endorsement_id, target_object_kind,
            target_object_id, target_version, basis, confirmed_at, confirmed_by_subject_user_id
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid,
            ${endorsement.endorsementId}, 'claim', ${endorsement.target.recordId},
            ${endorsement.target.recordRevision}, ${endorsement.basis}, ${endorsement.confirmedAt},
            ${endorsement.confirmedBy.subjectId}::uuid
          )
        `;
      });
    },
    async recordNecessityReview(ctx: Context, review: NecessityReviewConfirmation): Promise<void> {
      ctx = snapshotContext(ctx, true);
      review = snapshotData(review);
      requireValue(review.policyVersion === TWIN_NECESSITY_REVIEW_POLICY, "POLICY_UNAVAILABLE");
      requireValue(review.confirmedBy.subjectId === ctx.scope.subjectId, "HUMAN_REQUIRED");
      await withAccess(ctx, true, async (tx, ctx) => {
        const [claim] = await tx<{ object_id: string }[]>`
          SELECT object_id FROM public.ai_twin_claim_revisions
          WHERE ${scoped(tx, ctx)}
            AND object_id = ${review.target.recordId}
            AND version = ${review.target.recordRevision}
        `;
        requireValue(claim, "CLAIM_UNAVAILABLE");
        await tx`
          INSERT INTO public.ai_twin_necessity_reviews (
            organization_id, subject_user_id, review_id, target_object_kind, target_object_id,
            target_version, policy_version, basis, decision, prepared_at, confirmed_at,
            confirmed_by_subject_user_id
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${review.reviewId},
            'claim', ${review.target.recordId}, ${review.target.recordRevision},
            ${review.policyVersion}, ${review.basis}, ${review.decision}, ${review.preparedAt},
            ${review.confirmedAt}, ${review.confirmedBy.subjectId}::uuid
          )
        `;
      });
    },
    async admitCompletionEvidence(
      ctx: Context,
      input: {
        digest: string;
        evidenceClass: string;
        producerReference: string;
        admittedByReference: string;
      },
    ): Promise<void> {
      ctx = snapshotContext(ctx, true);
      input = snapshotData(input);
      await withAccess(ctx, true, async (tx, ctx, authorityNow) => {
        await tx`
          INSERT INTO public.ai_twin_rights_completion_evidence (
            organization_id, subject_user_id, evidence_digest, evidence_class,
            producer_reference, admitted_at, admitted_by_reference
          ) VALUES (
            ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${input.digest},
            ${input.evidenceClass}, ${input.producerReference}, ${authorityNow},
            ${input.admittedByReference}
          )
        `;
      });
    },
    async recordRightsOperation(
      ctx: Context,
      input: unknown,
      validation: Omit<
        RightsOperationValidationContext,
        "previous" | "admittedCompletionEvidenceDigests"
      >,
    ): Promise<void> {
      ctx = snapshotContext(ctx, true);
      input = snapshotData(input);
      await withAccess(ctx, true, async (tx, ctx) => {
        const history = input as RightsOperationHistory;
        const previous = await loadRightsHistory(tx, ctx, scoped, history.operationId);
        const admitted = await tx<{ evidence_digest: string }[]>`
          SELECT evidence_digest FROM public.ai_twin_rights_completion_evidence
          WHERE ${scoped(tx, ctx)}
        `;
        validateRightsOperationHistory(history, {
          ...validation,
          scope: ctx.scope,
          previous,
          admittedCompletionEvidenceDigests: admitted.map((row) => row.evidence_digest),
        });
        if (previous === null) {
          await tx`
            INSERT INTO public.ai_twin_rights_operations (
              organization_id, subject_user_id, operation_id, operation_type, target_scope_kind,
              target_digest, policy_version, requested_at, requested_by_subject_user_id,
              requested_by_actor_reference
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${history.operationId},
              ${history.type}, ${history.target.scopeKind}, ${history.target.digest},
              ${history.policyVersion}, ${history.requestedAt},
              ${history.requestedBy.subjectId}::uuid, ${history.requestedBy.actorReference}
            )
          `;
        }
        for (const event of history.history) {
          if (previous?.history.some((row) => row.sequence === event.sequence)) continue;
          await tx`
            INSERT INTO public.ai_twin_rights_operation_events (
              organization_id, subject_user_id, operation_id, sequence, state, event_time,
              completion_evidence_digest, accepted_by_subject_user_id, accepted_by_actor_reference
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${history.operationId},
              ${event.sequence}, ${event.state}, ${event.at}, ${event.completionEvidenceDigest},
              ${event.state === "ACCEPTED" ? (history.acceptedBy?.subjectId ?? null) : null},
              ${event.state === "ACCEPTED" ? (history.acceptedBy?.actorReference ?? null) : null}
            )
          `;
        }
        for (const attempt of history.attempts) {
          if (previous?.attempts.some((row) => row.attemptId === attempt.attemptId)) continue;
          await tx`
            INSERT INTO public.ai_twin_rights_operation_attempts (
              organization_id, subject_user_id, operation_id, sequence, attempt_id, started_at,
              completed_at, outcome, outcome_code, completion_evidence_digest
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${history.operationId},
              ${attempt.sequence}, ${attempt.attemptId}, ${attempt.startedAt}, ${attempt.completedAt},
              ${attempt.outcome}, ${attempt.outcomeCode}, ${attempt.completionEvidenceDigest}
            )
          `;
        }
        if (history.effect && previous?.effect === null) {
          await tx`
            INSERT INTO public.ai_twin_rights_operation_effects (
              organization_id, subject_user_id, operation_id, effect_kind, committed_at,
              completion_evidence_digest
            ) VALUES (
              ${ctx.scope.organizationId}::uuid, ${ctx.scope.subjectId}::uuid, ${history.operationId},
              ${history.effect.kind}, ${history.effect.committedAt},
              ${history.effect.completionEvidenceDigest}
            )
          `;
        }
      });
    },
    async executeQualifiedRemoval(
      ctx: Context,
      operationId: string,
      objectKind: ObjectKind,
      objectId: string,
    ): Promise<void> {
      ctx = snapshotContext(ctx, true);
      await withAccess(ctx, true, async (tx, ctx) => {
        const history = await loadRightsHistory(tx, ctx, scoped, operationId);
        requireValue(history, "RIGHTS_UNAVAILABLE");
        const state = history.history.at(-1)?.state;
        requireValue(
          (history.type === "DELETE" || history.type === "ERASE") &&
            (state === "USE_BLOCKED" || state === "LIVE_REMOVAL_IN_PROGRESS"),
          "RIGHTS_UNAVAILABLE",
        );
        await tx`
          DELETE FROM public.ai_twin_command_receipts
          WHERE ${scoped(tx, ctx)} AND target_id = ${objectId}
        `;
        await tx`
          DELETE FROM public.ai_twin_necessity_reviews
          WHERE ${scoped(tx, ctx)} AND target_object_id = ${objectId}
            AND target_object_kind = ${objectKind}
        `;
        await tx`
          DELETE FROM public.ai_twin_model_endorsements
          WHERE ${scoped(tx, ctx)} AND target_object_id = ${objectId}
            AND target_object_kind = ${objectKind}
        `;
        await tx`
          DELETE FROM public.ai_twin_evidence_links
          WHERE ${scoped(tx, ctx)}
            AND (source_id = ${objectId} OR target_id = ${objectId} OR object_id IN (
              SELECT object_id FROM public.ai_twin_evidence_links
              WHERE ${scoped(tx, ctx)} AND (source_id = ${objectId} OR target_id = ${objectId})
            ))
        `;
        for (const table of [
          "ai_twin_observations",
          "ai_twin_human_corrections",
          "ai_twin_claim_revisions",
          "ai_twin_working_hypotheses",
          "ai_twin_dynamic_relations",
          "ai_twin_knowledge_needs",
        ] as const) {
          await tx.unsafe(
            `DELETE FROM public.${table} WHERE organization_id = $1::uuid AND subject_user_id = $2::uuid AND object_id = $3`,
            [ctx.scope.organizationId, ctx.scope.subjectId, objectId],
          );
        }
        await tx`
          DELETE FROM public.ai_twin_object_versions
          WHERE ${scoped(tx, ctx)} AND object_id = ${objectId}
        `;
      });
    },
    async modelReviewState(ctx: Context, recordId: string, recordRevision: number) {
      ctx = snapshotContext(ctx, false);
      return withAccess(ctx, false, async (tx, ctx) => {
        const [endorsement] = await tx<
          {
            endorsement_id: string;
            target_object_id: string;
            target_version: number;
            confirmed_at: Date;
            confirmed_by_subject_user_id: string;
          }[]
        >`
          SELECT endorsement_id, target_object_id, target_version, confirmed_at,
            confirmed_by_subject_user_id
          FROM public.ai_twin_model_endorsements
          WHERE ${scoped(tx, ctx)}
            AND target_object_id = ${recordId}
            AND target_version = ${recordRevision}
        `;
        if (!endorsement) return null;
        const [review] = await tx<
          {
            review_id: string;
            target_object_id: string;
            target_version: number;
            policy_version: string;
            prepared_at: Date;
            confirmed_at: Date;
            confirmed_by_subject_user_id: string;
          }[]
        >`
          SELECT review_id, target_object_id, target_version, policy_version, prepared_at,
            confirmed_at, confirmed_by_subject_user_id
          FROM public.ai_twin_necessity_reviews
          WHERE ${scoped(tx, ctx)}
            AND target_object_id = ${recordId}
            AND target_version <= ${recordRevision}
          ORDER BY confirmed_at DESC
          LIMIT 1
        `;
        return {
          initialEndorsement: {
            endorsementId: endorsement.endorsement_id,
            target: {
              organizationId: ctx.scope.organizationId,
              subjectId: ctx.scope.subjectId,
              recordId: endorsement.target_object_id,
              recordRevision: endorsement.target_version,
            },
            basis: "initial_model_endorsement" as const,
            confirmedAt: endorsement.confirmed_at.toISOString(),
            confirmedBy: {
              kind: "human" as const,
              organizationId: ctx.scope.organizationId,
              subjectId: endorsement.confirmed_by_subject_user_id,
            },
          },
          latestReview: review
            ? {
                reviewId: review.review_id,
                policyVersion: review.policy_version as typeof TWIN_NECESSITY_REVIEW_POLICY,
                target: {
                  organizationId: ctx.scope.organizationId,
                  subjectId: ctx.scope.subjectId,
                  recordId: review.target_object_id,
                  recordRevision: review.target_version,
                },
                basis: "storage_necessity" as const,
                decision: "retain" as const,
                preparedAt: review.prepared_at.toISOString(),
                confirmedAt: review.confirmed_at.toISOString(),
                confirmedBy: {
                  kind: "human" as const,
                  organizationId: ctx.scope.organizationId,
                  subjectId: review.confirmed_by_subject_user_id,
                },
              }
            : null,
        };
      });
    },
    observationTargetDigest,
  };
}

async function loadRightsHistory(
  tx: Tx,
  ctx: Context,
  scoped: (tx: Tx, ctx: Context) => postgres.Fragment,
  operationId: string,
): Promise<RightsOperationHistory | null> {
  const [header] = await tx<
    {
      operation_id: string;
      operation_type: RightsOperationType;
      target_scope_kind: RightsOperationHistory["target"]["scopeKind"];
      target_digest: string;
      policy_version: string;
      requested_at: Date;
      requested_by_subject_user_id: string;
      requested_by_actor_reference: string;
    }[]
  >`
    SELECT operation_id, operation_type, target_scope_kind, target_digest, policy_version,
      requested_at, requested_by_subject_user_id, requested_by_actor_reference
    FROM public.ai_twin_rights_operations
    WHERE ${scoped(tx, ctx)} AND operation_id = ${operationId}
  `;
  if (!header) return null;
  const events = await tx<
    {
      sequence: number;
      state: RightsOperationHistory["history"][number]["state"];
      event_time: Date;
      completion_evidence_digest: string | null;
      accepted_by_subject_user_id: string | null;
      accepted_by_actor_reference: string | null;
    }[]
  >`
    SELECT sequence, state, event_time, completion_evidence_digest,
      accepted_by_subject_user_id, accepted_by_actor_reference
    FROM public.ai_twin_rights_operation_events
    WHERE ${scoped(tx, ctx)} AND operation_id = ${operationId}
    ORDER BY sequence
  `;
  const attempts = await tx<
    {
      attempt_id: string;
      sequence: number;
      started_at: Date;
      completed_at: Date;
      outcome: "FAILED" | "SUCCEEDED";
      outcome_code: string;
      completion_evidence_digest: string | null;
    }[]
  >`
    SELECT attempt_id, sequence, started_at, completed_at, outcome, outcome_code,
      completion_evidence_digest
    FROM public.ai_twin_rights_operation_attempts
    WHERE ${scoped(tx, ctx)} AND operation_id = ${operationId}
    ORDER BY sequence
  `;
  const [effect] = await tx<
    {
      effect_kind: NonNullable<RightsOperationHistory["effect"]>["kind"];
      committed_at: Date;
      completion_evidence_digest: string;
    }[]
  >`
    SELECT effect_kind, committed_at, completion_evidence_digest
    FROM public.ai_twin_rights_operation_effects
    WHERE ${scoped(tx, ctx)} AND operation_id = ${operationId}
  `;
  const accepted = events.find((event) => event.state === "ACCEPTED");
  return {
    operationId: header.operation_id,
    policyVersion: header.policy_version as typeof TWIN_RIGHTS_OPERATION_POLICY,
    scope: ctx.scope,
    type: header.operation_type,
    target: { scopeKind: header.target_scope_kind, digest: header.target_digest },
    requestedAt: header.requested_at.toISOString(),
    requestedBy: {
      actorClass: "human",
      subjectId: header.requested_by_subject_user_id,
      actorReference: header.requested_by_actor_reference,
    },
    acceptedBy:
      accepted && accepted.accepted_by_subject_user_id && accepted.accepted_by_actor_reference
        ? {
            actorClass: "human",
            subjectId: accepted.accepted_by_subject_user_id,
            actorReference: accepted.accepted_by_actor_reference,
          }
        : null,
    history: events.map((event) => ({
      sequence: event.sequence,
      state: event.state,
      at: event.event_time.toISOString(),
      completionEvidenceDigest: event.completion_evidence_digest,
    })),
    attempts: attempts.map((attempt) => ({
      attemptId: attempt.attempt_id,
      sequence: attempt.sequence,
      startedAt: attempt.started_at.toISOString(),
      completedAt: attempt.completed_at.toISOString(),
      outcome: attempt.outcome,
      outcomeCode: attempt.outcome_code,
      completionEvidenceDigest: attempt.completion_evidence_digest,
    })),
    effect: effect
      ? {
          kind: effect.effect_kind,
          committedAt: effect.committed_at.toISOString(),
          completionEvidenceDigest: effect.completion_evidence_digest,
        }
      : null,
  };
}
