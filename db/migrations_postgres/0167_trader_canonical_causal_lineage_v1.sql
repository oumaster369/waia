ALTER TABLE "trader_intelligence_hypothesis_record"
  ADD COLUMN "canonical_causal_lineage_json" text,
  ADD COLUMN "canonical_causal_lineage_digest" text;

ALTER TABLE "trader_intelligence_forecast_record"
  ADD COLUMN "canonical_causal_lineage_json" text,
  ADD COLUMN "canonical_causal_lineage_digest" text;

ALTER TABLE "trader_intelligence_hypothesis_record"
  ADD CONSTRAINT "trader_intelligence_hypothesis_record_causal_lineage_pair_check"
  CHECK (("canonical_causal_lineage_json" IS NULL) = ("canonical_causal_lineage_digest" IS NULL));

ALTER TABLE "trader_intelligence_forecast_record"
  ADD CONSTRAINT "trader_intelligence_forecast_record_causal_lineage_pair_check"
  CHECK (("canonical_causal_lineage_json" IS NULL) = ("canonical_causal_lineage_digest" IS NULL));
