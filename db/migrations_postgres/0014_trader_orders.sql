CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');
--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('limit', 'market');
--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('CREATED', 'RISK_APPROVED', 'SENT_TO_EXCHANGE', 'ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED', 'RECONCILIATION_REQUIRED');
--> statement-breakpoint
CREATE TYPE "public"."order_execution_mode" AS ENUM('mock', 'paper', 'live');
--> statement-breakpoint
CREATE TABLE "trader_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"credential_id" uuid,
	"venue" text NOT NULL,
	"execution_mode" "order_execution_mode" NOT NULL,
	"symbol" text NOT NULL,
	"side" "order_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"price" text,
	"quantity" text NOT NULL,
	"filled_quantity" text DEFAULT '0' NOT NULL,
	"avg_fill_price" text,
	"state" "order_state" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"exchange_order_id" text,
	"client_order_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"risk_decision_id" text NOT NULL,
	"strategy_signal_id" text,
	"allocation_decision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_orders" ADD CONSTRAINT "trader_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_orders" ADD CONSTRAINT "trader_orders_credential_id_exchange_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."exchange_credentials"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_orders_id_organization_unique" ON "trader_orders" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_orders_org_client_order_id_unique" ON "trader_orders" USING btree ("organization_id","client_order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_orders_org_idempotency_key_unique" ON "trader_orders" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "trader_orders_org_state_idx" ON "trader_orders" USING btree ("organization_id","state");
--> statement-breakpoint
CREATE INDEX "trader_orders_org_execution_mode_state_idx" ON "trader_orders" USING btree ("organization_id","execution_mode","state");
--> statement-breakpoint
CREATE INDEX "trader_orders_org_venue_symbol_idx" ON "trader_orders" USING btree ("organization_id","venue","symbol");
--> statement-breakpoint
CREATE INDEX "trader_orders_exchange_order_id_idx" ON "trader_orders" USING btree ("exchange_order_id");
--> statement-breakpoint
CREATE TABLE "trader_order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_state" "order_state",
	"to_state" "order_state" NOT NULL,
	"event_type" text NOT NULL,
	"payload" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_order_events" ADD CONSTRAINT "trader_order_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_order_events" ADD CONSTRAINT "trader_order_events_order_id_organization_id_trader_orders_id_organization_id_fk" FOREIGN KEY ("order_id","organization_id") REFERENCES "public"."trader_orders"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_order_events_order_seq_unique" ON "trader_order_events" USING btree ("order_id","seq");
--> statement-breakpoint
CREATE INDEX "trader_order_events_org_order_seq_idx" ON "trader_order_events" USING btree ("organization_id","order_id","seq");
--> statement-breakpoint
CREATE TABLE "trader_fills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"exchange_trade_id" text NOT NULL,
	"price" text NOT NULL,
	"quantity" text NOT NULL,
	"fee" text DEFAULT '0' NOT NULL,
	"fee_asset" text DEFAULT '' NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_fills" ADD CONSTRAINT "trader_fills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_fills" ADD CONSTRAINT "trader_fills_order_id_organization_id_trader_orders_id_organization_id_fk" FOREIGN KEY ("order_id","organization_id") REFERENCES "public"."trader_orders"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_fills_order_exchange_trade_id_unique" ON "trader_fills" USING btree ("order_id","exchange_trade_id");
--> statement-breakpoint
CREATE INDEX "trader_fills_org_order_idx" ON "trader_fills" USING btree ("organization_id","order_id");
