-- DEE-311 / AT-E11 S6: extend invoice_status enum with ISSUED (isolated — do not use in same migration).

ALTER TYPE "public"."invoice_status" ADD VALUE IF NOT EXISTS 'ISSUED';
