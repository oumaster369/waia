-- AT-E12 S3-B / DEE-217: append-only SUSPENDED account status event type.

ALTER TYPE "public"."account_status_event_type" ADD VALUE IF NOT EXISTS 'SUSPENDED';
