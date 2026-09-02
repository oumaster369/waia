-- Bind every Forecast V2 issuance to one symbol across its predictive package,
-- bundle, PIT runtime source, snapshot and authorized outcome. Existing mixed-
-- symbol lineage is not reclassified; the migration refuses it fail closed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trader_forecast_bundle_v2 b
    JOIN public.trader_forecast_predictive_package_v2 p
      ON p.id = b.predictive_package_id
     AND p.organization_id = b.organization_id
    WHERE b.symbol <> p.symbol
  ) OR EXISTS (
    SELECT 1
    FROM public.trader_forecast_runtime_input_source_v2 s
    JOIN public.trader_forecast_predictive_package_v2 p
      ON p.id = s.predictive_package_id
     AND p.organization_id = s.organization_id
     AND p.predictive_package_content_digest = s.predictive_package_content_digest_hex
    WHERE NOT ((
      s.symbol = p.symbol AND
      s.runtime_input_json ?& ARRAY[
        'marketStateSnapshot', 'predictivePackage'
      ] AND
      s.runtime_input_json -> 'marketStateSnapshot' ?& ARRAY[
        'symbol', 'instrumentId'
      ] AND
      s.runtime_input_json -> 'predictivePackage' ? 'family' AND
      s.runtime_input_json -> 'predictivePackage' -> 'family' ? 'symbol' AND
      s.authorized_outcome_json ? 'issuance' AND
      s.authorized_outcome_json -> 'issuance' ? 'package' AND
      s.authorized_outcome_json -> 'issuance' -> 'package' ? 'family' AND
      s.authorized_outcome_json -> 'issuance' -> 'package' -> 'family' ? 'symbol' AND
      s.runtime_input_json -> 'marketStateSnapshot' ->> 'symbol' = s.symbol AND
      replace(
        s.runtime_input_json -> 'marketStateSnapshot' ->> 'instrumentId', '/', ''
      ) = s.symbol AND
      s.runtime_input_json -> 'predictivePackage' -> 'family' ->> 'symbol' = s.symbol AND
      s.authorized_outcome_json -> 'issuance' -> 'package' -> 'family' ->> 'symbol' = s.symbol
    ) IS TRUE)
  ) THEN
    RAISE EXCEPTION '0192 refuses mixed-symbol Forecast V2 lineage';
  END IF;
END $$;

CREATE UNIQUE INDEX forecast_predictive_package_v2_symbol_lineage_unique
  ON public.trader_forecast_predictive_package_v2
    (id, organization_id, predictive_package_content_digest, symbol);

CREATE UNIQUE INDEX forecast_predictive_package_v2_org_symbol_unique
  ON public.trader_forecast_predictive_package_v2 (id, organization_id, symbol);

ALTER TABLE public.trader_forecast_bundle_v2
  ADD CONSTRAINT tfbv2_package_org_symbol_fk
  FOREIGN KEY (predictive_package_id, organization_id, symbol)
  REFERENCES public.trader_forecast_predictive_package_v2 (id, organization_id, symbol)
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE public.trader_forecast_runtime_input_source_v2
  ADD CONSTRAINT forecast_runtime_input_source_package_symbol_fk
  FOREIGN KEY (
    predictive_package_id,
    organization_id,
    predictive_package_content_digest_hex,
    symbol
  )
  REFERENCES public.trader_forecast_predictive_package_v2 (
    id,
    organization_id,
    predictive_package_content_digest,
    symbol
  )
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE public.trader_forecast_runtime_input_source_v2
  ADD CONSTRAINT forecast_runtime_input_source_symbol_json_binding CHECK ((
    runtime_input_json ?& ARRAY['marketStateSnapshot', 'predictivePackage'] AND
    runtime_input_json -> 'marketStateSnapshot' ?& ARRAY['symbol', 'instrumentId'] AND
    runtime_input_json -> 'predictivePackage' ? 'family' AND
    runtime_input_json -> 'predictivePackage' -> 'family' ? 'symbol' AND
    authorized_outcome_json ? 'issuance' AND
    authorized_outcome_json -> 'issuance' ? 'package' AND
    authorized_outcome_json -> 'issuance' -> 'package' ? 'family' AND
    authorized_outcome_json -> 'issuance' -> 'package' -> 'family' ? 'symbol' AND
    runtime_input_json -> 'marketStateSnapshot' ->> 'symbol' = symbol AND
    replace(
      runtime_input_json -> 'marketStateSnapshot' ->> 'instrumentId', '/', ''
    ) = symbol AND
    runtime_input_json -> 'predictivePackage' -> 'family' ->> 'symbol' = symbol AND
    authorized_outcome_json -> 'issuance' -> 'package' -> 'family' ->> 'symbol' = symbol
  ) IS TRUE);

-- Historical cold-start knowledge is a content-addressed issuance authority.
-- Confidence evolution is recorded in its own append-only update table; the
-- bootstrap edge itself must never be rewritten or removed after a Forecast
-- has proven it under a row-level FOR SHARE lock.
CREATE OR REPLACE FUNCTION public.trader_historical_forecast_bootstrap_immutable_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'historical Forecast knowledge bootstrap edges are immutable';
END;
$$;

CREATE TRIGGER trader_historical_forecast_bootstrap_immutable_v2
  BEFORE UPDATE OR DELETE ON public.trader_knowledge_edges
  FOR EACH ROW
  WHEN (OLD.relation_kind = 'predictive_package_models_symbol_horizon')
  EXECUTE FUNCTION public.trader_historical_forecast_bootstrap_immutable_v2();
