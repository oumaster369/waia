ALTER TABLE trader_trades ADD COLUMN opening_causal_lineage_json text;
ALTER TABLE trader_trades ADD COLUMN opening_causal_lineage_digest text;
ALTER TABLE trader_position_lots ADD COLUMN opening_causal_lineage_json text;
ALTER TABLE trader_position_lots ADD COLUMN opening_causal_lineage_digest text;

ALTER TABLE trader_trades ADD CONSTRAINT trader_trades_opening_causal_lineage_complete
CHECK ((opening_causal_lineage_json IS NULL) = (opening_causal_lineage_digest IS NULL));
ALTER TABLE trader_trades ADD CONSTRAINT trader_trades_opening_causal_lineage_digest_format
CHECK (opening_causal_lineage_digest IS NULL OR opening_causal_lineage_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE trader_position_lots ADD CONSTRAINT trader_position_lots_opening_causal_lineage_complete
CHECK ((opening_causal_lineage_json IS NULL) = (opening_causal_lineage_digest IS NULL));
ALTER TABLE trader_position_lots ADD CONSTRAINT trader_position_lots_opening_causal_lineage_digest_format
CHECK (opening_causal_lineage_digest IS NULL OR opening_causal_lineage_digest ~ '^[0-9a-f]{64}$');

CREATE FUNCTION waia_trader_lifecycle_opening_lineage_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opening_causal_lineage_json IS DISTINCT FROM OLD.opening_causal_lineage_json
     OR NEW.opening_causal_lineage_digest IS DISTINCT FROM OLD.opening_causal_lineage_digest THEN
    RAISE EXCEPTION 'LIFECYCLE_OPENING_CAUSAL_LINEAGE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trader_trades_opening_causal_lineage_immutable
BEFORE UPDATE OF opening_causal_lineage_json, opening_causal_lineage_digest ON trader_trades
FOR EACH ROW EXECUTE FUNCTION waia_trader_lifecycle_opening_lineage_immutable();
CREATE TRIGGER trader_position_lots_opening_causal_lineage_immutable
BEFORE UPDATE OF opening_causal_lineage_json, opening_causal_lineage_digest ON trader_position_lots
FOR EACH ROW EXECUTE FUNCTION waia_trader_lifecycle_opening_lineage_immutable();
