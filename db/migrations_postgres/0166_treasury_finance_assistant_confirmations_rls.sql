-- DEE-705: append-only, service-only Finance Assistant confirmation receipts.

CREATE OR REPLACE FUNCTION public.waia_treasury_finance_assistant_confirmation_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury_finance_assistant_confirmations is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER treasury_finance_assistant_confirmation_block_update
  BEFORE UPDATE ON public.treasury_finance_assistant_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_finance_assistant_confirmation_block_mutation();
--> statement-breakpoint
CREATE TRIGGER treasury_finance_assistant_confirmation_block_delete
  BEFORE DELETE ON public.treasury_finance_assistant_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_finance_assistant_confirmation_block_mutation();
--> statement-breakpoint
ALTER TABLE public.treasury_finance_assistant_confirmations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.treasury_finance_assistant_confirmations FROM anon, authenticated;
--> statement-breakpoint
CREATE POLICY treasury_fin_asst_confirm_deny_select
  ON public.treasury_finance_assistant_confirmations FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_fin_asst_confirm_deny_insert
  ON public.treasury_finance_assistant_confirmations FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_fin_asst_confirm_deny_update
  ON public.treasury_finance_assistant_confirmations FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_fin_asst_confirm_deny_delete
  ON public.treasury_finance_assistant_confirmations FOR DELETE TO authenticated, anon USING (false);
