-- ==============================================================================
-- 004_database_functions.sql
-- Lumière Dental Studio: Security Definer Public APIs & Helpers
-- ==============================================================================

-- 1. Verified Public Appointment Request Function (submit_lead) with Authoritative Idempotency & Role Separation
CREATE OR REPLACE FUNCTION public.submit_lead(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE 
  v_id uuid; 
  v_name text; 
  v_phone text; 
  v_source public.lead_source; 
  v_email text;
  v_status public.lead_status;
  v_client_sub_id text;
  v_pref_date date;
  v_service text;
  v_notes text;
  v_doctor text;
  v_assigned_to uuid;
  v_is_rapid_repeat boolean := false;
  v_prior_patient_name text;
  v_phone_recent_count integer;
  v_caller_is_staff boolean;
BEGIN
  -- 1. Anti-bot honeypot check
  IF coalesce(p_payload->>'honeypot','') <> '' THEN 
    RETURN jsonb_build_object('ok', true, 'id', null); 
  END IF;

  v_client_sub_id := nullif(trim(coalesce(p_payload->>'client_submission_id', '')), '');
  v_name := trim(coalesce(p_payload->>'name',''));
  v_phone := regexp_replace(coalesce(p_payload->>'phone',''), '\D','','g');
  v_email := nullif(trim(coalesce(p_payload->>'email','')),'');
  v_pref_date := nullif(p_payload->>'preferred_date','')::date;
  v_service := left(coalesce(p_payload->>'service', 'General dentistry'), 160);

  -- 2. Immediate Authoritative Idempotency Check: By client_submission_id
  IF v_client_sub_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads WHERE client_submission_id = v_client_sub_id LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'id', v_id, 'deduplicated', true);
    END IF;
  END IF;

  -- 3. Strict Input Validation
  IF length(v_name) < 2 OR length(v_name) > 120 THEN 
    RAISE EXCEPTION 'Please provide a valid patient name.' USING errcode='22023'; 
  END IF;

  IF length(v_phone) < 8 OR length(v_phone) > 16 THEN 
    RAISE EXCEPTION 'Please provide a valid phone number.' USING errcode='22023'; 
  END IF;

  IF v_email IS NOT NULL AND v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN 
    RAISE EXCEPTION 'Please provide a valid email address.' USING errcode='22023'; 
  END IF;

  -- 4. Database-Level Rate Limiting (Defense-in-depth against direct RPC spam)
  -- Max 5 new submissions per phone number within 10 minutes
  IF v_phone <> '' THEN
    SELECT count(*) INTO v_phone_recent_count
    FROM public.leads
    WHERE phone = v_phone
      AND created_at > (now() - interval '10 minutes');

    IF v_phone_recent_count >= 5 THEN
      RAISE EXCEPTION 'Rate limit exceeded: Too many booking attempts for this phone number. Please wait or call reception directly.' USING errcode='42901';
    END IF;
  END IF;

  -- 5. Caller Privilege Verification
  -- STRICT CLINICAL ROLE SEPARATION:
  -- Only Administrators and Receptionists can set clinical management fields (status, doctor, assigned_to, staff_notes, source).
  -- Doctors and anonymous/public callers are strictly restricted to new / unassigned / zero privileged fields.
  v_caller_is_staff := public.is_staff() AND (public.current_staff_role() IN ('admin'::public.staff_role, 'receptionist'::public.staff_role));

  IF v_caller_is_staff THEN
    v_source := CASE 
      WHEN p_payload->>'source' = 'contact_form' THEN 'contact_form'::public.lead_source 
      WHEN p_payload->>'source' = 'walk_in' THEN 'walk_in'::public.lead_source
      WHEN p_payload->>'source' = 'phone' THEN 'phone'::public.lead_source
      WHEN p_payload->>'source' = 'whatsapp' THEN 'whatsapp'::public.lead_source
      WHEN p_payload->>'source' = 'manual' THEN 'manual'::public.lead_source
      ELSE 'booking_form'::public.lead_source 
    END;

    v_status := CASE 
      WHEN p_payload->>'status' = 'booked' OR p_payload->>'status' = 'Confirmed' THEN 'booked'::public.lead_status
      WHEN p_payload->>'status' = 'completed' OR p_payload->>'status' = 'Completed' THEN 'completed'::public.lead_status
      WHEN p_payload->>'status' = 'lost' OR p_payload->>'status' = 'Cancelled' THEN 'lost'::public.lead_status
      ELSE 'new'::public.lead_status
    END;

    v_doctor := coalesce(nullif(trim(p_payload->>'doctor'), ''), 'Unassigned');
    v_assigned_to := nullif(trim(p_payload->>'assigned_to'), '')::uuid;
    v_notes := trim(coalesce(p_payload->>'staff_notes', p_payload->>'notes', ''));
  ELSE
    -- Public / Doctor Submission Security Boundaries:
    -- Doctors and unauthenticated callers cannot self-confirm bookings, assign staff, or write internal reception notes
    v_source := 'booking_form'::public.lead_source;
    v_status := 'new'::public.lead_status;
    v_doctor := 'Unassigned';
    v_assigned_to := NULL;
    v_notes := '';
  END IF;

  -- 6. Heuristic Review Check (Never silently swallow legitimate bookings)
  IF v_phone <> '' AND v_pref_date IS NOT NULL THEN
    SELECT name INTO v_prior_patient_name 
    FROM public.leads 
    WHERE phone = v_phone 
      AND preferred_date = v_pref_date 
      AND created_at > (now() - interval '5 minutes')
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_prior_patient_name IS NOT NULL THEN
      v_is_rapid_repeat := true;
    END IF;
  END IF;

  IF v_is_rapid_repeat THEN
    IF lower(v_prior_patient_name) = lower(v_name) THEN
      v_notes := ltrim(v_notes || E'\n[Review Notice: Repeated submission for same patient/date within 5 min]');
    ELSE
      v_notes := ltrim(v_notes || E'\n[Review Notice: Additional family/patient booking under same phone within 5 min (Prior: ' || v_prior_patient_name || ')]');
    END IF;
  END IF;

  -- 7. Concurrency-Safe Insert with ON CONFLICT DO NOTHING
  INSERT INTO public.leads(
    client_submission_id,
    name,
    phone,
    email,
    service,
    plan,
    preferred_date,
    preferred_time,
    message,
    source,
    status,
    doctor,
    assigned_to,
    staff_notes,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    page_url,
    form_started_at
  )
  VALUES (
    v_client_sub_id,
    v_name,
    v_phone,
    v_email,
    v_service,
    left(p_payload->>'plan', 120),
    v_pref_date,
    left(coalesce(p_payload->>'preferred_time', '10:00 AM'), 40),
    left(p_payload->>'message', 3000),
    v_source,
    v_status,
    v_doctor,
    v_assigned_to,
    nullif(v_notes, ''),
    left(p_payload->>'utm_source', 200),
    left(p_payload->>'utm_medium', 200),
    left(p_payload->>'utm_campaign', 200),
    left(p_payload->>'utm_term', 200),
    left(p_payload->>'utm_content', 200),
    left(p_payload->>'page_url', 1000),
    nullif(p_payload->>'form_started_at','')::timestamptz
  )
  ON CONFLICT (client_submission_id) DO NOTHING
  RETURNING id INTO v_id;

  -- Handle concurrent race condition: If another thread inserted in parallel, retrieve existing ID
  IF v_id IS NULL AND v_client_sub_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads WHERE client_submission_id = v_client_sub_id LIMIT 1;
    RETURN jsonb_build_object(
      'ok', true, 
      'id', v_id, 
      'deduplicated', true,
      'potential_duplicate', false
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 
    'id', v_id, 
    'deduplicated', false,
    'potential_duplicate', v_is_rapid_repeat
  );
END;
$$;

-- Security Ingress: Revoke execution from ALL client roles (public, anon, authenticated).
-- Only service_role (used exclusively by the secured Edge Function) can execute submit_lead.
-- Direct REST RPC access is completely sealed against all roles.
REVOKE ALL ON FUNCTION public.submit_lead(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_lead(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.submit_lead(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_lead(jsonb) TO service_role;

-- 2. IP Rate Limit Checking Function for Edge Functions (check_submit_rate_limit)
CREATE TABLE IF NOT EXISTS public.submit_rate_limits (
  ip_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  submissions int NOT NULL DEFAULT 1
);
ALTER TABLE public.submit_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_submit_rate_limit(p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n int;
BEGIN
  -- Automatic Cleanup Policy: Purge IP rate limit records older than 24 hours to prevent unbounded table growth
  DELETE FROM public.submit_rate_limits WHERE window_started_at < now() - interval '24 hours';

  INSERT INTO public.submit_rate_limits(ip_hash, window_started_at, submissions)
  VALUES(p_ip_hash, now(), 1)
  ON CONFLICT(ip_hash) DO UPDATE SET
    window_started_at = CASE WHEN public.submit_rate_limits.window_started_at < now() - interval '1 hour' THEN now() ELSE public.submit_rate_limits.window_started_at END,
    submissions = CASE WHEN public.submit_rate_limits.window_started_at < now() - interval '1 hour' THEN 1 ELSE public.submit_rate_limits.submissions + 1 END
  RETURNING submissions INTO n;

  RETURN jsonb_build_object('allowed', n <= 5, 'remaining', greatest(0, 5 - n));
END;
$$;

REVOKE ALL ON public.submit_rate_limits FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_submit_rate_limit(text) TO service_role;

-- 3. Maintenance / Automated Audit Helper to Reset Test IP Rate Limits
CREATE OR REPLACE FUNCTION public.reset_test_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.submit_rate_limits WHERE ip_hash IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_test_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_test_rate_limits() TO service_role;

-- 4. Newsletter Subscription Function (submit_subscriber)
CREATE OR REPLACE FUNCTION public.submit_subscriber(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean text;
BEGIN
  v_clean := lower(trim(coalesce(p_email, '')));
  IF length(v_clean) > 254 OR v_clean !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Please provide a valid email address.' USING errcode='22023';
  END IF;

  INSERT INTO public.subscribers (email)
  VALUES (v_clean)
  ON CONFLICT (email) DO UPDATE
  SET is_active = true;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Security Ingress: Revoke execution from client roles (anon, authenticated); service_role is the sole ingress point
REVOKE ALL ON FUNCTION public.submit_subscriber(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_subscriber(text) TO service_role;

-- 5. Server Vault Secret Resolver for Edge Functions (get_vault_secret)
-- Allows secured Edge Functions running under service_role to resolve application secrets
-- stored securely in Supabase Vault (vault.secrets / vault.decrypted_secrets).
CREATE OR REPLACE FUNCTION public.get_vault_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vault_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_secret(text) TO service_role;
