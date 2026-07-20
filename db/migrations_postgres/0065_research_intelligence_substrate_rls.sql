-- RI substrate: targeted RLS deny authenticated/anon (ADR-0007).

ALTER TABLE public.trader_market_bars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_market_bars_deny_authenticated_select ON public.trader_market_bars;
CREATE POLICY trader_market_bars_deny_authenticated_select ON public.trader_market_bars FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_bars_deny_authenticated_insert ON public.trader_market_bars;
CREATE POLICY trader_market_bars_deny_authenticated_insert ON public.trader_market_bars FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_market_bars_deny_authenticated_update ON public.trader_market_bars;
CREATE POLICY trader_market_bars_deny_authenticated_update ON public.trader_market_bars FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_bars_deny_authenticated_delete ON public.trader_market_bars;
CREATE POLICY trader_market_bars_deny_authenticated_delete ON public.trader_market_bars FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_market_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_market_facts_deny_authenticated_select ON public.trader_market_facts;
CREATE POLICY trader_market_facts_deny_authenticated_select ON public.trader_market_facts FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_facts_deny_authenticated_insert ON public.trader_market_facts;
CREATE POLICY trader_market_facts_deny_authenticated_insert ON public.trader_market_facts FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_market_facts_deny_authenticated_update ON public.trader_market_facts;
CREATE POLICY trader_market_facts_deny_authenticated_update ON public.trader_market_facts FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_facts_deny_authenticated_delete ON public.trader_market_facts;
CREATE POLICY trader_market_facts_deny_authenticated_delete ON public.trader_market_facts FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.research_dataset ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS research_dataset_deny_authenticated_select ON public.research_dataset;
CREATE POLICY research_dataset_deny_authenticated_select ON public.research_dataset FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS research_dataset_deny_authenticated_insert ON public.research_dataset;
CREATE POLICY research_dataset_deny_authenticated_insert ON public.research_dataset FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS research_dataset_deny_authenticated_update ON public.research_dataset;
CREATE POLICY research_dataset_deny_authenticated_update ON public.research_dataset FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS research_dataset_deny_authenticated_delete ON public.research_dataset;
CREATE POLICY research_dataset_deny_authenticated_delete ON public.research_dataset FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_backtest_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_backtest_runs_deny_authenticated_select ON public.trader_backtest_runs;
CREATE POLICY trader_backtest_runs_deny_authenticated_select ON public.trader_backtest_runs FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_backtest_runs_deny_authenticated_insert ON public.trader_backtest_runs;
CREATE POLICY trader_backtest_runs_deny_authenticated_insert ON public.trader_backtest_runs FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_backtest_runs_deny_authenticated_update ON public.trader_backtest_runs;
CREATE POLICY trader_backtest_runs_deny_authenticated_update ON public.trader_backtest_runs FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_backtest_runs_deny_authenticated_delete ON public.trader_backtest_runs;
CREATE POLICY trader_backtest_runs_deny_authenticated_delete ON public.trader_backtest_runs FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_backtest_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_backtest_results_deny_authenticated_select ON public.trader_backtest_results;
CREATE POLICY trader_backtest_results_deny_authenticated_select ON public.trader_backtest_results FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_backtest_results_deny_authenticated_insert ON public.trader_backtest_results;
CREATE POLICY trader_backtest_results_deny_authenticated_insert ON public.trader_backtest_results FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_backtest_results_deny_authenticated_update ON public.trader_backtest_results;
CREATE POLICY trader_backtest_results_deny_authenticated_update ON public.trader_backtest_results FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_backtest_results_deny_authenticated_delete ON public.trader_backtest_results;
CREATE POLICY trader_backtest_results_deny_authenticated_delete ON public.trader_backtest_results FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_strategy_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_strategy_candidates_deny_authenticated_select ON public.trader_strategy_candidates;
CREATE POLICY trader_strategy_candidates_deny_authenticated_select ON public.trader_strategy_candidates FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_strategy_candidates_deny_authenticated_insert ON public.trader_strategy_candidates;
CREATE POLICY trader_strategy_candidates_deny_authenticated_insert ON public.trader_strategy_candidates FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_strategy_candidates_deny_authenticated_update ON public.trader_strategy_candidates;
CREATE POLICY trader_strategy_candidates_deny_authenticated_update ON public.trader_strategy_candidates FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_strategy_candidates_deny_authenticated_delete ON public.trader_strategy_candidates;
CREATE POLICY trader_strategy_candidates_deny_authenticated_delete ON public.trader_strategy_candidates FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_walk_forward_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_walk_forward_windows_deny_authenticated_select ON public.trader_walk_forward_windows;
CREATE POLICY trader_walk_forward_windows_deny_authenticated_select ON public.trader_walk_forward_windows FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_walk_forward_windows_deny_authenticated_insert ON public.trader_walk_forward_windows;
CREATE POLICY trader_walk_forward_windows_deny_authenticated_insert ON public.trader_walk_forward_windows FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_walk_forward_windows_deny_authenticated_update ON public.trader_walk_forward_windows;
CREATE POLICY trader_walk_forward_windows_deny_authenticated_update ON public.trader_walk_forward_windows FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_walk_forward_windows_deny_authenticated_delete ON public.trader_walk_forward_windows;
CREATE POLICY trader_walk_forward_windows_deny_authenticated_delete ON public.trader_walk_forward_windows FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_blind_validation_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_blind_validation_results_deny_authenticated_select ON public.trader_blind_validation_results;
CREATE POLICY trader_blind_validation_results_deny_authenticated_select ON public.trader_blind_validation_results FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_blind_validation_results_deny_authenticated_insert ON public.trader_blind_validation_results;
CREATE POLICY trader_blind_validation_results_deny_authenticated_insert ON public.trader_blind_validation_results FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_blind_validation_results_deny_authenticated_update ON public.trader_blind_validation_results;
CREATE POLICY trader_blind_validation_results_deny_authenticated_update ON public.trader_blind_validation_results FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_blind_validation_results_deny_authenticated_delete ON public.trader_blind_validation_results;
CREATE POLICY trader_blind_validation_results_deny_authenticated_delete ON public.trader_blind_validation_results FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_market_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_market_events_deny_authenticated_select ON public.trader_market_events;
CREATE POLICY trader_market_events_deny_authenticated_select ON public.trader_market_events FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_events_deny_authenticated_insert ON public.trader_market_events;
CREATE POLICY trader_market_events_deny_authenticated_insert ON public.trader_market_events FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_market_events_deny_authenticated_update ON public.trader_market_events;
CREATE POLICY trader_market_events_deny_authenticated_update ON public.trader_market_events FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_events_deny_authenticated_delete ON public.trader_market_events;
CREATE POLICY trader_market_events_deny_authenticated_delete ON public.trader_market_events FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_knowledge_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_knowledge_edges_deny_authenticated_select ON public.trader_knowledge_edges;
CREATE POLICY trader_knowledge_edges_deny_authenticated_select ON public.trader_knowledge_edges FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_knowledge_edges_deny_authenticated_insert ON public.trader_knowledge_edges;
CREATE POLICY trader_knowledge_edges_deny_authenticated_insert ON public.trader_knowledge_edges FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_knowledge_edges_deny_authenticated_update ON public.trader_knowledge_edges;
CREATE POLICY trader_knowledge_edges_deny_authenticated_update ON public.trader_knowledge_edges FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_knowledge_edges_deny_authenticated_delete ON public.trader_knowledge_edges;
CREATE POLICY trader_knowledge_edges_deny_authenticated_delete ON public.trader_knowledge_edges FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_market_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_market_predictions_deny_authenticated_select ON public.trader_market_predictions;
CREATE POLICY trader_market_predictions_deny_authenticated_select ON public.trader_market_predictions FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_predictions_deny_authenticated_insert ON public.trader_market_predictions;
CREATE POLICY trader_market_predictions_deny_authenticated_insert ON public.trader_market_predictions FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_market_predictions_deny_authenticated_update ON public.trader_market_predictions;
CREATE POLICY trader_market_predictions_deny_authenticated_update ON public.trader_market_predictions FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_predictions_deny_authenticated_delete ON public.trader_market_predictions;
CREATE POLICY trader_market_predictions_deny_authenticated_delete ON public.trader_market_predictions FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_operator_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_operator_audit_deny_authenticated_select ON public.trader_operator_audit;
CREATE POLICY trader_operator_audit_deny_authenticated_select ON public.trader_operator_audit FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_operator_audit_deny_authenticated_insert ON public.trader_operator_audit;
CREATE POLICY trader_operator_audit_deny_authenticated_insert ON public.trader_operator_audit FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_operator_audit_deny_authenticated_update ON public.trader_operator_audit;
CREATE POLICY trader_operator_audit_deny_authenticated_update ON public.trader_operator_audit FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_operator_audit_deny_authenticated_delete ON public.trader_operator_audit;
CREATE POLICY trader_operator_audit_deny_authenticated_delete ON public.trader_operator_audit FOR DELETE TO authenticated, anon USING (false);
