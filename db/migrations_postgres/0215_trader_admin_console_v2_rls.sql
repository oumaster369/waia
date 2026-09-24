-- DEE-1050: deny authenticated and anon on admin console tables
--> statement-breakpoint
ALTER TABLE public.trader_admin_market_quote_latest ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_latest_deny_authenticated_select ON public.trader_admin_market_quote_latest;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_latest_deny_authenticated_select ON public.trader_admin_market_quote_latest FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_latest_deny_authenticated_insert ON public.trader_admin_market_quote_latest;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_latest_deny_authenticated_insert ON public.trader_admin_market_quote_latest FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_latest_deny_authenticated_update ON public.trader_admin_market_quote_latest;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_latest_deny_authenticated_update ON public.trader_admin_market_quote_latest FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_latest_deny_authenticated_delete ON public.trader_admin_market_quote_latest;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_latest_deny_authenticated_delete ON public.trader_admin_market_quote_latest FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_market_quote_minute ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_minute_deny_authenticated_select ON public.trader_admin_market_quote_minute;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_minute_deny_authenticated_select ON public.trader_admin_market_quote_minute FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_minute_deny_authenticated_insert ON public.trader_admin_market_quote_minute;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_minute_deny_authenticated_insert ON public.trader_admin_market_quote_minute FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_minute_deny_authenticated_update ON public.trader_admin_market_quote_minute;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_minute_deny_authenticated_update ON public.trader_admin_market_quote_minute FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_market_quote_minute_deny_authenticated_delete ON public.trader_admin_market_quote_minute;
--> statement-breakpoint
CREATE POLICY trader_admin_market_quote_minute_deny_authenticated_delete ON public.trader_admin_market_quote_minute FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_fear_greed ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_fear_greed_deny_authenticated_select ON public.trader_admin_fear_greed;
--> statement-breakpoint
CREATE POLICY trader_admin_fear_greed_deny_authenticated_select ON public.trader_admin_fear_greed FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_fear_greed_deny_authenticated_insert ON public.trader_admin_fear_greed;
--> statement-breakpoint
CREATE POLICY trader_admin_fear_greed_deny_authenticated_insert ON public.trader_admin_fear_greed FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_fear_greed_deny_authenticated_update ON public.trader_admin_fear_greed;
--> statement-breakpoint
CREATE POLICY trader_admin_fear_greed_deny_authenticated_update ON public.trader_admin_fear_greed FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_fear_greed_deny_authenticated_delete ON public.trader_admin_fear_greed;
--> statement-breakpoint
CREATE POLICY trader_admin_fear_greed_deny_authenticated_delete ON public.trader_admin_fear_greed FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_change_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_change_log_deny_authenticated_select ON public.trader_admin_change_log;
--> statement-breakpoint
CREATE POLICY trader_admin_change_log_deny_authenticated_select ON public.trader_admin_change_log FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_change_log_deny_authenticated_insert ON public.trader_admin_change_log;
--> statement-breakpoint
CREATE POLICY trader_admin_change_log_deny_authenticated_insert ON public.trader_admin_change_log FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_change_log_deny_authenticated_update ON public.trader_admin_change_log;
--> statement-breakpoint
CREATE POLICY trader_admin_change_log_deny_authenticated_update ON public.trader_admin_change_log FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_change_log_deny_authenticated_delete ON public.trader_admin_change_log;
--> statement-breakpoint
CREATE POLICY trader_admin_change_log_deny_authenticated_delete ON public.trader_admin_change_log FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_news_item ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_deny_authenticated_select ON public.trader_admin_news_item;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_deny_authenticated_select ON public.trader_admin_news_item FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_deny_authenticated_insert ON public.trader_admin_news_item;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_deny_authenticated_insert ON public.trader_admin_news_item FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_deny_authenticated_update ON public.trader_admin_news_item;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_deny_authenticated_update ON public.trader_admin_news_item FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_deny_authenticated_delete ON public.trader_admin_news_item;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_deny_authenticated_delete ON public.trader_admin_news_item FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_news_item_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_version_deny_authenticated_select ON public.trader_admin_news_item_version;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_version_deny_authenticated_select ON public.trader_admin_news_item_version FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_version_deny_authenticated_insert ON public.trader_admin_news_item_version;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_version_deny_authenticated_insert ON public.trader_admin_news_item_version FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_version_deny_authenticated_update ON public.trader_admin_news_item_version;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_version_deny_authenticated_update ON public.trader_admin_news_item_version FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_news_item_version_deny_authenticated_delete ON public.trader_admin_news_item_version;
--> statement-breakpoint
CREATE POLICY trader_admin_news_item_version_deny_authenticated_delete ON public.trader_admin_news_item_version FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_account_valuation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_account_valuation_deny_authenticated_select ON public.trader_admin_account_valuation;
--> statement-breakpoint
CREATE POLICY trader_admin_account_valuation_deny_authenticated_select ON public.trader_admin_account_valuation FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_account_valuation_deny_authenticated_insert ON public.trader_admin_account_valuation;
--> statement-breakpoint
CREATE POLICY trader_admin_account_valuation_deny_authenticated_insert ON public.trader_admin_account_valuation FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_account_valuation_deny_authenticated_update ON public.trader_admin_account_valuation;
--> statement-breakpoint
CREATE POLICY trader_admin_account_valuation_deny_authenticated_update ON public.trader_admin_account_valuation FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_account_valuation_deny_authenticated_delete ON public.trader_admin_account_valuation;
--> statement-breakpoint
CREATE POLICY trader_admin_account_valuation_deny_authenticated_delete ON public.trader_admin_account_valuation FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_equity_point ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_equity_point_deny_authenticated_select ON public.trader_admin_equity_point;
--> statement-breakpoint
CREATE POLICY trader_admin_equity_point_deny_authenticated_select ON public.trader_admin_equity_point FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_equity_point_deny_authenticated_insert ON public.trader_admin_equity_point;
--> statement-breakpoint
CREATE POLICY trader_admin_equity_point_deny_authenticated_insert ON public.trader_admin_equity_point FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_equity_point_deny_authenticated_update ON public.trader_admin_equity_point;
--> statement-breakpoint
CREATE POLICY trader_admin_equity_point_deny_authenticated_update ON public.trader_admin_equity_point FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_equity_point_deny_authenticated_delete ON public.trader_admin_equity_point;
--> statement-breakpoint
CREATE POLICY trader_admin_equity_point_deny_authenticated_delete ON public.trader_admin_equity_point FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_diagnostic_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_diagnostic_event_deny_authenticated_select ON public.trader_admin_diagnostic_event;
--> statement-breakpoint
CREATE POLICY trader_admin_diagnostic_event_deny_authenticated_select ON public.trader_admin_diagnostic_event FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_diagnostic_event_deny_authenticated_insert ON public.trader_admin_diagnostic_event;
--> statement-breakpoint
CREATE POLICY trader_admin_diagnostic_event_deny_authenticated_insert ON public.trader_admin_diagnostic_event FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_diagnostic_event_deny_authenticated_update ON public.trader_admin_diagnostic_event;
--> statement-breakpoint
CREATE POLICY trader_admin_diagnostic_event_deny_authenticated_update ON public.trader_admin_diagnostic_event FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_diagnostic_event_deny_authenticated_delete ON public.trader_admin_diagnostic_event;
--> statement-breakpoint
CREATE POLICY trader_admin_diagnostic_event_deny_authenticated_delete ON public.trader_admin_diagnostic_event FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_incident ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_deny_authenticated_select ON public.trader_admin_incident;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_deny_authenticated_select ON public.trader_admin_incident FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_deny_authenticated_insert ON public.trader_admin_incident;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_deny_authenticated_insert ON public.trader_admin_incident FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_deny_authenticated_update ON public.trader_admin_incident;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_deny_authenticated_update ON public.trader_admin_incident FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_deny_authenticated_delete ON public.trader_admin_incident;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_deny_authenticated_delete ON public.trader_admin_incident FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_incident_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_event_deny_authenticated_select ON public.trader_admin_incident_event;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_event_deny_authenticated_select ON public.trader_admin_incident_event FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_event_deny_authenticated_insert ON public.trader_admin_incident_event;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_event_deny_authenticated_insert ON public.trader_admin_incident_event FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_event_deny_authenticated_update ON public.trader_admin_incident_event;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_event_deny_authenticated_update ON public.trader_admin_incident_event FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_incident_event_deny_authenticated_delete ON public.trader_admin_incident_event;
--> statement-breakpoint
CREATE POLICY trader_admin_incident_event_deny_authenticated_delete ON public.trader_admin_incident_event FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_job_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_job_run_deny_authenticated_select ON public.trader_admin_job_run;
--> statement-breakpoint
CREATE POLICY trader_admin_job_run_deny_authenticated_select ON public.trader_admin_job_run FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_job_run_deny_authenticated_insert ON public.trader_admin_job_run;
--> statement-breakpoint
CREATE POLICY trader_admin_job_run_deny_authenticated_insert ON public.trader_admin_job_run FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_job_run_deny_authenticated_update ON public.trader_admin_job_run;
--> statement-breakpoint
CREATE POLICY trader_admin_job_run_deny_authenticated_update ON public.trader_admin_job_run FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_job_run_deny_authenticated_delete ON public.trader_admin_job_run;
--> statement-breakpoint
CREATE POLICY trader_admin_job_run_deny_authenticated_delete ON public.trader_admin_job_run FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_assistant_conversation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_conversation_deny_authenticated_select ON public.trader_admin_assistant_conversation;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_conversation_deny_authenticated_select ON public.trader_admin_assistant_conversation FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_conversation_deny_authenticated_insert ON public.trader_admin_assistant_conversation;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_conversation_deny_authenticated_insert ON public.trader_admin_assistant_conversation FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_conversation_deny_authenticated_update ON public.trader_admin_assistant_conversation;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_conversation_deny_authenticated_update ON public.trader_admin_assistant_conversation FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_conversation_deny_authenticated_delete ON public.trader_admin_assistant_conversation;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_conversation_deny_authenticated_delete ON public.trader_admin_assistant_conversation FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_assistant_message ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_message_deny_authenticated_select ON public.trader_admin_assistant_message;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_message_deny_authenticated_select ON public.trader_admin_assistant_message FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_message_deny_authenticated_insert ON public.trader_admin_assistant_message;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_message_deny_authenticated_insert ON public.trader_admin_assistant_message FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_message_deny_authenticated_update ON public.trader_admin_assistant_message;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_message_deny_authenticated_update ON public.trader_admin_assistant_message FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_message_deny_authenticated_delete ON public.trader_admin_assistant_message;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_message_deny_authenticated_delete ON public.trader_admin_assistant_message FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_assistant_tool_call ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_tool_call_deny_authenticated_select ON public.trader_admin_assistant_tool_call;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_tool_call_deny_authenticated_select ON public.trader_admin_assistant_tool_call FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_tool_call_deny_authenticated_insert ON public.trader_admin_assistant_tool_call;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_tool_call_deny_authenticated_insert ON public.trader_admin_assistant_tool_call FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_tool_call_deny_authenticated_update ON public.trader_admin_assistant_tool_call;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_tool_call_deny_authenticated_update ON public.trader_admin_assistant_tool_call FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_assistant_tool_call_deny_authenticated_delete ON public.trader_admin_assistant_tool_call;
--> statement-breakpoint
CREATE POLICY trader_admin_assistant_tool_call_deny_authenticated_delete ON public.trader_admin_assistant_tool_call FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_saved_view ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_saved_view_deny_authenticated_select ON public.trader_admin_saved_view;
--> statement-breakpoint
CREATE POLICY trader_admin_saved_view_deny_authenticated_select ON public.trader_admin_saved_view FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_saved_view_deny_authenticated_insert ON public.trader_admin_saved_view;
--> statement-breakpoint
CREATE POLICY trader_admin_saved_view_deny_authenticated_insert ON public.trader_admin_saved_view FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_saved_view_deny_authenticated_update ON public.trader_admin_saved_view;
--> statement-breakpoint
CREATE POLICY trader_admin_saved_view_deny_authenticated_update ON public.trader_admin_saved_view FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_saved_view_deny_authenticated_delete ON public.trader_admin_saved_view;
--> statement-breakpoint
CREATE POLICY trader_admin_saved_view_deny_authenticated_delete ON public.trader_admin_saved_view FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
ALTER TABLE public.trader_admin_visit_marker ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_visit_marker_deny_authenticated_select ON public.trader_admin_visit_marker;
--> statement-breakpoint
CREATE POLICY trader_admin_visit_marker_deny_authenticated_select ON public.trader_admin_visit_marker FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_visit_marker_deny_authenticated_insert ON public.trader_admin_visit_marker;
--> statement-breakpoint
CREATE POLICY trader_admin_visit_marker_deny_authenticated_insert ON public.trader_admin_visit_marker FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_visit_marker_deny_authenticated_update ON public.trader_admin_visit_marker;
--> statement-breakpoint
CREATE POLICY trader_admin_visit_marker_deny_authenticated_update ON public.trader_admin_visit_marker FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_admin_visit_marker_deny_authenticated_delete ON public.trader_admin_visit_marker;
--> statement-breakpoint
CREATE POLICY trader_admin_visit_marker_deny_authenticated_delete ON public.trader_admin_visit_marker FOR DELETE TO authenticated, anon USING (false);
