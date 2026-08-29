CREATE FUNCTION waia_trader_trade_leg_reference_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'FORCED_FLAT' THEN
    IF NEW.fill_id IS NOT NULL OR NEW.synthetic_id IS NULL THEN
      RAISE EXCEPTION 'TRADE_LEG_SYNTHETIC_REFERENCE_INVALID';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.fill_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM trader_fills f
    JOIN trader_orders o ON o.id = f.order_id AND o.organization_id = f.organization_id
    WHERE f.id = NEW.fill_id
      AND f.order_id = NEW.order_id
      AND f.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'TRADE_LEG_EXECUTION_REFERENCE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trader_trade_legs_execution_reference_insert_guard
BEFORE INSERT ON trader_trade_legs
FOR EACH ROW EXECUTE FUNCTION waia_trader_trade_leg_reference_guard();

CREATE FUNCTION waia_trader_trade_leg_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRADE_LEG_APPEND_ONLY';
END;
$$;

CREATE TRIGGER trader_trade_legs_append_only_update_guard
BEFORE UPDATE ON trader_trade_legs
FOR EACH ROW EXECUTE FUNCTION waia_trader_trade_leg_append_only();
CREATE TRIGGER trader_trade_legs_append_only_delete_guard
BEFORE DELETE ON trader_trade_legs
FOR EACH ROW EXECUTE FUNCTION waia_trader_trade_leg_append_only();
