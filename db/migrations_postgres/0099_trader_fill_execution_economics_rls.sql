-- DEE-415 / HTR-WP17: trader_fill_execution_economics RLS + append-only (ADR-0007)

ALTER TABLE public.trader_fill_execution_economics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_fill_execution_economics_deny_authenticated_select ON public.trader_fill_execution_economics;
CREATE POLICY trader_fill_execution_economics_deny_authenticated_select ON public.trader_fill_execution_economics FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_fill_execution_economics_deny_authenticated_insert ON public.trader_fill_execution_economics;
CREATE POLICY trader_fill_execution_economics_deny_authenticated_insert ON public.trader_fill_execution_economics FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_fill_execution_economics_deny_authenticated_update ON public.trader_fill_execution_economics;
CREATE POLICY trader_fill_execution_economics_deny_authenticated_update ON public.trader_fill_execution_economics FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_fill_execution_economics_deny_authenticated_delete ON public.trader_fill_execution_economics;
CREATE POLICY trader_fill_execution_economics_deny_authenticated_delete ON public.trader_fill_execution_economics FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_trader_fill_execution_economics_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_fill_execution_economics is append-only';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS waia_trader_fill_execution_economics_block_update ON public.trader_fill_execution_economics;
CREATE TRIGGER waia_trader_fill_execution_economics_block_update
  BEFORE UPDATE ON public.trader_fill_execution_economics
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_fill_execution_economics_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS waia_trader_fill_execution_economics_block_delete ON public.trader_fill_execution_economics;
CREATE TRIGGER waia_trader_fill_execution_economics_block_delete
  BEFORE DELETE ON public.trader_fill_execution_economics
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_fill_execution_economics_block_mutation();
