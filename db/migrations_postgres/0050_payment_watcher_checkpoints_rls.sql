-- DEE-321 / AT-E12 S3-A: payment_watcher_checkpoints targeted RLS (ADR-0007 defense-in-depth).

ALTER TABLE public.payment_watcher_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_watcher_checkpoints_deny_authenticated_select ON public.payment_watcher_checkpoints;
CREATE POLICY payment_watcher_checkpoints_deny_authenticated_select ON public.payment_watcher_checkpoints
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_watcher_checkpoints_deny_authenticated_insert ON public.payment_watcher_checkpoints;
CREATE POLICY payment_watcher_checkpoints_deny_authenticated_insert ON public.payment_watcher_checkpoints
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS payment_watcher_checkpoints_deny_authenticated_update ON public.payment_watcher_checkpoints;
CREATE POLICY payment_watcher_checkpoints_deny_authenticated_update ON public.payment_watcher_checkpoints
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_watcher_checkpoints_deny_authenticated_delete ON public.payment_watcher_checkpoints;
CREATE POLICY payment_watcher_checkpoints_deny_authenticated_delete ON public.payment_watcher_checkpoints
  FOR DELETE
  TO authenticated, anon
  USING (false);
