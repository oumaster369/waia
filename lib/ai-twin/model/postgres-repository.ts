import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import type {
  HumanClaimVersion,
  HumanCorrectionRecord,
  ModelCommand,
  ModelConsentGrant,
  ModelContext,
  ModelLedger,
  ModelObservation,
} from "./contracts";
import { applyModelCommand, createModelLedger, projectCurrentModel } from "./ledger";
import {
  planRetention,
  TWIN_RETENTION_POLICY,
  composePrivateExperience,
  type ExperienceDraft,
  type RetentionRecord,
  type RetentionAuthorization,
} from "./lifecycle";
import {
  assertModelJsonData,
  modelReferenceKey,
  validateWorkingHypothesis,
  validateDynamicRelation,
  validateKnowledgeNeed,
  type DynamicRelation,
  type KnowledgeNeed,
  type WorkingHypothesis,
  type VersionedModelReference,
} from "./persistence-contracts";

type Context = Omit<ModelContext, "grants">;
type Tx = postgres.TransactionSql;
type PrivateSource = {
  scope: Context["scope"];
  id: string;
  revision: number;
  recordedAt: string;
  text: string;
  origin: "human_declaration";
};
type PrivateExperience = ReturnType<typeof composePrivateExperience>;
type GroundedKind = "relation" | "knowledge_need";
type GroundedCandidate = DynamicRelation | KnowledgeNeed;
type ArchiveAuthority = { record: RetentionRecord; authorization: RetentionAuthorization };
type ObjectRow = {
  kind:
    | "observation"
    | "claim"
    | "correction"
    | "hypothesis"
    | "experience"
    | "private_source"
    | GroundedKind;
  id: string;
  version: number;
  payload:
    | ModelObservation
    | HumanClaimVersion
    | HumanCorrectionRecord
    | WorkingHypothesis
    | GroundedCandidate
    | PrivateSource
    | PrivateExperience;
  recorded_at: Date;
};
type RightsRow = {
  source_id: string;
  source_kind: "observation" | "private_source" | "experience";
  purpose: string;
  request_id: string;
  operation: "withdraw_modelling" | "delete_source";
  state: "restricted" | "live_removed";
  requested_at: Date;
};
function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) throw new Error(code);
}
function sameScope(a: Context["scope"], b: Context["scope"]): boolean {
  return a.organizationId === b.organizationId && a.subjectId === b.subjectId;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  return value;
}
function context(ctx: Context, humanOnly = false): void {
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

/** Disconnected fixture repository, not a registered schema or runtime adapter.
 * Explicit dedicated SQL handle only; no ambient URLs, singleton or external I/O.
 * Authenticated actor/scope MUST come from a future trusted server boundary, never
 * request/LLM fields. Fixtures seed authoritative consent; no consent-creation API.
 * Rights fences here live only for the disposable fixture, not indefinitely in production.
 */
export function createIsolatedTwinRepository(sql: postgres.Sql) {
  async function lock(tx: Tx, ctx: Context) {
    // One consistent lock order for scope -> records; unrelated subjects remain separate.
    await tx`select pg_advisory_xact_lock(hashtextextended(jsonb_build_array(${ctx.scope.organizationId}::text,${ctx.scope.subjectId}::text)::text,0))`;
  }
  async function rights(tx: Tx, ctx: Context): Promise<RightsRow[]> {
    return tx<
      RightsRow[]
    >`select source_id, source_kind, purpose, request_id, operation, state, requested_at from twin_model_fixture.rights_request where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and (purpose=${ctx.purpose} or operation='delete_source')`;
  }
  async function load(tx: Tx, ctx: Context) {
    const grants = (
      await tx<
        { payload: ModelConsentGrant }[]
      >`select payload from twin_model_fixture.consent where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId}`
    ).map((row) => row.payload);
    const rows = await tx<
      ObjectRow[]
    >`select kind,id,version,payload,recorded_at from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and purpose=${ctx.purpose} order by version,recorded_at,id`;
    const restrictions = await rights(tx, ctx);
    const denied = new Set(
      restrictions.filter((r) => r.source_kind === "observation").map((r) => r.source_id),
    );
    const observations = rows
      .filter((row) => row.kind === "observation")
      .map((row) => row.payload as ModelObservation)
      .filter((observation) => {
        if (denied.has(observation.id) || observation.source !== "dialogue") return false;
        // Current, exact grant is resolved inside this transaction, not from the caller.
        const candidates = grants
          .filter((g) => g.id === observation.grant.id)
          .sort((a, b) => b.version - a.version);
        const grant = candidates[0];
        if (
          !grant ||
          grant.version !== observation.grant.version ||
          !sameScope(grant.scope, ctx.scope) ||
          grant.purpose !== ctx.purpose ||
          grant.mode !== "private_modelling" ||
          !grant.sources.includes("dialogue") ||
          grant.retentionPolicyId !== TWIN_RETENTION_POLICY ||
          grant.issuedAt > observation.recordedAt
        )
          return false;
        return planRetention(
          {
            scope: ctx.scope,
            id: observation.id,
            revision: 1,
            kind: "dialogue",
            createdAt: observation.recordedAt,
            evidenceEligible: true,
            erasureRequestedAt: null,
          },
          {
            scope: ctx.scope,
            recordId: observation.id,
            recordRevision: 1,
            purpose: "dialogue",
            approvedBy: "human",
            validFrom: grant.issuedAt,
            validUntil: grant.expiresAt,
            revokedAt: grant.revokedAt,
            basisReference: `${grant.id}:${grant.version}`,
          },
          ctx.now,
        ).purposeUseAllowed;
      });
    const times = [
      ...rows.map((r) => r.recorded_at.toISOString()),
      ...restrictions.map((r) => r.requested_at.toISOString()),
    ];
    const state: ModelLedger = {
      scope: ctx.scope,
      lastRecordedAt: times.length ? times.sort().at(-1)! : null,
      observations,
      claims: rows.filter((r) => r.kind === "claim").map((r) => r.payload as HumanClaimVersion),
      corrections: rows
        .filter((r) => r.kind === "correction")
        .map((r) => r.payload as HumanCorrectionRecord),
      receipts: (
        await tx<
          { request_id: string; fingerprint: string }[]
        >`select request_id,fingerprint from twin_model_fixture.receipt where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and purpose=${ctx.purpose}`
      ).map((r) => ({ requestId: r.request_id, fingerprint: r.fingerprint })),
    };
    return { state, ctx: { ...ctx, grants }, restrictions, rows };
  }
  async function insert(
    tx: Tx,
    ctx: Context,
    kind: ObjectRow["kind"],
    id: string,
    version: number,
    payload: ObjectRow["payload"],
  ) {
    await tx`insert into twin_model_fixture.object(organization_id,subject_id,purpose,kind,id,version,recorded_at,payload) values (${ctx.scope.organizationId},${ctx.scope.subjectId},${ctx.purpose},${kind},${id},${version},${ctx.now},${tx.json(payload)})`;
  }
  async function link(
    tx: Tx,
    ctx: Context,
    sourceKind: string,
    sourceId: string,
    sourceVersion: number,
    targetKind: string,
    targetId: string,
    targetVersion: number,
    relationship: "supports" | "contradicts" | "contextualizes" = "supports",
  ) {
    await tx`insert into twin_model_fixture.link values (${ctx.scope.organizationId},${ctx.scope.subjectId},${sourceKind},${sourceId},${sourceVersion},${targetKind},${targetId},${targetVersion},${relationship}) on conflict do nothing`;
  }
  function eligibleReferences(loaded: Awaited<ReturnType<typeof load>>): VersionedModelReference[] {
    return [
      ...loaded.state.observations.map(
        (o): VersionedModelReference => ({ ...o.scope, kind: "observation", id: o.id, version: 1 }),
      ),
      ...projectCurrentModel(loaded.state, loaded.ctx).map(
        (c): VersionedModelReference => ({
          ...c.scope,
          kind: "claim",
          id: c.claimId,
          version: c.revision,
        }),
      ),
    ];
  }
  function hypothesisPolicy(hypothesis: WorkingHypothesis, ctx: Context): boolean {
    return planRetention(
      {
        scope: ctx.scope,
        id: hypothesis.ref.id,
        revision: hypothesis.ref.version,
        kind: "hypothesis",
        createdAt: hypothesis.createdAt,
        evidenceEligible: true,
        erasureRequestedAt: null,
      },
      {
        scope: ctx.scope,
        recordId: hypothesis.ref.id,
        recordRevision: hypothesis.ref.version,
        purpose: "modelling",
        approvedBy: "reviewed_policy",
        validFrom: hypothesis.createdAt,
        validUntil: null,
        revokedAt: null,
        basisReference: "current-purpose-bound-source-grants",
      },
      ctx.now,
    ).purposeUseAllowed;
  }
  function groundedValue(
    kind: GroundedKind,
    input: unknown,
    loaded: Awaited<ReturnType<typeof load>>,
  ): GroundedCandidate {
    requireValue(kind === "relation" || kind === "knowledge_need");
    const validation = {
      scope: loaded.ctx.scope,
      purpose: loaded.ctx.purpose,
      retentionPolicyId: TWIN_RETENTION_POLICY,
      eligibleSources: eligibleReferences(loaded),
      now: loaded.ctx.now,
    };
    const value =
      kind === "relation"
        ? validateDynamicRelation(input, validation)
        : validateKnowledgeNeed(input, validation);
    requireValue(
      value.ref.version === 1 &&
        ("status" in value ? value.status === "proposed" : value.state === "open"),
      "BINDING_UNAVAILABLE",
    );
    // Pure contracts allow open unknowns; persistence without any current source
    // still requires a future explicit purpose authority, not an inferred grant.
    requireValue(
      ("endpoints" in value ? value.endpoints : value.evidence).length > 0,
      "EVIDENCE_UNAVAILABLE",
    );
    return value;
  }
  function groundedPolicy(value: GroundedCandidate, ctx: Context): boolean {
    if ("validUntil" in value && value.validUntil !== null && ctx.now >= value.validUntil)
      return false;
    // Fixture-only PROPOSED mapping: not a ratified retention classification for
    // initial relations/needs. Current source eligibility is always checked first
    // and cannot be prolonged by this model policy or by rephrasing/retry.
    const policy = planRetention(
      {
        scope: ctx.scope,
        id: value.ref.id,
        revision: value.ref.version,
        kind: "model",
        createdAt: value.createdAt,
        evidenceEligible: true,
        erasureRequestedAt: null,
      },
      {
        scope: ctx.scope,
        recordId: value.ref.id,
        recordRevision: value.ref.version,
        purpose: "modelling",
        approvedBy: "reviewed_policy",
        validFrom: value.createdAt,
        validUntil: null,
        revokedAt: null,
        basisReference: "fixture-only-current-source-authority",
      },
      ctx.now,
    );
    return policy.purposeUseAllowed && !policy.reviewDue;
  }
  function archiveContext(ctx: Context) {
    context(ctx, true);
    requireValue(ctx.purpose === "private_archive", "ARCHIVE_PURPOSE_REQUIRED");
  }
  async function archiveAuthority(
    tx: Tx,
    ctx: Context,
    kind: "private_source" | "experience",
    id: string,
    revision: number,
  ): Promise<ArchiveAuthority> {
    const [row] = await tx<
      { payload: ArchiveAuthority }[]
    >`select payload from twin_model_fixture.archive_authority where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and kind=${kind} and id=${id} order by version desc limit 1`;
    requireValue(row, "ARCHIVE_AUTHORITY_UNAVAILABLE");
    const { record, authorization } = row.payload;
    requireValue(
      sameScope(record.scope, ctx.scope) &&
        record.id === id &&
        record.revision === revision &&
        record.kind === (kind === "private_source" ? "saved_episode" : "experience_archive"),
      "ARCHIVE_AUTHORITY_UNAVAILABLE",
    );
    requireValue(
      !(await rights(tx, ctx)).some((r) => r.source_kind === kind && r.source_id === id),
      "SOURCE_RESTRICTED",
    );
    requireValue(
      planRetention(record, authorization, ctx.now).purposeUseAllowed,
      "ARCHIVE_AUTHORITY_UNAVAILABLE",
    );
    return row.payload;
  }
  async function composeStoredExperience(
    tx: Tx,
    ctx: Context,
    draft: ExperienceDraft,
    approvedFingerprint: string,
  ) {
    assertModelJsonData(draft);
    requireValue(sameScope(draft.scope, ctx.scope) && draft.revision === 1, "SCOPE_MISMATCH");
    const authority = await archiveAuthority(tx, ctx, "experience", draft.id, draft.revision);
    const currentSources: ExperienceDraft["provenance"][number][] = [];
    for (const source of draft.provenance) {
      // A draft kind/eligibility flag is insufficient: require the exact persisted
      // Human-created private source, not a dialogue/claim with the same id.
      const [row] = await tx<
        { payload: PrivateSource }[]
      >`select payload from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and purpose='private_archive' and kind='private_source' and id=${source.sourceId} and version=${source.sourceVersion}`;
      requireValue(
        row &&
          sameScope(source.scope, ctx.scope) &&
          source.kind === "human_declaration" &&
          row.payload.origin === "human_declaration",
        "ARCHIVE_SOURCE_UNAVAILABLE",
      );
      let sourceAuthority: ArchiveAuthority;
      try {
        sourceAuthority = await archiveAuthority(
          tx,
          ctx,
          "private_source",
          source.sourceId,
          source.sourceVersion,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          ["ARCHIVE_AUTHORITY_UNAVAILABLE", "SOURCE_RESTRICTED"].includes(error.message)
        )
          throw new Error("ARCHIVE_SOURCE_UNAVAILABLE");
        throw error; // Operational/storage corruption is not a consent denial or absent record.
      }
      requireValue(
        row.payload.recordedAt === sourceAuthority.record.createdAt,
        "ARCHIVE_SOURCE_UNAVAILABLE",
      );
      currentSources.push({
        scope: ctx.scope,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        kind: "human_declaration",
        authorizationReference: sourceAuthority.authorization.basisReference,
        eligible: true,
      });
    }
    return composePrivateExperience(draft, {
      scope: ctx.scope,
      actor: ctx.actor,
      now: ctx.now,
      authorization: authority.authorization,
      currentRecord: authority.record,
      currentSources,
      approvedFingerprint,
    });
  }
  return {
    async proposeGroundedCandidate(
      ctx: Context,
      kind: GroundedKind,
      input: unknown,
      requestId: string,
    ): Promise<void> {
      context(ctx);
      requireValue(ctx.actor.kind === "model", "MODEL_REQUIRED");
      requireValue(nonempty(requestId));
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        requireValue(
          !loaded.state.lastRecordedAt || ctx.now >= loaded.state.lastRecordedAt,
          "STALE_CLOCK",
        );
        const value = groundedValue(kind, input, loaded);
        requireValue(groundedPolicy(value, ctx), "RETENTION_UNAVAILABLE");
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(["initial-grounded-candidate", kind, canonicalJson(value)]))
          .digest("hex");
        const prior = loaded.state.receipts.find((r) => r.requestId === requestId);
        if (prior) {
          requireValue(prior.fingerprint === fingerprint, "REPLAY_CONFLICT");
          return;
        }
        requireValue(value.createdAt === ctx.now, "BINDING_UNAVAILABLE");
        await insert(tx, ctx, kind, value.ref.id, 1, value);
        for (const source of "endpoints" in value ? value.endpoints : value.evidence)
          await link(
            tx,
            ctx,
            source.kind,
            source.id,
            source.version,
            kind,
            value.ref.id,
            1,
            "contextualizes",
          );
        await tx`insert into twin_model_fixture.receipt values (${ctx.scope.organizationId},${ctx.scope.subjectId},${ctx.purpose},${requestId},${fingerprint},${kind},${value.ref.id},1)`;
      });
    },
    async groundedCandidates(ctx: Context): Promise<GroundedCandidate[]> {
      context(ctx);
      return sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        const result: GroundedCandidate[] = [];
        for (const row of loaded.rows) {
          if (row.kind !== "relation" && row.kind !== "knowledge_need") continue;
          try {
            const value = groundedValue(row.kind, row.payload, loaded);
            if (groundedPolicy(value, ctx)) result.push(value);
          } catch (error) {
            // Rights/expiry exclude current use. Corrupt payloads and operational
            // failures are not silently reported as an empty/healthy model.
            if (!(error instanceof Error) || error.message !== "EVIDENCE_UNAVAILABLE") throw error;
          }
        }
        return result;
      });
    },
    async savePrivateSource(ctx: Context, source: PrivateSource): Promise<void> {
      archiveContext(ctx);
      assertModelJsonData(source);
      createModelLedger(source.scope);
      requireValue(
        Object.keys(source).sort().join(",") === "id,origin,recordedAt,revision,scope,text" &&
          sameScope(source.scope, ctx.scope) &&
          nonempty(source.id) &&
          nonempty(source.text) &&
          source.origin === "human_declaration" &&
          source.revision === 1,
        "INVALID_INPUT",
      );
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const authority = await archiveAuthority(
          tx,
          ctx,
          "private_source",
          source.id,
          source.revision,
        );
        requireValue(authority.record.createdAt === source.recordedAt, "BINDING_UNAVAILABLE");
        const [prior] = await tx<
          { payload: PrivateSource }[]
        >`select payload from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and kind='private_source' and id=${source.id} and version=1`;
        if (prior) {
          requireValue(
            prior.payload.text === source.text &&
              prior.payload.recordedAt === source.recordedAt &&
              prior.payload.origin === source.origin,
            "REPLAY_CONFLICT",
          );
          return;
        }
        requireValue(source.recordedAt === ctx.now, "BINDING_UNAVAILABLE");
        await insert(tx, ctx, "private_source", source.id, 1, source);
      });
    },
    async saveExperience(
      ctx: Context,
      draft: ExperienceDraft,
      approvedFingerprint: string,
    ): Promise<void> {
      archiveContext(ctx);
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const value = await composeStoredExperience(tx, ctx, draft, approvedFingerprint);
        const [prior] = await tx<
          { payload: PrivateExperience }[]
        >`select payload from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and kind='experience' and id=${value.id} and version=1`;
        if (prior) {
          requireValue(prior.payload.fingerprint === value.fingerprint, "REPLAY_CONFLICT");
          return;
        }
        requireValue(value.recordedAt === ctx.now, "BINDING_UNAVAILABLE");
        await insert(tx, ctx, "experience", value.id, 1, value);
        for (const source of value.provenance)
          await link(
            tx,
            ctx,
            "private_source",
            source.sourceId,
            source.sourceVersion,
            "experience",
            value.id,
            1,
            "contextualizes",
          );
      });
    },
    async experience(ctx: Context, id: string): Promise<PrivateExperience | null> {
      archiveContext(ctx);
      requireValue(nonempty(id));
      return sql.begin(async (tx) => {
        await lock(tx, ctx);
        const [row] = await tx<
          { payload: PrivateExperience }[]
        >`select payload from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and purpose='private_archive' and kind='experience' and id=${id} and version=1`;
        if (!row) return null;
        const { fingerprint, policyVersion, transferAuthority, ...draft } = row.payload;
        requireValue(
          policyVersion === TWIN_RETENTION_POLICY && transferAuthority === "none",
          "BINDING_UNAVAILABLE",
        );
        try {
          return await composeStoredExperience(tx, ctx, draft, fingerprint);
        } catch (error) {
          if (
            error instanceof Error &&
            [
              "ARCHIVE_AUTHORITY_UNAVAILABLE",
              "ARCHIVE_SOURCE_UNAVAILABLE",
              "SOURCE_RESTRICTED",
            ].includes(error.message)
          )
            return null;
          throw error;
        }
      });
    },
    async proposeHypothesis(ctx: Context, input: unknown, requestId: string): Promise<void> {
      context(ctx);
      requireValue(ctx.actor.kind === "model", "MODEL_REQUIRED");
      requireValue(nonempty(requestId));
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        const value = validateWorkingHypothesis(
          input,
          ctx.scope,
          eligibleReferences(loaded),
          ctx.now,
        );
        // Only initial proposal is admitted: model text cannot invent policy, purpose,
        // a substantial-evidence clock, promotion or a historical backfill.
        requireValue(
          value.purpose === ctx.purpose &&
            value.retentionPolicyId === TWIN_RETENTION_POLICY &&
            value.ref.version === 1 &&
            value.status === "proposed" &&
            value.lastSubstantialEvidenceAt === null,
          "BINDING_UNAVAILABLE",
        );
        requireValue(hypothesisPolicy(value, ctx), "RETENTION_UNAVAILABLE");
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify([
              "initial-hypothesis",
              modelReferenceKey(value.ref),
              value.purpose,
              value.createdAt,
              value.retentionPolicyId,
              value.context,
              value.domains,
              value.validFrom,
              value.validUntil,
              value.lastSubstantialEvidenceAt,
              value.status,
              value.alternatives.map((a) => [
                a.id,
                a.statement,
                a.support.map(modelReferenceKey),
                a.contradiction.map(modelReferenceKey),
                a.uncertainty,
                a.falsifier,
              ]),
            ]),
          )
          .digest("hex");
        const prior = loaded.state.receipts.find((r) => r.requestId === requestId);
        if (prior) {
          requireValue(prior.fingerprint === fingerprint, "REPLAY_CONFLICT");
          return;
        }
        requireValue(value.createdAt === ctx.now, "BINDING_UNAVAILABLE");
        await insert(tx, ctx, "hypothesis", value.ref.id, 1, value);
        for (const alternative of value.alternatives) {
          for (const source of alternative.support)
            await link(
              tx,
              ctx,
              source.kind,
              source.id,
              source.version,
              "hypothesis",
              value.ref.id,
              1,
              "supports",
            );
          for (const source of alternative.contradiction)
            await link(
              tx,
              ctx,
              source.kind,
              source.id,
              source.version,
              "hypothesis",
              value.ref.id,
              1,
              "contradicts",
            );
        }
        await tx`insert into twin_model_fixture.receipt values (${ctx.scope.organizationId},${ctx.scope.subjectId},${ctx.purpose},${requestId},${fingerprint},'hypothesis',${value.ref.id},1)`;
      });
    },
    async hypotheses(ctx: Context): Promise<WorkingHypothesis[]> {
      context(ctx);
      return sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        const evidence = eligibleReferences(loaded);
        const result: WorkingHypothesis[] = [];
        for (const row of loaded.rows.filter((r) => r.kind === "hypothesis")) {
          try {
            const value = validateWorkingHypothesis(row.payload, ctx.scope, evidence, ctx.now);
            if (
              value.purpose === ctx.purpose &&
              value.retentionPolicyId === TWIN_RETENTION_POLICY &&
              value.status !== "withdrawn" &&
              (value.validUntil === null || ctx.now < value.validUntil) &&
              hypothesisPolicy(value, ctx)
            )
              result.push(value);
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "EVIDENCE_UNAVAILABLE") throw error;
          }
        }
        return result;
      });
    },
    async apply(ctx: Context, command: ModelCommand): Promise<void> {
      context(ctx);
      assertModelJsonData(command);
      requireValue(sameScope(command.scope, ctx.scope), "SCOPE_MISMATCH");
      // Diary/private archive authority is deliberately not inferred by this first fixture.
      if (command.kind === "observe")
        requireValue(command.source === "dialogue", "SOURCE_NOT_ADMITTED");
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        if (command.kind === "observe") {
          requireValue(
            !loaded.restrictions.some(
              (r) => r.source_kind === "observation" && r.source_id === command.id,
            ),
            "SOURCE_RESTRICTED",
          );
          const existing = loaded.rows.find(
            (row) => row.kind === "observation" && row.id === command.id,
          );
          requireValue(
            !existing ||
              loaded.state.observations.some((observation) => observation.id === command.id),
            "RETENTION_UNAVAILABLE",
          );
          const grant = loaded.ctx.grants.find(
            (g) => g.id === command.grant.id && g.version === command.grant.version,
          );
          requireValue(grant?.retentionPolicyId === TWIN_RETENTION_POLICY, "POLICY_UNAVAILABLE");
        }
        const next = applyModelCommand(loaded.state, command, loaded.ctx);
        if (next === loaded.state) return;
        for (const observation of next.observations) {
          if (!loaded.rows.some((r) => r.kind === "observation" && r.id === observation.id))
            await insert(tx, ctx, "observation", observation.id, 1, observation);
        }
        for (const claim of next.claims) {
          if (
            loaded.rows.some(
              (r) => r.kind === "claim" && r.id === claim.claimId && r.version === claim.revision,
            )
          )
            continue;
          await insert(tx, ctx, "claim", claim.claimId, claim.revision, claim);
          for (const id of claim.observationIds)
            await link(tx, ctx, "observation", id, 1, "claim", claim.claimId, claim.revision);
        }
        for (const correction of next.corrections) {
          if (loaded.rows.some((r) => r.kind === "correction" && r.id === correction.id)) continue;
          await insert(tx, ctx, "correction", correction.id, 1, correction);
          await link(
            tx,
            ctx,
            "claim",
            correction.claimId,
            correction.previousRevision,
            "correction",
            correction.id,
            1,
          );
        }
        const receipt = next.receipts.at(-1)!;
        const targetKind =
          command.kind === "observe"
            ? "observation"
            : command.kind === "propose"
              ? "claim"
              : "correction";
        const targetId = command.kind === "propose" ? command.claimId : command.id;
        await tx`insert into twin_model_fixture.receipt values (${ctx.scope.organizationId},${ctx.scope.subjectId},${ctx.purpose},${receipt.requestId},${receipt.fingerprint},${targetKind},${targetId},1)`;
      });
    },
    async current(ctx: Context) {
      context(ctx);
      return sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        return projectCurrentModel(loaded.state, loaded.ctx);
      });
    },
    async history(ctx: Context): Promise<ModelLedger> {
      context(ctx);
      return sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        const usable = new Set(loaded.state.observations.map((o) => o.id));
        const claims = loaded.state.claims.filter((c) =>
          c.observationIds.every((id) => usable.has(id)),
        );
        const claimIds = new Set(claims.map((c) => c.claimId));
        return {
          ...loaded.state,
          claims,
          corrections: loaded.state.corrections.filter((c) => claimIds.has(c.claimId)),
          receipts: [],
        };
      });
    },
    async withdraw(
      ctx: Context,
      sourceId: string,
      requestId: string,
      operation: RightsRow["operation"],
      sourceKind: RightsRow["source_kind"] = "observation",
    ): Promise<void> {
      context(ctx, true);
      requireValue(
        nonempty(sourceId) &&
          nonempty(requestId) &&
          ["withdraw_modelling", "delete_source"].includes(operation) &&
          ["observation", "private_source", "experience"].includes(sourceKind),
      );
      requireValue(
        operation === "delete_source" || sourceKind === "observation",
        "RIGHTS_PURPOSE_MISMATCH",
      );
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const loaded = await load(tx, ctx);
        const prior = loaded.restrictions.find(
          (r) => r.request_id === requestId && r.purpose === ctx.purpose,
        );
        if (prior) {
          requireValue(
            prior.source_id === sourceId &&
              prior.source_kind === sourceKind &&
              prior.operation === operation,
            "REPLAY_CONFLICT",
          );
          return;
        }
        requireValue(
          loaded.rows.some((r) => r.kind === sourceKind && r.id === sourceId),
          "SOURCE_UNAVAILABLE",
        );
        requireValue(
          !loaded.state.lastRecordedAt || ctx.now >= loaded.state.lastRecordedAt,
          "STALE_CLOCK",
        );
        await tx`insert into twin_model_fixture.rights_request values (${ctx.scope.organizationId},${ctx.scope.subjectId},${ctx.purpose},${requestId},${sourceId},${operation},${ctx.now},'restricted',${sourceKind})`;
      });
    },
    async erase(ctx: Context, requestId: string): Promise<void> {
      context(ctx, true);
      requireValue(nonempty(requestId));
      // Separate transaction: an erasure failure can never roll back the use restriction.
      await sql.begin(async (tx) => {
        await lock(tx, ctx);
        const [request] = await tx<
          RightsRow[]
        >`select * from twin_model_fixture.rights_request where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and purpose=${ctx.purpose} and request_id=${requestId}`;
        requireValue(request, "RIGHTS_UNAVAILABLE");
        requireValue(ctx.now >= request.requested_at.toISOString(), "STALE_CLOCK");
        if (request.state === "live_removed") return;
        const affected = await tx<
          { kind: string; id: string; version: number; purpose: string }[]
        >`with recursive affected(kind,id,version) as (
          select kind,id,version from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and kind=${request.source_kind} and id=${request.source_id}
          union select l.target_kind,l.target_id,l.target_version from twin_model_fixture.link l join affected a on l.source_kind=a.kind and l.source_id=a.id and l.source_version=a.version where l.organization_id=${ctx.scope.organizationId} and l.subject_id=${ctx.scope.subjectId}
        ) select o.kind,o.id,o.version,o.purpose from twin_model_fixture.object o join affected a on o.kind=a.kind and o.id=a.id and o.version=a.version where o.organization_id=${ctx.scope.organizationId} and o.subject_id=${ctx.scope.subjectId}`;
        if (request.operation === "withdraw_modelling")
          requireValue(
            affected.every(
              (row) =>
                row.purpose === ctx.purpose &&
                [
                  "observation",
                  "claim",
                  "correction",
                  "hypothesis",
                  "relation",
                  "knowledge_need",
                ].includes(row.kind),
            ),
            "CROSS_PURPOSE_REVIEW_REQUIRED",
          );
        for (const row of affected)
          await tx`delete from twin_model_fixture.object where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and kind=${row.kind} and id=${row.id} and version=${row.version}`;
        await tx`update twin_model_fixture.rights_request set state='live_removed' where organization_id=${ctx.scope.organizationId} and subject_id=${ctx.scope.subjectId} and purpose=${ctx.purpose} and request_id=${requestId}`;
      });
    },
  };
}
