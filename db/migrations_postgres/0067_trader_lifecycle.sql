CREATE TYPE "public"."trader_position_side" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."trader_instrument_kind" AS ENUM('SPOT', 'PERP', 'FUTURE');--> statement-breakpoint
CREATE TYPE "public"."trader_position_lot_state" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."trader_trade_state" AS ENUM('OPEN', 'CLOSED', 'FORCED_FLAT');--> statement-breakpoint
CREATE TYPE "public"."trader_trade_leg_kind" AS ENUM('OPEN_FILL', 'CLOSE_FILL', 'FORCED_FLAT');--> statement-breakpoint
CREATE TYPE "public"."trader_lifecycle_event_phase" AS ENUM('SIGNAL_ACCEPTED', 'ORDER_SUBMITTED', 'ORDER_FILLED', 'TRADE_OPENED', 'TRADE_CLOSED', 'FORCED_FLAT', 'GUARDIAN_EVALUATED', 'GUARDIAN_EXIT_INTENT');--> statement-breakpoint
CREATE TYPE "public"."trader_lifecycle_entity_type" AS ENUM('TRADE', 'POSITION_LOT', 'ORDER', 'FILL', 'STRATEGY_SIGNAL');--> statement-breakpoint
CREATE TABLE "trader_trades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"venue" text NOT NULL,
	"account_key" text NOT NULL,
	"position_side" "trader_position_side" NOT NULL,
	"instrument_kind" "trader_instrument_kind" NOT NULL,
	"strategy_signal_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"state" "trader_trade_state" NOT NULL,
	"semantics_version" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"realized_pnl" text DEFAULT '0' NOT NULL,
	"marked_pnl" text DEFAULT '0' NOT NULL,
	"hypothesis_id" uuid,
	"pattern_id" uuid,
	"risk_decision_id" text NOT NULL,
	"allocation_decision_id" text,
	"reasoning_session_id" text,
	"signal_confidence" text,
	"opening_regime" text,
	"opening_msv_id" text,
	"opening_feature_set_id" text,
	"closing_msv_id" text,
	"closing_feature_set_id" text,
	"closing_regime" text,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_position_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"venue" text NOT NULL,
	"account_key" text NOT NULL,
	"position_side" "trader_position_side" NOT NULL,
	"instrument_kind" "trader_instrument_kind" NOT NULL,
	"strategy_signal_id" text NOT NULL,
	"state" "trader_position_lot_state" NOT NULL,
	"open_qty" text NOT NULL,
	"remaining_qty" text NOT NULL,
	"avg_cost" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"trade_id" uuid NOT NULL,
	"hedge_group_id" uuid,
	"target_lot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_trade_legs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"position_lot_id" uuid NOT NULL,
	"kind" "trader_trade_leg_kind" NOT NULL,
	"order_id" uuid NOT NULL,
	"fill_id" uuid,
	"synthetic_id" text,
	"quantity" text NOT NULL,
	"price" text NOT NULL,
	"fee" text DEFAULT '0' NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"leg_pnl" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_lifecycle_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" "trader_lifecycle_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"phase" "trader_lifecycle_event_phase" NOT NULL,
	"payload" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"research_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_trades" ADD CONSTRAINT "trader_trades_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_position_lots" ADD CONSTRAINT "trader_position_lots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_position_lots" ADD CONSTRAINT "trader_position_lots_trade_id_organization_id_trader_trades_id_organization_id_fk" FOREIGN KEY ("trade_id","organization_id") REFERENCES "public"."trader_trades"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_trade_legs" ADD CONSTRAINT "trader_trade_legs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_trade_legs" ADD CONSTRAINT "trader_trade_legs_trade_id_organization_id_trader_trades_id_organization_id_fk" FOREIGN KEY ("trade_id","organization_id") REFERENCES "public"."trader_trades"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_trade_legs" ADD CONSTRAINT "trader_trade_legs_position_lot_id_organization_id_trader_position_lots_id_organization_id_fk" FOREIGN KEY ("position_lot_id","organization_id") REFERENCES "public"."trader_position_lots"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_lifecycle_events" ADD CONSTRAINT "trader_lifecycle_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trader_trades_id_organization_unique" ON "trader_trades" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "trader_trades_org_strategy_signal_idx" ON "trader_trades" USING btree ("organization_id","strategy_signal_id");--> statement-breakpoint
CREATE INDEX "trader_trades_org_state_idx" ON "trader_trades" USING btree ("organization_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_position_lots_id_organization_unique" ON "trader_position_lots" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "trader_position_lots_org_state_idx" ON "trader_position_lots" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "trader_position_lots_org_symbol_strategy_idx" ON "trader_position_lots" USING btree ("organization_id","symbol","strategy_signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_trade_legs_id_organization_unique" ON "trader_trade_legs" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "trader_trade_legs_org_trade_idx" ON "trader_trade_legs" USING btree ("organization_id","trade_id");--> statement-breakpoint
CREATE INDEX "trader_lifecycle_events_org_entity_idx" ON "trader_lifecycle_events" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "trader_lifecycle_events_org_phase_idx" ON "trader_lifecycle_events" USING btree ("organization_id","phase");
