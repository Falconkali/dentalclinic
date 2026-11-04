-- ==============================================================================
-- 003_row_level_security.sql
-- Lumière Dental Studio: Row-Level Security Policies for Multi-Role Clinical Access
-- ==============================================================================

-- Enable RLS across all tables
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Profiles Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_read_profiles" ON public.profiles;
DROP POLICY IF EXISTS "staff read all active profiles" ON public.profiles;
DROP POLICY IF EXISTS "active_staff_read_profiles" ON public.profiles;
CREATE POLICY "active_staff_read_profiles" ON public.profiles
FOR SELECT TO authenticated
USING (is_staff() AND is_active = true);

DROP POLICY IF EXISTS "staff can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "authenticated read own profile" ON public.profiles;
CREATE POLICY "authenticated read own profile" ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "admin_manage_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admin manages profiles" ON public.profiles;
CREATE POLICY "admin_manage_profiles" ON public.profiles
FOR ALL TO authenticated
USING (current_staff_role() = 'admin'::staff_role)
WITH CHECK (current_staff_role() = 'admin'::staff_role);

-- ------------------------------------------------------------------------------
-- Leads (Appointments) Policies — Strict Role & UUID-Based Enforcement
-- ------------------------------------------------------------------------------
-- 1. SELECT: Admins and Receptionists see all leads; Doctors ONLY see assigned leads via UUID
DROP POLICY IF EXISTS "staff_select_leads" ON public.leads;
DROP POLICY IF EXISTS "staff read leads" ON public.leads;
CREATE POLICY "staff_select_leads" ON public.leads
FOR SELECT TO authenticated
USING (
  is_staff() AND (
    current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role)
    OR (
      current_staff_role() = 'doctor'::staff_role
      AND assigned_to = auth.uid()
    )
  )
);

-- 2. INSERT: Receptionist and Admin can insert walk-in leads; Doctors blocked
DROP POLICY IF EXISTS "staff_insert_leads" ON public.leads;
CREATE POLICY "staff_insert_leads" ON public.leads
FOR INSERT TO authenticated
WITH CHECK (
  is_staff() AND current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role)
);

-- 3. UPDATE: Receptionist & Admin can update all; Doctor can ONLY update their assigned appointments
DROP POLICY IF EXISTS "staff_update_leads" ON public.leads;
DROP POLICY IF EXISTS "doctor update assigned leads" ON public.leads;
CREATE POLICY "staff_update_leads" ON public.leads
FOR UPDATE TO authenticated
USING (
  is_staff() AND (
    current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role)
    OR (
      current_staff_role() = 'doctor'::staff_role
      AND assigned_to = auth.uid()
    )
  )
)
WITH CHECK (
  is_staff() AND (
    current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role)
    OR (
      current_staff_role() = 'doctor'::staff_role
      AND assigned_to = auth.uid()
    )
  )
);

-- 4. DELETE: ONLY ADMIN CAN DELETE LEADS (Receptionists & Doctors blocked)
DROP POLICY IF EXISTS "admin_delete_leads" ON public.leads;
DROP POLICY IF EXISTS "admin and reception manage leads" ON public.leads;
CREATE POLICY "admin_delete_leads" ON public.leads
FOR DELETE TO authenticated
USING (
  is_staff() AND current_staff_role() = 'admin'::staff_role
);

-- 5. Trigger Guard: Restrict doctor updates strictly to status and staff_notes (Whitelist)
-- Every other column in public.leads is strictly immutable to doctors
CREATE OR REPLACE FUNCTION public.protect_lead_doctor_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.current_staff_role() = 'doctor'::public.staff_role THEN
    -- STRICT WHITELIST: Doctors may ONLY modify 'status' and 'staff_notes' (and 'updated_at').
    -- Every other column in public.leads is strictly immutable to doctors.
    IF (
      NEW.id IS DISTINCT FROM OLD.id OR
      NEW.client_submission_id IS DISTINCT FROM OLD.client_submission_id OR
      NEW.name IS DISTINCT FROM OLD.name OR
      NEW.phone IS DISTINCT FROM OLD.phone OR
      NEW.email IS DISTINCT FROM OLD.email OR
      NEW.service IS DISTINCT FROM OLD.service OR
      NEW.plan IS DISTINCT FROM OLD.plan OR
      NEW.preferred_date IS DISTINCT FROM OLD.preferred_date OR
      NEW.preferred_time IS DISTINCT FROM OLD.preferred_time OR
      NEW.message IS DISTINCT FROM OLD.message OR
      NEW.source IS DISTINCT FROM OLD.source OR
      NEW.priority IS DISTINCT FROM OLD.priority OR
      NEW.doctor IS DISTINCT FROM OLD.doctor OR
      NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR
      NEW.lost_reason IS DISTINCT FROM OLD.lost_reason OR
      NEW.estimated_value IS DISTINCT FROM OLD.estimated_value OR
      NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR
      NEW.created_at IS DISTINCT FROM OLD.created_at OR
      NEW.page_url IS DISTINCT FROM OLD.page_url OR
      NEW.form_started_at IS DISTINCT FROM OLD.form_started_at OR
      NEW.utm_source IS DISTINCT FROM OLD.utm_source OR
      NEW.utm_medium IS DISTINCT FROM OLD.utm_medium OR
      NEW.utm_campaign IS DISTINCT FROM OLD.utm_campaign OR
      NEW.utm_term IS DISTINCT FROM OLD.utm_term OR
      NEW.utm_content IS DISTINCT FROM OLD.utm_content
    ) THEN
      RAISE EXCEPTION 'Doctors may only update appointment status and clinical notes.' USING errcode='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_check_lead_doctor_reassignment ON public.leads;
DROP TRIGGER IF EXISTS tr_protect_lead_doctor_columns ON public.leads;
CREATE TRIGGER tr_protect_lead_doctor_columns
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_lead_doctor_columns();

-- 5b. Trigger Guard: Unconditionally override updated_at with database server clock
CREATE OR REPLACE FUNCTION public.set_lead_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_lead_updated_at ON public.leads;
CREATE TRIGGER tr_set_lead_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_lead_updated_at();

-- 6. Trigger Guard: Prevent non-admins from changing profiles roles or active status
CREATE OR REPLACE FUNCTION public.protect_profile_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Allow DBA direct console/migration executions (Supabase Dashboard SQL Editor / migrations)
  -- In direct DBA sessions, session_user is 'postgres' or 'supabase_admin' and auth.uid() is NULL.
  -- IMPORTANT: We check session_user (original connection identity), NEVER current_user
  -- (which always resolves to the function owner in a SECURITY DEFINER context).
  IF session_user IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. For API / authenticated staff requests, strictly enforce that only active administrators can alter roles or active status
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF public.current_staff_role() IS DISTINCT FROM 'admin'::public.staff_role THEN
      RAISE EXCEPTION 'Only administrators can modify staff roles or account status.' USING errcode='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_profile_role_escalation ON public.profiles;
CREATE TRIGGER tr_protect_profile_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_role_escalation();

-- ------------------------------------------------------------------------------
-- Public Read Access for Published Content
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "public_read_services" ON public.services;
CREATE POLICY "public_read_services" ON public.services
FOR SELECT TO anon, authenticated
USING (is_published = true OR is_staff());

DROP POLICY IF EXISTS "public_read_doctors" ON public.doctors;
CREATE POLICY "public_read_doctors" ON public.doctors
FOR SELECT TO anon, authenticated
USING (is_published = true OR is_staff());

DROP POLICY IF EXISTS "public_read_pricing" ON public.pricing_plans;
CREATE POLICY "public_read_pricing" ON public.pricing_plans
FOR SELECT TO anon, authenticated
USING (is_published = true OR is_staff());

DROP POLICY IF EXISTS "public_read_testimonials" ON public.testimonials;
CREATE POLICY "public_read_testimonials" ON public.testimonials
FOR SELECT TO anon, authenticated
USING (is_published = true OR is_staff());

DROP POLICY IF EXISTS "public_read_faqs" ON public.faqs;
CREATE POLICY "public_read_faqs" ON public.faqs
FOR SELECT TO anon, authenticated
USING (is_published = true OR is_staff());

DROP POLICY IF EXISTS "public_read_gallery" ON public.gallery_cases;
CREATE POLICY "public_read_gallery" ON public.gallery_cases
FOR SELECT TO anon, authenticated
USING (is_published = true OR is_staff());

-- ------------------------------------------------------------------------------
-- Subscribers Management
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_manage_subscribers" ON public.subscribers;
CREATE POLICY "staff_manage_subscribers" ON public.subscribers
FOR ALL TO authenticated
USING (current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role))
WITH CHECK (current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role));

-- ------------------------------------------------------------------------------
-- Internal Lead Activity Security (Internal Audit Records)
-- ------------------------------------------------------------------------------
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_activity TO authenticated;
GRANT ALL ON public.lead_activity TO service_role;

DROP POLICY IF EXISTS "staff_read_activity" ON public.lead_activity;
CREATE POLICY "staff_read_activity" ON public.lead_activity
FOR SELECT TO authenticated
USING (
  is_staff() AND (
    current_staff_role() IN ('admin'::staff_role, 'receptionist'::staff_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_activity.lead_id AND l.assigned_to = auth.uid()
    )
  )
);
