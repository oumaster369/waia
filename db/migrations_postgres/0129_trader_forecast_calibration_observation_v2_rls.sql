-- DEE-527 / WP-FORECAST-V2: trader_forecast_calibration_observation_v2 RLS (ADR-0007)

ALTER TABLE public.trader_forecast_calibration_observation_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tfcov2_deny_authenticated_select ON public.trader_forecast_calibration_observation_v2;
CREATE POLICY tfcov2_deny_authenticated_select ON public.trader_forecast_calibration_observation_v2 FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS tfcov2_deny_authenticated_insert ON public.trader_forecast_calibration_observation_v2;
CREATE POLICY tfcov2_deny_authenticated_insert ON public.trader_forecast_calibration_observation_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS tfcov2_deny_authenticated_update ON public.trader_forecast_calibration_observation_v2;
CREATE POLICY tfcov2_deny_authenticated_update ON public.trader_forecast_calibration_observation_v2 FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS tfcov2_deny_authenticated_delete ON public.trader_forecast_calibration_observation_v2;
CREATE POLICY tfcov2_deny_authenticated_delete ON public.trader_forecast_calibration_observation_v2 FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
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
    SELECT COUNT(*) INTO forecast_count FROM public.trader_forecast_v2 WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;
    SELECT COUNT(*) INTO outcome_count FROM public.trader_forecast_outcome_v2 WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;
    SELECT COUNT(*) INTO calibration_count FROM public.trader_forecast_calibration_observation_v2 WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;
    SELECT COUNT(*) INTO scenario_count FROM public.trader_forecast_scenario_v2 WHERE bundle_id = NEW.id AND organization_id = NEW.organization_id;
    IF forecast_count <> 2 OR outcome_count <> 2 OR calibration_count <> 2 OR scenario_count <> 7 THEN
      RAISE EXCEPTION 'trader_forecast_bundle_v2 completeness invariant violated (expected 2/2/2/7 child rows)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_bundle_v2_check_completeness ON public.trader_forecast_bundle_v2;
CREATE CONSTRAINT TRIGGER trader_forecast_bundle_v2_check_completeness
  AFTER INSERT OR UPDATE ON public.trader_forecast_bundle_v2
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_bundle_v2_check_completeness();
