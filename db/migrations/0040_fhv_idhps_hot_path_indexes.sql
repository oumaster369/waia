CREATE INDEX `trader_orders_org_mode_venue_state_idx`
  ON `trader_orders` (`organization_id`, `execution_mode`, `venue`, `state`);--> statement-breakpoint
CREATE INDEX `trader_fills_org_order_executed_id_idx`
  ON `trader_fills` (`organization_id`, `order_id`, `executed_at`, `id`);
