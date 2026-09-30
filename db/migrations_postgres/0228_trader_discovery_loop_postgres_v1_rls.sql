-- DEE-1152 step 2: deny authenticated and anon on discovery admission tables.
--> statement-breakpoint
ALTER TABLE public.trader_strategy_admission_family ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_family_deny_authenticated_select ON public.trader_strategy_admission_family;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_family_deny_authenticated_select ON public.trader_strategy_admission_family FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_family_deny_authenticated_insert ON public.trader_strategy_admission_family;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_family_deny_authenticated_insert ON public.trader_strategy_admission_family FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_family_deny_authenticated_update ON public.trader_strategy_admission_family;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_family_deny_authenticated_update ON public.trader_strategy_admission_family FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_family_deny_authenticated_delete ON public.trader_strategy_admission_family;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_family_deny_authenticated_delete ON public.trader_strategy_admission_family FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_strategy_admission_journal ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_journal_deny_authenticated_select ON public.trader_strategy_admission_journal;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_journal_deny_authenticated_select ON public.trader_strategy_admission_journal FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_journal_deny_authenticated_insert ON public.trader_strategy_admission_journal;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_journal_deny_authenticated_insert ON public.trader_strategy_admission_journal FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_journal_deny_authenticated_update ON public.trader_strategy_admission_journal;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_journal_deny_authenticated_update ON public.trader_strategy_admission_journal FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_journal_deny_authenticated_delete ON public.trader_strategy_admission_journal;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_journal_deny_authenticated_delete ON public.trader_strategy_admission_journal FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_strategy_admission_split_consume ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_split_consume_deny_authenticated_select ON public.trader_strategy_admission_split_consume;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_split_consume_deny_authenticated_select ON public.trader_strategy_admission_split_consume FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_split_consume_deny_authenticated_insert ON public.trader_strategy_admission_split_consume;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_split_consume_deny_authenticated_insert ON public.trader_strategy_admission_split_consume FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_split_consume_deny_authenticated_update ON public.trader_strategy_admission_split_consume;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_split_consume_deny_authenticated_update ON public.trader_strategy_admission_split_consume FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_strategy_admission_split_consume_deny_authenticated_delete ON public.trader_strategy_admission_split_consume;
--> statement-breakpoint
CREATE POLICY trader_strategy_admission_split_consume_deny_authenticated_delete ON public.trader_strategy_admission_split_consume FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_dee540_bar_consumption ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_dee540_bar_consumption_deny_authenticated_select ON public.trader_dee540_bar_consumption;
--> statement-breakpoint
CREATE POLICY trader_dee540_bar_consumption_deny_authenticated_select ON public.trader_dee540_bar_consumption FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_dee540_bar_consumption_deny_authenticated_insert ON public.trader_dee540_bar_consumption;
--> statement-breakpoint
CREATE POLICY trader_dee540_bar_consumption_deny_authenticated_insert ON public.trader_dee540_bar_consumption FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_dee540_bar_consumption_deny_authenticated_update ON public.trader_dee540_bar_consumption;
--> statement-breakpoint
CREATE POLICY trader_dee540_bar_consumption_deny_authenticated_update ON public.trader_dee540_bar_consumption FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_dee540_bar_consumption_deny_authenticated_delete ON public.trader_dee540_bar_consumption;
--> statement-breakpoint
CREATE POLICY trader_dee540_bar_consumption_deny_authenticated_delete ON public.trader_dee540_bar_consumption FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_discovery_loop_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_run_deny_authenticated_select ON public.trader_discovery_loop_run;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_run_deny_authenticated_select ON public.trader_discovery_loop_run FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_run_deny_authenticated_insert ON public.trader_discovery_loop_run;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_run_deny_authenticated_insert ON public.trader_discovery_loop_run FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_run_deny_authenticated_update ON public.trader_discovery_loop_run;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_run_deny_authenticated_update ON public.trader_discovery_loop_run FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_run_deny_authenticated_delete ON public.trader_discovery_loop_run;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_run_deny_authenticated_delete ON public.trader_discovery_loop_run FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_discovery_loop_trial ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_trial_deny_authenticated_select ON public.trader_discovery_loop_trial;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_trial_deny_authenticated_select ON public.trader_discovery_loop_trial FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_trial_deny_authenticated_insert ON public.trader_discovery_loop_trial;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_trial_deny_authenticated_insert ON public.trader_discovery_loop_trial FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_trial_deny_authenticated_update ON public.trader_discovery_loop_trial;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_trial_deny_authenticated_update ON public.trader_discovery_loop_trial FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_trial_deny_authenticated_delete ON public.trader_discovery_loop_trial;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_trial_deny_authenticated_delete ON public.trader_discovery_loop_trial FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_discovery_loop_verdict ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_verdict_deny_authenticated_select ON public.trader_discovery_loop_verdict;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_verdict_deny_authenticated_select ON public.trader_discovery_loop_verdict FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_verdict_deny_authenticated_insert ON public.trader_discovery_loop_verdict;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_verdict_deny_authenticated_insert ON public.trader_discovery_loop_verdict FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_verdict_deny_authenticated_update ON public.trader_discovery_loop_verdict;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_verdict_deny_authenticated_update ON public.trader_discovery_loop_verdict FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_discovery_loop_verdict_deny_authenticated_delete ON public.trader_discovery_loop_verdict;
--> statement-breakpoint
CREATE POLICY trader_discovery_loop_verdict_deny_authenticated_delete ON public.trader_discovery_loop_verdict FOR DELETE TO authenticated, anon USING (false);
