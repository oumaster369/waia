-- DEE-415 / HTR-WP17: historical fill execution economics decomposition (append-only)

CREATE UNIQUE INDEX IF NOT EXISTS trader_fills_id_organization_unique
  ON public.trader_fills (id, organization_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trader_fill_execution_economics (
  id uuid PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  fill_id uuid NOT NULL,
  order_id uuid NOT NULL,
  exchange_trade_id text NOT NULL,
  fill_sequence integer NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  quantity text NOT NULL,
  gross_fill_price text NOT NULL,
  gross_notional text NOT NULL,
  fee_amount text NOT NULL,
  fee_asset text NOT NULL,
  spread_cost text NOT NULL,
  impact_slippage_cost text NOT NULL,
  total_execution_cost text NOT NULL,
  net_fill_price text NOT NULL,
  net_cash_effect text NOT NULL,
  remaining_quantity_after text NOT NULL,
  execution_model_id text NOT NULL,
  execution_model_schema_version text NOT NULL,
  simulator_id text NOT NULL,
  simulator_version text NOT NULL,
  source_bar_timestamp timestamptz NOT NULL,
  source_bar_index integer NOT NULL,
  accepted_at timestamptz NOT NULL,
  fill_timestamp timestamptz NOT NULL,
  submit_latency_ms integer NOT NULL,
  cancel_latency_ms integer,
  execution_fact_kind text NOT NULL,
  economics_content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT trader_fill_execution_economics_fill_sequence_check CHECK (fill_sequence >= 1),
  CONSTRAINT trader_fill_execution_economics_submit_latency_check CHECK (submit_latency_ms >= 0),
  CONSTRAINT trader_fill_execution_economics_digest_check CHECK (economics_content_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE public.trader_fill_execution_economics
  ADD CONSTRAINT trader_fill_execution_economics_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_fill_execution_economics
  ADD CONSTRAINT trader_fill_execution_economics_fill_org_fk
  FOREIGN KEY (fill_id, organization_id) REFERENCES public.trader_fills(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_fill_execution_economics
  ADD CONSTRAINT trader_fill_execution_economics_order_org_fk
  FOREIGN KEY (order_id, organization_id) REFERENCES public.trader_orders(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX trader_fill_execution_economics_org_fill_unique
  ON public.trader_fill_execution_economics (organization_id, fill_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_fill_execution_economics_org_order_seq_unique
  ON public.trader_fill_execution_economics (organization_id, order_id, fill_sequence);
--> statement-breakpoint
CREATE INDEX trader_fill_execution_economics_org_digest_idx
  ON public.trader_fill_execution_economics (organization_id, economics_content_digest);
--> statement-breakpoint
CREATE INDEX trader_fill_execution_economics_org_order_idx
  ON public.trader_fill_execution_economics (organization_id, order_id);
