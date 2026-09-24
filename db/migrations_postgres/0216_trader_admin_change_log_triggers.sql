-- DEE-1071: id-only change log. One static function per table.
-- Functions use NEW and OLD columns directly. No dynamic SQL. No EXCEPTION block.
-- The journal stores identifiers, organization_id, and state_version.
-- Credential ciphertext columns are never read.
-- A row with historical_run_id set is skipped by static SQL.
-- exchange_credentials: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_exchange_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'exchange_credentials', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'exchange_credentials', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_exchange_credentials() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.exchange_credentials;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.exchange_credentials
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_exchange_credentials();
--> statement-breakpoint
-- trader_orders: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.historical_run_id IS NOT NULL THEN
      RETURN OLD;
    END IF;
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    version := OLD.state_version;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_orders', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  IF NEW.historical_run_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
    entity_id := NEW.id::text;
    org_id := NEW.organization_id;
    version := NEW.state_version;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_orders', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_orders() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_orders;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_orders
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_orders();
--> statement-breakpoint
-- trader_fills: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_fills()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.trader_orders AS historical_order
      WHERE historical_order.id = OLD.order_id
        AND historical_order.historical_run_id IS NOT NULL
    ) THEN
      RETURN OLD;
    END IF;
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_fills', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  IF EXISTS (
      SELECT 1 FROM public.trader_orders AS historical_order
      WHERE historical_order.id = NEW.order_id
        AND historical_order.historical_run_id IS NOT NULL
    ) THEN
      RETURN NEW;
    END IF;
    entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_fills', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_fills() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_fills;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_fills
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_fills();
--> statement-breakpoint
-- trader_trade_legs: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_trade_legs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.trader_orders AS historical_order
      WHERE historical_order.id = OLD.order_id
        AND historical_order.historical_run_id IS NOT NULL
    ) THEN
      RETURN OLD;
    END IF;
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_trade_legs', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  IF NEW.order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.trader_orders AS historical_order
      WHERE historical_order.id = NEW.order_id
        AND historical_order.historical_run_id IS NOT NULL
    ) THEN
      RETURN NEW;
    END IF;
    entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_trade_legs', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_trade_legs() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_trade_legs;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_trade_legs
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_trade_legs();
--> statement-breakpoint
-- trader_position_lots: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_position_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_position_lots', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_position_lots', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_position_lots() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_position_lots;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_position_lots
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_position_lots();
--> statement-breakpoint
-- trader_trades: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_trades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_trades', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_trades', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_trades() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_trades;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_trades
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_trades();
--> statement-breakpoint
-- trader_account_collection_state: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_account_collection_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.organization_id::text || ':' || OLD.credential_id::text || ':' || OLD.exchange_account_id;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_account_collection_state', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.organization_id::text || ':' || NEW.credential_id::text || ':' || NEW.exchange_account_id;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_account_collection_state', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_account_collection_state() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_account_collection_state;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_account_collection_state
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_account_collection_state();
--> statement-breakpoint
-- trader_risk_account_state_v2: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_risk_account_state_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.organization_id::text || ':' || OLD.account_id;
    org_id := OLD.organization_id;
    version := OLD.state_version;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_risk_account_state_v2', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.organization_id::text || ':' || NEW.account_id;
    org_id := NEW.organization_id;
    version := NEW.state_version;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_risk_account_state_v2', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_risk_account_state_v2() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_risk_account_state_v2;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_risk_account_state_v2
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_risk_account_state_v2();
--> statement-breakpoint
-- trader_kill_switches: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_kill_switches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    version := OLD.state_version;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_kill_switches', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
    version := NEW.state_version;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_kill_switches', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_kill_switches() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_kill_switches;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_kill_switches
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_kill_switches();
--> statement-breakpoint
-- trader_org_live_enable: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_org_live_enable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.organization_id::text;
    org_id := OLD.organization_id;
    version := OLD.state_version;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_org_live_enable', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.organization_id::text;
    org_id := NEW.organization_id;
    version := NEW.state_version;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_org_live_enable', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_org_live_enable() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_org_live_enable;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_org_live_enable
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_org_live_enable();
--> statement-breakpoint
-- trader_account_status: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.organization_id::text || ':' || OLD.exchange_account_id;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_account_status', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.organization_id::text || ':' || NEW.exchange_account_id;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_account_status', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_account_status() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_account_status;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_account_status
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_account_status();
--> statement-breakpoint
-- trader_invoices: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_invoices', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_invoices', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_invoices() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_invoices;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_invoices();
--> statement-breakpoint
-- trader_invoice_corrections: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_invoice_corrections()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_invoice_corrections', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_invoice_corrections', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_invoice_corrections() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_invoice_corrections;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_invoice_corrections
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_invoice_corrections();
--> statement-breakpoint
-- trader_invoice_disputes: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_invoice_disputes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_invoice_disputes', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_invoice_disputes', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_invoice_disputes() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_invoice_disputes;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_invoice_disputes
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_invoice_disputes();
--> statement-breakpoint
-- trader_settlement_applications: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_settlement_applications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_settlement_applications', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_settlement_applications', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_settlement_applications() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_settlement_applications;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_settlement_applications
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_settlement_applications();
--> statement-breakpoint
-- trader_settlement_reconciliation_cases: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_settlement_reconciliation_cases()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_settlement_reconciliation_cases', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_settlement_reconciliation_cases', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_settlement_reconciliation_cases() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_settlement_reconciliation_cases;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_settlement_reconciliation_cases
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_settlement_reconciliation_cases();
--> statement-breakpoint
-- trader_reporting_periods: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_reporting_periods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_reporting_periods', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_reporting_periods', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_reporting_periods() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_reporting_periods;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_reporting_periods
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_reporting_periods();
--> statement-breakpoint
-- trader_strategy_promotion_records: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_strategy_promotion_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    version := OLD.state_version;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_strategy_promotion_records', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
    version := NEW.state_version;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_strategy_promotion_records', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_strategy_promotion_records() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_strategy_promotion_records;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_strategy_promotion_records
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_strategy_promotion_records();
--> statement-breakpoint
-- trader_strategy_lifecycle_event: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_strategy_lifecycle_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_strategy_lifecycle_event', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_strategy_lifecycle_event', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_strategy_lifecycle_event() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_strategy_lifecycle_event;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_strategy_lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_strategy_lifecycle_event();
--> statement-breakpoint
-- trader_human_promotion_proposal_v2: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_human_promotion_proposal_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_human_promotion_proposal_v2', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_human_promotion_proposal_v2', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_human_promotion_proposal_v2() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_human_promotion_proposal_v2;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_human_promotion_proposal_v2
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_human_promotion_proposal_v2();
--> statement-breakpoint
-- trader_historical_simulation_run_lifecycle_event_v2: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_historical_simulation_run_lifecycle_event_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.organization_id::text || ':' || OLD.run_id || ':' || OLD.event_sequence::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_historical_simulation_run_lifecycle_event_v2', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.organization_id::text || ':' || NEW.run_id || ':' || NEW.event_sequence::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_historical_simulation_run_lifecycle_event_v2', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_historical_simulation_run_lifecycle_event_v2() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_historical_simulation_run_lifecycle_event_v2;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_historical_simulation_run_lifecycle_event_v2
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_historical_simulation_run_lifecycle_event_v2();
--> statement-breakpoint
-- trader_backtest_runs: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_backtest_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_backtest_runs', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_backtest_runs', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_backtest_runs() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_backtest_runs;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_backtest_runs
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_backtest_runs();
--> statement-breakpoint
-- trader_admin_incident: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_admin_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    version := OLD.state_version;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_admin_incident', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    version := NEW.state_version;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_admin_incident', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_admin_incident() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_admin_incident;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_admin_incident
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_admin_incident();
--> statement-breakpoint
-- trader_admin_diagnostic_event: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_admin_diagnostic_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    org_id := OLD.organization_id;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_admin_diagnostic_event', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
    org_id := NEW.organization_id;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_admin_diagnostic_event', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_admin_diagnostic_event() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_admin_diagnostic_event;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_admin_diagnostic_event
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_admin_diagnostic_event();
--> statement-breakpoint
-- trader_admin_job_run: identifiers, organization_id, and state_version only.
CREATE OR REPLACE FUNCTION public.trader_admin_record_trader_admin_job_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_id text;
  org_id uuid;
  version bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    INSERT INTO public.trader_admin_change_log
      (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
    VALUES
      (pg_current_xact_id(), clock_timestamp(), 'trader_admin_job_run', TG_OP, entity_id, org_id, version);
    RETURN OLD;
  END IF;
  entity_id := NEW.id::text;
  INSERT INTO public.trader_admin_change_log
    (xid, changed_at, source_table, op, entity_id, organization_id, entity_version)
  VALUES
    (pg_current_xact_id(), clock_timestamp(), 'trader_admin_job_run', TG_OP, entity_id, org_id, version);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_admin_record_trader_admin_job_run() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_admin_change_log_trg ON public.trader_admin_job_run;
--> statement-breakpoint
CREATE TRIGGER trader_admin_change_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.trader_admin_job_run
  FOR EACH ROW EXECUTE FUNCTION public.trader_admin_record_trader_admin_job_run();
