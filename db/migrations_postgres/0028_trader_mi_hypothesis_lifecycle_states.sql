-- DEE-286 / LD-5a.1b: extend mi_hypothesis_lifecycle_state enum (doctrine §7 states).
-- Isolated ALTER TYPE only — new values must not be used in the same transaction.

ALTER TYPE "public"."mi_hypothesis_lifecycle_state" ADD VALUE IF NOT EXISTS 'VALIDATING';
--> statement-breakpoint
ALTER TYPE "public"."mi_hypothesis_lifecycle_state" ADD VALUE IF NOT EXISTS 'VALIDATED';
--> statement-breakpoint
ALTER TYPE "public"."mi_hypothesis_lifecycle_state" ADD VALUE IF NOT EXISTS 'DECAYING';
--> statement-breakpoint
ALTER TYPE "public"."mi_hypothesis_lifecycle_state" ADD VALUE IF NOT EXISTS 'RETIRED';
--> statement-breakpoint
ALTER TYPE "public"."mi_hypothesis_lifecycle_state" ADD VALUE IF NOT EXISTS 'QUARANTINED';
