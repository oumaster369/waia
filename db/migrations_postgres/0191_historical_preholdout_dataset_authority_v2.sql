-- Generalize Historical Simulation V2 lineage from a seal-only digest to a
-- typed dataset authority. This is deliberately fail-closed: an environment
-- carrying legacy run rows must be reconciled explicitly rather than silently
-- reclassifying a qualification receipt as a seal receipt.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM trader_historical_dataset_authority_v2 LIMIT 1) OR
     EXISTS (SELECT 1 FROM trader_dee659_authority_preregistration_v2 LIMIT 1) OR
     EXISTS (SELECT 1 FROM trader_historical_simulation_run_start_v2 LIMIT 1) OR
     EXISTS (SELECT 1 FROM trader_dee659_authority_bundle_v2 LIMIT 1) OR
     EXISTS (SELECT 1 FROM trader_historical_forecast_input_pit_v2 LIMIT 1) THEN
    RAISE EXCEPTION '0191 refuses implicit reclassification of existing historical dataset authority rows';
  END IF;
END $$;

ALTER TABLE trader_historical_dataset_authority_v2
  RENAME COLUMN dataset_seal_digest_hex TO dataset_authority_digest_hex;
ALTER TABLE trader_dee659_authority_preregistration_v2
  RENAME COLUMN dataset_seal_digest_hex TO dataset_authority_digest_hex;
ALTER TABLE trader_historical_simulation_run_start_v2
  RENAME COLUMN dataset_seal_digest_hex TO dataset_authority_digest_hex;
ALTER TABLE trader_dee659_authority_bundle_v2
  RENAME COLUMN dataset_seal_digest_hex TO dataset_authority_digest_hex;
ALTER TABLE trader_historical_forecast_input_pit_v2
  RENAME COLUMN dataset_seal_digest_hex TO dataset_authority_digest_hex;

ALTER TABLE trader_historical_dataset_authority_v2
  ADD COLUMN dataset_authority_class text NOT NULL;

ALTER TABLE trader_historical_dataset_authority_v2
  DROP CONSTRAINT historical_dataset_authority_v2_json_binding,
  ADD CONSTRAINT historical_dataset_authority_v2_class CHECK
    (dataset_authority_class IN ('FULL_SEALED_DATASET_V2', 'PRE_HOLDOUT_QUALIFICATION_V1')),
  ADD CONSTRAINT historical_dataset_authority_v2_json_binding CHECK ((
    membership_json ?& ARRAY['contentDigestHex', 'datasetAuthorityClass',
      'datasetAuthorityDigestHex', 'sealedCycleContentDigestHex', 'cycleId'] AND
    sealed_cycle_json ?& ARRAY['contentDigestHex', 'cycleId'] AND
    membership_json ->> 'contentDigestHex' = membership_content_digest_hex AND
    membership_json ->> 'datasetAuthorityClass' = dataset_authority_class AND
    membership_json ->> 'datasetAuthorityDigestHex' = dataset_authority_digest_hex AND
    membership_json ->> 'sealedCycleContentDigestHex' = sealed_cycle_content_digest_hex AND
    sealed_cycle_json ->> 'contentDigestHex' = sealed_cycle_content_digest_hex AND
    membership_json ->> 'cycleId' = cycle_id AND
    sealed_cycle_json ->> 'cycleId' = cycle_id AND
    (
      (dataset_authority_class = 'FULL_SEALED_DATASET_V2' AND
       membership_json ? 'sealReceiptDigestHex' AND
       membership_json ->> 'sealReceiptDigestHex' = dataset_authority_digest_hex AND
       NOT (membership_json ? 'qualificationReceiptDigestHex')) OR
      (dataset_authority_class = 'PRE_HOLDOUT_QUALIFICATION_V1' AND
       membership_json ? 'qualificationReceiptDigestHex' AND
       membership_json ->> 'qualificationReceiptDigestHex' = dataset_authority_digest_hex AND
       NOT (membership_json ? 'sealReceiptDigestHex') AND
       NOT (membership_json ? 'manifestSemanticDigestHex'))
    )
  ) IS TRUE);

CREATE INDEX historical_dataset_authority_v2_class_lookup_idx
  ON trader_historical_dataset_authority_v2
    (organization_id, run_id, dataset_authority_class, dataset_authority_digest_hex);
