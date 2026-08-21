ALTER TYPE "public"."treasury_tx_status" ADD VALUE IF NOT EXISTS 'PLANNED' AFTER 'MANUAL_DRAFT';
--> statement-breakpoint
CREATE TYPE "public"."treasury_account_kind" AS ENUM('CRYPTO_WALLET', 'BANK_CARD', 'BANK_ACCOUNT', 'CASH', 'OTHER');
--> statement-breakpoint
CREATE TABLE "treasury_counterparties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"website_url" text,
	"email" text,
	"phone" text,
	"payment_instructions" text,
	"waia_user_id" uuid,
	"waia_username" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_counterparties_display_name_nonempty" CHECK (length(btrim("display_name")) > 0),
	CONSTRAINT "treasury_counterparties_id_org_unique_fk_source" UNIQUE("id", "organization_id")
);
--> statement-breakpoint
CREATE TABLE "treasury_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"kind" "treasury_account_kind" NOT NULL,
	"currency" text NOT NULL,
	"network" text,
	"address" text,
	"masked_requisites" text,
	"watched_address_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_accounts_display_name_nonempty" CHECK (length(btrim("display_name")) > 0),
	CONSTRAINT "treasury_accounts_currency_nonempty" CHECK (length(btrim("currency")) > 0),
	CONSTRAINT "treasury_accounts_id_org_unique_fk_source" UNIQUE("id", "organization_id")
);
--> statement-breakpoint
CREATE TABLE "treasury_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"monthly_budget_micros" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_categories_code_nonempty" CHECK (length(btrim("code")) > 0),
	CONSTRAINT "treasury_categories_name_nonempty" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "treasury_categories_monthly_budget_nonneg" CHECK ("monthly_budget_micros" >= 0),
	CONSTRAINT "treasury_categories_currency_nonempty" CHECK (length(btrim("currency")) > 0),
	CONSTRAINT "treasury_categories_id_org_unique_fk_source" UNIQUE("id", "organization_id")
);
--> statement-breakpoint
CREATE TABLE "treasury_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"starts_on" date,
	"ends_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_projects_name_nonempty" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "treasury_projects_date_order" CHECK ("starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on"),
	CONSTRAINT "treasury_projects_id_org_unique_fk_source" UNIQUE("id", "organization_id")
);
--> statement-breakpoint
ALTER TABLE "treasury_counterparties" ADD CONSTRAINT "treasury_counterparties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_counterparties" ADD CONSTRAINT "treasury_counterparties_waia_user_id_users_id_fk" FOREIGN KEY ("waia_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_watched_address_same_org_fk" FOREIGN KEY ("watched_address_id", "organization_id") REFERENCES "public"."treasury_watched_addresses"("id", "organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_categories" ADD CONSTRAINT "treasury_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_projects" ADD CONSTRAINT "treasury_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_counterparties_org_username_unique" ON "treasury_counterparties" USING btree ("organization_id", "waia_username");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_counterparties_org_waia_user_unique" ON "treasury_counterparties" USING btree ("organization_id", "waia_user_id");
--> statement-breakpoint
CREATE INDEX "treasury_counterparties_org_active_name_idx" ON "treasury_counterparties" USING btree ("organization_id", "is_active", "display_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_accounts_org_name_unique" ON "treasury_accounts" USING btree ("organization_id", "display_name");
--> statement-breakpoint
CREATE INDEX "treasury_accounts_org_active_name_idx" ON "treasury_accounts" USING btree ("organization_id", "is_active", "display_name");
--> statement-breakpoint
CREATE INDEX "treasury_accounts_watched_address_idx" ON "treasury_accounts" USING btree ("watched_address_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_categories_org_code_unique" ON "treasury_categories" USING btree ("organization_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_categories_org_name_unique" ON "treasury_categories" USING btree ("organization_id", "name");
--> statement-breakpoint
CREATE INDEX "treasury_categories_org_active_name_idx" ON "treasury_categories" USING btree ("organization_id", "is_active", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_projects_org_name_unique" ON "treasury_projects" USING btree ("organization_id", "name");
--> statement-breakpoint
CREATE INDEX "treasury_projects_org_active_name_idx" ON "treasury_projects" USING btree ("organization_id", "is_active", "name");
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD COLUMN "counterparty_id" uuid;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD COLUMN "account_id" uuid;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD COLUMN "category_id" uuid;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_counterparty_same_org_fk" FOREIGN KEY ("counterparty_id", "organization_id") REFERENCES "public"."treasury_counterparties"("id", "organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_account_same_org_fk" FOREIGN KEY ("account_id", "organization_id") REFERENCES "public"."treasury_accounts"("id", "organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_category_same_org_fk" FOREIGN KEY ("category_id", "organization_id") REFERENCES "public"."treasury_categories"("id", "organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_project_same_org_fk" FOREIGN KEY ("project_id", "organization_id") REFERENCES "public"."treasury_projects"("id", "organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_counterparty_idx" ON "treasury_transactions" USING btree ("organization_id", "counterparty_id");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_account_idx" ON "treasury_transactions" USING btree ("organization_id", "account_id");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_category_idx" ON "treasury_transactions" USING btree ("organization_id", "category_id");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_project_idx" ON "treasury_transactions" USING btree ("organization_id", "project_id");
