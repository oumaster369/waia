ALTER TABLE "trader_historical_simulation_reason_ledger_v2"
  ADD COLUMN "dataset_membership_content_digest_hex" text NOT NULL,
  ADD COLUMN "dataset_membership_json" jsonb NOT NULL;

ALTER TABLE "trader_historical_simulation_reason_ledger_v2"
  ADD CONSTRAINT "historical_sim_v2_dataset_membership_digest"
  CHECK ("dataset_membership_content_digest_hex" ~ '^[0-9a-f]{64}$');

ALTER TABLE "trader_historical_simulation_reason_ledger_v2"
  ADD CONSTRAINT "historical_sim_v2_dataset_membership_json_binding" CHECK (
    "dataset_membership_json" ->> 'schemaVersion' = 'waia.trader.historical_dataset_membership.v2' AND
    "dataset_membership_json" ->> 'contentDigestHex' = "dataset_membership_content_digest_hex" AND
    "dataset_membership_json" ->> 'organizationId' = "organization_id"::text AND
    "dataset_membership_json" ->> 'cycleId' = "cycle_id" AND
    "dataset_membership_json" ->> 'partition' = "partition"
  );
