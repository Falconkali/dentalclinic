import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM') || 'Lumière Dental <appointments@example.com>';
  const staffEmail = Deno.env.get('CLINIC_NOTIFICATION_EMAIL');
  if (!secret || !url || !resendKey || !staffEmail) return new Response(JSON.stringify({ error: 'Missing function configuration' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  const supabase = createClient(url, secret);
  const body = await req.json().catch(() => ({}));
  // Database webhook payload: { type, table, record, old_record, schema }
  const lead = body.record || body;
  if (!lead?.id || !lead?.name) return new Response(JSON.stringify({ error: 'Invalid lead event' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  const safe = (s: unknown) => String(s ?? '—').replace(/[<>]/g, '');
  const staffHtml = `<h2>New dental enquiry</h2><p><b>${safe(lead.name)}</b></p><p>Phone: ${safe(lead.phone)}<br>Email: ${safe(lead.email)}<br>Service: ${safe(lead.service)}<br>Preferred date: ${safe(lead.preferred_date)}<br>Preferred time: ${safe(lead.preferred_time)}</p><p>${safe(lead.message)}</p><p>Lead ID: ${safe(lead.id)}</p>`;
  const send = async (to: string, subject: string, html: string) => {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html }) });
    if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
  };
  try {
    await send(staffEmail, `New enquiry: ${safe(lead.name)} — ${safe(lead.service)}`, staffHtml);
    if (lead.email) await send(lead.email, 'We received your appointment request', `<p>Hello ${safe(lead.name)},</p><p>Thank you for contacting the clinic. We have received your request for ${safe(lead.service)}. This is a request, not a confirmed appointment; our team will contact you to confirm availability.</p><p>Warm regards,<br>Lumière Dental Studio</p>`);
    await supabase.from('lead_activity').insert({ lead_id: lead.id, type: 'notification_sent', meta: { staff_email_sent: true, patient_confirmation_sent: Boolean(lead.email) } });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Notification delivery failed', e instanceof Error ? e.message : 'unknown error');
    return new Response(JSON.stringify({ error: 'Notification delivery failed' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
