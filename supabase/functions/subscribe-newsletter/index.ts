import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
serve(async (req) => {
 if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
 if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
 const url = Deno.env.get('SUPABASE_URL'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if (!url || !service) return new Response(JSON.stringify({ error: 'Missing configuration' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
 const { email } = await req.json().catch(() => ({}));
 if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response(JSON.stringify({ error: 'Please provide a valid email address.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
 const sb = createClient(url, service);
 const { data: existing } = await sb.from('subscribers').select('id').eq('email', email.toLowerCase()).maybeSingle();
 if (existing) return new Response(JSON.stringify({ ok: true, alreadySubscribed: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
 const { error } = await sb.rpc('submit_subscriber', { p_email: email.toLowerCase() });
 if (error) return new Response(JSON.stringify({ error: 'Could not save subscription.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
 return new Response(JSON.stringify({ ok: true, alreadySubscribed: false }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
