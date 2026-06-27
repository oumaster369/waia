-- AT-E12 S3-C-B: operator reconciliation workflow schema (Postgres).

CREATE TYPE settlement_reconciliation_resolution_type AS ENUM (
  'MANUAL_APPLY',
  'WAIVE',
  'CLOSE_NO_ACTION',
  'CLOSE_DUPLICATE'
);
--> statement-breakpoint
ALTER TABLE trader_settlement_reconciliation_cases
  ADD COLUMN current_decision_id uuid;
--> statement-breakpoint
ALTER TABLE trader_settlement_applications
  ADD COLUMN decision_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX trader_settlement_applications_settlement_id_unique
  ON trader_settlement_applications (settlement_id);
