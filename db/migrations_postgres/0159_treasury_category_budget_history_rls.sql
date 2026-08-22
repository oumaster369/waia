ALTER TABLE public.treasury_category_budget_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treasury_category_budget_history_deny_authenticated_select ON public.treasury_category_budget_history FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_category_budget_history_deny_authenticated_insert ON public.treasury_category_budget_history FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_category_budget_history_deny_authenticated_update ON public.treasury_category_budget_history FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_category_budget_history_deny_authenticated_delete ON public.treasury_category_budget_history FOR DELETE TO authenticated, anon USING (false);
