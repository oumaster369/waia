CREATE TRIGGER `trader_trades_opening_causal_lineage_insert_guard`
BEFORE INSERT ON `trader_trades`
FOR EACH ROW
WHEN
  ((NEW.`opening_causal_lineage_json` IS NULL) != (NEW.`opening_causal_lineage_digest` IS NULL))
  OR (NEW.`opening_causal_lineage_digest` IS NOT NULL AND (
    length(NEW.`opening_causal_lineage_digest`) != 64
    OR NEW.`opening_causal_lineage_digest` GLOB '*[^0-9a-f]*'
  ))
BEGIN
  SELECT RAISE(ABORT, 'TRADE_OPENING_CAUSAL_LINEAGE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_position_lots_opening_causal_lineage_insert_guard`
BEFORE INSERT ON `trader_position_lots`
FOR EACH ROW
WHEN
  ((NEW.`opening_causal_lineage_json` IS NULL) != (NEW.`opening_causal_lineage_digest` IS NULL))
  OR (NEW.`opening_causal_lineage_digest` IS NOT NULL AND (
    length(NEW.`opening_causal_lineage_digest`) != 64
    OR NEW.`opening_causal_lineage_digest` GLOB '*[^0-9a-f]*'
  ))
BEGIN
  SELECT RAISE(ABORT, 'LOT_OPENING_CAUSAL_LINEAGE_INVALID');
END;
