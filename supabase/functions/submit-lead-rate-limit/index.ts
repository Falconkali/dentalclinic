import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function signHmac(secret: string, dataToSign: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) {
    return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const sb = createClient(url, service);

  // 1. Strict Trusted IP verification: platform-provided Cloudflare connecting IP only.
  const ip = req.headers.get('cf-connecting-ip')?.trim();
  if (!ip) {
    return new Response(JSON.stringify({ error: 'Client IP verification required: cf-connecting-ip header missing' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 2. Strict Dedicated Salt configuration:
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
    new TextEncoder().encode(`${salt}:${ip}`)
  );
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');

  // 3. IP-level rate limiting check in database
  const { data: limit, error: limitError } = await sb.rpc('check_submit_rate_limit', { p_ip_hash: hash });
  if (limitError) {
    return new Response(JSON.stringify({ error: 'Submission rate limiting service unavailable' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  if (!limit?.allowed) {
    return new Response(JSON.stringify({
      error: 'Rate limit exceeded: Too many booking attempts from this network. Please wait a moment before trying again.',
      code: '42901'
    }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  const rawBody = await req.text();
  if (rawBody.length > 32768) {
    return new Response(JSON.stringify({ error: 'Payload too large (max 32KB)' }), {
      status: 413,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid booking payload' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  // 4. Authoritative Database Ingestion via service_role RPC
  // Transactional outbox persistence is guaranteed by database trigger tr_enqueue_lead_notification on public.leads.
  // The outbox worker (process-notification-outbox) serves as the single authoritative email delivery pipeline.
  const { data, error } = await sb.rpc('submit_lead', { p_payload: payload });
  if (error) {
    const isRateLimit = error.code === '42901' || error.message?.includes('Rate limit exceeded');
    return new Response(JSON.stringify({
      error: error.message,
      code: error.code || (isRateLimit ? '42901' : '40000')
    }), {
      status: isRateLimit ? 429 : 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
});
