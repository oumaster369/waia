ALTER TABLE trader_risk_verdicts_v2 ADD COLUMN forecast_id text;
ALTER TABLE trader_risk_verdicts_v2 ADD COLUMN forecast_content_digest text;
ALTER TABLE trader_risk_verdicts_v2 ADD COLUMN canonical_causal_lineage_digest text;
ALTER TABLE trader_risk_allowances_v2 ADD COLUMN forecast_id text;
ALTER TABLE trader_risk_allowances_v2 ADD COLUMN forecast_content_digest text;
ALTER TABLE trader_risk_allowances_v2 ADD COLUMN canonical_causal_lineage_digest text;

ALTER TABLE trader_risk_verdicts_v2 ADD CONSTRAINT trader_risk_verdicts_v2_causal_projection_complete CHECK (
  (forecast_id IS NULL AND forecast_content_digest IS NULL AND canonical_causal_lineage_digest IS NULL)
  OR (forecast_id IS NOT NULL AND forecast_content_digest ~ '^[0-9a-f]{64}$' AND canonical_causal_lineage_digest ~ '^[0-9a-f]{64}$')
);
ALTER TABLE trader_risk_allowances_v2 ADD CONSTRAINT trader_risk_allowances_v2_causal_projection_complete CHECK (
  (forecast_id IS NULL AND forecast_content_digest IS NULL AND canonical_causal_lineage_digest IS NULL)
  OR (forecast_id IS NOT NULL AND forecast_content_digest ~ '^[0-9a-f]{64}$' AND canonical_causal_lineage_digest ~ '^[0-9a-f]{64}$')
);
