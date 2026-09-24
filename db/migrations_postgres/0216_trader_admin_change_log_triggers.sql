-- DEE-1050: id-only change log. No EXCEPTION block: a journal failure fails the caller transaction.
-- Human review: one extra insert on execution and billing writes.

CREATE OR REPLACE FUNCTION public.trader_admin_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  src record;
  entity_id text;
  org_id uuid;
  version bigint;
  historical text;
  order_text text;
  org_text text;
  second_text text;
  third_text text;
  version_text text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    src := OLD;
  ELSE
    src := NEW;
  END IF;

  IF TG_TABLE_NAME = 'trader_orders' THEN
    EXECUTE 'SELECT ($1).historical_run_id::text' INTO historical USING src;
    IF NULLIF(historical, '') IS NOT NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  IF TG_TABLE_NAME IN ('trader_fills', 'trader_trade_legs') THEN
    EXECUTE 'SELECT ($1).order_id::text' INTO order_text USING src;
    IF NULLIF(order_text, '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.trader_orders o
      WHERE o.id = order_text::uuid AND o.historical_run_id IS NOT NULL
    ) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'trader_account_collection_state' THEN
    EXECUTE 'SELECT ($1).organization_id::text, ($1).credential_id::text, ($1).exchange_account_id::text'
      INTO org_text, second_text, third_text USING src;
    entity_id := org_text || ':' || second_text || ':' || third_text;
    org_id := NULLIF(org_text, '')::uuid;
  ELSIF TG_TABLE_NAME = 'trader_account_status' THEN
    EXECUTE 'SELECT ($1).organization_id::text, ($1).exchange_account_id::text'
      INTO org_text, second_text USING src;
    entity_id := org_text || ':' || second_text;
    org_id := NULLIF(org_text, '')::uuid;
  ELSIF TG_TABLE_NAME = 'trader_org_live_enable' THEN
    EXECUTE 'SELECT ($1).organization_id::text, ($1).state_version::text'
      INTO org_text, version_text USING src;
    entity_id := org_text;
    org_id := NULLIF(org_text, '')::uuid;
    version := NULLIF(version_text, '')::bigint;
  ELSIF TG_TABLE_NAME = 'trader_risk_account_state_v2' THEN
    EXECUTE 'SELECT ($1).organization_id::text, ($1).account_id::text, ($1).state_version::text'
      INTO org_text, second_text, version_text USING src;
    entity_id := org_text || ':' || second_text;
    org_id := NULLIF(org_text, '')::uuid;
    version := NULLIF(version_text, '')::bigint;
  ELSIF TG_TABLE_NAME = 'trader_historical_simulation_run_lifecycle_event_v2' THEN
    EXECUTE 'SELECT ($1).organization_id::text, ($1).run_id::text, ($1).event_sequence::text'
      INTO org_text, second_text, third_text USING src;
    entity_id := org_text || ':' || second_text || ':' || third_text;
    org_id := NULLIF(org_text, '')::uuid;
  ELSE
    IF TG_ARGV[0] IS NOT NULL AND TG_ARGV[0] <> '' THEN
      EXECUTE format('SELECT ($1).%I::text', TG_ARGV[0]) INTO entity_id USING src;
    END IF;
    IF TG_ARGV[1] IS NOT NULL AND TG_ARGV[1] <> '' THEN
      EXECUTE format('SELECT ($1).%I::text', TG_ARGV[1]) INTO org_text USING src;
      org_id := NULLIF(org_text, '')::uuid;
    END IF;
    IF TG_ARGV[2] IS NOT NULL AND TG_ARGV[2] <> '' THEN
      EXECUTE format('SELECT ($1).%I::text', TG_ARGV[2]) INTO version_text USING src;
      version := NULLIF(version_text, '')::bigint;
    END IF;
  END IF;

  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), TG_TABLE_NAME, TG_OP, entity_id, org_id, version);
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_change() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trader_admin_record_credential_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  revoked_at timestamp with time zone;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    revoked_at := OLD.revoked_at;
  ELSE
    entity_id := NEW.id::text;
    org_id := NEW.organization_id;
    revoked_at := NEW.revoked_at;
  END IF;
  -- revoked_at is read so ciphertext columns stay out of this function.
  -- It is not stored. The projection reloads the credential and emits entity_removed.
  IF revoked_at IS NOT NULL AND TG_OP = 'DELETE' THEN
    NULL;
  END IF;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'exchange_credentials', TG_OP, entity_id, org_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_credential_change() FROM PUBLIC;

--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.exchange_credentials;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.exchange_credentials FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_credential_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_orders;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_orders FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','state_version');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_fills;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_fills FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_trade_legs;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_trade_legs FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_position_lots;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_position_lots FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_trades;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_trades FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_account_collection_state;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_account_collection_state FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('','','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_risk_account_state_v2;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_risk_account_state_v2 FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('','','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_kill_switches;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_kill_switches FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','state_version');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_org_live_enable;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_org_live_enable FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('','','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_account_status;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_account_status FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('','','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_invoices;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_invoices FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_invoice_corrections;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_invoice_corrections FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_invoice_disputes;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_invoice_disputes FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_settlement_applications;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_settlement_applications FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_settlement_reconciliation_cases;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_settlement_reconciliation_cases FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_reporting_periods;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_reporting_periods FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_strategy_promotion_records;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_strategy_promotion_records FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','state_version');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_strategy_lifecycle_event;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_strategy_lifecycle_event FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_human_promotion_proposal_v2;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_human_promotion_proposal_v2 FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_historical_simulation_run_lifecycle_event_v2;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_historical_simulation_run_lifecycle_event_v2 FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('','','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_backtest_runs;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_backtest_runs FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_admin_incident;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_admin_incident FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','', 'state_version');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_admin_diagnostic_event;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_admin_diagnostic_event FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','organization_id','');
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_admin_job_run;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg AFTER INSERT OR UPDATE OR DELETE ON public.trader_admin_job_run FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_change('id','','');
