-- DEE-415 / HTR-WP16: strategy lifecycle event (append-only)

CREATE TABLE "trader_strategy_lifecycle_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor" text NOT NULL,
	"approval_ref" text,
	"reason_code" text,
	"seq" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"run_id" text,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_strategy_lifecycle_event_to_state_check" CHECK (
		"to_state" IN ('DRAFT','RESEARCHING','PAPER','LIVE','RETIRED')
	),
	CONSTRAINT "trader_strategy_lifecycle_event_actor_check" CHECK (
		"actor" IN ('HUMAN','MACHINE','SERVICE')
	),
	CONSTRAINT "trader_strategy_lifecycle_event_actor_state_check" CHECK (
		("actor" = 'MACHINE' AND "to_state" IN ('DRAFT','RESEARCHING'))
		OR ("to_state" NOT IN ('PAPER','LIVE'))
		OR ("actor" = 'HUMAN' AND "approval_ref" IS NOT NULL)
	),
	CONSTRAINT "trader_strategy_lifecycle_event_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_strategy_lifecycle_event" ADD CONSTRAINT "trader_strategy_lifecycle_event_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_lifecycle_event_id_organization_unique" ON "trader_strategy_lifecycle_event" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_lifecycle_event_org_strategy_version_seq_unique" ON "trader_strategy_lifecycle_event" USING btree ("organization_id","strategy_id","strategy_version","seq");
--> statement-breakpoint
CREATE INDEX "trader_strategy_lifecycle_event_org_strategy_version_effective_idx" ON "trader_strategy_lifecycle_event" USING btree ("organization_id","strategy_id","strategy_version","effective_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_strategy_lifecycle_event_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_strategy_lifecycle_event is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_strategy_lifecycle_event_block_update ON public.trader_strategy_lifecycle_event;
CREATE TRIGGER trader_strategy_lifecycle_event_block_update
  BEFORE UPDATE ON public.trader_strategy_lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION public.waia_strategy_lifecycle_event_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_strategy_lifecycle_event_block_delete ON public.trader_strategy_lifecycle_event;
CREATE TRIGGER trader_strategy_lifecycle_event_block_delete
  BEFORE DELETE ON public.trader_strategy_lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION public.waia_strategy_lifecycle_event_block_mutation();
