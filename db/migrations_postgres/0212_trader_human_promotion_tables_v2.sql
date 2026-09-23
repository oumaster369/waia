-- DEE-1049: human promotion proposal and research assignment tables

CREATE TABLE "trader_human_promotion_proposal_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"payload_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"disposition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_human_research_assignment_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"payload_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"disposition" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_human_promotion_proposal_v2" ADD CONSTRAINT "trader_human_promotion_proposal_v2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_human_research_assignment_v2" ADD CONSTRAINT "trader_human_research_assignment_v2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_human_promotion_proposal_v2_id_organization_unique" ON "trader_human_promotion_proposal_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_human_promotion_proposal_v2_organization_id_idx" ON "trader_human_promotion_proposal_v2" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "trader_human_promotion_proposal_v2_org_disposition_idx" ON "trader_human_promotion_proposal_v2" USING btree ("organization_id","disposition");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_human_research_assignment_v2_id_organization_unique" ON "trader_human_research_assignment_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_human_research_assignment_v2_organization_id_idx" ON "trader_human_research_assignment_v2" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "trader_human_research_assignment_v2_org_disposition_idx" ON "trader_human_research_assignment_v2" USING btree ("organization_id","disposition");
