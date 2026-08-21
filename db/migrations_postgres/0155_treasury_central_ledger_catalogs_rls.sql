ALTER TABLE public.treasury_counterparties ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treasury_counterparties_deny_authenticated_select ON public.treasury_counterparties FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_counterparties_deny_authenticated_insert ON public.treasury_counterparties FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_counterparties_deny_authenticated_update ON public.treasury_counterparties FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_counterparties_deny_authenticated_delete ON public.treasury_counterparties FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treasury_accounts_deny_authenticated_select ON public.treasury_accounts FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_accounts_deny_authenticated_insert ON public.treasury_accounts FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_accounts_deny_authenticated_update ON public.treasury_accounts FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_accounts_deny_authenticated_delete ON public.treasury_accounts FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treasury_categories_deny_authenticated_select ON public.treasury_categories FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_categories_deny_authenticated_insert ON public.treasury_categories FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_categories_deny_authenticated_update ON public.treasury_categories FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_categories_deny_authenticated_delete ON public.treasury_categories FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY treasury_projects_deny_authenticated_select ON public.treasury_projects FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_projects_deny_authenticated_insert ON public.treasury_projects FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY treasury_projects_deny_authenticated_update ON public.treasury_projects FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY treasury_projects_deny_authenticated_delete ON public.treasury_projects FOR DELETE TO authenticated, anon USING (false);
