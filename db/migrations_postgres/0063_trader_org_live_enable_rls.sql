-- DEE-212 / BP-7: org live-enable append-only triggers + RLS (ADR-0007).

CREATE OR REPLACE FUNCTION public.waia_trader_org_live_enable_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_org_live_enable_events is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trader_org_live_enable_events_block_update ON public.trader_org_live_enable_events;
CREATE TRIGGER trader_org_live_enable_events_block_update
  BEFORE UPDATE ON public.trader_org_live_enable_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_org_live_enable_events_block_mutation();

DROP TRIGGER IF EXISTS trader_org_live_enable_events_block_delete ON public.trader_org_live_enable_events;
CREATE TRIGGER trader_org_live_enable_events_block_delete
  BEFORE DELETE ON public.trader_org_live_enable_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_org_live_enable_events_block_mutation();

ALTER TABLE public.trader_org_live_enable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_org_live_enable_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_org_live_enable_deny_authenticated_select ON public.trader_org_live_enable;
CREATE POLICY trader_org_live_enable_deny_authenticated_select ON public.trader_org_live_enable
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_org_live_enable_deny_authenticated_insert ON public.trader_org_live_enable;
CREATE POLICY trader_org_live_enable_deny_authenticated_insert ON public.trader_org_live_enable
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_org_live_enable_deny_authenticated_update ON public.trader_org_live_enable;
CREATE POLICY trader_org_live_enable_deny_authenticated_update ON public.trader_org_live_enable
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_org_live_enable_deny_authenticated_delete ON public.trader_org_live_enable;
CREATE POLICY trader_org_live_enable_deny_authenticated_delete ON public.trader_org_live_enable
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_org_live_enable_events_deny_authenticated_select ON public.trader_org_live_enable_events;
CREATE POLICY trader_org_live_enable_events_deny_authenticated_select ON public.trader_org_live_enable_events
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_org_live_enable_events_deny_authenticated_insert ON public.trader_org_live_enable_events;
CREATE POLICY trader_org_live_enable_events_deny_authenticated_insert ON public.trader_org_live_enable_events
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_org_live_enable_events_deny_authenticated_update ON public.trader_org_live_enable_events;
CREATE POLICY trader_org_live_enable_events_deny_authenticated_update ON public.trader_org_live_enable_events
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_org_live_enable_events_deny_authenticated_delete ON public.trader_org_live_enable_events;
CREATE POLICY trader_org_live_enable_events_deny_authenticated_delete ON public.trader_org_live_enable_events
  FOR DELETE TO authenticated, anon USING (false);
