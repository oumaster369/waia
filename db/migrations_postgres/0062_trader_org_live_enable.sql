-- DEE-212 / BP-7: org-level live-enable governance (projection + append-only events).

CREATE TYPE "public"."trader_org_live_enable_state" AS ENUM('DISABLED', 'REQUESTED', 'COOLING_OFF', 'ENABLED', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "public"."trader_org_live_enable_event_type" AS ENUM('REQUESTED', 'CONFIRMED', 'ENABLED', 'DISABLED', 'CANCELLED');
--> statement-breakpoint
CREATE TABLE "trader_org_live_enable" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"state" "trader_org_live_enable_state" DEFAULT 'DISABLED' NOT NULL,
	"max_notional_cap" text NOT NULL,
	"requested_at" timestamp with time zone,
	"cooling_off_ends_at" timestamp with time zone,
	"enabled_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"operator_ack_phrase_hash" text,
	"state_version" integer DEFAULT 1 NOT NULL,
	"last_event_seq" integer DEFAULT 0 NOT NULL,
	"last_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_org_live_enable" ADD CONSTRAINT "trader_org_live_enable_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "trader_org_live_enable_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" "trader_org_live_enable_event_type" NOT NULL,
	"max_notional_cap" text,
	"reason" text,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_org_live_enable_events" ADD CONSTRAINT "trader_org_live_enable_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_org_live_enable_events_org_seq_unique" ON "trader_org_live_enable_events" USING btree ("organization_id","seq");
