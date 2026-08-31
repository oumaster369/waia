CREATE TABLE "trader_dee659_authority_bundle_v2" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "cycle_id" text NOT NULL,
  "forecast_authority_content_digest_hex" text NOT NULL,
  "forecast_id" text NOT NULL,
  "forecast_issuance_receipt_digest_hex" text NOT NULL,
  "forecast_verification_receipt_digest_hex" text NOT NULL,
  "scientific_admission_evidence_digest_hex" text NOT NULL,
  "scientific_verification_receipt_digest_hex" text NOT NULL,
  "anchor_authority_json" jsonb NOT NULL,
  "executable_policy_json" jsonb NOT NULL,
  "economic_size_set_json" jsonb NOT NULL,
  "cash_authority_json" jsonb NOT NULL,
  "execution_payoff_verification_json" jsonb NOT NULL,
  "pit_anchor" timestamptz NOT NULL,
  "schema_version" text NOT NULL,
  "bundle_content_digest_hex" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "dee659_authority_bundle_pk" PRIMARY KEY (
    "organization_id", "account_id", "cycle_id", "forecast_authority_content_digest_hex"
  ),
  CONSTRAINT "dee659_authority_bundle_schema" CHECK (
    "schema_version" = 'waia.trader.dee659_durable_authority_bundle.v2'
  ),
  CONSTRAINT "dee659_authority_bundle_digests" CHECK (
    "forecast_authority_content_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "forecast_issuance_receipt_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "forecast_verification_receipt_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "scientific_admission_evidence_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "scientific_verification_receipt_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "bundle_content_digest_hex" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "dee659_authority_bundle_tenant_binding" CHECK (
    "anchor_authority_json" ->> 'organizationId' = "organization_id"::text AND
    "anchor_authority_json" ->> 'accountId' = "account_id" AND
    "executable_policy_json" ->> 'organizationId' = "organization_id"::text AND
    "executable_policy_json" ->> 'accountId' = "account_id" AND
    "economic_size_set_json" ->> 'organizationId' = "organization_id"::text AND
    "economic_size_set_json" ->> 'accountId' = "account_id" AND
    "cash_authority_json" ->> 'organizationId' = "organization_id"::text AND
    "cash_authority_json" ->> 'accountId' = "account_id"
  ),
  CONSTRAINT "dee659_authority_bundle_pit_binding" CHECK (
    (("anchor_authority_json" ->> 'forecastAnchorClosedBarEpochMs')::bigint) =
      floor(extract(epoch FROM "pit_anchor") * 1000)::bigint
  )
);

CREATE INDEX "dee659_authority_bundle_pit_idx" ON "trader_dee659_authority_bundle_v2"
  ("organization_id", "account_id", "pit_anchor", "cycle_id");

CREATE TRIGGER "dee659_authority_bundle_append_only"
  BEFORE UPDATE OR DELETE ON "trader_dee659_authority_bundle_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();

ALTER TABLE "trader_dee659_authority_bundle_v2" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "trader_dee659_authority_bundle_v2" FROM anon, authenticated;
