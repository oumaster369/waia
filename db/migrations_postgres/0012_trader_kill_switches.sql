CREATE TYPE "public"."kill_switch_scope_type" AS ENUM('platform', 'organization', 'venue', 'strategy', 'account', 'instrument');
--> statement-breakpoint
CREATE TYPE "public"."kill_switch_type" AS ENUM('EMERGENCY_STOP', 'CLOSE_ONLY', 'PAUSE', 'DATA_QUALITY', 'CONTROL_PLANE_LOSS', 'STALE_STATE', 'RECON_MISMATCH', 'ABNORMAL_SLIPPAGE', 'UNKNOWN_POSITION');
--> statement-breakpoint
CREATE TYPE "public"."kill_switch_enforcement_mode" AS ENUM('STOP_ACCOUNT', 'CLOSE_ONLY', 'REJECT');
--> statement-breakpoint
CREATE TYPE "public"."kill_switch_state" AS ENUM('ACTIVE', 'CLEARING', 'INACTIVE');
--> statement-breakpoint
CREATE TYPE "public"."kill_switch_origin" AS ENUM('manual', 'automatic');
--> statement-breakpoint
CREATE TABLE "trader_kill_switches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"scope_type" "kill_switch_scope_type" NOT NULL,
	"scope_ref" text DEFAULT '' NOT NULL,
	"switch_type" "kill_switch_type" NOT NULL,
	"enforcement_mode" "kill_switch_enforcement_mode" NOT NULL,
	"state" "kill_switch_state" NOT NULL,
	"origin" "kill_switch_origin" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"clearing_started_at" timestamp with time zone,
	"cooling_off_ms" integer,
	"tripped_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_kill_switches" ADD CONSTRAINT "trader_kill_switches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trader_kill_switches_org_scope_state_idx" ON "trader_kill_switches" USING btree ("organization_id","scope_type","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_kill_switches_org_scope_unique" ON "trader_kill_switches" USING btree ("organization_id","scope_type","scope_ref","switch_type") WHERE "organization_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_kill_switches_platform_scope_unique" ON "trader_kill_switches" USING btree ("scope_type","scope_ref","switch_type") WHERE "organization_id" IS NULL;
