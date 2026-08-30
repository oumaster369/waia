ALTER TABLE trader_orders ADD COLUMN opening_causal_lineage_json text;
ALTER TABLE trader_orders ADD COLUMN opening_causal_lineage_digest text;

ALTER TABLE trader_orders ADD CONSTRAINT trader_orders_opening_causal_lineage_complete
CHECK ((opening_causal_lineage_json IS NULL) = (opening_causal_lineage_digest IS NULL));

ALTER TABLE trader_orders ADD CONSTRAINT trader_orders_opening_causal_lineage_digest_format
CHECK (opening_causal_lineage_digest IS NULL OR opening_causal_lineage_digest ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN trader_orders.opening_causal_lineage_json IS
  'DEE-635 immutable canonical opening causal lineage envelope; tenant scope is inherited from trader_orders RLS.';

CREATE FUNCTION waia_trader_order_opening_lineage_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opening_causal_lineage_json IS DISTINCT FROM OLD.opening_causal_lineage_json
     OR NEW.opening_causal_lineage_digest IS DISTINCT FROM OLD.opening_causal_lineage_digest THEN
    RAISE EXCEPTION 'ORDER_OPENING_CAUSAL_LINEAGE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trader_orders_opening_causal_lineage_immutable
BEFORE UPDATE OF opening_causal_lineage_json, opening_causal_lineage_digest ON trader_orders
FOR EACH ROW EXECUTE FUNCTION waia_trader_order_opening_lineage_immutable();
