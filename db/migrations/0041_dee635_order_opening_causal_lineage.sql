ALTER TABLE `trader_orders` ADD `opening_causal_lineage_json` text;
--> statement-breakpoint
ALTER TABLE `trader_orders` ADD `opening_causal_lineage_digest` text;
--> statement-breakpoint
CREATE TRIGGER `trader_orders_opening_causal_lineage_immutable`
BEFORE UPDATE OF `opening_causal_lineage_json`, `opening_causal_lineage_digest` ON `trader_orders`
FOR EACH ROW
WHEN NOT (NEW.`opening_causal_lineage_json` IS OLD.`opening_causal_lineage_json` AND NEW.`opening_causal_lineage_digest` IS OLD.`opening_causal_lineage_digest`)
BEGIN
  SELECT RAISE(ABORT, 'ORDER_OPENING_CAUSAL_LINEAGE_IMMUTABLE');
END;
