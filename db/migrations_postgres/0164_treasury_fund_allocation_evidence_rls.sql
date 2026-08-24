-- DEE-690: append-only and service-only allocation evidence.

CREATE OR REPLACE FUNCTION public.waia_treasury_fund_allocation_evidence_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury_fund_allocation_evidence is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER treasury_fund_allocation_evidence_block_update
  BEFORE UPDATE ON public.treasury_fund_allocation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_fund_allocation_evidence_block_mutation();
--> statement-breakpoint
CREATE TRIGGER treasury_fund_allocation_evidence_block_delete
  BEFORE DELETE ON public.treasury_fund_allocation_evidence
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_fund_allocation_evidence_block_mutation();
--> statement-breakpoint
ALTER TABLE public.treasury_fund_allocation_evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treasury_fund_alloc_evidence_deny_authenticated_select
  ON public.treasury_fund_allocation_evidence FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_fund_alloc_evidence_deny_authenticated_insert
  ON public.treasury_fund_allocation_evidence FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_fund_alloc_evidence_deny_authenticated_update
  ON public.treasury_fund_allocation_evidence FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_fund_alloc_evidence_deny_authenticated_delete
  ON public.treasury_fund_allocation_evidence FOR DELETE TO authenticated, anon USING (false);
