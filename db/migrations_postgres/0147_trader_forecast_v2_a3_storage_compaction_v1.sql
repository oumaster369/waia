-- DEE-518 A3 Closure VI compaction (semantic-preserving physical representation).
-- - outcome/calibration: natural PK (organization_id, forecast_id); drop surrogate id
-- - proportional schema_version: text → int2 via closed immutable map
-- - scenario scale8 fields: text → int8 exact scaled integers

-- ---------------------------------------------------------------------------
-- 1) Outcome / calibration natural PK (drop surrogate id)
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_outcome_v2
  DROP CONSTRAINT IF EXISTS trader_forecast_outcome_v2_pkey;
DROP INDEX IF EXISTS public.tfov2_org_forecast_uq;
ALTER TABLE public.trader_forecast_outcome_v2 DROP COLUMN IF EXISTS id;
ALTER TABLE public.trader_forecast_outcome_v2
  ADD CONSTRAINT trader_forecast_outcome_v2_pkey
  PRIMARY KEY (organization_id, forecast_id);

ALTER TABLE public.trader_forecast_calibration_observation_v2
  DROP CONSTRAINT IF EXISTS trader_forecast_calibration_observation_v2_pkey;
DROP INDEX IF EXISTS public.tfcov2_org_forecast_uq;
ALTER TABLE public.trader_forecast_calibration_observation_v2 DROP COLUMN IF EXISTS id;
ALTER TABLE public.trader_forecast_calibration_observation_v2
  ADD CONSTRAINT trader_forecast_calibration_observation_v2_pkey
  PRIMARY KEY (organization_id, forecast_id);

-- ---------------------------------------------------------------------------
-- 2) schema_version text → int2 (closed map)
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_bundle_v2
  ALTER COLUMN schema_version TYPE smallint
  USING (
    CASE schema_version
      WHEN 'forecast-bundle/v2' THEN 1
      ELSE NULL
    END
  );
ALTER TABLE public.trader_forecast_bundle_v2
  ADD CONSTRAINT tfbv2_schema_version_check CHECK (schema_version = 1);

ALTER TABLE public.trader_forecast_v2
  ALTER COLUMN schema_version TYPE smallint
  USING (
    CASE schema_version
      WHEN 'forecast/v2' THEN 2
      ELSE NULL
    END
  );
ALTER TABLE public.trader_forecast_v2
  ADD CONSTRAINT tfv2_schema_version_check CHECK (schema_version = 2);

ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN schema_version TYPE smallint
  USING (
    CASE schema_version
      WHEN 'forecast-scenario/v2' THEN 3
      ELSE NULL
    END
  );
ALTER TABLE public.trader_forecast_scenario_v2
  ADD CONSTRAINT tfsv2_schema_version_check CHECK (schema_version = 3);

ALTER TABLE public.trader_forecast_outcome_v2
  ALTER COLUMN schema_version TYPE smallint
  USING (
    CASE schema_version
      WHEN 'forecast-outcome/v2' THEN 4
      ELSE NULL
    END
  );
ALTER TABLE public.trader_forecast_outcome_v2
  ADD CONSTRAINT tfov2_schema_version_check CHECK (schema_version = 4);

ALTER TABLE public.trader_forecast_calibration_observation_v2
  ALTER COLUMN schema_version TYPE smallint
  USING (
    CASE schema_version
      WHEN 'forecast-calibration/v2' THEN 5
      ELSE NULL
    END
  );
ALTER TABLE public.trader_forecast_calibration_observation_v2
  ADD CONSTRAINT tfcov2_schema_version_check CHECK (schema_version = 5);

-- ---------------------------------------------------------------------------
-- 3) scenario scale8 text → int8 (exact * 10^8)
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN probability_scale8 TYPE bigint
  USING (
    CASE
      WHEN probability_scale8 ~ '^-?[0-9]+\.[0-9]{8}$' THEN
        (
          CASE WHEN probability_scale8 LIKE '-%' THEN -1 ELSE 1 END
          *
          (
            (replace(replace(probability_scale8, '-', ''), '.', ''))::numeric
          )
        )::bigint
      ELSE NULL
    END
  );

ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN lower_bound_scale8 TYPE bigint
  USING (
    CASE
      WHEN lower_bound_scale8 ~ '^-?[0-9]+\.[0-9]{8}$' THEN
        (
          CASE WHEN lower_bound_scale8 LIKE '-%' THEN -1 ELSE 1 END
          *
          (
            (replace(replace(lower_bound_scale8, '-', ''), '.', ''))::numeric
          )
        )::bigint
      ELSE NULL
    END
  );

ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN upper_bound_scale8 TYPE bigint
  USING (
    CASE
      WHEN upper_bound_scale8 ~ '^-?[0-9]+\.[0-9]{8}$' THEN
        (
          CASE WHEN upper_bound_scale8 LIKE '-%' THEN -1 ELSE 1 END
          *
          (
            (replace(replace(upper_bound_scale8, '-', ''), '.', ''))::numeric
          )
        )::bigint
      ELSE NULL
    END
  );
