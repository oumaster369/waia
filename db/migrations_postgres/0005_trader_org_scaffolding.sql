CREATE TABLE "trader_org_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_org_profiles_organization_id_unique" ON "trader_org_profiles" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "trader_org_profiles" ADD CONSTRAINT "trader_org_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
