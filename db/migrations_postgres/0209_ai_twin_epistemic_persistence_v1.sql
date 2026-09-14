-- DEE-871: first production AI-TWIN epistemic persistence package.
-- Human-ratified 2026-09-14: ownership A (bounded Trader compatible-additive
-- tuple in this issue), annual-review targets exact Human-endorsed claim
-- revisions, private-archive tables deferred. Create-only. No backfill, no
-- existing-table rewrite, no RLS expansion, no runtime trigger, no writer
-- activation, no route mount, no production apply.
CREATE FUNCTION public.ai_twin_observation_sources_valid_v1(sources jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(sources) = 'array'
    AND jsonb_array_length(sources) > 0
    AND jsonb_array_length(sources) = (
      SELECT count(DISTINCT value) FROM jsonb_array_elements_text(sources) value
    )
    AND (
      SELECT bool_and(value IN ('dialogue', 'diary'))
      FROM jsonb_array_elements_text(sources) value
    )
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_twin_projection_risks_valid_v1(risks jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(risks) = 'array'
    AND jsonb_array_length(risks) = (
      SELECT count(DISTINCT value) FROM jsonb_array_elements_text(risks) value
    )
    AND (
      SELECT bool_and(value IN (
        'ambiguity',
        'leading_question',
        'missing_context',
        'selection_bias',
        'model_interpretation'
      ))
      FROM jsonb_array_elements_text(risks) value
    )
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_twin_nonempty_text_array_valid_v1(values jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(values) = 'array'
    AND jsonb_array_length(values) > 0
    AND jsonb_array_length(values) = (
      SELECT count(DISTINCT value) FROM jsonb_array_elements_text(values) value
    )
    AND (
      SELECT bool_and(length(btrim(value)) > 0)
      FROM jsonb_array_elements_text(values) value
    )
$$;
--> statement-breakpoint
CREATE FUNCTION public.ai_twin_hypothesis_alternatives_valid_v1(alternatives jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(alternatives) = 'array'
    AND jsonb_array_length(alternatives) >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(alternatives) value
      WHERE jsonb_typeof(value) <> 'object'
        OR coalesce(length(btrim(value ->> 'id')), 0) = 0
        OR coalesce(length(btrim(value ->> 'statement')), 0) = 0
        OR coalesce(length(btrim(value ->> 'uncertainty')), 0) = 0
        OR coalesce(length(btrim(value ->> 'falsifier')), 0) = 0
        OR jsonb_typeof(value -> 'support') <> 'array'
        OR jsonb_typeof(value -> 'contradiction') <> 'array'
    )
$$;
--> statement-breakpoint
CREATE TABLE public.ai_twin_object_versions (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL,
  object_id text NOT NULL,
  version integer NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL,
  retention_policy_id text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  CHECK (version >= 1),
  CHECK (length(btrim(object_id)) > 0),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (object_kind IN (
    'observation',
    'claim',
    'correction',
    'evidence_link',
    'hypothesis',
    'relation',
    'knowledge_need'
  ))
);
--> statement-breakpoint
CREATE INDEX ai_twin_object_versions_scope_purpose_created_idx
  ON public.ai_twin_object_versions (organization_id, subject_user_id, purpose, created_at);
--> statement-breakpoint
CREATE INDEX ai_twin_object_versions_scope_kind_id_version_idx
  ON public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version DESC);
--> statement-breakpoint
CREATE TABLE public.ai_twin_consent_grants (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  version integer NOT NULL,
  purpose text NOT NULL,
  sources jsonb NOT NULL,
  mode text NOT NULL,
  permitted_uses jsonb NOT NULL,
  disclosure_boundary text NOT NULL,
  issued_at timestamptz NOT NULL,
  temporal_mode text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  retention_policy_id text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, grant_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  CHECK (version >= 1),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (mode = 'private_modelling'),
  CHECK (disclosure_boundary = 'private_only'),
  CHECK (temporal_mode IN ('UNTIL_REVOKED', 'EXPIRES_AT')),
  CHECK (
    (temporal_mode = 'UNTIL_REVOKED' AND expires_at IS NULL)
    OR (temporal_mode = 'EXPIRES_AT' AND expires_at IS NOT NULL AND expires_at > issued_at)
  ),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
  CHECK (public.ai_twin_observation_sources_valid_v1(sources)),
  CHECK (permitted_uses = '["productive_private_modelling"]'::jsonb)
);
--> statement-breakpoint
CREATE INDEX ai_twin_consent_grants_scope_grant_version_idx
  ON public.ai_twin_consent_grants (organization_id, subject_user_id, grant_id, version DESC);
--> statement-breakpoint
CREATE INDEX ai_twin_consent_grants_scope_purpose_idx
  ON public.ai_twin_consent_grants (organization_id, subject_user_id, purpose);
--> statement-breakpoint
CREATE TABLE public.ai_twin_consent_issuance_receipts (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  purpose text NOT NULL,
  request_id uuid NOT NULL,
  intent_fingerprint text NOT NULL,
  grant_id uuid NOT NULL,
  grant_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, purpose, request_id),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, grant_id, grant_version)
    REFERENCES public.ai_twin_consent_grants (organization_id, subject_user_id, grant_id, version)
    ON DELETE RESTRICT,
  CHECK (length(btrim(purpose)) > 0),
  CHECK (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (grant_version >= 1)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_observations (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'observation',
  object_id text NOT NULL,
  version integer NOT NULL,
  grant_id uuid NOT NULL,
  grant_version integer NOT NULL,
  source text NOT NULL,
  event_time timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  context text NOT NULL,
  observation_text text NOT NULL,
  projection_risks jsonb NOT NULL,
  epistemic_kind text NOT NULL,
  purpose text NOT NULL,
  retention_policy_id text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, grant_id, grant_version)
    REFERENCES public.ai_twin_consent_grants (organization_id, subject_user_id, grant_id, version)
    ON DELETE RESTRICT,
  CHECK (object_kind = 'observation'),
  CHECK (version = 1),
  CHECK (source IN ('dialogue', 'diary')),
  CHECK (epistemic_kind = 'self_report'),
  CHECK (length(btrim(context)) > 0),
  CHECK (length(btrim(observation_text)) > 0),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (public.ai_twin_projection_risks_valid_v1(projection_risks))
);
--> statement-breakpoint
CREATE INDEX ai_twin_observations_scope_purpose_recorded_idx
  ON public.ai_twin_observations (organization_id, subject_user_id, purpose, recorded_at);
--> statement-breakpoint
CREATE INDEX ai_twin_observations_grant_idx
  ON public.ai_twin_observations (organization_id, subject_user_id, grant_id, grant_version);
--> statement-breakpoint
CREATE TABLE public.ai_twin_claim_revisions (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'claim',
  object_id text NOT NULL,
  version integer NOT NULL,
  statement text NOT NULL,
  domain text NOT NULL,
  context text NOT NULL,
  uncertainty text NOT NULL,
  status text NOT NULL,
  basis text NOT NULL,
  recorded_at timestamptz NOT NULL,
  purpose text NOT NULL,
  supersedes_revision integer,
  human_correction_id text,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, supersedes_revision)
    REFERENCES public.ai_twin_claim_revisions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  CHECK (object_kind = 'claim'),
  CHECK (version >= 1),
  CHECK (length(btrim(statement)) > 0),
  CHECK (length(btrim(domain)) > 0),
  CHECK (length(btrim(context)) > 0),
  CHECK (length(btrim(uncertainty)) > 0),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (status IN ('proposed', 'active', 'contested', 'superseded', 'withdrawn')),
  CHECK (basis IN ('model_interpretation', 'human_endorsed')),
  CHECK (supersedes_revision IS NULL OR (supersedes_revision >= 1 AND supersedes_revision = version - 1)),
  CHECK (human_correction_id IS NULL OR length(btrim(human_correction_id)) > 0)
);
--> statement-breakpoint
CREATE INDEX ai_twin_claim_revisions_scope_claim_version_idx
  ON public.ai_twin_claim_revisions (organization_id, subject_user_id, object_id, version DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_twin_claim_revisions_scope_id_version_uq
  ON public.ai_twin_claim_revisions (organization_id, subject_user_id, object_id, version);
--> statement-breakpoint
CREATE TABLE public.ai_twin_human_corrections (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'correction',
  object_id text NOT NULL,
  version integer NOT NULL,
  claim_id text NOT NULL,
  previous_revision integer NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  statement text,
  context text,
  actor_subject_user_id uuid NOT NULL,
  purpose text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, claim_id, previous_revision)
    REFERENCES public.ai_twin_claim_revisions (organization_id, subject_user_id, object_id, version)
    ON DELETE RESTRICT,
  CHECK (object_kind = 'correction'),
  CHECK (version = 1),
  CHECK (actor_subject_user_id = subject_user_id),
  CHECK (previous_revision >= 1),
  CHECK (length(btrim(claim_id)) > 0),
  CHECK (length(btrim(reason)) > 0),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (action IN ('ratify', 'correct', 'dispute', 'contextualize')),
  CHECK (statement IS NULL OR length(btrim(statement)) > 0),
  CHECK (context IS NULL OR length(btrim(context)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ai_twin_human_corrections_scope_id_uq
  ON public.ai_twin_human_corrections (organization_id, subject_user_id, object_id);
--> statement-breakpoint
ALTER TABLE public.ai_twin_claim_revisions
  ADD CONSTRAINT ai_twin_claim_revisions_correction_fk
  FOREIGN KEY (organization_id, subject_user_id, human_correction_id)
  REFERENCES public.ai_twin_human_corrections (organization_id, subject_user_id, object_id)
  ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE public.ai_twin_evidence_links (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'evidence_link',
  object_id text NOT NULL,
  version integer NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL,
  retention_policy_id text NOT NULL,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  source_version integer NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  target_version integer NOT NULL,
  relationship text NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, source_kind, source_id, source_version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, target_kind, target_id, target_version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  UNIQUE (
    organization_id,
    subject_user_id,
    source_kind,
    source_id,
    source_version,
    target_kind,
    target_id,
    target_version,
    relationship
  ),
  CHECK (object_kind = 'evidence_link'),
  CHECK (version = 1),
  CHECK (source_version >= 1),
  CHECK (target_version >= 1),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (length(btrim(reason)) > 0),
  CHECK (relationship IN ('supports', 'contradicts', 'contextualizes'))
);
--> statement-breakpoint
CREATE INDEX ai_twin_evidence_links_source_idx
  ON public.ai_twin_evidence_links (
    organization_id, subject_user_id, source_kind, source_id, source_version
  );
--> statement-breakpoint
CREATE INDEX ai_twin_evidence_links_target_idx
  ON public.ai_twin_evidence_links (
    organization_id, subject_user_id, target_kind, target_id, target_version
  );
--> statement-breakpoint
CREATE TABLE public.ai_twin_working_hypotheses (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'hypothesis',
  object_id text NOT NULL,
  version integer NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL,
  retention_policy_id text NOT NULL,
  context text NOT NULL,
  domains jsonb NOT NULL,
  alternatives jsonb NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  last_substantial_evidence_at timestamptz,
  status text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  CHECK (object_kind = 'hypothesis'),
  CHECK (version >= 1),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (length(btrim(context)) > 0),
  CHECK (status IN ('proposed', 'contested', 'withdrawn')),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    last_substantial_evidence_at IS NULL
    OR last_substantial_evidence_at >= created_at
  ),
  CHECK (public.ai_twin_nonempty_text_array_valid_v1(domains)),
  CHECK (public.ai_twin_hypothesis_alternatives_valid_v1(alternatives))
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_dynamic_relations (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'relation',
  object_id text NOT NULL,
  version integer NOT NULL,
  relation_kind text NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL,
  retention_policy_id text NOT NULL,
  context text NOT NULL,
  uncertainty text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  status text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  CHECK (object_kind = 'relation'),
  CHECK (version >= 1),
  CHECK (relation_kind IN ('sigma', 'delta', 'attractor', 'tension', 'temporal_transition')),
  CHECK (status IN ('proposed', 'contested', 'withdrawn')),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (length(btrim(context)) > 0),
  CHECK (length(btrim(uncertainty)) > 0),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_knowledge_needs (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  object_kind text NOT NULL DEFAULT 'knowledge_need',
  object_id text NOT NULL,
  version integer NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL,
  retention_policy_id text NOT NULL,
  reason text NOT NULL,
  proposed_observation text NOT NULL,
  state text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, object_kind, object_id, version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, object_kind, object_id, version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  CHECK (object_kind = 'knowledge_need'),
  CHECK (version >= 1),
  CHECK (state IN ('open', 'skipped', 'resolved', 'withdrawn')),
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (length(btrim(reason)) > 0),
  CHECK (length(btrim(proposed_observation)) > 0)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_command_receipts (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  purpose text NOT NULL,
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  target_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  retention_policy_id text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, purpose, request_id),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, target_kind, target_id, target_version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  CHECK (length(btrim(purpose)) > 0),
  CHECK (length(btrim(request_id)) > 0),
  CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (length(btrim(retention_policy_id)) > 0),
  CHECK (target_version >= 1)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_rights_completion_evidence (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  evidence_digest text NOT NULL,
  evidence_class text NOT NULL,
  producer_reference text NOT NULL,
  admitted_at timestamptz NOT NULL,
  admitted_by_reference text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, evidence_digest),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (length(btrim(evidence_class)) > 0),
  CHECK (length(btrim(producer_reference)) > 0),
  CHECK (length(btrim(admitted_by_reference)) > 0)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_rights_operations (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  target_scope_kind text NOT NULL,
  target_digest text NOT NULL,
  policy_version text NOT NULL,
  requested_at timestamptz NOT NULL,
  requested_by_subject_user_id uuid NOT NULL,
  requested_by_actor_reference text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, operation_id),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  CHECK (length(btrim(operation_id)) > 0),
  CHECK (operation_type IN (
    'WITHDRAW_USE', 'DELETE', 'ERASE', 'EXPORT', 'CORRECT', 'RETAIN', 'ARCHIVE'
  )),
  CHECK (target_scope_kind IN ('record', 'source', 'purpose', 'subject')),
  CHECK (target_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (length(btrim(policy_version)) > 0),
  CHECK (requested_by_subject_user_id = subject_user_id),
  CHECK (length(btrim(requested_by_actor_reference)) > 0)
);
--> statement-breakpoint
CREATE INDEX ai_twin_rights_operations_scope_type_requested_idx
  ON public.ai_twin_rights_operations (
    organization_id, subject_user_id, operation_type, requested_at
  );
--> statement-breakpoint
CREATE INDEX ai_twin_rights_operations_target_digest_idx
  ON public.ai_twin_rights_operations (organization_id, subject_user_id, target_digest);
--> statement-breakpoint
CREATE TABLE public.ai_twin_rights_operation_events (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  sequence integer NOT NULL,
  state text NOT NULL,
  event_time timestamptz NOT NULL,
  completion_evidence_digest text,
  accepted_by_subject_user_id uuid,
  accepted_by_actor_reference text,
  PRIMARY KEY (organization_id, subject_user_id, operation_id, sequence),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, operation_id)
    REFERENCES public.ai_twin_rights_operations (organization_id, subject_user_id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, completion_evidence_digest)
    REFERENCES public.ai_twin_rights_completion_evidence (organization_id, subject_user_id, evidence_digest)
    ON DELETE RESTRICT,
  CHECK (sequence >= 1),
  CHECK (state IN (
    'REQUESTED',
    'ACCEPTED',
    'USE_BLOCKED',
    'LIVE_REMOVAL_IN_PROGRESS',
    'LIVE_REMOVED',
    'RESIDUAL_COPIES_PENDING',
    'CLOSED',
    'REFUSED',
    'CANCELLED'
  )),
  CHECK (
    (state = 'ACCEPTED'
      AND accepted_by_subject_user_id = subject_user_id
      AND length(btrim(accepted_by_actor_reference)) > 0)
    OR (state <> 'ACCEPTED'
      AND accepted_by_subject_user_id IS NULL
      AND accepted_by_actor_reference IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_rights_operation_attempts (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  sequence integer NOT NULL,
  attempt_id text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  outcome text NOT NULL,
  outcome_code text NOT NULL,
  completion_evidence_digest text,
  PRIMARY KEY (organization_id, subject_user_id, operation_id, sequence),
  UNIQUE (organization_id, subject_user_id, operation_id, attempt_id),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, operation_id)
    REFERENCES public.ai_twin_rights_operations (organization_id, subject_user_id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, completion_evidence_digest)
    REFERENCES public.ai_twin_rights_completion_evidence (organization_id, subject_user_id, evidence_digest)
    ON DELETE RESTRICT,
  CHECK (sequence >= 1),
  CHECK (completed_at >= started_at),
  CHECK (outcome IN ('FAILED', 'SUCCEEDED')),
  CHECK (length(btrim(attempt_id)) > 0),
  CHECK (length(btrim(outcome_code)) > 0)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_rights_operation_effects (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  effect_kind text NOT NULL,
  committed_at timestamptz NOT NULL,
  completion_evidence_digest text NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, operation_id),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, operation_id)
    REFERENCES public.ai_twin_rights_operations (organization_id, subject_user_id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, completion_evidence_digest)
    REFERENCES public.ai_twin_rights_completion_evidence (organization_id, subject_user_id, evidence_digest)
    ON DELETE RESTRICT,
  CHECK (effect_kind IN (
    'EXPORT_ARTIFACT_CREATED',
    'CORRECTIVE_REVISION_COMMITTED',
    'RETENTION_DECISION_COMMITTED',
    'ARCHIVE_EFFECT_COMMITTED'
  ))
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_model_endorsements (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  endorsement_id text NOT NULL,
  target_object_kind text NOT NULL DEFAULT 'claim',
  target_object_id text NOT NULL,
  target_version integer NOT NULL,
  basis text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  confirmed_by_subject_user_id uuid NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, endorsement_id),
  UNIQUE (organization_id, subject_user_id, target_object_id, target_version),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, target_object_kind, target_object_id, target_version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, target_object_id, target_version)
    REFERENCES public.ai_twin_claim_revisions (organization_id, subject_user_id, object_id, version)
    ON DELETE RESTRICT,
  CHECK (target_object_kind = 'claim'),
  CHECK (target_version >= 1),
  CHECK (basis = 'initial_model_endorsement'),
  CHECK (confirmed_by_subject_user_id = subject_user_id),
  CHECK (length(btrim(endorsement_id)) > 0),
  CHECK (length(btrim(target_object_id)) > 0)
);
--> statement-breakpoint
CREATE TABLE public.ai_twin_necessity_reviews (
  organization_id uuid NOT NULL,
  subject_user_id uuid NOT NULL,
  review_id text NOT NULL,
  target_object_kind text NOT NULL DEFAULT 'claim',
  target_object_id text NOT NULL,
  target_version integer NOT NULL,
  policy_version text NOT NULL,
  basis text NOT NULL,
  decision text NOT NULL,
  prepared_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  confirmed_by_subject_user_id uuid NOT NULL,
  PRIMARY KEY (organization_id, subject_user_id, review_id),
  FOREIGN KEY (organization_id, subject_user_id)
    REFERENCES public.organization_members (organization_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, target_object_kind, target_object_id, target_version)
    REFERENCES public.ai_twin_object_versions (organization_id, subject_user_id, object_kind, object_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, subject_user_id, target_object_id, target_version)
    REFERENCES public.ai_twin_claim_revisions (organization_id, subject_user_id, object_id, version)
    ON DELETE RESTRICT,
  CHECK (target_object_kind = 'claim'),
  CHECK (target_version >= 1),
  CHECK (basis = 'storage_necessity'),
  CHECK (decision = 'retain'),
  CHECK (confirmed_at >= prepared_at),
  CHECK (confirmed_by_subject_user_id = subject_user_id),
  CHECK (length(btrim(review_id)) > 0),
  CHECK (length(btrim(target_object_id)) > 0),
  CHECK (length(btrim(policy_version)) > 0)
);
--> statement-breakpoint
CREATE INDEX ai_twin_necessity_reviews_target_idx
  ON public.ai_twin_necessity_reviews (
    organization_id, subject_user_id, target_object_id, target_version, confirmed_at DESC
  );
