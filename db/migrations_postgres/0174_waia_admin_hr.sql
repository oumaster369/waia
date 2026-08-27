-- DEE-747: shared WAIA Admin grants, public team applications and HR funnel history.

CREATE TYPE public.waia_admin_grant_role AS ENUM (
  'SUPER_ADMIN', 'FINANCE_ADMIN', 'HR_ADMIN'
);
--> statement-breakpoint
CREATE TYPE public.hr_application_status AS ENUM (
  'NEW_APPLICATION', 'INTERVIEW', 'CONTRACT', 'WORK', 'PAYMENT', 'TERMINATION'
);
--> statement-breakpoint
CREATE TYPE public.hr_application_target_type AS ENUM (
  'TASK', 'MILESTONE', 'PROJECT', 'GENERAL'
);
--> statement-breakpoint
CREATE TYPE public.hr_application_event_type AS ENUM (
  'CREATED', 'STATUS_CHANGED', 'ASSIGNEE_CHANGED', 'COMMENT_ADDED'
);
--> statement-breakpoint
CREATE TABLE public.waia_admin_module_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role public.waia_admin_grant_role NOT NULL,
  granted_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  grant_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  revoke_reason text,
  CONSTRAINT waia_admin_module_grants_reason_nonempty CHECK (length(trim(grant_reason)) > 0),
  CONSTRAINT waia_admin_module_grants_revoke_shape CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND length(trim(revoke_reason)) > 0)
  )
);
--> statement-breakpoint
CREATE INDEX waia_admin_module_grants_user_idx
  ON public.waia_admin_module_grants (user_id, role);
--> statement-breakpoint
CREATE UNIQUE INDEX waia_admin_module_grants_active_uq
  ON public.waia_admin_module_grants (user_id, role)
  WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE public.hr_team_applications (
  id uuid PRIMARY KEY,
  applicant_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  identity_name text NOT NULL,
  contact_email text NOT NULL,
  public_profile_url text,
  target_type public.hr_application_target_type NOT NULL,
  target_reference text,
  competencies text NOT NULL,
  experience text NOT NULL,
  collaboration_terms text NOT NULL,
  context text NOT NULL,
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL,
  source text NOT NULL,
  status public.hr_application_status NOT NULL DEFAULT 'NEW_APPLICATION',
  assigned_to_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_team_applications_identity_nonempty CHECK (length(trim(identity_name)) BETWEEN 2 AND 120),
  CONSTRAINT hr_team_applications_email_nonempty CHECK (length(trim(contact_email)) BETWEEN 3 AND 320),
  CONSTRAINT hr_team_applications_competencies_nonempty CHECK (length(trim(competencies)) BETWEEN 10 AND 4000),
  CONSTRAINT hr_team_applications_experience_nonempty CHECK (length(trim(experience)) BETWEEN 10 AND 8000),
  CONSTRAINT hr_team_applications_terms_nonempty CHECK (length(trim(collaboration_terms)) BETWEEN 2 AND 2000),
  CONSTRAINT hr_team_applications_context_length CHECK (length(context) <= 8000),
  CONSTRAINT hr_team_applications_target_shape CHECK (
    (target_type = 'GENERAL' AND target_reference IS NULL)
    OR
    (target_type <> 'GENERAL' AND length(trim(target_reference)) BETWEEN 2 AND 240)
  )
);
--> statement-breakpoint
CREATE INDEX hr_team_applications_status_created_idx
  ON public.hr_team_applications (status, created_at DESC);
--> statement-breakpoint
CREATE INDEX hr_team_applications_assignee_status_idx
  ON public.hr_team_applications (assigned_to_user_id, status);
--> statement-breakpoint
CREATE INDEX hr_team_applications_contact_created_idx
  ON public.hr_team_applications (contact_email, created_at DESC);
--> statement-breakpoint
CREATE TABLE public.hr_application_events (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.hr_team_applications(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type public.hr_application_event_type NOT NULL,
  from_status public.hr_application_status,
  to_status public.hr_application_status,
  previous_assignee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  new_assignee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_application_events_shape CHECK (
    (event_type = 'CREATED'
      AND from_status IS NULL AND to_status = 'NEW_APPLICATION'
      AND previous_assignee_user_id IS NULL AND new_assignee_user_id IS NULL
      AND comment IS NULL)
    OR
    (event_type = 'STATUS_CHANGED'
      AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status
      AND previous_assignee_user_id IS NULL AND new_assignee_user_id IS NULL
      AND comment IS NULL)
    OR
    (event_type = 'ASSIGNEE_CHANGED'
      AND from_status IS NULL AND to_status IS NULL
      AND previous_assignee_user_id IS DISTINCT FROM new_assignee_user_id
      AND comment IS NULL)
    OR
    (event_type = 'COMMENT_ADDED'
      AND from_status IS NULL AND to_status IS NULL
      AND previous_assignee_user_id IS NULL AND new_assignee_user_id IS NULL
      AND length(trim(comment)) BETWEEN 1 AND 4000)
  )
);
--> statement-breakpoint
CREATE INDEX hr_application_events_application_created_idx
  ON public.hr_application_events (application_id, created_at);
--> statement-breakpoint
WITH bootstrap AS (
  SELECT u.id
  FROM public.users u
  JOIN public.user_platform_roles r ON r.user_id = u.id AND r.role = 'admin'
  WHERE lower(u.email) = 'oumaster369@gmail.com'
), inserted AS (
  INSERT INTO public.waia_admin_module_grants (
    id, user_id, role, granted_by_user_id, grant_reason, created_at
  )
  SELECT
    '74700000-0000-4000-8000-000000000001'::uuid,
    id,
    'SUPER_ADMIN',
    id,
    'DEE-747 bootstrap super-admin approved by Human Architect',
    now()
  FROM bootstrap
  WHERE NOT EXISTS (
    SELECT 1 FROM public.waia_admin_module_grants g
    WHERE g.user_id = bootstrap.id AND g.role = 'SUPER_ADMIN' AND g.revoked_at IS NULL
  )
  RETURNING user_id
)
INSERT INTO public.audit_logs (
  id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at
)
SELECT
  '74700000-0000-4000-8000-000000000002'::uuid,
  'admin', user_id::text, 'waia_admin.grant', 'waia_admin_module_grant',
  '74700000-0000-4000-8000-000000000001',
  jsonb_build_object('role', 'SUPER_ADMIN', 'source', 'DEE-747 bootstrap'), now()
FROM inserted;
