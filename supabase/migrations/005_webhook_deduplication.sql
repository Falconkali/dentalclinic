-- ==============================================================================
-- 005_webhook_deduplication.sql
-- Lumière Dental Studio: Webhook Event Nonce Deduplication Table
-- Prevents duplicate webhook processing (e.g. repeated notification emails)
-- within a 10-minute replay window.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_processed_events (
  nonce text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_events_processed_at_idx ON public.webhook_processed_events(processed_at);

-- Enable RLS; client roles have no access. Only service_role (Edge Functions) can write.
ALTER TABLE public.webhook_processed_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_processed_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_processed_events TO service_role;

-- Automatic cleanup function: purge nonces older than 10 minutes
CREATE OR REPLACE FUNCTION public.cleanup_processed_webhook_events()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.webhook_processed_events WHERE processed_at < now() - interval '10 minutes';
$$;

REVOKE ALL ON FUNCTION public.cleanup_processed_webhook_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_processed_webhook_events() TO service_role;
