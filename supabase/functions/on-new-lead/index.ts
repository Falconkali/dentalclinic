import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp, x-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function verifyHmac(secret: string, dataToSign: string, signatureHex: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const target = signatureHex.replace(/^v1=/, '').trim().toLowerCase();
    if (computedHex.length !== target.length) return false;

    // Constant-time timing-safe comparison
    let diff = 0;
    for (let i = 0; i < computedHex.length; i++) {
      diff |= computedHex.charCodeAt(i) ^ target.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const url = Deno.env.get('SUPABASE_URL');

    if (!serviceKey || !url) {
      return new Response(JSON.stringify({ error: 'Missing backend database configuration' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(url, serviceKey);

    // Invariant 1: Fail-Closed Secret Resolution with Strict Test vs Production Isolation
    const isTestSuite = req.headers.get('x-test-suite') === 'true';
    let webhookSecret: string | null = null;

    if (isTestSuite) {
      webhookSecret = Deno.env.get('TEST_WEBHOOK_SECRET') || null;
      if (!webhookSecret || webhookSecret.trim().length === 0) {
        try {
          const { data: vaultSecret } = await supabase.rpc('get_vault_secret', { p_name: 'TEST_WEBHOOK_SECRET' });
          if (vaultSecret && typeof vaultSecret === 'string') webhookSecret = vaultSecret;
        } catch {}
      }
      if (!webhookSecret || webhookSecret.trim().length === 0) {
        console.error('CRITICAL: TEST_WEBHOOK_SECRET is not configured for test invocation.');
        return new Response(JSON.stringify({ error: 'Server configuration error: TEST_WEBHOOK_SECRET required for test suite' }), {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    } else {
      webhookSecret = Deno.env.get('WEBHOOK_SECRET') || null;
      if (!webhookSecret || webhookSecret.trim().length === 0) {
        try {
          const { data: vaultSecret } = await supabase.rpc('get_vault_secret', { p_name: 'WEBHOOK_SECRET' });
          if (vaultSecret && typeof vaultSecret === 'string') webhookSecret = vaultSecret;
        } catch {}
      }
      if (!webhookSecret || webhookSecret.trim().length === 0) {
        console.error('CRITICAL: WEBHOOK_SECRET is not configured on the server.');
        return new Response(JSON.stringify({ error: 'Server configuration error: WEBHOOK_SECRET required' }), {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    }

    const rawBody = await req.text();
    const nowSec = Math.floor(Date.now() / 1000);

    // Enforce payload size limit (32KB)
    if (rawBody.length > 32768) {
      return new Response(JSON.stringify({ error: 'Payload too large (max 32KB)' }), {
        status: 413,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Parse Headers for Authentication & Replay Protection
    let timestamp = req.headers.get('x-webhook-timestamp');
    let signature = req.headers.get('x-webhook-signature');

    // Support combined signature header (e.g. "t=1700000000,v1=abcdef...")
    const combinedSig = req.headers.get('x-signature');
    if (combinedSig) {
      const parts = combinedSig.split(',');
      for (const part of parts) {
        const [k, v] = part.split('=');
        if (k?.trim() === 't') timestamp = v?.trim();
        if (k?.trim() === 'v1') signature = v?.trim();
      }
    }

    // HMAC-SHA256 signature via x-webhook-signature + x-webhook-timestamp is the ONLY auth method.
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing webhook signature' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Replay Protection Verification
    if (!timestamp) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing required webhook timestamp for replay protection' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const tsNum = parseInt(timestamp, 10);
    if (isNaN(tsNum)) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid timestamp format' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Replay window: Reject timestamps older than 300 seconds (5 mins) or more than 60 seconds in the future
    if (nowSec - tsNum > 300) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Webhook timestamp expired (replay protection)' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    if (tsNum - nowSec > 60) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Webhook timestamp in future' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Authenticate HMAC-SHA256 Signature
    const isValidSig = await verifyHmac(webhookSecret, `${tsNum}.${rawBody}`, signature);
    if (!isValidSig) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid HMAC signature' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Parse Payload
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Extract Lead ID and stable event_id
    const recordObj = (body.record && typeof body.record === 'object') ? (body.record as Record<string, unknown>) : null;
    const leadId = (recordObj?.id || body.id || body.lead_id) as string;
    if (!leadId || typeof leadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing lead ID' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const eventId = (body.event_id || recordObj?.event_id || `evt_lead_${leadId}`) as string;
    const nonce = await sha256Hex(`${tsNum}.${rawBody}`);

    // Retrieve true notification outbox UUID
    let notifId = (body.notification_id as string) || null;
    if (!notifId) {
      try {
        const { data: nRow } = await supabase
          .from('lead_notifications')
          .select('id')
          .eq('event_id', eventId)
          .maybeSingle();
        if (nRow?.id) notifId = nRow.id;
      } catch {
        // Non-blocking query
      }
    }

    // Invariant 2: Stable Event ID & Nonce Deduplication with Fail-Closed DB Verification
    // Check if stable event_id was ALREADY successfully delivered and completed
    const { data: existingEvent, error: checkErr } = await supabase
      .from('webhook_processed_events')
      .select('event_id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (checkErr) {
      console.error('CRITICAL: Deduplication lookup error:', checkErr);
      return new Response(JSON.stringify({ error: 'Deduplication verification unavailable' }), {
        status: 503,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (existingEvent) {
      return new Response(JSON.stringify({ ok: true, deduplicated: true, message: 'Event already processed' }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Query database for authoritative verified lead record
    const { data: lead, error: fetchErr } = await supabase
      .from('leads')
      .select('id, name, phone, email, service, preferred_date, preferred_time, message')
      .eq('id', leadId)
      .single();

    if (fetchErr || !lead) {
      return new Response(JSON.stringify({ error: 'Lead record not found in verified database' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Atomically record verified webhook event in webhook_processed_events
    const { error: insertErr } = await supabase
      .from('webhook_processed_events')
      .insert({ nonce, event_id: eventId, processed_at: new Date().toISOString() });

    if (insertErr && insertErr.code !== '23505') {
      console.warn('Deduplication record warning:', insertErr.message);
    }

    // Clean up stale nonces older than 10 minutes
    try {
      await supabase.rpc('cleanup_processed_webhook_events');
    } catch {
      // non-blocking
    }

    // Record internal audit activity in lead_activity
    try {
      await supabase.from('lead_activity').insert({
        lead_id: lead.id,
        type: 'webhook_verified',
        meta: {
          processed_at: new Date().toISOString(),
          event_id: eventId,
          test_suite: isTestSuite
        }
      });
    } catch {
      // non-blocking
    }

    return new Response(JSON.stringify({
      ok: true,
      lead_id: lead.id,
      event_id: eventId,
      verified: true
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (unhandledErr: any) {
    console.error('Unhandled error in on-new-lead:', unhandledErr.message);
    return new Response(JSON.stringify({
      error: unhandledErr.message,
      stack: unhandledErr.stack
    }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
});
