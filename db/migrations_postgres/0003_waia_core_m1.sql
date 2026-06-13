CREATE TYPE "public"."organization_kind" AS ENUM('personal', 'business', 'fund', 'partner');--> statement-breakpoint
CREATE TYPE "public"."organization_member_role" AS ENUM('owner', 'member', 'manager');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('user', 'admin', 'agent', 'service');--> statement-breakpoint
CREATE TYPE "public"."waia_module" AS ENUM('twin', 'trader', '3p', 'marketplace');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'admin', 'agent', 'service', 'system');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"avatar_ref" text,
	"settings_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_id_unique" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organizations_owner_user_id_idx" ON "organizations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_role" "organization_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE TABLE "user_platform_roles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "platform_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"module" "waia_module" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_subscriptions_org_module_unique" ON "organization_subscriptions" USING btree ("organization_id","module");--> statement-breakpoint
CREATE TABLE "organization_entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entitlement_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"source_module" "waia_module",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_entitlements_org_key_unique" ON "organization_entitlements" USING btree ("organization_id","entitlement_key");--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"organization_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_platform_roles" ADD CONSTRAINT "user_platform_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_entitlements" ADD CONSTRAINT "organization_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
