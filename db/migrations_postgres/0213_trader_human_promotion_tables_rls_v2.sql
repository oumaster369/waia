-- DEE-1049: deny authenticated and anon on human promotion tables

ALTER TABLE public.trader_human_promotion_proposal_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_promotion_proposal_v2_deny_authenticated_select ON public.trader_human_promotion_proposal_v2;
--> statement-breakpoint
CREATE POLICY trader_human_promotion_proposal_v2_deny_authenticated_select ON public.trader_human_promotion_proposal_v2 FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_promotion_proposal_v2_deny_authenticated_insert ON public.trader_human_promotion_proposal_v2;
--> statement-breakpoint
CREATE POLICY trader_human_promotion_proposal_v2_deny_authenticated_insert ON public.trader_human_promotion_proposal_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_promotion_proposal_v2_deny_authenticated_update ON public.trader_human_promotion_proposal_v2;
--> statement-breakpoint
CREATE POLICY trader_human_promotion_proposal_v2_deny_authenticated_update ON public.trader_human_promotion_proposal_v2 FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_promotion_proposal_v2_deny_authenticated_delete ON public.trader_human_promotion_proposal_v2;
--> statement-breakpoint
CREATE POLICY trader_human_promotion_proposal_v2_deny_authenticated_delete ON public.trader_human_promotion_proposal_v2 FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_human_research_assignment_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_research_assignment_v2_deny_authenticated_select ON public.trader_human_research_assignment_v2;
--> statement-breakpoint
CREATE POLICY trader_human_research_assignment_v2_deny_authenticated_select ON public.trader_human_research_assignment_v2 FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_research_assignment_v2_deny_authenticated_insert ON public.trader_human_research_assignment_v2;
--> statement-breakpoint
CREATE POLICY trader_human_research_assignment_v2_deny_authenticated_insert ON public.trader_human_research_assignment_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_research_assignment_v2_deny_authenticated_update ON public.trader_human_research_assignment_v2;
--> statement-breakpoint
CREATE POLICY trader_human_research_assignment_v2_deny_authenticated_update ON public.trader_human_research_assignment_v2 FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_human_research_assignment_v2_deny_authenticated_delete ON public.trader_human_research_assignment_v2;
--> statement-breakpoint
CREATE POLICY trader_human_research_assignment_v2_deny_authenticated_delete ON public.trader_human_research_assignment_v2 FOR DELETE TO authenticated, anon USING (false);
