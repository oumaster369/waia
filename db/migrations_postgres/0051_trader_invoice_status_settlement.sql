-- AT-E12 S3-B: extend invoice_status with PAID (isolated — do not combine with table DDL).

ALTER TYPE "public"."invoice_status" ADD VALUE IF NOT EXISTS 'PAID';
