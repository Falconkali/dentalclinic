-- ==============================================================================
-- 006_lead_notification_outbox.sql
-- Lumière Dental Studio: Transactional Notification Outbox & Admin Safeguards
-- 
-- 1. Creates durable lead_notifications outbox table for reliable webhook dispatch.
-- 2. Attaches AFTER INSERT trigger on public.leads to automatically enqueue events.
-- 3. Provides concurrency-safe batch claiming with exponential backoff retry support.
-- 4. Extends webhook_processed_events with stable event_id uniqueness.
-- 5. Hardens protect_profile_role_escalation() to prevent demoting/deactivating the last active admin.
-- ==============================================================================

-- 1. Durable Lead Notification Outbox Table
CREATE TABLE IF NOT EXISTS public.lead_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  payload jsonb NOT NULL,
  delivered_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_log text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure delivered_recipients column exists if table was previously created
ALTER TABLE public.lead_notifications 
  ADD COLUMN IF NOT EXISTS delivered_recipients jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Indices for reliable polling & lead lookups
CREATE INDEX IF NOT EXISTS idx_lead_notifications_queue 
  ON public.lead_notifications (status, next_retry_at) 
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_lead_notifications_lead_id 
  ON public.lead_notifications (lead_id);

-- Strict RLS: completely inaccessible from client roles (except admin read & manage)
ALTER TABLE public.lead_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_notifications TO authenticated;
GRANT ALL ON public.lead_notifications TO service_role;

DROP POLICY IF EXISTS "admin_read_lead_notifications" ON public.lead_notifications;
DROP POLICY IF EXISTS "admin_manage_lead_notifications" ON public.lead_notifications;
CREATE POLICY "admin_manage_lead_notifications" ON public.lead_notifications
FOR ALL TO authenticated
USING (current_staff_role() = 'admin'::staff_role)
WITH CHECK (current_staff_role() = 'admin'::staff_role);

-- 2. Trigger on public.leads: Enqueue Notification on Insert
CREATE OR REPLACE FUNCTION public.enqueue_lead_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id text;
BEGIN
  v_event_id := 'evt_lead_' || NEW.id::text;
  
  INSERT INTO public.lead_notifications (
    lead_id,
    event_id,
    status,
    payload
  ) VALUES (
    NEW.id,
    v_event_id,
    'pending',
    jsonb_build_object(
      'event_id', v_event_id,
      'lead_id', NEW.id,
      'id', NEW.id,
      'name', NEW.name,
      'phone', NEW.phone,
      'email', NEW.email,
      'service', NEW.service,
      'plan', NEW.plan,
      'preferred_date', NEW.preferred_date,
      'preferred_time', NEW.preferred_time,
      'message', NEW.message,
      'source', NEW.source,
      'created_at', NEW.created_at
    )
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enqueue_lead_notification ON public.leads;
CREATE TRIGGER tr_enqueue_lead_notification
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_lead_notification();

-- 3. Outbox Processing Authorization & Helper Functions
-- Robust role identification distinguishing service_role, DBA, and active admin
CREATE OR REPLACE FUNCTION public.is_service_or_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Direct superuser / DBA session check
  IF session_user IN ('postgres', 'supabase_admin') THEN
    RETURN true;
  END IF;

  -- 2. PostgREST role setting (set to 'service_role' when connecting via service_role key)
  IF current_user = 'service_role' THEN
    RETURN true;
  END IF;

  -- 3. PostgREST request JWT claim check (request.jwt.claim.role or request.jwt.claims -> 'role')
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN true;
  END IF;

  BEGIN
    IF (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 4. Supabase auth.jwt() helper if available
  BEGIN
    IF (auth.jwt() ->> 'role') = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 5. Clinic Staff Profile check: must be active administrator
  IF public.current_staff_role() = 'admin'::public.staff_role THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_service_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_service_or_admin() TO authenticated, service_role;

-- Atomically claim up to p_batch_size notifications ready for processing
-- Includes a 5-minute lease timeout to safely recover stale processing records,
-- and increments attempts on reclaimed stale items so repeated worker crashes respect max_attempts!
CREATE OR REPLACE FUNCTION public.claim_next_notification_batch(p_batch_size int DEFAULT 5)
RETURNS SETOF public.lead_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_service_or_admin() THEN
    RAISE EXCEPTION 'Access denied: Outbox queue operations require service_role or admin privileges'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Permanently fail any stale processing records that have already exhausted max_attempts
  UPDATE public.lead_notifications
  SET status = 'failed',
      error_log = 'Processing lease expired: worker crashed or timed out repeatedly (exceeded max_attempts)',
      updated_at = now()
  WHERE status = 'processing'
    AND last_attempt_at < now() - interval '5 minutes'
    AND attempts >= max_attempts;

  -- 2. Claim batch atomically, incrementing attempt count for reclaimed stale items
  -- so crashed attempts count toward the retry limit!
  RETURN QUERY
  UPDATE public.lead_notifications n
  SET status = 'processing',
      attempts = CASE 
        WHEN n.status = 'processing' THEN n.attempts + 1 
        ELSE n.attempts 
      END,
      last_attempt_at = now(),
      updated_at = now()
  WHERE n.id IN (
    SELECT id
    FROM public.lead_notifications
    WHERE (
      (status = 'pending' AND next_retry_at <= now())
      OR (status = 'failed' AND attempts < max_attempts AND next_retry_at <= now())
      OR (status = 'processing' AND last_attempt_at < now() - interval '5 minutes' AND attempts < max_attempts)
    )
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_notification_batch(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_notification_batch(int) TO authenticated, service_role;

-- Complete notification attempt (record success, partial delivery state, or exponential backoff retry)
CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_delivered_recipients jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts int;
  v_max_attempts int;
BEGIN
  IF NOT public.is_service_or_admin() THEN
    RAISE EXCEPTION 'Access denied: Outbox queue operations require service_role or admin privileges'
      USING ERRCODE = '42501';
  END IF;

  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM public.lead_notifications
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_status = 'delivered' THEN
    UPDATE public.lead_notifications
    SET status = 'delivered',
        error_log = NULL,
        delivered_recipients = COALESCE(p_delivered_recipients, delivered_recipients),
        updated_at = now()
    WHERE id = p_id;
  ELSE
    v_attempts := v_attempts + 1;
    IF v_attempts >= v_max_attempts THEN
      UPDATE public.lead_notifications
      SET status = 'failed',
          attempts = v_attempts,
          error_log = p_error,
          delivered_recipients = COALESCE(p_delivered_recipients, delivered_recipients),
          updated_at = now()
      WHERE id = p_id;
    ELSE
      UPDATE public.lead_notifications
      SET status = 'failed',
          attempts = v_attempts,
          error_log = p_error,
          delivered_recipients = COALESCE(p_delivered_recipients, delivered_recipients),
          -- Bounded exponential backoff: 15s, 30s, 60s, 120s...
          next_retry_at = now() + (power(2, v_attempts) * interval '15 seconds'),
          updated_at = now()
      WHERE id = p_id;
    END IF;
  END IF;
END;
$$;

-- Backward-compatibility overload for 3-argument calls
CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  p_id uuid,
  p_status text,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT public.complete_notification_delivery(p_id, p_status, p_error, NULL);
$$;

REVOKE ALL ON FUNCTION public.complete_notification_delivery(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(uuid, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_notification_delivery(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(uuid, text, text) TO authenticated, service_role;

-- 4. Extend webhook_processed_events for stable event_id deduplication
ALTER TABLE public.webhook_processed_events 
  ADD COLUMN IF NOT EXISTS event_id text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_webhook_processed_events_event_id 
  ON public.webhook_processed_events(event_id);

-- 4b. Realtime replica identity for leads table (full row change capture)
ALTER TABLE public.leads REPLICA IDENTITY FULL;

-- 5. Database Safeguard: Prevent Demoting or Deactivating the Last Active Administrator
CREATE OR REPLACE FUNCTION public.protect_profile_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Allow DBA direct console/migration executions (Supabase Dashboard SQL Editor / migrations)
  -- In direct DBA sessions, session_user is 'postgres' or 'supabase_admin' and auth.uid() is NULL.
  IF session_user IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. For API / authenticated staff requests, strictly enforce that only active administrators can alter roles or active status
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF public.current_staff_role() IS DISTINCT FROM 'admin'::public.staff_role THEN
      RAISE EXCEPTION 'Only administrators can modify staff roles or account status.' USING errcode='42501';
    END IF;

    -- 3. Last Active Administrator Safeguard:
    -- If demoting an admin or deactivating an admin, ensure there is at least one other active admin
    IF OLD.role = 'admin'::public.staff_role AND (NEW.role <> 'admin'::public.staff_role OR NEW.is_active = false) THEN
      IF (
        SELECT count(*)
        FROM public.profiles
        WHERE role = 'admin'::public.staff_role
          AND is_active = true
          AND id <> OLD.id
      ) = 0 THEN
        RAISE EXCEPTION 'Cannot demote or deactivate the last remaining active administrator.' USING errcode='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Automated Background Outbox Scheduler via pg_cron & pg_net
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_scheduled_outbox_processing()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_secret text;
  v_url text;
  v_body jsonb;
  v_headers jsonb;
BEGIN
  -- Retrieve dedicated CRON_SECRET from Supabase Vault (zero plaintext credentials in cron job)
  v_secret := public.get_vault_secret('CRON_SECRET');

  v_url := 'https://nczxzztlwveocdxphsmk.supabase.co/functions/v1/process-notification-outbox';
  
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-key', COALESCE(v_secret, '')
  );

  v_body := jsonb_build_object('batch_size', 10);

  -- Perform asynchronous HTTP POST via pg_net
  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := v_body
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_scheduled_outbox_processing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_scheduled_outbox_processing() TO authenticated, service_role;

-- Schedule outbox processing every minute via pg_cron (idempotent setup)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'process-notification-outbox-every-minute'
  ) THEN
    PERFORM cron.schedule(
      'process-notification-outbox-every-minute',
      '* * * * *',
      'SELECT public.trigger_scheduled_outbox_processing()'
    );
  END IF;
END $$;

-- Defense-in-depth: revoke public access to extension internal schemas
DO $$
BEGIN
  REVOKE USAGE ON SCHEMA net FROM PUBLIC, anon, authenticated;
  REVOKE USAGE ON SCHEMA cron FROM PUBLIC, anon, authenticated;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
