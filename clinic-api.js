/**
 * Lumière Dental Studio — Unified Clinic API Layer
 * 
 * Secure Supabase client wrapper for both public patient website and staff portal.
 * Handles Supabase Auth, verified appointment submissions, newsletter subscriptions,
 * cloud CRUD with RLS, and Postgres Realtime synchronisation.
 */
(function() {
  const cfg = window.CLINIC_CONFIG || {};
  const supabaseUrl = cfg.supabaseUrl || cfg.integrations?.supabaseUrl;
  const supabaseAnonKey = cfg.supabaseAnonKey || cfg.integrations?.supabaseAnonKey;
  const submitEndpoint = cfg.submitEndpoint || cfg.integrations?.submitEndpoint;
  const newsletterEndpoint = cfg.newsletterEndpoint || cfg.integrations?.newsletterEndpoint;

  const isConfigured = Boolean(supabaseUrl && supabaseAnonKey && window.supabase);
  const client = isConfigured ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  }) : null;

  // First-touch UTM parameter tracking
  const utmKey = 'lumiereFirstTouchUtm';
  const firstTouch = (() => {
    try {
      const saved = sessionStorage.getItem(utmKey);
      if (saved) return JSON.parse(saved);
      const p = new URLSearchParams(window.location.search);
      const v = Object.fromEntries(
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
          .map(k => [k, p.get(k) || null])
      );
      sessionStorage.setItem(utmKey, JSON.stringify(v));
      return v;
    } catch {
      return {};
    }
  })();

  // 1. Genuine Supabase Authentication
  const auth = {
    async signIn(email, password) {
      if (!client) throw new Error('Supabase client is not initialized.');
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password
      });
      if (error) throw error;
      return data;
    },

    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.warn('Get session error:', error);
        return null;
      }
      return data.session;
    },

    async getCurrentUser() {
      if (!client) return null;
      const { data, error } = await client.auth.getUser();
      if (error || !data?.user) return null;
      return data.user;
    },

    async getProfile(userId) {
      if (!client) return null;
      let targetId = userId;
      if (!targetId) {
        const user = await this.getCurrentUser();
        if (!user) return null;
        targetId = user.id;
      }
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .single();

      if (error) {
        console.warn('Profile fetch error:', error);
        return null;
      }
      return data;
    },

    onAuthStateChange(callback) {
      if (!client) return { data: { subscription: { unsubscribe: () => {} } } };
      return client.auth.onAuthStateChange(callback);
    }
  };

  // 2. Strict Public Booking Submission with Idempotency Guard
  async function submitAppointment(payload) {
    if (!client) {
      throw new Error('Clinic database is not configured. Please contact reception at ' + (cfg.phone || 'the clinic'));
    }

    if (!payload.client_submission_id) {
      payload.client_submission_id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));
    }
    const clientSubmissionId = payload.client_submission_id;

    const row = {
      ...firstTouch,
      client_submission_id: clientSubmissionId,
      name: payload.name?.trim(),
      phone: payload.phone?.trim(),
      email: payload.email?.trim() || null,
      service: payload.service || 'General dentistry',
      plan: payload.plan || null,
      preferred_date: payload.preferred_date || payload.date || null,
      preferred_time: payload.preferred_time || payload.time || '10:00 AM',
      message: payload.message?.trim() || null,
      source: payload.source || 'booking_form',
      page_url: window.location.href,
      honeypot: payload.honeypot || '',
      form_started_at: payload.form_started_at || new Date().toISOString()
    };

    // Architecture Boundary: Edge Function is the sole ingress for public anonymous submissions.
    // Anonymous execution of submit_lead is revoked in Postgres to prevent rate-limit bypasses.
    let result = null;
    if (submitEndpoint) {
      try {
        const res = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(row)
        });

        if (res.ok) {
          result = await res.json();
        } else if (res.status === 429) {
          const errData = await res.json().catch(() => ({}));
          const rateErr = new Error(errData.error || errData.message || 'Rate limit exceeded: Too many booking attempts. Please wait a moment before trying again or call reception.');
          rateErr.status = 429;
          rateErr.isRateLimited = true;
          throw rateErr;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || 'Appointment submission service is temporarily unavailable. Please retry or contact reception.');
        }
      } catch (err) {
        // Re-throw rate limits and submission errors; do NOT fall back to direct anonymous RPC
        throw err;
      }
    } else {
      // Ingress Boundary: submit_lead execution is revoked from all client roles (anon and authenticated).
      // All appointment requests must be routed via the secured Edge Function.
      throw new Error('Appointment booking service is temporarily unavailable. Please contact reception directly at ' + (cfg.phone || 'the studio'));
    }

    // Strict Verification
    if (!result || !result.id) {
      throw new Error('Clinic server did not return a valid booking confirmation. Please retry or contact the studio.');
    }

    return {
      success: true,
      id: result.id,
      shortRef: 'LUM-' + result.id.slice(0, 8).toUpperCase(),
      data: result
    };
  }

  // 3. Strict Newsletter Subscription
  async function subscribeNewsletter(email) {
    if (!client) throw new Error('Clinic database is not configured.');
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }

    // Edge Function is the sole authorized ingress point; submit_subscriber execution is revoked from client roles
    if (!newsletterEndpoint) {
      throw new Error('Newsletter service is temporarily unavailable. Please try again later.');
    }

    const res = await fetch(newsletterEndpoint, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: cleanEmail })
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, ...data };
    }

    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || 'Newsletter subscription failed. Please try again later.');
  }

  // 4. Staff Portal Operations (Authenticated)
  async function getStaffDoctors() {
    if (!client) return [];
    try {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, role, is_active')
        .eq('role', 'doctor')
        .eq('is_active', true)
        .order('full_name', { ascending: true });

      if (error) {
        console.warn('Error fetching staff doctors from profiles:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('getStaffDoctors error:', err);
      return [];
    }
  }

  async function getAppointments() {
    if (!client) throw new Error('Supabase client is not ready.');
    const { data, error } = await client
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch appointments error:', error);
      throw error;
    }
    return data || [];
  }

  async function updateAppointment(id, updates) {
    if (!client) throw new Error('Supabase client is not ready.');
    if (!id) throw new Error('Appointment ID is required.');

    const cleanUpdates = { ...updates };
    delete cleanUpdates.updated_at; // Managed authoritatively by PostgreSQL triggers
    const { data, error } = await client
      .from('leads')
      .update(cleanUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update appointment error:', error);
      throw error;
    }
    return data;
  }

  async function createWalkIn(payload) {
    if (!client) throw new Error('Supabase client is not ready.');

    if (!payload.client_submission_id) {
      payload.client_submission_id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'walkin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));
    }

    const row = {
      client_submission_id: payload.client_submission_id,
      name: payload.name?.trim(),
      phone: payload.phone?.trim(),
      email: payload.email?.trim() || null,
      service: payload.service || 'General dentistry',
      plan: payload.plan || null,
      preferred_date: payload.preferred_date || payload.date || null,
      preferred_time: payload.preferred_time || payload.time || '10:00 AM',
      message: payload.message?.trim() || null,
      doctor: payload.doctor || 'Unassigned',
      assigned_to: payload.assigned_to || payload.assignedTo || null,
      staff_notes: payload.staff_notes || payload.staffNotes || 'Logged at reception desk',
      source: 'walk_in',
      status: payload.status === 'Confirmed' ? 'booked' : 'new'
    };

    // Safe Idempotency: Check if client_submission_id already exists to prevent destructive overwrites
    const { data: existing } = await client
      .from('leads')
      .select('*')
      .eq('client_submission_id', row.client_submission_id)
      .maybeSingle();

    if (existing) {
      // Return existing booking record without mutating its columns
      return existing;
    }

    const { data, error } = await client
      .from('leads')
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.code === '23505' || (error.message && error.message.includes('unique constraint'))) {
        // Concurrent race condition: Another process completed insertion with the same key
        const { data: racedExisting } = await client
          .from('leads')
          .select('*')
          .eq('client_submission_id', row.client_submission_id)
          .maybeSingle();
        if (racedExisting) return racedExisting;
      }
      console.error('Walk-in database insert failed:', error);
      throw new Error(error.message || 'Unable to record walk-in appointment in database.');
    }

    return data;
  }

  async function deleteAppointment(id) {
    if (!client) throw new Error('Supabase client is not ready.');
    if (!id) throw new Error('Appointment ID is required.');

    const { data, error } = await client
      .from('leads')
      .delete()
      .eq('id', id)
      .select('id, name');

    if (error) {
      console.error('Delete appointment error:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      throw new Error('Deletion failed: Record was not found or your user role is not authorized to delete appointments. Only administrators can delete records.');
    }

    return { success: true, deleted: data[0] };
  }

  // 5. Postgres Realtime Subscription
  function subscribeRealtime(onEvent) {
    if (!client) return () => {};
    const channelName = 'realtime:leads-' + Math.random().toString(36).slice(2, 7);
    const channel = client.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        if (typeof onEvent === 'function') onEvent(payload);
      })
      .subscribe((status, err) => {
        if (err) console.warn('Realtime subscription status:', status, err);
      });

    return () => {
      try { client.removeChannel(channel); } catch (e) {}
    };
  }

  // Expose global ClinicAPI
  window.ClinicAPI = {
    supabaseUrl,
    supabaseAnonKey,
    isConfigured: () => isConfigured,
    client,
    auth,
    submitAppointment,
    subscribeNewsletter,
    getStaffDoctors,
    getAppointments,
    updateAppointment,
    createWalkIn,
    deleteAppointment,
    subscribeRealtime
  };
})();
