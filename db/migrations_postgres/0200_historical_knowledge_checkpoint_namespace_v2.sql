-- DEE-920: isolate Historical Simulation V2 checkpoints by their digest-bound
-- run/surface identity while preserving the existing GENERAL live/paper identity.

ALTER TABLE public.trader_knowledge_state_checkpoint_v2
  ADD COLUMN checkpoint_namespace text DEFAULT 'GENERAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE public.trader_knowledge_state_checkpoint_v2
  ADD CONSTRAINT trader_knowledge_state_checkpoint_v2_namespace_nonempty_check
  CHECK (btrim(checkpoint_namespace) <> '');
--> statement-breakpoint
ALTER TABLE public.trader_knowledge_state_checkpoint_v2
  ADD CONSTRAINT trader_knowledge_state_checkpoint_v2_namespace_identity_check
  CHECK (
    checkpoint_namespace = 'GENERAL'
    OR (
      checkpoint_namespace = model_version
      AND checkpoint_namespace LIKE
        'waia.trader.historical_simulation_knowledge_binding.v2|%'
    )
  );
--> statement-breakpoint
-- Rows written by the pre-0200 Historical adapter already bind their run in
-- model_version. Move only those rows out of GENERAL. The old adapter did not
-- bind symbol, so new run+surface restores intentionally fail closed and restart.
ALTER TABLE public.trader_knowledge_state_checkpoint_v2
  DISABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_update;
--> statement-breakpoint
UPDATE public.trader_knowledge_state_checkpoint_v2
SET checkpoint_namespace = model_version
WHERE checkpoint_namespace = 'GENERAL'
  AND model_version LIKE 'waia.trader.historical_simulation_knowledge_binding.v2|%';
--> statement-breakpoint
ALTER TABLE public.trader_knowledge_state_checkpoint_v2
  ENABLE TRIGGER trader_knowledge_state_checkpoint_v2_block_update;
--> statement-breakpoint
DROP INDEX IF EXISTS public.tksc_v2_org_checkpoint_seq_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX tksc_v2_org_namespace_checkpoint_seq_uq
  ON public.trader_knowledge_state_checkpoint_v2 USING btree
  (organization_id, checkpoint_namespace, checkpoint_seq);
