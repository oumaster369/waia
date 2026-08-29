CREATE UNIQUE INDEX `trader_fills_id_organization_unique` ON `trader_fills` (`id`, `organization_id`);
--> statement-breakpoint
CREATE TABLE `trader_trade_legs_dee635_new` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL,
  `trade_id` text NOT NULL, `position_lot_id` text NOT NULL, `kind` text NOT NULL,
  `order_id` text, `fill_id` text, `synthetic_id` text, `quantity` text NOT NULL,
  `price` text NOT NULL, `fee` text DEFAULT '0' NOT NULL, `executed_at` integer NOT NULL,
  `leg_pnl` text DEFAULT '0' NOT NULL, `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`trade_id`,`organization_id`) REFERENCES `trader_trades`(`id`,`organization_id`) ON DELETE cascade,
  FOREIGN KEY (`position_lot_id`,`organization_id`) REFERENCES `trader_position_lots`(`id`,`organization_id`) ON DELETE cascade,
  FOREIGN KEY (`order_id`,`organization_id`) REFERENCES `trader_orders`(`id`,`organization_id`),
  FOREIGN KEY (`fill_id`,`organization_id`) REFERENCES `trader_fills`(`id`,`organization_id`)
);
--> statement-breakpoint
INSERT INTO `trader_trade_legs_dee635_new`
SELECT `id`, `organization_id`, `trade_id`, `position_lot_id`, `kind`, NULLIF(`order_id`, ''),
  `fill_id`, `synthetic_id`, `quantity`, `price`, `fee`, `executed_at`, `leg_pnl`, `created_at`
FROM `trader_trade_legs`;
--> statement-breakpoint
DROP TABLE `trader_trade_legs`;
--> statement-breakpoint
ALTER TABLE `trader_trade_legs_dee635_new` RENAME TO `trader_trade_legs`;
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_trade_legs_id_organization_unique` ON `trader_trade_legs` (`id`,`organization_id`);
--> statement-breakpoint
CREATE INDEX `trader_trade_legs_org_trade_idx` ON `trader_trade_legs` (`organization_id`,`trade_id`);
--> statement-breakpoint
CREATE TRIGGER `trader_trade_legs_execution_reference_insert_guard`
BEFORE INSERT ON `trader_trade_legs` FOR EACH ROW
WHEN (NEW.`kind` = 'FORCED_FLAT' AND (NEW.`order_id` IS NOT NULL OR NEW.`fill_id` IS NOT NULL OR NEW.`synthetic_id` IS NULL))
  OR (NEW.`kind` != 'FORCED_FLAT' AND (NEW.`order_id` IS NULL OR NEW.`fill_id` IS NULL OR NOT EXISTS (
    SELECT 1 FROM `trader_fills` f WHERE f.`id` = NEW.`fill_id`
      AND f.`order_id` = NEW.`order_id` AND f.`organization_id` = NEW.`organization_id`
  )))
BEGIN SELECT RAISE(ABORT, 'TRADE_LEG_EXECUTION_REFERENCE_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER `trader_trade_legs_append_only_update_guard`
BEFORE UPDATE ON `trader_trade_legs` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'TRADE_LEG_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `trader_trade_legs_append_only_delete_guard`
BEFORE DELETE ON `trader_trade_legs` FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'TRADE_LEG_APPEND_ONLY'); END;
