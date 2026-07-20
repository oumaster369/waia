CREATE TABLE "trader_position_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"exchange_account_id" text NOT NULL,
	"positions" text NOT NULL,
	"position_count" integer NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_trade_history_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"exchange_account_id" text NOT NULL,
	"symbol" text NOT NULL,
	"trades" text NOT NULL,
	"trade_count" integer NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_position_snapshots" ADD CONSTRAINT "trader_position_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_position_snapshots" ADD CONSTRAINT "trader_position_snapshots_credential_id_exchange_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."exchange_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_trade_history_snapshots" ADD CONSTRAINT "trader_trade_history_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trader_trade_history_snapshots" ADD CONSTRAINT "trader_trade_history_snapshots_credential_id_exchange_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."exchange_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trader_position_snapshots_org_cred_synced_idx" ON "trader_position_snapshots" USING btree ("organization_id","credential_id","synced_at");--> statement-breakpoint
CREATE INDEX "trader_position_snapshots_org_synced_idx" ON "trader_position_snapshots" USING btree ("organization_id","synced_at");--> statement-breakpoint
CREATE INDEX "trader_trade_history_snapshots_org_cred_symbol_synced_idx" ON "trader_trade_history_snapshots" USING btree ("organization_id","credential_id","symbol","synced_at");--> statement-breakpoint
CREATE INDEX "trader_trade_history_snapshots_org_synced_idx" ON "trader_trade_history_snapshots" USING btree ("organization_id","synced_at");
