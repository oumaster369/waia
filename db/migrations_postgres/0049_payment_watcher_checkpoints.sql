CREATE TABLE "payment_watcher_checkpoints" (
	"network" text PRIMARY KEY NOT NULL,
	"last_scanned_block" text NOT NULL,
	"last_scanned_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
