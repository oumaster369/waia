-- WC-E5/E6: audit_logs immutability + targeted RLS (ADR-0007 defense-in-depth, ADR-0011 governance).
-- Contract: "insert-only for services, select-only for admins; no update/delete for anyone."
-- Application-layer enforcement remains primary; the trigger + policies are additive backstops.

-- 1. Append-only enforcement for EVERY role (including service/owner/BYPASSRLS).
--    RLS policies alone are bypassed by privileged roles, so a trigger is the real guarantee.
CREATE OR REPLACE FUNCTION public.waia_audit_logs_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_block_update ON public.audit_logs;
CREATE TRIGGER audit_logs_block_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.waia_audit_logs_block_mutation();

DROP TRIGGER IF EXISTS audit_logs_block_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_block_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.waia_audit_logs_block_mutation();

-- 2. Targeted RLS as defense-in-depth for the application (authenticated/anon) roles.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Deny update/delete for every RLS-subject role (the trigger covers privileged roles too).
DROP POLICY IF EXISTS audit_logs_deny_update ON public.audit_logs;
CREATE POLICY audit_logs_deny_update ON public.audit_logs
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS audit_logs_deny_delete ON public.audit_logs;
CREATE POLICY audit_logs_deny_delete ON public.audit_logs
  FOR DELETE
  USING (false);

-- Authenticated/anon users may not insert directly (writes go through the service layer).
DROP POLICY IF EXISTS audit_logs_deny_authenticated_insert ON public.audit_logs;
CREATE POLICY audit_logs_deny_authenticated_insert ON public.audit_logs
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

-- Authenticated/anon users cannot select audit rows directly (admin reads via service layer).
DROP POLICY IF EXISTS audit_logs_deny_authenticated_select ON public.audit_logs;
CREATE POLICY audit_logs_deny_authenticated_select ON public.audit_logs
  FOR SELECT
  TO authenticated, anon
  USING (false);
