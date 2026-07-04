-- DEE-377 / M2: portfolio risk limit columns on trader_risk_limits (Postgres)
-- No new RLS migration — existing 0011_trader_risk_limits_rls covers table-level policies.

ALTER TABLE "trader_risk_limits" ADD COLUMN "max_risk_per_trade_pct" text DEFAULT '0.01' NOT NULL;
ALTER TABLE "trader_risk_limits" ADD COLUMN "max_portfolio_risk_pct" text DEFAULT '0.05' NOT NULL;
ALTER TABLE "trader_risk_limits" ADD COLUMN "max_concurrent_positions" integer DEFAULT 3 NOT NULL;
