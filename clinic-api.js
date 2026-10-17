/* Lumière public-site integration. Configure window.CLINIC_CONFIG in index.html before loading this file.
   Public key only; never put a service-role key in a browser. */
(function () {
  const config = window.CLINIC_CONFIG || {};
  const key = config.supabaseAnonKey;
  const url = config.supabaseUrl;
  let _client = null;

  function getClient() {
    if (_client) return _client;
    if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
      _client = window.supabase.createClient(url, key);
      return _client;
    }
    return null;
  }

  const queueKey = 'lumierePendingSubmissions';
  const utmKey = 'lumiereFirstTouchUtm';
  const firstTouch = (() => {
    try {
      const saved = sessionStorage.getItem(utmKey);
      if (saved) return JSON.parse(saved);
      const p = new URLSearchParams(location.search);
      const v = Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].map(k => [k, p.get(k) || null]));
      sessionStorage.setItem(utmKey, JSON.stringify(v));
      return v;
    } catch { return {}; }
  })();

  function pending() { try { return JSON.parse(localStorage.getItem(queueKey) || '[]'); } catch { return []; } }
  function savePending(v) { try { localStorage.setItem(queueKey, JSON.stringify(v)); } catch {} }

  async function submitLead(payload) {
    const row = {
      ...payload,
      ...firstTouch,
      page_url: location.href,
      honeypot: payload.honeypot || ''
    };

    if (!url || !key) {
      const q = pending();
      q.push({ ...row, _queued_at: new Date().toISOString() });
      savePending(q);
      return { queued: true, configured: false };
    }

    try {
      const res = await fetch(`${url}/functions/v1/submit-lead-rate-limit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(row)
      });

      const data = await res.json().catch(() => null);

      if (res.ok) {
        return { data, queued: false, configured: true };
      }

      // If function is 404 (not deployed) or error, fallback to direct client insert
      const client = getClient();
      if (client && (res.status === 404 || res.status >= 500)) {
        const { data: inserted, error: insErr } = await client.from('leads').insert({
          name: row.name,
          phone: row.phone,
          email: row.email || null,
          service: row.service || null,
          preferred_date: row.preferred_date || null,
          preferred_time: row.preferred_time || null,
          message: row.message || null,
          source: row.source || 'booking_form',
          status: 'new',
          priority: 'normal'
        }).select('id').single();
        if (!insErr && inserted) {
          return { data: inserted, queued: false, configured: true };
        }
      }

      const errMsg = data?.error || (res.status === 429 ? 'Too many requests. Please try again shortly.' : `Submission failed (${res.status})`);
      throw new Error(errMsg);
    } catch (err) {
      const client = getClient();
      if (client && navigator.onLine) {
        try {
          const { data: inserted, error: insErr } = await client.from('leads').insert({
            name: row.name,
            phone: row.phone,
            email: row.email || null,
            service: row.service || null,
            preferred_date: row.preferred_date || null,
            preferred_time: row.preferred_time || null,
            message: row.message || null,
            source: row.source || 'booking_form',
            status: 'new',
            priority: 'normal'
          }).select('id').single();
          if (!insErr && inserted) {
            return { data: inserted, queued: false, configured: true };
          }
        } catch (_) {}
      }

      if (!navigator.onLine || err.name === 'TypeError') {
        const q = pending();
        q.push({ ...row, _queued_at: new Date().toISOString() });
        savePending(q);
        return { queued: true, configured: true, offline: true };
      }
      throw err;
    }
  }

  async function retryQueue() {
    if (!url || !key || !navigator.onLine) return;
    const q = pending();
    if (!q.length) return;
    const remain = [];
    for (const item of q) {
      try {
        const res = await fetch(`${url}/functions/v1/submit-lead-rate-limit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': key,
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify(item)
        });
        if (!res.ok) remain.push(item);
      } catch {
        remain.push(item);
      }
    }
    savePending(remain);
  }

  async function subscribe(email) {
    if (!url || !key) throw new Error('Newsletter signup is not configured yet.');
    const cleanEmail = email.trim().toLowerCase();
    const res = await fetch(`${url}/functions/v1/subscribe-newsletter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({ email: cleanEmail })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || `Subscription failed (${res.status})`);
    }
    return { alreadySubscribed: Boolean(data?.alreadySubscribed) };
  }

  async function published(table, order = 'sort_order') {
    const client = getClient();
    if (!client) return null;
    const { data, error } = await client.from(table).select('*').eq('is_published', true).order(order, { ascending: true });
    if (error) throw error;
    return data;
  }

  async function getSlots(date) {
    const client = getClient();
    if (!client) return null;
    const { data, error } = await client.rpc('get_available_slots', { p_date: date });
    if (error) throw error;
    return data;
  }

  async function getSettings() {
    const client = getClient();
    if (!client) return null;
    const { data, error } = await client.from('site_settings').select('*').limit(1).single();
    if (error) return null;
    return data;
  }

  window.ClinicAPI = {
    isConfigured: () => Boolean(url && key),
    getClient,
    submitLead,
    subscribe,
    published,
    getSettings,
    getSlots,
    retryQueue
  };

  window.addEventListener('online', retryQueue);
  retryQueue();
})();
