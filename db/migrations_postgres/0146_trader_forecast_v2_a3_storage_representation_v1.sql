-- DEE-518 A3 Closure VI: physical storage representation repair (semantic-preserving).
-- Forward corrective migration. Does not rewrite DEE-527 history.
--
-- Preserved semantics:
--   - append-only triggers
--   - RLS deny policies (unchanged)
--   - completeness 2/2/2/7 (scenario count via forecast join after bundle_id drop)
--   - natural uniqueness / one-forecast-per-role / one-outcome-per-forecast /
--     calibration uniqueness / seven scenario ordinal uniqueness
--   - idempotency via immutable natural identity (not deleted as a semantic)
--   - digests remain SHA-256; physical form bytea(32); canonical hex unchanged
--
-- Disposition notes (implementation report):
--   idempotency: REPLACED_WITH_PROVEN_EQUIVALENT_NATURAL_IDEMPOTENCY (proportional tables)
--   scenario PK: natural (organization_id, forecast_id, scenario_ordinal)
--   scenario.bundle_id: REMOVED (derived via forecast.bundle_id; completeness updated)
--   digest: text hex -> bytea(32)
--   schema_version / scale8: KEPT as text (closed int mapping not proven cheaply)

-- ---------------------------------------------------------------------------
-- 1) Digests: text hex -> bytea(32) on proportional V2 tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_bundle_v2
  DROP CONSTRAINT IF EXISTS tfbv2_bundle_content_digest_check;
ALTER TABLE public.trader_forecast_bundle_v2
  ALTER COLUMN bundle_content_digest TYPE bytea
  USING decode(bundle_content_digest, 'hex');
ALTER TABLE public.trader_forecast_bundle_v2
  ADD CONSTRAINT tfbv2_bundle_content_digest_len_check
  CHECK (octet_length(bundle_content_digest) = 32);

ALTER TABLE public.trader_forecast_v2
  DROP CONSTRAINT IF EXISTS tfv2_digest_check;
ALTER TABLE public.trader_forecast_v2
  ALTER COLUMN forecast_generation_identity_digest TYPE bytea
  USING decode(forecast_generation_identity_digest, 'hex');
ALTER TABLE public.trader_forecast_v2
  ALTER COLUMN forecast_content_digest TYPE bytea
  USING decode(forecast_content_digest, 'hex');
ALTER TABLE public.trader_forecast_v2
  ALTER COLUMN distribution_semantic_digest TYPE bytea
  USING decode(distribution_semantic_digest, 'hex');
ALTER TABLE public.trader_forecast_v2
  ADD CONSTRAINT tfv2_digest_len_check CHECK (
    octet_length(forecast_generation_identity_digest) = 32
    AND octet_length(forecast_content_digest) = 32
    AND octet_length(distribution_semantic_digest) = 32
  );

ALTER TABLE public.trader_forecast_outcome_v2
  DROP CONSTRAINT IF EXISTS tfov2_digest_check;
ALTER TABLE public.trader_forecast_outcome_v2
  ALTER COLUMN observed_outcome_digest TYPE bytea
  USING decode(observed_outcome_digest, 'hex');
ALTER TABLE public.trader_forecast_outcome_v2
  ALTER COLUMN content_digest TYPE bytea
  USING decode(content_digest, 'hex');
ALTER TABLE public.trader_forecast_outcome_v2
  ADD CONSTRAINT tfov2_digest_len_check CHECK (
    octet_length(observed_outcome_digest) = 32
    AND octet_length(content_digest) = 32
  );

ALTER TABLE public.trader_forecast_calibration_observation_v2
  DROP CONSTRAINT IF EXISTS tfcov2_content_digest_check;
ALTER TABLE public.trader_forecast_calibration_observation_v2
  ALTER COLUMN content_digest TYPE bytea
  USING decode(content_digest, 'hex');
ALTER TABLE public.trader_forecast_calibration_observation_v2
  ADD CONSTRAINT tfcov2_content_digest_len_check
  CHECK (octet_length(content_digest) = 32);

ALTER TABLE public.trader_forecast_scenario_v2
  DROP CONSTRAINT IF EXISTS tfsv2_content_digest_check;
ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN content_digest TYPE bytea
  USING decode(content_digest, 'hex');
ALTER TABLE public.trader_forecast_scenario_v2
  ADD CONSTRAINT tfsv2_content_digest_len_check
  CHECK (octet_length(content_digest) = 32);

-- ---------------------------------------------------------------------------
-- 2) Idempotency: replace stored key with natural identity uniqueness
-- ---------------------------------------------------------------------------

-- Fail closed if natural identity collisions exist before dropping old keys.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trader_forecast_bundle_v2
    GROUP BY organization_id, run_id, cycle_id, symbol, anchor_closed_bar_epoch_ms
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'tfbv2 natural identity duplicates block idempotency replacement';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tfbv2_org_natural_idempotency_uq
  ON public.trader_forecast_bundle_v2
  USING btree (organization_id, run_id, cycle_id, symbol, anchor_closed_bar_epoch_ms);

DROP INDEX IF EXISTS public.tfbv2_org_idempotency_key_uq;
ALTER TABLE public.trader_forecast_bundle_v2 DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS public.tfv2_org_idempotency_key_uq;
ALTER TABLE public.trader_forecast_v2 DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS public.tfov2_org_idempotency_key_uq;
ALTER TABLE public.trader_forecast_outcome_v2 DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS public.tfcov2_org_idempotency_key_uq;
ALTER TABLE public.trader_forecast_calibration_observation_v2 DROP COLUMN IF EXISTS idempotency_key;

DROP INDEX IF EXISTS public.tfsv2_org_idempotency_key_uq;
ALTER TABLE public.trader_forecast_scenario_v2 DROP COLUMN IF EXISTS idempotency_key;

-- ---------------------------------------------------------------------------
-- 3) PK reshape: (id, organization_id) as PK for non-scenario proportional tables
--    Convert existing composite unique indexes into PKs (no FK gap).
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_bundle_v2 DROP CONSTRAINT IF EXISTS trader_forecast_bundle_v2_pkey;
ALTER TABLE public.trader_forecast_bundle_v2
  ADD CONSTRAINT trader_forecast_bundle_v2_pkey
  PRIMARY KEY USING INDEX tfbv2_id_organization_unique;

ALTER TABLE public.trader_forecast_v2 DROP CONSTRAINT IF EXISTS trader_forecast_v2_pkey;
ALTER TABLE public.trader_forecast_v2
  ADD CONSTRAINT trader_forecast_v2_pkey
  PRIMARY KEY USING INDEX tfv2_id_organization_unique;

ALTER TABLE public.trader_forecast_outcome_v2 DROP CONSTRAINT IF EXISTS trader_forecast_outcome_v2_pkey;
ALTER TABLE public.trader_forecast_outcome_v2
  ADD CONSTRAINT trader_forecast_outcome_v2_pkey
  PRIMARY KEY USING INDEX tfov2_id_organization_unique;

ALTER TABLE public.trader_forecast_calibration_observation_v2
  DROP CONSTRAINT IF EXISTS trader_forecast_calibration_observation_v2_pkey;
ALTER TABLE public.trader_forecast_calibration_observation_v2
  ADD CONSTRAINT trader_forecast_calibration_observation_v2_pkey
  PRIMARY KEY USING INDEX tfcov2_id_organization_unique;

-- ---------------------------------------------------------------------------
-- 4) Scenario: natural PK; drop surrogate id + derivable bundle_id
-- ---------------------------------------------------------------------------

-- Completeness must move off scenario.bundle_id before the column is dropped.
CREATE OR REPLACE FUNCTION public.waia_forecast_bundle_v2_check_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  forecast_count integer;
  outcome_count integer;
  calibration_count integer;
  scenario_count integer;
BEGIN
  IF NEW.completeness_state = 'COMPLETE' THEN
    SELECT COUNT(*) INTO forecast_count
    FROM public.trader_forecast_v2
    WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;

    SELECT COUNT(*) INTO outcome_count
    FROM public.trader_forecast_outcome_v2
    WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;

    SELECT COUNT(*) INTO calibration_count
    FROM public.trader_forecast_calibration_observation_v2
    WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;

    SELECT COUNT(*) INTO scenario_count
    FROM public.trader_forecast_scenario_v2 s
    INNER JOIN public.trader_forecast_v2 f
      ON f.id = s.forecast_id
     AND f.organization_id = s.organization_id
    WHERE f.bundle_id = NEW.id
      AND f.organization_id = NEW.organization_id;

    IF forecast_count <> 2 OR outcome_count <> 2 OR calibration_count <> 2 OR scenario_count <> 7 THEN
      RAISE EXCEPTION 'trader_forecast_bundle_v2 completeness invariant violated (expected 2/2/2/7 child rows)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.trader_forecast_scenario_v2 DROP CONSTRAINT IF EXISTS tfsv2_bundle_org_fk;
ALTER TABLE public.trader_forecast_scenario_v2 DROP COLUMN IF EXISTS bundle_id;

ALTER TABLE public.trader_forecast_scenario_v2 DROP CONSTRAINT IF EXISTS trader_forecast_scenario_v2_pkey;
DROP INDEX IF EXISTS public.tfsv2_id_organization_unique;
DROP INDEX IF EXISTS public.tfsv2_org_forecast_scenario_uq;
ALTER TABLE public.trader_forecast_scenario_v2 DROP COLUMN IF EXISTS id;

ALTER TABLE public.trader_forecast_scenario_v2
  ADD CONSTRAINT trader_forecast_scenario_v2_pkey
  PRIMARY KEY (organization_id, forecast_id, scenario_ordinal);
