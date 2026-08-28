-- DEE-747: deny browser roles and preserve immutable intake/history authority.

CREATE OR REPLACE FUNCTION public.waia_admin_grant_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.role IS DISTINCT FROM NEW.role
    OR OLD.granted_by_user_id IS DISTINCT FROM NEW.granted_by_user_id
    OR OLD.grant_reason IS DISTINCT FROM NEW.grant_reason
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL
  THEN
    RAISE EXCEPTION 'WAIA Admin grants may only transition once from active to revoked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER waia_admin_grant_transition_guard
  BEFORE UPDATE ON public.waia_admin_module_grants
  FOR EACH ROW EXECUTE FUNCTION public.waia_admin_grant_transition_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_admin_block_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WAIA Admin authority and HR history cannot be deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER waia_admin_grant_delete_guard
  BEFORE DELETE ON public.waia_admin_module_grants
  FOR EACH ROW EXECUTE FUNCTION public.waia_admin_block_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hr_team_application_update_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.applicant_user_id IS DISTINCT FROM NEW.applicant_user_id
    OR OLD.identity_name IS DISTINCT FROM NEW.identity_name
    OR OLD.contact_email IS DISTINCT FROM NEW.contact_email
    OR OLD.public_profile_url IS DISTINCT FROM NEW.public_profile_url
    OR OLD.target_type IS DISTINCT FROM NEW.target_type
    OR OLD.target_reference IS DISTINCT FROM NEW.target_reference
    OR OLD.competencies IS DISTINCT FROM NEW.competencies
    OR OLD.experience IS DISTINCT FROM NEW.experience
    OR OLD.collaboration_terms IS DISTINCT FROM NEW.collaboration_terms
    OR OLD.context IS DISTINCT FROM NEW.context
    OR OLD.consent_version IS DISTINCT FROM NEW.consent_version
    OR OLD.consented_at IS DISTINCT FROM NEW.consented_at
    OR OLD.source IS DISTINCT FROM NEW.source
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'HR application intake facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hr_team_application_update_guard
  BEFORE UPDATE ON public.hr_team_applications
  FOR EACH ROW EXECUTE FUNCTION public.hr_team_application_update_guard();
--> statement-breakpoint
CREATE TRIGGER hr_team_application_delete_guard
  BEFORE DELETE ON public.hr_team_applications
  FOR EACH ROW EXECUTE FUNCTION public.waia_admin_block_delete();
--> statement-breakpoint
CREATE TRIGGER hr_application_event_update_guard
  BEFORE UPDATE ON public.hr_application_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_admin_block_delete();
--> statement-breakpoint
CREATE TRIGGER hr_application_event_delete_guard
  BEFORE DELETE ON public.hr_application_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_admin_block_delete();
--> statement-breakpoint
ALTER TABLE public.waia_admin_module_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.hr_team_applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.hr_application_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.waia_admin_module_grants, public.hr_team_applications,
  public.hr_application_events FROM anon, authenticated;
--> statement-breakpoint
CREATE POLICY waia_admin_module_grants_deny_all
  ON public.waia_admin_module_grants FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY hr_team_applications_deny_all
  ON public.hr_team_applications FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY hr_application_events_deny_all
  ON public.hr_application_events FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_admin_grant_transition_guard() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_admin_block_delete() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hr_team_application_update_guard() FROM PUBLIC;
