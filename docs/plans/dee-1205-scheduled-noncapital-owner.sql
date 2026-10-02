-- DEE-1205 synthetic PostgreSQL proof fixture only. Not a production migration.
-- The scheduled owner must fail closed until a separately reviewed canonical migration exists.
CREATE TABLE public.trader_scheduled_noncapital_cycle_receipts_v1 (
  organization_id uuid NOT NULL,
  ownership_domain text NOT NULL DEFAULT 'SCHEDULED_PAPER_NO_TRADE_V1'
    CHECK (ownership_domain = 'SCHEDULED_PAPER_NO_TRADE_V1'),
  symbol text NOT NULL CHECK (symbol <> '' AND octet_length(symbol) <= 128),
  bar_interval text NOT NULL CHECK (bar_interval <> '' AND octet_length(bar_interval) <= 32),
  closed_bar_utc timestamptz NOT NULL,
  account_key text NOT NULL CHECK (account_key <> '' AND octet_length(account_key) <= 256),
  config_digest char(64) NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  release_sha char(40) NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  input_digest char(64) NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  receipt_digest char(64) NOT NULL CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  authority text NOT NULL DEFAULT 'NONCAPITAL_OPERATIONAL_RECEIPT_ONLY'
    CHECK (authority = 'NONCAPITAL_OPERATIONAL_RECEIPT_ONLY'),
  report_json jsonb NOT NULL CHECK (octet_length(report_json::text) <= 8192),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, ownership_domain, symbol, bar_interval, closed_bar_utc)
);

CREATE FUNCTION public.trader_scheduled_noncapital_receipt_append_only_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scheduled noncapital receipts are append-only';
END;
$$;

CREATE TRIGGER trader_scheduled_noncapital_receipt_no_mutation_v1
BEFORE UPDATE OR DELETE ON public.trader_scheduled_noncapital_cycle_receipts_v1
FOR EACH ROW EXECUTE FUNCTION public.trader_scheduled_noncapital_receipt_append_only_v1();

ALTER TABLE public.trader_scheduled_noncapital_cycle_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_scheduled_noncapital_cycle_receipts_v1 FROM PUBLIC;
