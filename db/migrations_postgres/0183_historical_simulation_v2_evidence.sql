CREATE TABLE "trader_historical_simulation_reason_ledger_v2" (
  "entry_id" text PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL,
  "cycle_id" text NOT NULL,
  "cycle_sequence" integer NOT NULL,
  "symbol" text NOT NULL,
  "partition" text NOT NULL,
  "capital_eligible" boolean DEFAULT false NOT NULL,
  "replay_bar_closed_at_utc" timestamptz NOT NULL,
  "previous_content_digest_hex" text,
  "forecast_json" jsonb NOT NULL,
  "decision_json" jsonb NOT NULL,
  "portfolio_json" jsonb NOT NULL,
  "risk_json" jsonb NOT NULL,
  "execution_json" jsonb NOT NULL,
  "accounting_json" jsonb NOT NULL,
  "guardian_json" jsonb NOT NULL,
  "learning_json" jsonb NOT NULL,
  "content_digest_hex" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "historical_sim_v2_preholdout_only" CHECK ("partition" IN ('DEVELOPMENT','WALK_FORWARD')),
  CONSTRAINT "historical_sim_v2_never_capital" CHECK ("capital_eligible" = false),
  CONSTRAINT "historical_sim_v2_nonnegative_sequence" CHECK ("cycle_sequence" >= 0),
  CONSTRAINT "historical_sim_v2_content_digest" CHECK ("content_digest_hex" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "historical_sim_v2_previous_digest" CHECK ("previous_content_digest_hex" IS NULL OR "previous_content_digest_hex" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "historical_sim_v2_org_run_sequence_unique" UNIQUE ("organization_id", "run_id", "cycle_sequence"),
  CONSTRAINT "historical_sim_v2_entry_org_unique" UNIQUE ("entry_id", "organization_id"),
  CONSTRAINT "historical_sim_v2_org_digest_unique" UNIQUE ("organization_id", "content_digest_hex")
);
CREATE INDEX "historical_sim_v2_org_run_bar_idx" ON "trader_historical_simulation_reason_ledger_v2" ("organization_id", "run_id", "replay_bar_closed_at_utc");

CREATE TABLE "trader_historical_simulation_modeled_evidence_v2" (
  "evidence_id" text PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "reason_ledger_entry_id" text NOT NULL,
  "evidence_kind" text NOT NULL,
  "evidence_ordinal" integer NOT NULL,
  "source_content_digest_hex" text,
  "evidence_content_digest_hex" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "capital_eligible" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "historical_sim_modeled_evidence_kind" CHECK ("evidence_kind" IN ('RISK','EXECUTION','GUARDIAN','FILL')),
  CONSTRAINT "historical_sim_modeled_evidence_never_capital" CHECK ("capital_eligible" = false),
  CONSTRAINT "historical_sim_modeled_evidence_nonnegative_ordinal" CHECK ("evidence_ordinal" >= 0),
  CONSTRAINT "historical_sim_modeled_evidence_digest" CHECK ("evidence_content_digest_hex" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "historical_sim_modeled_source_digest" CHECK ("source_content_digest_hex" IS NULL OR "source_content_digest_hex" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "historical_sim_modeled_evidence_entry_kind_ordinal_unique" UNIQUE ("reason_ledger_entry_id", "evidence_kind", "evidence_ordinal"),
  CONSTRAINT "historical_sim_modeled_evidence_entry_org_fk" FOREIGN KEY ("reason_ledger_entry_id", "organization_id") REFERENCES "trader_historical_simulation_reason_ledger_v2"("entry_id", "organization_id") ON DELETE CASCADE
);
CREATE INDEX "historical_sim_modeled_evidence_org_entry_idx" ON "trader_historical_simulation_modeled_evidence_v2" ("organization_id", "reason_ledger_entry_id", "evidence_kind");

CREATE FUNCTION "trader_historical_simulation_v2_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'historical simulation V2 evidence is append-only';
END $$;
CREATE TRIGGER "historical_sim_reason_ledger_v2_append_only" BEFORE UPDATE OR DELETE ON "trader_historical_simulation_reason_ledger_v2" FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();
CREATE TRIGGER "historical_sim_modeled_evidence_v2_append_only" BEFORE UPDATE OR DELETE ON "trader_historical_simulation_modeled_evidence_v2" FOR EACH ROW EXECUTE FUNCTION "trader_historical_simulation_v2_append_only"();

ALTER TABLE "trader_historical_simulation_reason_ledger_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_historical_simulation_modeled_evidence_v2" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "trader_historical_simulation_reason_ledger_v2" FROM anon, authenticated;
REVOKE ALL ON "trader_historical_simulation_modeled_evidence_v2" FROM anon, authenticated;
