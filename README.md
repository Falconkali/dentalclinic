# Lumière Dental Studio — Website + Clinic Admin (integration build)

This continues the existing Lumière Dental Studio front-end and adds the foundation for the master prompt's connected clinic system. The public site remains vanilla HTML/CSS/JS with GSAP, ScrollTrigger, Lenis and SplitType as progressive enhancements. The separate `/admin` app uses React + Vite + TypeScript and Supabase Auth/Postgres/Realtime. The `/supabase` folder contains schema and Edge Functions.

## Important status

This is an **integration scaffold, not a fully deployed production clinic system yet**. The public website now submits booking requests through the Supabase Edge Function when configured, and only shows a successful receipt after the backend confirms it. Offline/failed requests are retained in a local retry queue, but are not delivered until the backend connection works. The admin includes login, live lead table, status changes, add-lead flow, dashboard KPIs, pipeline, search, call/email/WhatsApp actions and a live update subscription. Appointment calendar, complete content CRUD, full role-specific screens, PDF exports, reminder automation, and all of the master prompt's advanced features still require implementation/testing before calling this production-ready.

All clinic identity/contact details, prices, doctor credentials, testimonials, before/after images, and ratings are demo placeholders. Replace with verified clinic-approved information. Never publish invented medical credentials or patient reviews.

## Architecture

```text
Public website (index.html + clinic-api.js)
       │ booking/newsletter request
       ▼
Supabase Edge Functions ── rate limiting / validation
       │
       ▼
Supabase Postgres + RLS + RPC + Realtime
       │                       │
       ▼                       ▼
Admin app (/admin)       Database webhook
                               │
                               ▼
                       on-new-lead Edge Function
                               │
                               ▼
                            Resend email
```

## 1. Create Supabase project

1. Create a new project at https://supabase.com/dashboard.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it. Use a new project or review the schema carefully before running against an existing database.
3. In **Authentication → Users**, create/invite staff accounts. For the first clinic owner, copy their auth user UUID and run:

```sql
insert into public.profiles (id, full_name, role, is_active)
values ('PASTE_AUTH_USER_UUID_HERE', 'Clinic Admin', 'admin', true)
on conflict (id) do update set role='admin', is_active=true;
```

4. Add staff rows to `profiles` for each receptionist/doctor. Do not grant admin role to untrusted staff.
5. In **Project Settings → API**, copy the project URL and public anon/publishable key.

## 2. Connect the public website

In `index.html`, find `window.CLINIC_CONFIG` and replace `https://YOUR_PROJECT.supabase.co` and `YOUR_SUPABASE_ANON_KEY` with your project's public URL and anon/publishable key. **Never use the service-role key in browser code.**

The booking form invokes the `submit-lead-rate-limit` Edge Function. It does not mark a request as received until the function returns a confirmed success. If the backend is unconfigured or unavailable, the form displays a warning and retains the form fields; any queued request is local to that browser and should not be treated as a confirmed appointment.

## 3. Deploy Edge Functions

Install the Supabase CLI, sign in, and link the project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy submit-lead-rate-limit
supabase functions deploy subscribe-newsletter
supabase functions deploy on-new-lead
```

Set secrets in the Supabase dashboard or CLI:

```bash
supabase secrets set RESEND_API_KEY=re_... EMAIL_FROM="Lumière Dental <appointments@your-verified-domain.com>" CLINIC_NOTIFICATION_EMAIL=appointments@your-clinic-domain.com RATE_LIMIT_SALT="a-long-random-secret"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available as Edge Function environment secrets in Supabase. Verify this in the project's function settings. Never commit secrets to source control.

## 4. Configure notifications

1. Verify your sender domain in Resend and set `EMAIL_FROM` to an address on that verified domain.
2. In Supabase **Database → Webhooks**, create a webhook for `public.leads`, event `INSERT`, target the deployed `on-new-lead` Edge Function URL, and send the database webhook payload.
3. Test with a real test lead and verify both staff notification and patient acknowledgement. The acknowledgement says the request is received, not that an appointment is confirmed.

## 5. Run the admin app locally

```bash
cd admin
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open the URL printed by Vite. Sign in with a staff account created in Supabase Auth and a corresponding row in `profiles`. For a production build:

```bash
npm run build
npm run preview
```

Deploy `/admin` as its own Vercel/Netlify project. Configure the same two `VITE_` environment variables in the hosting provider. The public anon key is designed for browser use only when the database RLS policies are correct.

## 6. Test checklist

- [ ] Replace all demo clinic contact details and fictional content before sharing publicly.
- [ ] Confirm anonymous users cannot select private lead data or write directly to `leads`/`subscribers` tables.
- [ ] Submit a website booking and confirm the Edge Function returns success.
- [ ] Confirm the lead appears in the admin lead list and in Realtime updates.
- [ ] Change lead status and verify it persists after refresh.
- [ ] Test repeated submissions and verify rate-limit behavior.
- [ ] Test newsletter duplicate handling.
- [ ] Confirm notification emails arrive and patient copy does not promise a confirmed appointment.
- [ ] Verify appointment overlap constraints using two appointments for the same doctor.
- [ ] Test keyboard access, mobile layouts, reduced-motion preference, error states and loading states.
- [ ] Review privacy policy, data retention, consent, and clinic-specific legal requirements with the clinic before launch.

## Folder map

- `index.html`, `style.css`, `script.js`: current public website
- `clinic-api.js`: Supabase browser integration and offline retry queue
- `admin/`: separate React/Vite admin app
- `supabase/schema.sql`: database schema, policies, RPCs, demo content
- `supabase/functions/submit-lead-rate-limit/`: public booking proxy with rate limit
- `supabase/functions/subscribe-newsletter/`: newsletter endpoint
- `supabase/functions/on-new-lead/`: Resend notification handler for database webhook
