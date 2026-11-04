import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  // 1. Request Size Validation (Max 4KB payload limit)
  const rawBody = await req.text();
  if (rawBody.length > 4096) {
    return new Response(JSON.stringify({ error: 'Payload too large (max 4KB)' }), {
      status: 413,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 2. Client IP Extraction & Verification
  const ip = req.headers.get('cf-connecting-ip')?.trim();
  if (!ip) {
    return new Response(JSON.stringify({ error: 'Client IP verification required: cf-connecting-ip header missing' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) {
    return new Response(JSON.stringify({ error: 'Missing backend configuration' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const sb = createClient(url, service);

  // Server Secret Resolution: Check Deno.env first, then Supabase Vault. Fails closed with 500 if missing.
  // Zero hardcoded secret fallback, zero test-header bypass.
  let salt = Deno.env.get('RATE_LIMIT_SALT');
  if (!salt || salt.trim().length === 0) {
    try {
      const { data: vaultSalt } = await sb.rpc('get_vault_secret', { p_name: 'RATE_LIMIT_SALT' });
      if (vaultSalt && typeof vaultSalt === 'string') {
        salt = vaultSalt;
      }
    } catch {
      // Vault lookup failed
    }
  }

  if (!salt || salt.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Server configuration error: RATE_LIMIT_SALT required' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`newsletter:${salt}:${ip}`)
  );
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');

  // 3. IP-Level Rate Limiting Check
  const { data: limit, error: limitError } = await sb.rpc('check_submit_rate_limit', { p_ip_hash: hash });
  if (limitError) {
    return new Response(JSON.stringify({ error: 'Newsletter service temporarily unavailable' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  if (!limit?.allowed) {
    return new Response(JSON.stringify({
      error: 'Too many subscription requests from this network. Please wait a moment.',
      code: '42901'
    }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 4. Input & Email Validation
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request format' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i.test(email)) {
    return new Response(JSON.stringify({ error: 'Please provide a valid email address.' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 5. Per-Email Abuse Rate Limiting (Distinct from IP limit: guards against multi-IP credential/email bombing)
  const emailDigest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`newsletter_email:${salt}:${email}`)
  );
  const emailHash = [...new Uint8Array(emailDigest)].map(b => b.toString(16).padStart(2, '0')).join('');

  const { data: emailLimit, error: emailLimitError } = await sb.rpc('check_submit_rate_limit', { p_ip_hash: emailHash });
  if (emailLimitError) {
    return new Response(JSON.stringify({ error: 'Newsletter service temporarily unavailable' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  if (!emailLimit?.allowed) {
    return new Response(JSON.stringify({
      error: 'Too many subscription requests for this email address. Please try again later.',
      code: '42901'
    }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 6. Ingest via service_role RPC (submit_subscriber)
  const { error } = await sb.rpc('submit_subscriber', { p_email: email });
  if (error) {
    return new Response(JSON.stringify({ error: 'Unable to process subscription.' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 7. Generic Success Response (Zero Status Disclosure)
  return new Response(JSON.stringify({
    ok: true,
    message: 'Thank you. If this email is eligible, you will receive thoughtful updates from Lumière Dental Studio.'
  }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
});
