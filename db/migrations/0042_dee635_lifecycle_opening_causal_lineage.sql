ALTER TABLE `trader_trades` ADD `opening_causal_lineage_json` text;
--> statement-breakpoint
ALTER TABLE `trader_trades` ADD `opening_causal_lineage_digest` text;
--> statement-breakpoint
ALTER TABLE `trader_position_lots` ADD `opening_causal_lineage_json` text;
--> statement-breakpoint
ALTER TABLE `trader_position_lots` ADD `opening_causal_lineage_digest` text;
--> statement-breakpoint
CREATE TRIGGER `trader_trades_opening_causal_lineage_immutable`
BEFORE UPDATE OF `opening_causal_lineage_json`, `opening_causal_lineage_digest` ON `trader_trades`
FOR EACH ROW
WHEN NOT (NEW.`opening_causal_lineage_json` IS OLD.`opening_causal_lineage_json` AND NEW.`opening_causal_lineage_digest` IS OLD.`opening_causal_lineage_digest`)
BEGIN
  SELECT RAISE(ABORT, 'TRADE_OPENING_CAUSAL_LINEAGE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_position_lots_opening_causal_lineage_immutable`
BEFORE UPDATE OF `opening_causal_lineage_json`, `opening_causal_lineage_digest` ON `trader_position_lots`
FOR EACH ROW
WHEN NOT (NEW.`opening_causal_lineage_json` IS OLD.`opening_causal_lineage_json` AND NEW.`opening_causal_lineage_digest` IS OLD.`opening_causal_lineage_digest`)
BEGIN
  SELECT RAISE(ABORT, 'LOT_OPENING_CAUSAL_LINEAGE_IMMUTABLE');
END;
