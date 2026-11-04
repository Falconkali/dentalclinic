import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key, x-test-mock-provider, x-test-fail-provider',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing backend database configuration' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(url, serviceKey);

  // Authentication & Authorization:
  // Allowed callers:
  // 1. Bearer with service_role key
  // 2. Bearer with authenticated staff token WHERE role = 'admin' AND is_active = true
  // 3. Header x-cron-key matching CRON_SECRET (dedicated secret in Supabase Vault)
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const cronKey = req.headers.get('x-cron-key')?.trim();

  let isAuthorized = false;
  let callerType = 'anonymous';

  let expectedCron = Deno.env.get('CRON_SECRET');
  if (!expectedCron) {
    try {
      const { data: vCron } = await supabase.rpc('get_vault_secret', { p_name: 'CRON_SECRET' });
      if (vCron && typeof vCron === 'string') expectedCron = vCron;
    } catch {}
  }

  if (cronKey && expectedCron && cronKey === expectedCron) {
    isAuthorized = true;
    callerType = 'cron';
  } else if (token === serviceKey) {
    isAuthorized = true;
    callerType = 'service_role';
  } else if (token) {
    // Check if user token is an active administrator
    const { data: userResp, error: userErr } = await supabase.auth.getUser(token);
    if (!userErr && userResp?.user?.id) {
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', userResp.user.id)
        .maybeSingle();

      if (!profErr && profile?.role === 'admin' && profile?.is_active === true) {
        isAuthorized = true;
        callerType = 'admin:' + userResp.user.id;
      }
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Admin or service credentials required to process outbox' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Security Invariant: Mock mode is NEVER permitted from portal UI or arbitrary requests!
  // It is strictly restricted to isolated automated test runs authenticated with TEST_WEBHOOK_SECRET
  const isTestSuite = req.headers.get('x-test-suite') === 'true';
  const testSuiteKey = req.headers.get('x-test-suite-key')?.trim();
  let isAuthorizedTestSuite = false;

  if (isTestSuite && testSuiteKey) {
    let expectedTestSecret = Deno.env.get('TEST_WEBHOOK_SECRET');
    if (!expectedTestSecret) {
      try {
        const { data: vTest } = await supabase.rpc('get_vault_secret', { p_name: 'TEST_WEBHOOK_SECRET' });
        if (vTest && typeof vTest === 'string') expectedTestSecret = vTest;
      } catch {}
    }
    if (expectedTestSecret && testSuiteKey === expectedTestSecret) {
      isAuthorizedTestSuite = true;
    }
  }

  // Parse request options
  let batchSize = 10;
  let mockProvider = false;
  let failProvider = false;
  let failPatientOnly = false;

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body.batch_size && typeof body.batch_size === 'number') {
        batchSize = Math.max(1, Math.min(50, body.batch_size));
      }
      // ONLY authorized test suite invocations with valid TEST_WEBHOOK_SECRET can trigger simulated providers
      if (isAuthorizedTestSuite) {
        if (body.test_mock_provider === true) {
          mockProvider = true;
        }
        if (body.test_fail_provider === true) {
          failProvider = true;
        }
        if (body.test_fail_patient_only === true) {
          failPatientOnly = true;
          mockProvider = true;
        }
      }
    } catch {
      // Use defaults
    }
  }

  // Atomically claim next notification batch from database queue
  // SQL function includes 5-minute lease recovery for stale processing items
  const { data: claimedBatch, error: claimErr } = await supabase.rpc('claim_next_notification_batch', {
    p_batch_size: batchSize
  });

  if (claimErr) {
    console.error('Error claiming outbox batch:', claimErr);
    return new Response(JSON.stringify({ error: 'Failed to claim outbox batch: ' + claimErr.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const batch = (claimedBatch || []) as Array<{
    id: string;
    lead_id: string;
    event_id: string;
    attempts: number;
    max_attempts: number;
    delivered_recipients?: string[];
    payload: Record<string, unknown>;
  }>;

  if (batch.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      claimed: 0,
      delivered: 0,
      failed: 0,
      caller: callerType,
      message: 'Notification outbox queue is currently empty'
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // Resolve required email delivery secrets (Deno.env or Supabase Vault)
  let resendKey = Deno.env.get('RESEND_API_KEY');
  let staffEmail = Deno.env.get('CLINIC_NOTIFICATION_EMAIL');
  let from = Deno.env.get('EMAIL_FROM');

  if (!resendKey || !staffEmail || !from) {
    try {
      const { data: vKey } = await supabase.rpc('get_vault_secret', { p_name: 'RESEND_API_KEY' });
      if (vKey && typeof vKey === 'string') resendKey = vKey;
      const { data: vEmail } = await supabase.rpc('get_vault_secret', { p_name: 'CLINIC_NOTIFICATION_EMAIL' });
      if (vEmail && typeof vEmail === 'string') staffEmail = vEmail;
      const { data: vFrom } = await supabase.rpc('get_vault_secret', { p_name: 'EMAIL_FROM' });
      if (vFrom && typeof vFrom === 'string') from = vFrom;
    } catch {
      // Non-blocking Vault check
    }
  }

  const safe = (s: unknown) => String(s ?? '—').replace(/[<>]/g, '');

  let deliveredCount = 0;
  let failedCount = 0;
  const executionResults: Array<{ id: string; event_id: string; status: string; error?: string; delivered_recipients?: string[] }> = [];

  for (const item of batch) {
    const deliveredRecipients = new Set<string>(
      Array.isArray(item.delivered_recipients) ? item.delivered_recipients : []
    );

    try {
      // 1. Strict Configuration Verification (False Success Prevention)
      // A notification must NEVER be marked delivered if the required email provider configuration is missing!
      if (!mockProvider) {
        if (!resendKey || resendKey.trim().length === 0) {
          throw new Error('Missing required email configuration: RESEND_API_KEY is not configured');
        }
        if (!staffEmail || staffEmail.trim().length === 0) {
          throw new Error('Missing required email configuration: CLINIC_NOTIFICATION_EMAIL is not configured');
        }
        if (!from || from.trim().length === 0) {
          throw new Error('Missing required email configuration: EMAIL_FROM is not configured');
        }
      }

      // 2. Retrieve Authoritative Verified Lead Record
      const { data: lead, error: fetchErr } = await supabase
        .from('leads')
        .select('id, name, phone, email, service, preferred_date, preferred_time, message')
        .eq('id', item.lead_id)
        .single();

      if (fetchErr || !lead) {
        throw new Error(`Lead record not found in verified database (lead_id: ${item.lead_id}): ${fetchErr?.message || 'not found'}`);
      }

      // 3. Provider Delivery Simulation for Isolated Automated Tests
      if (failProvider) {
        throw new Error('Simulated email provider network timeout / 503 Service Unavailable');
      }

      // 4. Send Clinic Staff Notification (if not already delivered in a previous attempt)
      if (!deliveredRecipients.has('clinic')) {
        if (mockProvider) {
          deliveredRecipients.add('clinic');
        } else {
          const staffHtml = `<h2>New dental appointment enquiry</h2>
<p><b>Patient:</b> ${safe(lead.name)}</p>
<p><b>Phone:</b> ${safe(lead.phone)}<br>
<b>Email:</b> ${safe(lead.email)}<br>
<b>Service:</b> ${safe(lead.service)}<br>
<b>Preferred date:</b> ${safe(lead.preferred_date)}<br>
<b>Preferred time:</b> ${safe(lead.preferred_time)}</p>
<p><b>Patient notes:</b> ${safe(lead.message)}</p>
<p><b>Lead Reference ID:</b> ${safe(lead.id)}</p>`;

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': `${item.event_id}-clinic`
            },
            body: JSON.stringify({
              from: from!,
              to: [staffEmail!],
              subject: `New enquiry: ${safe(lead.name)} — ${safe(lead.service)}`,
              html: staffHtml
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Resend API error sending staff alert (${res.status}): ${errText}`);
          }
          deliveredRecipients.add('clinic');
        }
      }

      // 5. Send Patient Confirmation Email (if patient email provided and not yet delivered)
      if (lead.email && !deliveredRecipients.has('patient')) {
        if (failPatientOnly) {
          throw new Error('Simulated patient email provider rejection (simulated partial failure)');
        }

        if (mockProvider) {
          deliveredRecipients.add('patient');
        } else {
          const patientHtml = `<p>Hello ${safe(lead.name)},</p>
<p>Thank you for contacting Lumière Dental Studio. We have received your appointment request for <b>${safe(lead.service)}</b>.</p>
<p>Please note that this is an initial appointment request, not a confirmed booking. Our reception desk will review our clinical schedule and contact you shortly to confirm your consultation time.</p>
<p>Warm regards,<br><b>Lumière Dental Studio</b></p>`;

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': `${item.event_id}-patient`
            },
            body: JSON.stringify({
              from: from!,
              to: [lead.email],
              subject: 'We received your appointment request — Lumière Dental Studio',
              html: patientHtml
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Resend API error sending patient receipt (${res.status}): ${errText}`);
          }
          deliveredRecipients.add('patient');
        }
      }

      // 6. Record Delivery Completion in Outbox (All Required Recipients Succeeded)
      const { error: completeErr } = await supabase.rpc('complete_notification_delivery', {
        p_id: item.id,
        p_status: 'delivered',
        p_error: null,
        p_delivered_recipients: Array.from(deliveredRecipients)
      });

      if (completeErr) {
        throw new Error('Database error recording delivery completion: ' + completeErr.message);
      }

      // 7. Deduplication & Activity Logging
      const { error: eventErr } = await supabase
        .from('webhook_processed_events')
        .insert({
          nonce: 'outbox_' + item.id.replace(/-/g, ''),
          event_id: item.event_id,
          processed_at: new Date().toISOString()
        });
      if (eventErr && eventErr.code !== '23505') {
        console.warn('Deduplication record warning:', eventErr.message);
      }

      const { error: activityErr } = await supabase.from('lead_activity').insert({
        lead_id: item.lead_id,
        type: 'outbox_notification_delivered',
        meta: {
          outbox_id: item.id,
          event_id: item.event_id,
          processed_by: callerType,
          delivered_recipients: Array.from(deliveredRecipients),
          delivered_at: new Date().toISOString()
        }
      });
      if (activityErr) {
        console.warn('Lead activity record warning:', activityErr.message);
      }

      deliveredCount++;
      executionResults.push({
        id: item.id,
        event_id: item.event_id,
        status: 'delivered',
        delivered_recipients: Array.from(deliveredRecipients)
      });
    } catch (deliveryErr: any) {
      console.error(`Error delivering outbox notification ${item.id}:`, deliveryErr.message);

      // Record failure and schedule exponential backoff retry in outbox
      // Preserves partial delivery state so already-delivered recipients are not resent!
      const { error: failErr } = await supabase.rpc('complete_notification_delivery', {
        p_id: item.id,
        p_status: 'failed',
        p_error: deliveryErr.message,
        p_delivered_recipients: Array.from(deliveredRecipients)
      });

      if (failErr) {
        console.error('Critical database error recording notification failure:', failErr.message);
      }

      failedCount++;
      executionResults.push({
        id: item.id,
        event_id: item.event_id,
        status: 'failed',
        error: deliveryErr.message,
        delivered_recipients: Array.from(deliveredRecipients)
      });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    claimed: batch.length,
    delivered: deliveredCount,
    failed: failedCount,
    caller: callerType,
    results: executionResults
  }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
});
