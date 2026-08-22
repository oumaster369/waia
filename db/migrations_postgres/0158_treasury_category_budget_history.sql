ALTER TABLE "treasury_categories" ADD COLUMN "group_name" text DEFAULT 'Other' NOT NULL;
--> statement-breakpoint
ALTER TABLE "treasury_categories" ADD CONSTRAINT "treasury_categories_group_name_nonempty" CHECK (length(btrim("group_name")) > 0);
--> statement-breakpoint
CREATE TABLE "treasury_category_budget_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"effective_month" date NOT NULL,
	"group_name" text NOT NULL,
	"monthly_budget_micros" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_category_budget_history_id_org_unique_fk_source" UNIQUE("id", "organization_id"),
	CONSTRAINT "treasury_category_budget_history_month_start" CHECK ("effective_month" = date_trunc('month', "effective_month")::date),
	CONSTRAINT "treasury_category_budget_history_group_name_nonempty" CHECK (length(btrim("group_name")) > 0),
	CONSTRAINT "treasury_category_budget_history_monthly_nonneg" CHECK ("monthly_budget_micros" >= 0),
	CONSTRAINT "treasury_category_budget_history_currency_nonempty" CHECK (length(btrim("currency")) > 0)
);
--> statement-breakpoint
ALTER TABLE "treasury_category_budget_history" ADD CONSTRAINT "treasury_category_budget_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_category_budget_history" ADD CONSTRAINT "treasury_category_budget_history_category_same_org_fk" FOREIGN KEY ("category_id", "organization_id") REFERENCES "public"."treasury_categories"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_category_budget_history_org_category_month_unique" ON "treasury_category_budget_history" USING btree ("organization_id", "category_id", "effective_month");
--> statement-breakpoint
CREATE INDEX "treasury_category_budget_history_org_month_idx" ON "treasury_category_budget_history" USING btree ("organization_id", "effective_month");
--> statement-breakpoint
INSERT INTO "treasury_category_budget_history" (
	"id",
	"organization_id",
	"category_id",
	"effective_month",
	"group_name",
	"monthly_budget_micros",
	"currency",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	"organization_id",
	"id",
	date_trunc('month', "updated_at")::date,
	"group_name",
	"monthly_budget_micros",
	"currency",
	"updated_at",
	"updated_at"
FROM "treasury_categories"
ON CONFLICT ("organization_id", "category_id", "effective_month") DO NOTHING;
