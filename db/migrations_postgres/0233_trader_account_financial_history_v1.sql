-- DEE-1248: additive immutable collector financial evidence. 0232 is reserved by PR759.
-- Apply this file only through its separately approved ordered rollout; no backfill.
--> statement-breakpoint
CREATE TABLE public.trader_account_financial_bills (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL REFERENCES public.exchange_credentials(id),
  exchange_account_id text NOT NULL,
  observation_id uuid NOT NULL,
  htx_uid text NOT NULL CHECK (htx_uid ~ '^[1-9][0-9]{0,38}$'),
  provider_bill_id text NOT NULL CHECK (provider_bill_id ~ '^(0|[1-9][0-9]{0,18})$'),
  created_time_ms bigint NOT NULL CHECK (created_time_ms >= 0),
  bill jsonb NOT NULL CHECK (jsonb_typeof(bill)='object' AND octet_length(bill::text)<=8192),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=8192),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Full top-level xid, even when the collector is inside a subtransaction.
  -- Column INSERT grants exclude this field; caller overrides are denied.
  recorded_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY (organization_id, credential_id, exchange_account_id, htx_uid, provider_bill_id),
  FOREIGN KEY (organization_id, credential_id, exchange_account_id, observation_id)
    REFERENCES public.trader_account_observations (organization_id, credential_id, exchange_account_id, observation_id)
);
--> statement-breakpoint
CREATE INDEX trader_financial_bills_page ON public.trader_account_financial_bills (organization_id, credential_id, exchange_account_id, htx_uid, created_time_ms, provider_bill_id COLLATE "C");
--> statement-breakpoint
ALTER TABLE public.trader_account_financial_bills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_account_financial_bills FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_account_financial_bills FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.trader_account_financial_bills TO waia_account_observer;
--> statement-breakpoint
GRANT INSERT (organization_id, credential_id, exchange_account_id, observation_id, htx_uid,
  provider_bill_id, created_time_ms, bill, provenance) ON public.trader_account_financial_bills TO waia_account_observer;
--> statement-breakpoint
GRANT SELECT ON public.trader_account_financial_bills TO waia_account_observation_reader;
--> statement-breakpoint
CREATE TRIGGER trader_financial_bills_immutable BEFORE UPDATE OR DELETE ON public.trader_account_financial_bills
  FOR EACH ROW EXECUTE FUNCTION public.trader_observation_immutable();
--> statement-breakpoint
CREATE TRIGGER trader_financial_bills_no_truncate BEFORE TRUNCATE ON public.trader_account_financial_bills
  FOR EACH STATEMENT EXECUTE FUNCTION public.trader_observation_immutable();
--> statement-breakpoint
CREATE POLICY trader_financial_bills_observer_select ON public.trader_account_financial_bills
  FOR SELECT TO waia_account_observer USING (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
--> statement-breakpoint
CREATE POLICY trader_financial_bills_reader_select ON public.trader_account_financial_bills
  FOR SELECT TO waia_account_observation_reader USING (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
--> statement-breakpoint
CREATE POLICY trader_financial_bills_insert ON public.trader_account_financial_bills
  FOR INSERT TO waia_account_observer WITH CHECK (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
--> statement-breakpoint
CREATE TABLE public.trader_account_financial_coverage (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL REFERENCES public.exchange_credentials(id),
  exchange_account_id text NOT NULL,
  observation_id uuid NOT NULL,
  htx_uid text CHECK (htx_uid ~ '^[1-9][0-9]{0,38}$'),
  scope_id uuid NOT NULL,
  window_start_ms bigint NOT NULL,
  window_end_ms bigint NOT NULL CHECK (window_end_ms > window_start_ms),
  collection_completed_ms bigint NOT NULL CHECK (collection_completed_ms >= 0),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage)='object' AND octet_length(coverage::text)<=16384),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=8192),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Full top-level xid, even when the collector is inside a subtransaction.
  -- Column INSERT grants exclude this field; caller overrides are denied.
  recorded_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY (organization_id, credential_id, exchange_account_id, observation_id, scope_id),
  FOREIGN KEY (organization_id, credential_id, exchange_account_id, observation_id)
    REFERENCES public.trader_account_observations (organization_id, credential_id, exchange_account_id, observation_id)
);
--> statement-breakpoint
CREATE INDEX trader_financial_coverage_page ON public.trader_account_financial_coverage (organization_id, credential_id, exchange_account_id, htx_uid, collection_completed_ms, observation_id);
--> statement-breakpoint
ALTER TABLE public.trader_account_financial_coverage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_account_financial_coverage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_account_financial_coverage FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.trader_account_financial_coverage TO waia_account_observer;
--> statement-breakpoint
GRANT INSERT (organization_id, credential_id, exchange_account_id, observation_id, htx_uid,
  scope_id, window_start_ms, window_end_ms, collection_completed_ms, coverage, provenance)
  ON public.trader_account_financial_coverage TO waia_account_observer;
--> statement-breakpoint
GRANT SELECT ON public.trader_account_financial_coverage TO waia_account_observation_reader;
--> statement-breakpoint
CREATE TRIGGER trader_financial_coverage_immutable BEFORE UPDATE OR DELETE ON public.trader_account_financial_coverage
  FOR EACH ROW EXECUTE FUNCTION public.trader_observation_immutable();
--> statement-breakpoint
CREATE TRIGGER trader_financial_coverage_no_truncate BEFORE TRUNCATE ON public.trader_account_financial_coverage
  FOR EACH STATEMENT EXECUTE FUNCTION public.trader_observation_immutable();
--> statement-breakpoint
CREATE POLICY trader_financial_coverage_observer_select ON public.trader_account_financial_coverage
  FOR SELECT TO waia_account_observer USING (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
--> statement-breakpoint
CREATE POLICY trader_financial_coverage_reader_select ON public.trader_account_financial_coverage
  FOR SELECT TO waia_account_observation_reader USING (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
--> statement-breakpoint
CREATE POLICY trader_financial_coverage_insert ON public.trader_account_financial_coverage
  FOR INSERT TO waia_account_observer WITH CHECK (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
