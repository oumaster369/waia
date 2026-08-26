-- DEE-623: persist the exact canonical causal input bundle behind input_semantic_digest.
-- Nullable is intentional backward compatibility: historical v1 envelopes retain their
-- original digest and have no fabricated v2 bundle. Every newly-built v2 envelope writes it.
ALTER TABLE "trader_intelligence_cycle_envelope"
  ADD COLUMN "input_causal_bundle_json" text;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_cycle_envelope"
  ADD CONSTRAINT "trader_intelligence_cycle_envelope_v2_bundle_required"
  CHECK (
    "schema_version" <> 'waia.trader.intelligence_cycle_envelope.v2'
    OR "input_causal_bundle_json" IS NOT NULL
  );
