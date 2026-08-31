CREATE TABLE "trader_canonical_decision_verification_subject_v2" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "account_id" text,
  "instrument_identity_digest_hex" text,
  "subject_kind" text NOT NULL,
  "subject_content_digest_hex" text NOT NULL,
  "subject_json" jsonb NOT NULL,
  "pit_anchor" timestamptz NOT NULL,
  "schema_version" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "canonical_decision_verification_subject_v2_pk" PRIMARY KEY (
    "organization_id", "subject_kind", "subject_content_digest_hex"
  ),
  CONSTRAINT "canonical_decision_verification_subject_v2_schema" CHECK (
    "schema_version" = 'waia.trader.canonical_decision_verification_subject.v2'
  ),
  CONSTRAINT "canonical_decision_verification_subject_v2_kind" CHECK (
    "subject_kind" IN (
      'FORECAST_RUNTIME_AUTHORITY', 'SCIENTIFIC_ADMISSION', 'FORECAST_ANCHOR_PRICE_AUTHORITY',
      'EXECUTABLE_POLICY', 'ECONOMIC_SIZE_SET', 'CASH_AUTHORITY'
    )
  ),
  CONSTRAINT "canonical_decision_verification_subject_v2_digest" CHECK (
    "subject_content_digest_hex" ~ '^[0-9a-f]{64}$' AND
    ("instrument_identity_digest_hex" IS NULL OR
      "instrument_identity_digest_hex" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "canonical_decision_verification_subject_v2_payload_binding" CHECK (
    "subject_json" ->> 'contentDigestHex' = "subject_content_digest_hex" AND
    "subject_json" ->> 'organizationId' = "organization_id"::text AND
    ("account_id" IS NULL OR "subject_json" ->> 'accountId' = "account_id") AND
    ("instrument_identity_digest_hex" IS NULL OR
      "subject_json" ->> 'instrumentIdentityDigestHex' = "instrument_identity_digest_hex")
  )
);

CREATE TABLE "trader_canonical_decision_verification_receipt_v2" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "account_id" text,
  "instrument_identity_digest_hex" text,
  "purpose" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_content_digest_hex" text NOT NULL,
  "source_record_kind" text NOT NULL,
  "source_record_id" text NOT NULL,
  "forecast_id" uuid,
  "forecast_bundle_id" uuid,
  "scientific_admission_receipt_id" uuid,
  "dee659_preregistration_id" uuid,
  "source_record_content_digest_hex" text NOT NULL,
  "verifier_version" text NOT NULL,
  "verifier_code_digest_hex" text NOT NULL,
  "pit_anchor" timestamptz NOT NULL,
  "verified" boolean NOT NULL,
  "verification_receipt_digest_hex" text NOT NULL,
  "receipt_json" jsonb NOT NULL,
  "schema_version" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "canonical_decision_verification_receipt_v2_subject_fk" FOREIGN KEY (
    "organization_id", "subject_kind", "subject_content_digest_hex"
  ) REFERENCES "trader_canonical_decision_verification_subject_v2" (
    "organization_id", "subject_kind", "subject_content_digest_hex"
  ),
  CONSTRAINT "canonical_decision_verification_receipt_v2_forecast_fk" FOREIGN KEY (
    "forecast_id", "organization_id"
  ) REFERENCES "trader_forecast_v2" ("id", "organization_id"),
  CONSTRAINT "canonical_decision_verification_receipt_v2_forecast_bundle_fk" FOREIGN KEY (
    "forecast_bundle_id", "organization_id"
  ) REFERENCES "trader_forecast_bundle_v2" ("id", "organization_id"),
  CONSTRAINT "canonical_decision_verification_receipt_v2_scientific_fk" FOREIGN KEY (
    "scientific_admission_receipt_id", "organization_id"
  ) REFERENCES "trader_scientific_admission_receipt_v1" ("id", "organization_id"),
  CONSTRAINT "canonical_decision_verification_receipt_v2_schema" CHECK (
    "schema_version" = 'waia.trader.canonical_decision_verification_receipt.v2'
  ),
  CONSTRAINT "canonical_decision_verification_receipt_v2_purpose" CHECK (
    "purpose" IN (
      'FORECAST_RUNTIME_AUTHORIZED', 'SCIENTIFIC_ADMISSION', 'ANCHOR_QUALIFICATION',
      'EXECUTABLE_POLICY_PREREGISTRATION', 'ECONOMIC_SIZE_AUTHORIZATION',
      'CASH_SNAPSHOT_AUTHORIZATION'
    )
  ),
  CONSTRAINT "canonical_decision_verification_receipt_v2_source_kind" CHECK (
    "source_record_kind" IN (
      'FORECAST_BUNDLE_V2', 'SCIENTIFIC_ADMISSION_V2', 'DEE659_AUTHORITY_PREREGISTRATION_V2'
    )
  ),
  CONSTRAINT "canonical_decision_verification_receipt_v2_source_fk_binding" CHECK (
    ("source_record_kind" = 'FORECAST_BUNDLE_V2' AND "forecast_id" IS NOT NULL AND
      "scientific_admission_receipt_id" IS NULL AND "purpose" = 'FORECAST_RUNTIME_AUTHORIZED' AND
      "dee659_preregistration_id" IS NULL AND "forecast_bundle_id" IS NOT NULL AND
      "subject_kind" = 'FORECAST_RUNTIME_AUTHORITY') OR
    ("source_record_kind" = 'SCIENTIFIC_ADMISSION_V2' AND "forecast_id" IS NOT NULL AND
      "scientific_admission_receipt_id" IS NOT NULL AND "purpose" = 'SCIENTIFIC_ADMISSION' AND
      "dee659_preregistration_id" IS NULL AND "forecast_bundle_id" IS NULL AND
      "subject_kind" = 'SCIENTIFIC_ADMISSION') OR
    ("source_record_kind" = 'DEE659_AUTHORITY_PREREGISTRATION_V2' AND "forecast_id" IS NOT NULL AND
      "scientific_admission_receipt_id" IS NULL AND "dee659_preregistration_id" IS NOT NULL AND
      "forecast_bundle_id" IS NULL AND
      (("purpose" = 'ANCHOR_QUALIFICATION' AND "subject_kind" = 'FORECAST_ANCHOR_PRICE_AUTHORITY') OR
       ("purpose" = 'EXECUTABLE_POLICY_PREREGISTRATION' AND "subject_kind" = 'EXECUTABLE_POLICY') OR
       ("purpose" = 'ECONOMIC_SIZE_AUTHORIZATION' AND "subject_kind" = 'ECONOMIC_SIZE_SET') OR
       ("purpose" = 'CASH_SNAPSHOT_AUTHORIZATION' AND "subject_kind" = 'CASH_AUTHORITY')))
  ),
  CONSTRAINT "canonical_decision_verification_receipt_v2_digests" CHECK (
    "subject_content_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "source_record_content_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "verifier_code_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "verification_receipt_digest_hex" ~ '^[0-9a-f]{64}$' AND
    ("instrument_identity_digest_hex" IS NULL OR
      "instrument_identity_digest_hex" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "canonical_decision_verification_receipt_v2_verified" CHECK ("verified" = true),
  CONSTRAINT "canonical_decision_verification_receipt_v2_payload_binding" CHECK (
    "receipt_json" ->> 'schemaVersion' = "schema_version" AND
    "receipt_json" ->> 'organizationId' = "organization_id"::text AND
    "receipt_json" ->> 'purpose' = "purpose" AND
    "receipt_json" ->> 'subjectKind' = "subject_kind" AND
    "receipt_json" ->> 'subjectContentDigestHex' = "subject_content_digest_hex" AND
    "receipt_json" ->> 'sourceRecordKind' = "source_record_kind" AND
    "receipt_json" ->> 'sourceRecordId' = "source_record_id" AND
    "receipt_json" ->> 'sourceRecordContentDigestHex' = "source_record_content_digest_hex" AND
    ("forecast_id" IS NOT DISTINCT FROM NULLIF("receipt_json" ->> 'forecastId', '')::uuid) AND
    ("forecast_bundle_id" IS NOT DISTINCT FROM NULLIF("receipt_json" ->> 'forecastBundleId', '')::uuid) AND
    ("dee659_preregistration_id" IS NOT DISTINCT FROM NULLIF("receipt_json" ->> 'dee659PreregistrationId', '')::uuid) AND
    "receipt_json" ->> 'verifierVersion' = "verifier_version" AND
    "receipt_json" ->> 'verifierCodeDigestHex' = "verifier_code_digest_hex" AND
    "receipt_json" ->> 'pitAnchor' = to_char("pit_anchor" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND
    "receipt_json" ->> 'verificationReceiptDigestHex' = "verification_receipt_digest_hex" AND
    ("receipt_json" ->> 'verified')::boolean = "verified" AND
    ("account_id" IS NOT DISTINCT FROM NULLIF("receipt_json" ->> 'accountId', '')) AND
    ("instrument_identity_digest_hex" IS NOT DISTINCT FROM
      NULLIF("receipt_json" ->> 'instrumentIdentityDigestHex', ''))
  )
);

CREATE TABLE "trader_dee659_authority_preregistration_v2" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "run_id" text NOT NULL,
  "cycle_id" text NOT NULL,
  "forecast_id" uuid NOT NULL,
  "instrument_identity_digest_hex" text NOT NULL,
  "dataset_seal_digest_hex" text NOT NULL,
  "policy_config_digest_hex" text NOT NULL,
  "anchor_subject_digest_hex" text NOT NULL,
  "policy_subject_digest_hex" text NOT NULL,
  "size_subject_digest_hex" text NOT NULL,
  "cash_subject_digest_hex" text NOT NULL,
  "authority_bundle_json" jsonb NOT NULL,
  "authority_bundle_digest_hex" text NOT NULL,
  "effective_market_from" timestamptz NOT NULL,
  "registered_at" timestamptz DEFAULT now() NOT NULL,
  "schema_version" text NOT NULL,
  CONSTRAINT "dee659_authority_preregistration_v2_forecast_fk" FOREIGN KEY
    ("forecast_id", "organization_id") REFERENCES "trader_forecast_v2" ("id", "organization_id"),
  CONSTRAINT "dee659_authority_preregistration_v2_natural" UNIQUE
    ("organization_id", "account_id", "run_id", "forecast_id", "authority_bundle_digest_hex"),
  CONSTRAINT "dee659_authority_preregistration_v2_schema" CHECK
    ("schema_version" = 'waia.trader.dee659_authority_preregistration.v2'),
  CONSTRAINT "dee659_authority_preregistration_v2_digests" CHECK (
    "instrument_identity_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "dataset_seal_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "policy_config_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "anchor_subject_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "policy_subject_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "size_subject_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "cash_subject_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "authority_bundle_digest_hex" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "trader_historical_simulation_policy_config_v2" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL,
  "policy_config_digest_hex" text NOT NULL,
  "policy_config_json" jsonb NOT NULL,
  "verifier_code_digest_hex" text NOT NULL,
  "schema_version" text NOT NULL,
  "registered_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("organization_id", "run_id", "policy_config_digest_hex"),
  CONSTRAINT "historical_simulation_policy_config_v2_digest" CHECK
    ("policy_config_digest_hex" ~ '^[0-9a-f]{64}$' AND "verifier_code_digest_hex" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "historical_simulation_policy_config_v2_schema" CHECK
    ("schema_version" = 'waia.trader.historical_simulation_policy_config.v2')
);

CREATE TABLE "trader_historical_dataset_authority_v2" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL,
  "cycle_id" text NOT NULL,
  "dataset_seal_digest_hex" text NOT NULL,
  "membership_content_digest_hex" text NOT NULL,
  "sealed_cycle_content_digest_hex" text NOT NULL,
  "membership_json" jsonb NOT NULL,
  "sealed_cycle_json" jsonb NOT NULL,
  "authority_content_digest_hex" text NOT NULL,
  "registered_at" timestamptz DEFAULT now() NOT NULL,
  "schema_version" text NOT NULL,
  CONSTRAINT "historical_dataset_authority_v2_natural" UNIQUE
    ("organization_id", "run_id", "cycle_id"),
  CONSTRAINT "historical_dataset_authority_v2_lineage_unique" UNIQUE
    ("id", "organization_id", "run_id", "cycle_id", "dataset_seal_digest_hex"),
  CONSTRAINT "historical_dataset_authority_v2_digests" CHECK (
    "dataset_seal_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "membership_content_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "sealed_cycle_content_digest_hex" ~ '^[0-9a-f]{64}$' AND
    "authority_content_digest_hex" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "historical_dataset_authority_v2_schema" CHECK
    ("schema_version" = 'waia.trader.historical_dataset_authority.v2'),
  CONSTRAINT "historical_dataset_authority_v2_json_binding" CHECK (
    "membership_json" ->> 'contentDigestHex' = "membership_content_digest_hex" AND
    "membership_json" ->> 'sealReceiptDigestHex' = "dataset_seal_digest_hex" AND
    "membership_json" ->> 'sealedCycleContentDigestHex' = "sealed_cycle_content_digest_hex" AND
    "sealed_cycle_json" ->> 'contentDigestHex' = "sealed_cycle_content_digest_hex" AND
    "membership_json" ->> 'cycleId' = "cycle_id" AND
    "sealed_cycle_json" ->> 'cycleId' = "cycle_id"
  )
);
ALTER TABLE "trader_dee659_authority_preregistration_v2"
  ADD COLUMN "dataset_authority_id" uuid NOT NULL;
ALTER TABLE "trader_dee659_authority_preregistration_v2"
  ADD CONSTRAINT "dee659_authority_preregistration_v2_dataset_authority_fk" FOREIGN KEY
    ("dataset_authority_id", "organization_id", "run_id", "cycle_id", "dataset_seal_digest_hex")
    REFERENCES "trader_historical_dataset_authority_v2"
      ("id", "organization_id", "run_id", "cycle_id", "dataset_seal_digest_hex"),
  ADD CONSTRAINT "dee659_authority_preregistration_v2_policy_fk" FOREIGN KEY
    ("organization_id", "run_id", "policy_config_digest_hex")
    REFERENCES "trader_historical_simulation_policy_config_v2"
      ("organization_id", "run_id", "policy_config_digest_hex");

CREATE UNIQUE INDEX "dee659_authority_preregistration_v2_id_org_unique"
  ON "trader_dee659_authority_preregistration_v2" ("id", "organization_id");
CREATE UNIQUE INDEX "dee659_authority_preregistration_v2_run_boundary_unique"
  ON "trader_dee659_authority_preregistration_v2"
    ("id", "organization_id", "run_id", "account_id", "dataset_seal_digest_hex", "policy_config_digest_hex");
ALTER TABLE "trader_canonical_decision_verification_receipt_v2"
  ADD CONSTRAINT "canonical_decision_verification_receipt_v2_prereg_fk" FOREIGN KEY
    ("dee659_preregistration_id", "organization_id")
    REFERENCES "trader_dee659_authority_preregistration_v2" ("id", "organization_id");

CREATE TABLE "trader_historical_simulation_run_start_v2" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL,
  "account_id" text NOT NULL,
  "dataset_seal_digest_hex" text NOT NULL,
  "policy_config_digest_hex" text NOT NULL,
  "initial_dee659_preregistration_id" uuid NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "schema_version" text NOT NULL,
  PRIMARY KEY ("organization_id", "run_id"),
  CONSTRAINT "historical_simulation_run_start_v2_prereg_fk" FOREIGN KEY
    ("initial_dee659_preregistration_id", "organization_id", "run_id", "account_id",
      "dataset_seal_digest_hex", "policy_config_digest_hex")
    REFERENCES "trader_dee659_authority_preregistration_v2"
      ("id", "organization_id", "run_id", "account_id", "dataset_seal_digest_hex", "policy_config_digest_hex"),
  CONSTRAINT "historical_simulation_run_start_v2_dataset_digest" CHECK
    ("dataset_seal_digest_hex" ~ '^[0-9a-f]{64}$' AND "policy_config_digest_hex" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "historical_simulation_run_start_v2_schema" CHECK
    ("schema_version" = 'waia.trader.historical_simulation_run_start.v2')
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "trader_dee659_authority_bundle_v2" LIMIT 1) THEN
    RAISE EXCEPTION '0187 refuses legacy DEE659 bundles without canonical preregistration lineage';
  END IF;
END $$;
ALTER TABLE "trader_dee659_authority_bundle_v2"
  ADD COLUMN "run_id" text NOT NULL,
  ADD COLUMN "dataset_seal_digest_hex" text NOT NULL,
  ADD COLUMN "dee659_preregistration_id" uuid NOT NULL;
ALTER TABLE "trader_dee659_authority_bundle_v2"
  ADD CONSTRAINT "dee659_authority_bundle_v2_prereg_fk" FOREIGN KEY
    ("dee659_preregistration_id", "organization_id")
    REFERENCES "trader_dee659_authority_preregistration_v2" ("id", "organization_id"),
  ADD CONSTRAINT "dee659_authority_bundle_v2_dataset_digest" CHECK
    ("dataset_seal_digest_hex" ~ '^[0-9a-f]{64}$');
ALTER TABLE "trader_dee659_authority_bundle_v2"
  DROP CONSTRAINT "dee659_authority_bundle_pk",
  ADD CONSTRAINT "dee659_authority_bundle_pk" PRIMARY KEY (
    "organization_id", "account_id", "run_id", "cycle_id", "dataset_seal_digest_hex",
    "dee659_preregistration_id", "forecast_id", "forecast_authority_content_digest_hex", "pit_anchor"
  );
CREATE UNIQUE INDEX "canonical_decision_verification_receipt_v2_natural"
  ON "trader_canonical_decision_verification_receipt_v2" (
    "organization_id", "account_id", "instrument_identity_digest_hex", "purpose",
    "subject_content_digest_hex", "source_record_kind", "source_record_id", "forecast_id",
    "forecast_bundle_id", "scientific_admission_receipt_id", "dee659_preregistration_id", "pit_anchor", "verifier_code_digest_hex"
  ) NULLS NOT DISTINCT;

CREATE INDEX "canonical_decision_verification_receipt_v2_lookup_idx"
  ON "trader_canonical_decision_verification_receipt_v2" (
    "organization_id", "account_id", "instrument_identity_digest_hex", "purpose", "pit_anchor" DESC
  );

CREATE TRIGGER "canonical_decision_verification_subject_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_canonical_decision_verification_subject_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();
CREATE TRIGGER "canonical_decision_verification_receipt_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_canonical_decision_verification_receipt_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();
CREATE TRIGGER "dee659_authority_preregistration_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_dee659_authority_preregistration_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();
CREATE TRIGGER "historical_simulation_policy_config_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_historical_simulation_policy_config_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();
CREATE TRIGGER "historical_dataset_authority_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_historical_dataset_authority_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();
CREATE TRIGGER "historical_simulation_run_start_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_historical_simulation_run_start_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();

ALTER TABLE "trader_canonical_decision_verification_subject_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_canonical_decision_verification_receipt_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_dee659_authority_preregistration_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_historical_simulation_policy_config_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_historical_dataset_authority_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_historical_simulation_run_start_v2" ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE "trader_historical_simulation_run_start_v2" IS
  'Owner-only historical simulation service boundary. RLS is enabled with no client policies; the database owner is the explicit maintenance bypass.';
REVOKE ALL ON "trader_canonical_decision_verification_subject_v2" FROM anon, authenticated;
REVOKE ALL ON "trader_canonical_decision_verification_receipt_v2" FROM anon, authenticated;
REVOKE ALL ON "trader_dee659_authority_preregistration_v2" FROM anon, authenticated;
REVOKE ALL ON "trader_historical_simulation_policy_config_v2" FROM anon, authenticated;
REVOKE ALL ON "trader_historical_dataset_authority_v2" FROM anon, authenticated;
REVOKE ALL ON "trader_historical_simulation_run_start_v2" FROM anon, authenticated;
