-- DEE-1108: inert recorded NO_TRADE receipts; no trading or qualification authority.
CREATE TABLE "trader_runtime_noncapital_cycles_v2" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "account_id" text NOT NULL CHECK (length(btrim("account_id")) > 0),
  "symbol" text NOT NULL CHECK (length(btrim("symbol")) > 0),
  "bar_interval" text NOT NULL CHECK ("bar_interval" IN ('1m','15m','1h','4h','1d')),
  "pit_anchor" timestamptz NOT NULL,
  "input_digest" text NOT NULL CHECK ("input_digest" ~ '^[0-9a-f]{64}$'),
  "content_digest" text NOT NULL CHECK ("content_digest" ~ '^[0-9a-f]{64}$'),
  "canonical_json" text NOT NULL CHECK (jsonb_typeof("canonical_json"::jsonb) = 'object'
    AND "canonical_json"::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.noncapital_cycle_receipt.v2'
    AND "canonical_json"::jsonb->'result'->>'status' IS NOT DISTINCT FROM 'NO_TRADE'),
  "runtime_instance_id" text NOT NULL CHECK (length(btrim("runtime_instance_id")) > 0),
  "lease_epoch" integer NOT NULL CHECK ("lease_epoch" > 0),
  "lease_content_digest" text NOT NULL REFERENCES "trader_runtime_control_lease_epoch_history_v2"("content_digest"),
  "recorded_at_utc" timestamptz NOT NULL,
  CONSTRAINT "trader_runtime_noncapital_cycles_v2_pk" PRIMARY KEY ("organization_id","account_id","symbol","bar_interval","pit_anchor")
);
--> statement-breakpoint
CREATE TRIGGER "trader_runtime_noncapital_cycles_v2_append_only"
  BEFORE UPDATE OR DELETE ON "trader_runtime_noncapital_cycles_v2"
  FOR EACH ROW EXECUTE FUNCTION "trader_runtime_authority_v2_append_only_guard"();
--> statement-breakpoint
-- Serialize with the existing organization owner, and check wall time again at commit.
-- No SECURITY DEFINER: privileged runtime connection follows the existing service boundary.
CREATE FUNCTION "trader_runtime_noncapital_cycles_v2_fence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner trader_runtime_control_lease_heads_v2%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 637));
  SELECT * INTO owner FROM trader_runtime_control_lease_heads_v2
    WHERE organization_id = NEW.organization_id FOR UPDATE;
  IF NOT FOUND OR owner.runtime_instance_id <> NEW.runtime_instance_id
    OR owner.lease_epoch <> NEW.lease_epoch OR owner.content_digest <> NEW.lease_content_digest
    OR clock_timestamp() > owner.valid_until_utc
  THEN RAISE EXCEPTION 'RUNTIME_CONTROL_LEASE_STALE_HOLDER'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trader_runtime_noncapital_cycles_v2_commit_fence"
  AFTER INSERT ON "trader_runtime_noncapital_cycles_v2"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "trader_runtime_noncapital_cycles_v2_fence"();
--> statement-breakpoint
ALTER TABLE "trader_runtime_noncapital_cycles_v2" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "noncapital_cycles_v2_browser_deny" ON "trader_runtime_noncapital_cycles_v2"
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
