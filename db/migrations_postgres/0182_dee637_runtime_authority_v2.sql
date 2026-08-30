CREATE TABLE "trader_runtime_authority_assessments_v2" (
  "assessment_id" text PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "runtime_instance_id" text NOT NULL,
  "posture" text NOT NULL CHECK ("posture" IN ('FULL_ANALYSIS_AND_NEW_RISK','NO_NEW_RISK','CLOSE_ONLY','HALT')),
  "content_digest" text NOT NULL CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
  "canonical_json" text NOT NULL CHECK (jsonb_typeof("canonical_json"::jsonb) = 'object'),
  "adjudicated_at_utc" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CHECK ("assessment_id" = 'runtime-authority-v2:' || "content_digest")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_runtime_authority_assessments_v2_org_digest_unique" ON "trader_runtime_authority_assessments_v2" ("organization_id","content_digest");
--> statement-breakpoint
CREATE INDEX "trader_runtime_authority_assessments_v2_org_runtime_idx" ON "trader_runtime_authority_assessments_v2" ("organization_id","runtime_instance_id","created_at");
--> statement-breakpoint
CREATE TABLE "trader_runtime_control_lease_heads_v2" (
  "organization_id" uuid PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "runtime_instance_id" text NOT NULL,
  "lease_epoch" integer NOT NULL CHECK ("lease_epoch" > 0),
  "content_digest" text NOT NULL CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
  "valid_until_utc" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_runtime_control_lease_epoch_history_v2" (
  "content_digest" text PRIMARY KEY NOT NULL CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "runtime_instance_id" text NOT NULL,
  "lease_epoch" integer NOT NULL CHECK ("lease_epoch" > 0),
  "prior_content_digest" text,
  "valid_until_utc" timestamptz NOT NULL,
  "adjudicated_at_utc" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  UNIQUE ("organization_id", "lease_epoch")
);
--> statement-breakpoint
CREATE FUNCTION "trader_runtime_authority_v2_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RUNTIME_AUTHORITY_V2_APPEND_ONLY'; END $$;
--> statement-breakpoint
CREATE TRIGGER "trader_runtime_authority_assessments_v2_update_guard" BEFORE UPDATE OR DELETE ON "trader_runtime_authority_assessments_v2" FOR EACH ROW EXECUTE FUNCTION "trader_runtime_authority_v2_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "trader_runtime_control_lease_epoch_history_v2_update_guard" BEFORE UPDATE OR DELETE ON "trader_runtime_control_lease_epoch_history_v2" FOR EACH ROW EXECUTE FUNCTION "trader_runtime_authority_v2_append_only_guard"();
--> statement-breakpoint
ALTER TABLE "trader_runtime_authority_assessments_v2" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trader_runtime_authority_assessments_v2" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trader_runtime_authority_assessments_v2_deny_direct" ON "trader_runtime_authority_assessments_v2" AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE "trader_runtime_control_lease_heads_v2" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trader_runtime_control_lease_heads_v2" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trader_runtime_control_lease_heads_v2_deny_direct" ON "trader_runtime_control_lease_heads_v2" AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE "trader_runtime_control_lease_epoch_history_v2" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trader_runtime_control_lease_epoch_history_v2" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trader_runtime_control_lease_epoch_history_v2_deny_direct" ON "trader_runtime_control_lease_epoch_history_v2" AS RESTRICTIVE FOR ALL USING (false) WITH CHECK (false);
