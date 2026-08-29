CREATE TRIGGER `trader_trade_legs_execution_reference_insert_guard`
BEFORE INSERT ON `trader_trade_legs`
FOR EACH ROW
WHEN
  (NEW.`kind` = 'FORCED_FLAT' AND (NEW.`order_id` != '' OR NEW.`fill_id` IS NOT NULL OR NEW.`synthetic_id` IS NULL))
  OR (NEW.`kind` != 'FORCED_FLAT' AND (
    NEW.`order_id` = '' OR NEW.`fill_id` IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `trader_fills` f
      JOIN `trader_orders` o ON o.`id` = f.`order_id` AND o.`organization_id` = f.`organization_id`
      WHERE f.`id` = NEW.`fill_id`
        AND f.`order_id` = NEW.`order_id`
        AND f.`organization_id` = NEW.`organization_id`
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'TRADE_LEG_EXECUTION_REFERENCE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_trade_legs_append_only_update_guard`
BEFORE UPDATE ON `trader_trade_legs`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'TRADE_LEG_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_trade_legs_append_only_delete_guard`
BEFORE DELETE ON `trader_trade_legs`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'TRADE_LEG_APPEND_ONLY');
END;
