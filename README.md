# Lumière Dental Studio — Production Website & Clinical Management System

A high-converting marketing website and real-time reception dashboard engineered for modern dental clinics, aesthetic studios, and multi-doctor practices.

---

## Architecture Overview

```
lumiere-dental-website/
├── index.html               # Patient-facing luxury marketing website
├── style.css                # Editorial aesthetic styles (Fraunces + Manrope)
├── script.js                # Patient-facing interactions, dynamic content rendering, verified booking
├── portal.html              # Secure Staff Portal & Reception Dashboard
├── portal.css               # Clinical workspace styling, card & spreadsheet views
├── portal.js                # Role-based dashboard logic, fail-closed auth & cloud CRUD
├── clinic.config.js         # Single-source-of-truth multi-clinic configuration
├── clinic-api.js            # Unified Supabase API layer (Auth, Submissions, RLS CRUD)
├── server.js                # Lightweight local development HTTP server
└── supabase/
    ├── functions/           # Production Supabase Edge Functions (Deno / TypeScript)
    │   ├── on-new-lead/                 # Webhook listener (HMAC-SHA256, Replay-Safe, Outbox Status Updates)
    │   ├── submit-lead-rate-limit/      # Public lead submission ingress & durable outbox integration
    │   ├── subscribe-newsletter/        # Newsletter ingress with IP & email rate limiting
    │   └── process-notification-outbox/ # Durable outbox batch worker & retry engine
    └── migrations/          # Version-controlled database migrations
        ├── 001_initial_schema.sql
        ├── 002_staff_profiles.sql
        ├── 003_row_level_security.sql
        ├── 004_database_functions.sql
        ├── 005_webhook_deduplication.sql
        └── 006_lead_notification_outbox.sql
```

---

## 1. Security & Staff Authentication Model

Authentication uses genuine **Supabase Auth** (`auth.users`) backed by custom Postgres Row-Level Security (RLS) policies and a linked `public.profiles` role table. The insecure client-side PIN system and demo unlocks have been completely eradicated.

### Strict "Fail-Closed" Access Control
If a user authenticates but does not have an active record in `public.profiles` with `is_active = true`, the portal strictly denies access, terminates the session, and logs out immediately. It **never fails open**.

### Role-Based Access Control (RBAC) & Pure Database RLS

| Role | Permissions | RLS & Trigger Enforcement |
|---|---|---|
| **Admin** | View all appointments, create walk-ins, update any record, assign doctors, **permanently delete records**, manage staff accounts. | Full CRUD via `staff_update_leads` and `admin_delete_leads`. Can modify profiles. |
| **Receptionist** | View all appointments, create walk-in / phone bookings, update appointment status, assign doctors, send WhatsApp confirmations. | Read/Write access via `staff_select_leads`, `staff_insert_leads`, `staff_update_leads`. **Hard deletion strictly blocked by RLS** (0 rows deleted). |
| **Doctor** | View **only assigned appointments** (strictly matched by UUID `assigned_to = auth.uid()`), update status and clinical notes on assigned patients. | **Pure UUID database enforcement** (zero string matching). **Blocked from viewing unassigned or other doctors' appointments**. Database trigger `tr_check_lead_doctor_reassignment` blocks doctors from reassigning patients. |

### Defense-in-Depth Database Triggers & Column Protections
- **`tr_protect_lead_doctor_columns`**: A Postgres BEFORE UPDATE trigger on `public.leads` that throws SQL exception `42501` if an authenticated doctor attempts to modify patient personal details (`name`, `phone`, `email`), services, schedule (`preferred_date`, `preferred_time`), messages, source, or assignments (`doctor`, `assigned_to`). Doctors are strictly limited to updating appointment `status` and `staff_notes` for clinical charts.
- **`tr_protect_profile_role_escalation`**: A Postgres BEFORE UPDATE trigger on `public.profiles` that guarantees only users where `current_staff_role() = 'admin'` can alter `role` or `is_active`. Any attempt by reception or doctors to elevate permissions is rejected at the database engine level. Furthermore, the trigger includes an immutable safeguard preventing the accidental demotion or deactivation of the last remaining active administrator account, raising SQL exception `23514` if an update would leave zero active admins.
- **Public Ingress Rate-Limit Closure**: Anonymous execution of `public.submit_lead` is strictly revoked (`REVOKE EXECUTE ... FROM anon`). Public booking submissions are ingested solely through the Supabase Edge Function `submit-lead-rate-limit` using `service_role`, eliminating any direct PostgREST rate-limit bypass.
- **Transactional Notification Outbox & Single Authoritative Pipeline (`public.lead_notifications`)**:
  - **Single Authoritative Pipeline**: Email notification dispatch is strictly centralized in `process-notification-outbox`. Ingestion functions (`submit-lead-rate-limit`) and webhook listeners (`on-new-lead`) do not run competing email dispatches.
  - **ACID Transaction Enqueue**: In Postgres, trigger `tr_enqueue_lead_notification` transactionally writes the notification event into `public.lead_notifications` within the exact same transaction as the lead insertion.
  - **Automated Background Scheduler (`pg_cron` & `pg_net`)**: Configured with automated minute-by-minute execution via `public.trigger_scheduled_outbox_processing()`. A dedicated `CRON_SECRET` is retrieved dynamically from Supabase Vault (`vault.decrypted_secrets`), completely separated from webhook signing keys (`WEBHOOK_SECRET`), ensuring zero credential reuse and zero plaintext secrets in the cron table or schedule definitions.
  - **Crash Recovery & Stale Lease Escalation**: In `claim_next_notification_batch()`, stale items lingering in `status = 'processing'` for over 5 minutes are atomically reclaimed with incremented attempt counts (`attempts = n.attempts + 1`). If `attempts >= max_attempts`, the item is permanently transitioned to `status = 'failed'` with an explicit crash error log, preventing infinite retry loops on crashed serverless workers or poison payloads.
  - **Provider-Side & Permanent Application Idempotency**: In `process-notification-outbox`, all outgoing Resend API calls include explicit `Idempotency-Key` headers (`${item.event_id}-clinic` and `${item.event_id}-patient`). While Resend's API retains idempotency keys for 24 hours to guard against in-flight network retries, permanent idempotency is guaranteed by the application database: once a recipient is recorded in `delivered_recipients jsonb` and marked `delivered`, it is never re-enqueued or re-dispatched, preventing duplicate emails across arbitrary timeframes (days, weeks, or years).
  - **Extension Schema & PostgREST Isolation**: The underlying tables of `pg_net` (`net.http_request_queue`, `net._http_response`) and `pg_cron` (`cron.job`, `cron.job_run_details`) are completely isolated from client access. PostgREST strictly serves the `public` schema (returning HTTP 404 `PGRST205` for non-public schemas). Database access to `trigger_scheduled_outbox_processing()` is granted exclusively to `authenticated` staff and `service_role`, with anonymous execution revoked.
  - **Strict Test Mode Isolation**: Mock delivery modes are completely stripped from production portal code. Mock simulation is strictly gated behind `x-test-suite: true` and `x-test-suite-key` validated against Supabase Vault's `TEST_WEBHOOK_SECRET`. Local admin portal actions interact directly with the live queue and report honest delivery status without faking delivery.
  - **Per-Recipient Tracking (Duplicate Resend Prevention)**: The outbox tracks `delivered_recipients jsonb` (`['clinic']`, `['patient']`). If clinic staff notification succeeds but patient receipt delivery encounters a temporary provider failure, the record is rescheduled with exponential backoff, and subsequent retries skip the clinic staff alert to prevent duplicate emails.
  - **False Success Prevention**: Delivery is NEVER marked `'delivered'` if email provider secrets (`RESEND_API_KEY`, `CLINIC_NOTIFICATION_EMAIL`, `EMAIL_FROM`) are absent. Missing configuration records `'failed'` with backoff and descriptive error logs.
  - **Service Role & Admin Authorization**: Helper function `public.is_service_or_admin()` reconciles database session identities (`session_user IN ('postgres', 'supabase_admin')`), `service_role` JWT claims, and active administrator sessions (`current_staff_role() = 'admin'`). Outbox batch claiming and delivery completion routines are strictly revoked from anonymous callers, receptionists, doctors, and inactive accounts (SQL code `42501`).

### First-Administrator Bootstrap Workflow
Because the `handle_new_user()` trigger intentionally ignores client metadata and creates all new users as inactive receptionists (`role = 'receptionist', is_active = false`), a new clinic environment must bootstrap its initial administrator account via the Supabase Dashboard or SQL Editor:

1. **Create the Administrator in Supabase Auth**:
   Navigate to **Authentication > Users** in the Supabase Dashboard and click **Add User > Create User** (or use `Invite User`), providing your clinic admin email (e.g., `admin@yourclinic.com`) and a strong temporary password.

2. **Elevate to Active Administrator**:
   In the Supabase **SQL Editor**, execute the following command:
   ```sql
   UPDATE public.profiles
   SET role = 'admin'::public.staff_role,
       is_active = true,
       full_name = 'Primary Clinic Administrator'
   WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@yourclinic.com');
   ```

3. **Log in to the Staff Portal & Manage Staff**:
   The administrator can now sign in at `http://localhost:3000/portal.html`. Once logged in, the administrator has exclusive access to the **Staff Directory** modal in the portal header.
   
4. **Staff Account Provisioning & Activation Flow**:
   - To add new receptionists or doctors, the administrator invites them via the Supabase Dashboard (**Authentication > Users > Invite User**).
   - When the invited staff member accepts the invitation, the database trigger `handle_new_user()` provisions their profile as an inactive receptionist (`is_active = false, role = 'receptionist'`).
   - The clinic administrator logs into the portal, opens **Staff Directory**, selects the appropriate **Role** (Receptionist, Doctor, or Admin) from the inline role selector, and toggles `Active Status` to **Active**.
   - Role changes are enforced by the database trigger `tr_protect_profile_role_escalation`, which ensures that only an active administrator can modify role or `is_active` at the database level — even if the API is called directly.
   - Inactive accounts cannot access clinical data or read other staff profiles.

   > **Important:** Never use the service role key in the frontend. All profile updates go through the staff member's authenticated Supabase session, which is subject to database RLS and trigger checks.

---

## 2. Verified Patient Booking Flow, Idempotency & Privacy

### Clinical Enquiry & Request Workflow vs. Unvetted Calendar Booking
The patient booking flow is intentionally engineered as an **enquiry and appointment request workflow** rather than an instant, unvetted calendar slot reservation. In high-standard aesthetic and specialized dental studios, clinical triage is essential:
- Front-desk staff and clinical directors review the requested service, suitability, patient notes, and medical history.
- Reception confirms operatory and chair availability, avoids double-booking, and formally assigns the appropriate lead clinician (`doctor` and `assigned_to` UUID).
- The patient receives an explicit booking confirmation and visit schedule via personalized WhatsApp or phone contact.

### Robust Submission Architecture & Invariants
1. **Submission**: The patient completes the 3-step booking flow and clicks "Confirm request". This registers an initial appointment request (`status = 'new'`) for front-desk triage and confirmation.
2. **Persistent Idempotency**: A unique `client_submission_id` is generated once for the form session and **persisted across retries**. If a network timeout or dropped connection occurs and the patient retries, the same key is transmitted. The database unique constraint and `submit_lead` function return the existing confirmed booking without creating duplicates.
3. **Non-Destructive Heuristic Review**: Rapid repeat submissions (e.g. multiple family members booked within minutes under the same contact number) are preserved as distinct records and flagged with an internal review alert for reception, preventing accidental merging or loss of patient appointments.
4. **Anti-Spam Verification**: The form captures the genuine interaction start timestamp on first touch (`form_started_at`) to guard against automated bot submissions, paired with a honeypot field.
5. **Atomic Cloud Ingestion**: The request is routed via `ClinicAPI.submitAppointment()` exclusively through the Supabase Edge Function `submit-lead-rate-limit` using `service_role`. Direct REST RPC access to `submit_lead` is completely revoked from public callers.
6. **Transactional Outbox Enqueue**: In Postgres, trigger `tr_enqueue_lead_notification` writes an event record to `public.lead_notifications` in the exact same database transaction as the lead. All notification delivery is handled asynchronously by the `process-notification-outbox` queue worker.
7. **Verification Guard**: The frontend displays the confirmation screen **only after receiving the verified database UUID**. The reference code format `LUM-XXXXXXXX` directly references the actual database record ID.
8. **Patient Privacy (Zero PII in Browser Storage)**: Sensitive patient personal data (name, phone, email, medical notes) is **never retained, stored, or hashed in browser `localStorage` or `sessionStorage`**. Session idempotency generates a pure cryptographically random UUID (`crypto.randomUUID()`) saved to `sessionStorage` under `lumiere_active_submission_id`. Zero patient personal data or hashed fingerprints are ever written to browser storage.
9. **Honest Failure Handling**: If the database or network is unavailable, the form remains accessible, displays an honest error message with the clinic's phone number, and allows the patient to retry without lost data.

---

## 3. Real-Time Staff Portal Features

- **Dual Viewports**: Switch instantly between **Patient Cards View** (touch-friendly, color-coded triage) and **Spreadsheet View** (high-density table for busy front desks).
- **Staff Directory (Admin Only)**: Dedicated administrative modal in the dashboard header to inspect the clinic roster, review account roles, and toggle staff activation (`is_active`).
- **Notification Outbox & Queue Manager (Admin Only)**: Dedicated administrative modal in the dashboard header (`#btnNotificationOutbox`) allowing clinic administrators to inspect all queued, delivered, and failed email notification outbox entries, examine retry backoff schedules and error logs, and trigger on-demand batch delivery via the `process-notification-outbox` Edge Function with one click.
- **Two-Way Doctor Synchronization**: When reception assigns a doctor, both the doctor's display name and relational UUID (`assigned_to`) are persisted in the database.
- **Doctor Portal View**: When a doctor logs in, their dashboard is automatically scoped to their patient roster with a dedicated clinical notice banner. Doctors may only modify `status` and `staff_notes`; all other patient and scheduling columns are protected by database triggers.
- **Instant WhatsApp Confirmation**: Clicking `✓ Confirm & WhatsApp 💬` updates the appointment status in the cloud and formats a pre-filled, personalized WhatsApp message with clinic address and doctor details.
- **Walk-in & Phone Call Logging**: Full modal to log patients visiting the reception desk directly into Supabase with doctor assignment.
- **Postgres Realtime Sync**: Any new appointment booked on the public website automatically pushes a live notification and updates the staff dashboard across all clinic computers without page reloads.
- **Database-Enforced Timestamps**: The database trigger `tr_set_lead_updated_at` automatically manages `updated_at = now()` on every modification, preventing client clock tampering across all staff roles.
- **CSV Data Export**: One-click download of the active roster for scheduling audits or patient management.

---

## 4. 100% Dynamic Multi-Clinic Architecture

All clinic-specific details are centralized in `clinic.config.js`. The entire marketing website dynamically renders from this configuration:

- **Branding & Identity**: Clinic name, short name, tagline, intro copy, and philosophy.
- **Services Catalog**: Dynamic generation of service cards, booking choice chips, and modal details.
- **Doctor Roster**: Dynamic rendering of doctor cards, credentials, specialties, and bio modals.
- **Pricing Packages**: Dynamic rendering of pricing tiers, features, visit fees, and care plan rates.
- **Patient Reviews**: Dynamic populating of the patient stories carousel.
- **Contact & Map**: Dynamic binding of telephone (`tel:`), WhatsApp (`wa.me`), email (`mailto:`), physical address, Google Maps iframe embed, SEO metadata, and Schema.org JSON-LD structured data.

---

## 5. Local Setup & Testing

### Running Locally

```bash
# Start the local development server
node server.js
```

The application is immediately served at:
- **Patient Website**: [http://localhost:3000/](http://localhost:3000/)
- **Staff Portal**: [http://localhost:3000/portal.html](http://localhost:3000/portal.html)

### 25-Point Automated Security & Reliability Audit

The repository contains an independent, comprehensive security audit suite that runs against the live Supabase instance:

```bash
# Provide audit credentials in your local private .env file, then run:
node scratch/test-expanded-security.js
```

**Verified Live Audit Results: 24 PASSED, 1 SKIPPED / INCONCLUSIVE, 0 FAILED**

This independently verifies all 25 security and operational invariants:
1. **Anonymous Access Isolation & Closed Public RPC**: Anonymous visitors have zero read access to `leads` and `profiles`. Direct execution of `submit_lead` is revoked from `anon` (code `42501`), closing any rate-limit bypass.
2. **Persistent Idempotency**: Re-sending identical submission keys returns existing records without duplication (`deduplicated: true`).
3. **Network Drop Recovery**: Simulates client connection abortion mid-flight and verifies client retry creates zero duplicate rows (`DB Count: 1`).
4. **Concurrent Race Protection**: Parallel submissions with the same key safely resolve to one database record.
5. **Non-Destructive Heuristic Review**: Multiple family bookings under one phone create distinct records with reception review alerts.
6. **Strict Doctor UUID Enforcement**: Doctors can only see appointments where `assigned_to = auth.uid()` via pure Postgres RLS.
7. **Cross-Doctor Modification Rejection**: Direct REST updates by doctors to unassigned or other doctor appointments are blocked (0 rows modified).
8. **Doctor Reassignment Prevention**: Database triggers abort attempts by doctors to change `assigned_to` (code `42501`).
9. **Privilege Escalation Defense**: Staff attempts to update `role` in `public.profiles` are rejected at the database level.
10. **Inactive Staff Lockout & Row Isolation**: Deactivated staff accounts (`is_active = false`) are denied access to leads (0 rows) and other staff profiles (0 rows), retaining read access only to their own profile row.
11. **Role-Based Deletion Restriction**: Receptionist deletion attempts return 0 deleted rows (admin-only deletion policy).
12. **Public Ingress Privileged Fields Neutralization**: Anonymous callers attempting to pass `status: "booked"`, `doctor`, `assigned_to`, or internal `staff_notes` have all privileged fields neutralized to `new`, `Unassigned`, `null`, and `""`.
13. **Signup Metadata Privilege Escalation Prevention**: `[SKIPPED / INCONCLUSIVE]` Public self-signups are disabled in this project's GoTrue configuration. Schema analysis verifies `handle_new_user()` defaults to inactive receptionists.
14. **Database-Level Rate Limiting**: The `submit_lead` function independently rejects burst spam from the same phone number (max 5 in 10 minutes) asserting HTTP 429 and error code `42901`.
15. **Walk-in Conflict Non-Destructive Safety**: Retrying walk-ins with existing submission keys preserves the original booking data without mutating columns (code `23505`).
16. **Complete Direct REST RPC Closure Across All Client Roles**: Direct execution of `submit_lead` is revoked from ALL client roles (`anon`, `authenticated`, doctor, receptionist, admin, and inactive staff), each receiving code `42501`; the Edge Function via `service_role` is conclusively the sole authorized ingress.
17. **Doctor Protected Column Update Rejection**: Postgres trigger `protect_lead_doctor_columns` raises exception `42501` if a doctor attempts to alter patient personal details (`name`, `phone`, `email`), services, schedule, priority, or value, while permitting doctors to update `status` and `staff_notes`.
18. **Critical Rate-Limit Reset Function Lockdown**: Maintenance helper `reset_test_rate_limits()` is strictly revoked from all client roles (`PUBLIC`, `anon`, `authenticated`), returning code `42501`; only `service_role` retains execution.
19. **Fail-Closed Webhook Authentication, Mandatory HMAC & Nonce Replay Protection**: Edge Function `on-new-lead` enforces mandatory HMAC-SHA256 signature verification, rejects plain secrets (HTTP 401), rejects timestamps expired by >300 seconds (HTTP 401), validates nonces against `webhook_processed_events` with fail-closed DB checks (HTTP 503 on error), enforces 32KB payload limits (HTTP 413), and retrieves the verified lead record directly from Postgres rather than trusting client fields.
20. **Database-Side Audit Timestamp Management & Clock Tampering Prevention**: Database trigger `tr_set_lead_updated_at` unconditionally enforces `updated_at = now()`, preventing forged client timestamps across all staff roles.
21. **Newsletter Ingress Hardening, Email Abuse Throttling & Zero Status Disclosure**: `subscribe-newsletter` Edge Function enforces IP rate limiting, per-email abuse throttling (HTTP 429), 4KB payload size limits (HTTP 413), and email format validation; direct RPC access is revoked (code `42501`); and responses return generic `{ ok: true }` without disclosing subscriber existence.
22. **Staff Role Management & Escalation Defense via Portal API**: Administrators can promote/demote staff roles (e.g. receptionist to doctor) via the Staff Directory modal and authenticated API; non-admin self-elevation is strictly rejected at the database level.
23. **Database Trigger Session Identity Verification (`session_user` check)**: The role escalation trigger explicitly verifies `session_user IN ('postgres', 'supabase_admin')` to distinguish genuine DBA sessions from API connections under `SECURITY DEFINER`; unauthenticated REST callers cannot trigger a bypass.
24. **Supabase Realtime WebSocket Connection & Doctor RLS Isolation**: Connects to the live Supabase Realtime WebSocket endpoint (`wss://${HOST}/realtime/v1/websocket`), joins the channel with `postgres_changes`, confirms `SUBSCRIBED`, verifies live `INSERT` event delivery to an admin, and verifies that doctor RLS strictly blocks streaming unassigned leads.
25. **Database Safeguard: Last Active Administrator Demotion Protection**: Trigger `tr_protect_profile_role_escalation` enforces that an admin cannot demote or deactivate the last remaining active administrator account, asserting SQL exception `23514`.

### Self-Contained Migration Sequence

The authoritative database setup is strictly version-controlled in `supabase/migrations/`:
1. `001_initial_schema.sql` (Types, leads, appointments, lead_activity, submit_rate_limits, Realtime publication)
2. `002_staff_profiles.sql` (Staff profiles, secure handle_new_user trigger ignoring client metadata, foreign keys, helper functions)
3. `003_row_level_security.sql` (Granular RLS policies, pure UUID doctor isolation, `tr_protect_lead_doctor_columns` doctor column whitelist trigger, `tr_set_lead_updated_at` server timestamp trigger, `tr_protect_profile_role_escalation` role escalation guard with `session_user` check)
4. `004_database_functions.sql` (Privilege-separated submit_lead with concurrency-safe ON CONFLICT idempotency, check_submit_rate_limit, locked-down reset_test_rate_limits, submit_subscriber, get_vault_secret)
5. `005_webhook_deduplication.sql` (Webhook nonce deduplication table with 10-minute TTL, RLS-locked to service_role)
6. `006_lead_notification_outbox.sql` (Transactional outbox table `public.lead_notifications`, outbox processor helpers `claim_next_notification_batch` / `complete_notification_delivery`, trigger `tr_enqueue_lead_notification`, last-admin demotion safeguard in `tr_protect_profile_role_escalation`, RLS policy `admin_read_lead_notifications`, full replica identity on `leads`)

*(Note: `supabase/schema.sql` is archived for historical reference. Fresh deployments should always execute migrations 001 through 006 in order)*

They can be applied directly using the Supabase CLI:
```bash
supabase db push
# or execute migrations 001 through 006 in the Supabase SQL Editor
```

---

## 6. Production Deployment & Environment Secrets

The project is static frontend friendly and can be hosted on **Netlify**, **Vercel**, or **Cloudflare Pages**:

1. Deploy the root repository to your preferred host.
2. Ensure your domain is added to Supabase **Authentication > URL Configuration > Redirect URLs**.
3. Configure your production Supabase URL and Anon Key in `clinic.config.js`.
4. Configure Edge Function Secrets in Supabase Dashboard (**Edge Functions > Secrets** or via CLI `supabase secrets set`) or via Supabase Vault (`vault.create_secret()`):
   - `CRON_SECRET`: Dedicated authentication key stored in Supabase Vault used exclusively by `public.trigger_scheduled_outbox_processing()` (`pg_cron` / `pg_net`) to authenticate against `process-notification-outbox` with zero secret reuse.
   - `WEBHOOK_SECRET`: A high-entropy 256-bit random key stored securely in Supabase Vault (`vault.decrypted_secrets`), used strictly to sign and verify internal webhook calls between the server-side dispatcher and `on-new-lead`.
   - `RATE_LIMIT_SALT`: A dedicated high-entropy salt stored in Supabase Vault used to hash visitor IP addresses in `submit-lead-rate-limit` and `subscribe-newsletter` (never reused from your Supabase Service Key).
   - `RESEND_API_KEY`: API key for transactional email delivery to clinic reception.
   - `CLINIC_NOTIFICATION_EMAIL`: Recipient email address for new booking alerts.
   - `EMAIL_FROM`: Verified sender email address (e.g., `bookings@yourclinic.com`).
5. Deploy the Edge Functions located in `supabase/functions/`:
   ```bash
   # on-new-lead requires --no-verify-jwt because internal webhook dispatchers authenticate via HMAC-SHA256 signatures
   supabase functions deploy on-new-lead --no-verify-jwt

   # submit-lead-rate-limit handles public lead ingestion & durable notification enqueuing
   supabase functions deploy submit-lead-rate-limit

   # subscribe-newsletter handles newsletter subscriptions with IP & per-email rate limiting
   supabase functions deploy subscribe-newsletter

   # process-notification-outbox processes pending/failed outbox batches with exponential backoff
   # Invokable by Administrators, service_role, or scheduled cron jobs (pg_cron / GitHub Actions)
   supabase functions deploy process-notification-outbox --no-verify-jwt
   ```

   *(Automated Background Cron Scheduler)*: Migration `006_lead_notification_outbox.sql` automatically registers a minute-by-minute `pg_cron` schedule that securely calls `public.trigger_scheduled_outbox_processing()`. This database wrapper fetches authentication tokens directly from Supabase Vault (`vault.decrypted_secrets`) and invokes the worker asynchronously via `pg_net`:
   ```sql
   -- The automated job is installed by migration 006:
   SELECT cron.schedule(
     'process-notification-outbox-every-minute',
     '* * * * *',
     $$SELECT public.trigger_scheduled_outbox_processing();$$
   );
   ```
   *No service-role tokens or webhooks are stored in the cron schedule definition or job tables.*

---

## 7. Known Remaining Limitations & Staging Recommendations

1. **Email Provider Integration**: `process-notification-outbox` is the sole email dispatcher wired to Resend API (`RESEND_API_KEY`). Until configured with live clinic API keys, notifications remain in the outbox queue in `'failed'` status with clear diagnostic logs, rather than producing false delivery confirmations. Lead records are always authoritatively written to Postgres first.
2. **Public GoTrue Self-Signup**: Public signups are intentionally disabled in the clinic's GoTrue configuration. Staff members must be invited via Supabase Auth invitations.
3. **Multi-Clinic Tenancy**: The current release is architected as a single-clinic, multi-doctor deployment with centralized configuration in `clinic.config.js`. Multi-tenant SaaS clinic partitioning is planned for a future release.

---

## 8. Packaging the Complete Project for Review

To create a clean ZIP archive that includes all subdirectories (`supabase/migrations/`, `supabase/functions/`, `scratch/`, and root files) while excluding private environment files (`.env`):

```powershell
# Using standard tar on Windows or Linux:
tar.exe -c --format zip -f lumiere-dental-complete.zip --exclude=".env" --exclude="lumiere-dental-complete.zip" --exclude="node_modules" index.html style.css script.js portal.html portal.css portal.js clinic.config.js clinic-api.js server.js package.json README.md .env.example .gitignore supabase admin scratch

# Or using PowerShell Compress-Archive:
Compress-Archive -Path index.html, style.css, script.js, portal.html, portal.css, portal.js, clinic-api.js, clinic.config.js, server.js, package.json, README.md, .env.example, .gitignore, supabase, admin, scratch -DestinationPath lumiere-dental-complete.zip -Force
```
