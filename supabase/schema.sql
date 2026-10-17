-- Lumière Dental Studio — Supabase schema
-- Run in a NEW Supabase project. Review demo seed content and replace it before production.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
do $$ begin create type public.staff_role as enum ('admin','receptionist','doctor'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_status as enum ('new','contacted','qualified','booked','completed','lost','spam'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_source as enum ('booking_form','contact_form','whatsapp','phone','walk_in','manual'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_priority as enum ('low','normal','high'); exception when duplicate_object then null; end $$;
do $$ begin create type public.appointment_status as enum ('scheduled','confirmed','completed','no_show','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.message_channel as enum ('email','whatsapp','sms'); exception when duplicate_object then null; end $$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null default '', role public.staff_role not null default 'receptionist', avatar_url text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.leads (id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120), phone text not null check(length(regexp_replace(phone,'\D','','g')) between 8 and 16), email text, service text, plan text, preferred_date date, preferred_time text, message text, source public.lead_source not null default 'booking_form', status public.lead_status not null default 'new', priority public.lead_priority not null default 'normal', assigned_to uuid references public.profiles(id) on delete set null, utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text, page_url text, lost_reason text, estimated_value numeric(12,2), deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.lead_notes (id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade, author_id uuid references public.profiles(id) on delete set null, body text not null check(length(trim(body)) between 1 and 5000), created_at timestamptz not null default now());
create table if not exists public.lead_activity (id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade, actor_id uuid references public.profiles(id) on delete set null, type text not null, meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists public.appointments (id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id) on delete set null, patient_name text not null, phone text not null, email text, service text, doctor_id uuid references public.profiles(id) on delete set null, starts_at timestamptz not null, ends_at timestamptz not null, status public.appointment_status not null default 'scheduled', notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(ends_at > starts_at));
-- Prevent overlapping appointments for the same doctor. Unassigned appointments are handled by application-level slot RPC.
alter table public.appointments drop constraint if exists appointments_no_doctor_overlap;
alter table public.appointments add constraint appointments_no_doctor_overlap exclude using gist (doctor_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (doctor_id is not null and status not in ('cancelled','no_show'));
create table if not exists public.follow_ups (id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade, due_at timestamptz not null, note text not null default '', done boolean not null default false, assigned_to uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.subscribers (id uuid primary key default gen_random_uuid(), email text not null unique check(email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'), subscribed_at timestamptz not null default now(), is_active boolean not null default true);
create table if not exists public.services (id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, short_description text not null default '', long_description text not null default '', steps jsonb not null default '[]', duration text, recovery text, image_url text, sort_order int not null default 0, is_published boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.doctors (id uuid primary key default gen_random_uuid(), name text not null, specialty text not null default '', credentials text not null default '', bio text not null default '', education jsonb not null default '[]', photo_url text, sort_order int not null default 0, is_published boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.pricing_plans (id uuid primary key default gen_random_uuid(), name text not null, monthly_price numeric(12,2), one_time_price numeric(12,2), features jsonb not null default '[]', is_popular boolean not null default false, sort_order int not null default 0, is_published boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.testimonials (id uuid primary key default gen_random_uuid(), name text not null, rating int not null default 5 check(rating between 1 and 5), quote text not null, treatment text, photo_url text, is_featured boolean not null default false, is_published boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.gallery_cases (id uuid primary key default gen_random_uuid(), category text not null, before_url text, after_url text, caption text not null default '', sort_order int not null default 0, is_published boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.faqs (id uuid primary key default gen_random_uuid(), question text not null, answer text not null, sort_order int not null default 0, is_published boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.site_settings (id int primary key default 1 check(id=1), clinic_name text not null default 'Lumière Dental Studio', tagline text not null default 'Smile design, refined.', phone text not null default '', whatsapp text not null default '', email text not null default '', address text not null default '', map_embed_url text, opening_hours jsonb not null default '{"monday":["09:00","19:00"],"tuesday":["09:00","19:00"],"wednesday":["09:00","19:00"],"thursday":["09:00","19:00"],"friday":["09:00","19:00"],"saturday":["09:00","19:00"],"sunday":null}'::jsonb, social_links jsonb not null default '{}'::jsonb, hero_stats jsonb not null default '[]', announcement_banner text, announcement_enabled boolean not null default false, booking_slot_minutes int not null default 30 check(booking_slot_minutes between 10 and 180), blocked_dates jsonb not null default '[]', notification_email text, seo_title text, seo_description text, updated_at timestamptz not null default now());
create table if not exists public.message_templates (id uuid primary key default gen_random_uuid(), channel public.message_channel not null, name text not null, subject text, body text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, action text not null, table_name text not null, record_id uuid, diff jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create index if not exists leads_created_idx on public.leads(created_at desc) where deleted_at is null;
create index if not exists leads_status_idx on public.leads(status) where deleted_at is null;
create index if not exists leads_phone_idx on public.leads(phone);
create index if not exists appointments_starts_idx on public.appointments(starts_at);
create index if not exists followups_due_idx on public.follow_ups(due_at) where not done;
create index if not exists activity_lead_idx on public.lead_activity(lead_id,created_at desc);

create or replace function public.current_staff_role() returns public.staff_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() and is_active=true $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_active=true) $$;
create or replace function public.submit_lead(p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_name text; v_phone text; v_source public.lead_source; v_email text; v_started timestamptz;
begin
 if coalesce(p_payload->>'honeypot','') <> '' then return jsonb_build_object('ok',true,'id',null); end if;
 begin v_started := (p_payload->>'form_started_at')::timestamptz; exception when others then v_started := null; end;
 if v_started is not null and v_started > now() - interval '2 seconds' then raise exception 'Please wait a moment and try again.' using errcode='22023'; end if;
 v_name := trim(coalesce(p_payload->>'name','')); v_phone := regexp_replace(coalesce(p_payload->>'phone',''), '\D','','g'); v_email := nullif(trim(coalesce(p_payload->>'email','')),'');
 if length(v_name)<2 or length(v_name)>120 then raise exception 'Please provide a valid name.' using errcode='22023'; end if;
 if length(v_phone)<8 or length(v_phone)>16 then raise exception 'Please provide a valid phone number.' using errcode='22023'; end if;
 if v_email is not null and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then raise exception 'Please provide a valid email address.' using errcode='22023'; end if;
 v_source := case when p_payload->>'source'='contact_form' then 'contact_form'::public.lead_source else 'booking_form'::public.lead_source end;
 insert into public.leads(name,phone,email,service,plan,preferred_date,preferred_time,message,source,utm_source,utm_medium,utm_campaign,utm_term,utm_content,page_url)
 values(v_name,v_phone,v_email,left(p_payload->>'service',160),left(p_payload->>'plan',120),nullif(p_payload->>'preferred_date','')::date,left(p_payload->>'preferred_time',40),left(p_payload->>'message',3000),v_source,left(p_payload->>'utm_source',200),left(p_payload->>'utm_medium',200),left(p_payload->>'utm_campaign',200),left(p_payload->>'utm_term',200),left(p_payload->>'utm_content',200),left(p_payload->>'page_url',1000)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id);
end $$;
create or replace function public.get_available_slots(p_date date) returns table(slot_start timestamptz, slot_label text) language plpgsql stable security definer set search_path=public as $$
declare cfg public.site_settings%rowtype; day_key text; hours jsonb; start_t time; end_t time; mins int; cur timestamptz; finish timestamptz;
begin
 select * into cfg from public.site_settings where id=1; if not found then return; end if;
 day_key := lower(to_char(p_date,'FMDay')); hours := cfg.opening_hours->day_key;
 if hours is null or jsonb_typeof(hours) <> 'array' or jsonb_array_length(hours)<2 then return; end if;
 start_t := (hours->>0)::time; end_t := (hours->>1)::time; mins := cfg.booking_slot_minutes;
 cur := (p_date + start_t) at time zone 'Asia/Kolkata'; finish := (p_date + end_t) at time zone 'Asia/Kolkata';
 while cur + make_interval(mins=>mins) <= finish loop
   if not (cfg.blocked_dates @> to_jsonb(array[p_date::text])) and not exists(select 1 from public.appointments a where a.status not in ('cancelled','no_show') and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(cur,cur+make_interval(mins=>mins),'[)')) then
    slot_start := cur; slot_label := to_char(cur at time zone 'Asia/Kolkata','HH12:MI AM'); return next;
   end if; cur := cur + make_interval(mins=>mins);
 end loop;
end $$;
create or replace view public.public_site_settings as select clinic_name,tagline,phone,whatsapp,email,address,map_embed_url,opening_hours,social_links,hero_stats,announcement_banner,announcement_enabled,booking_slot_minutes,blocked_dates,seo_title,seo_description from public.site_settings where id=1;

-- Updated-at triggers
 do $$ declare t text; begin foreach t in array array['profiles','leads','appointments','follow_ups','services','doctors','pricing_plans','testimonials','gallery_cases','faqs','message_templates'] loop execute format('drop trigger if exists set_updated_at on public.%I',t); execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t); end loop; end $$;
-- Activity and audit triggers for core lead changes
create or replace function public.log_lead_change() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if TG_OP='INSERT' then insert into public.lead_activity(lead_id,actor_id,type,meta) values(new.id,auth.uid(),'created',jsonb_build_object('status',new.status)); insert into public.audit_log(actor_id,action,table_name,record_id,diff) values(auth.uid(),'insert','leads',new.id,jsonb_build_object('status',new.status,'source',new.source,'service',new.service)); return new;
 elsif TG_OP='UPDATE' then if old.status is distinct from new.status then insert into public.lead_activity(lead_id,actor_id,type,meta) values(new.id,auth.uid(),'status_changed',jsonb_build_object('from',old.status,'to',new.status)); end if; insert into public.audit_log(actor_id,action,table_name,record_id,diff) values(auth.uid(),'update','leads',new.id,jsonb_build_object('old_status',old.status,'new_status',new.status,'old_assigned_to',old.assigned_to,'new_assigned_to',new.assigned_to)); return new;
 elsif TG_OP='DELETE' then insert into public.audit_log(actor_id,action,table_name,record_id,diff) values(auth.uid(),'delete','leads',old.id,jsonb_build_object('status',old.status,'source',old.source)); return old; end if; return null; end $$;
drop trigger if exists lead_change_log on public.leads;
create trigger lead_change_log after insert or update or delete on public.leads for each row execute function public.log_lead_change();

-- RLS on every table. Public writes go through submit_lead RPC; no anonymous direct table writes.
do $$ declare t text; begin foreach t in array array['profiles','leads','lead_notes','lead_activity','appointments','follow_ups','subscribers','services','doctors','pricing_plans','testimonials','gallery_cases','faqs','site_settings','message_templates','audit_log'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
-- Staff profile policies
create policy "staff can read own profile" on public.profiles for select to authenticated using (id=auth.uid() or public.current_staff_role()='admin');
create policy "admin manages profiles" on public.profiles for all to authenticated using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
-- Leads
create policy "staff read leads" on public.leads for select to authenticated using (public.is_staff() and (public.current_staff_role() in ('admin','receptionist') or assigned_to=auth.uid()));
create policy "admin and reception manage leads" on public.leads for all to authenticated using (public.current_staff_role() in ('admin','receptionist')) with check (public.current_staff_role() in ('admin','receptionist'));
-- Supporting tables
create policy "staff read notes" on public.lead_notes for select to authenticated using (public.is_staff() and (public.current_staff_role() in ('admin','receptionist') or exists(select 1 from public.leads l where l.id=lead_id and l.assigned_to=auth.uid())));
create policy "staff add notes" on public.lead_notes for insert to authenticated with check (public.is_staff() and (public.current_staff_role() in ('admin','receptionist') or author_id=auth.uid()));
create policy "staff read activity" on public.lead_activity for select to authenticated using (public.is_staff() and (public.current_staff_role() in ('admin','receptionist') or exists(select 1 from public.leads l where l.id=lead_id and l.assigned_to=auth.uid())));
create policy "staff read appointments" on public.appointments for select to authenticated using (public.is_staff() and (public.current_staff_role() in ('admin','receptionist') or doctor_id=auth.uid()));
create policy "admin reception manage appointments" on public.appointments for all to authenticated using (public.current_staff_role() in ('admin','receptionist')) with check (public.current_staff_role() in ('admin','receptionist'));
create policy "staff manage followups" on public.follow_ups for all to authenticated using (public.current_staff_role() in ('admin','receptionist') or assigned_to=auth.uid()) with check (public.current_staff_role() in ('admin','receptionist') or assigned_to=auth.uid());
create policy "staff manage subscribers" on public.subscribers for all to authenticated using (public.current_staff_role() in ('admin','receptionist')) with check (public.current_staff_role() in ('admin','receptionist'));
-- Published content read by anyone; staff manage, admin/receptionist only
 do $$ declare t text; begin foreach t in array array['services','doctors','pricing_plans','testimonials','gallery_cases','faqs'] loop execute format('create policy %I on public.%I for select to anon, authenticated using (is_published or public.is_staff())',t||'_public_read',t); execute format('create policy %I on public.%I for all to authenticated using (public.current_staff_role() in (''admin'',''receptionist'')) with check (public.current_staff_role() in (''admin'',''receptionist''))',t||'_staff_manage',t); end loop; end $$;
create policy "admin manage site settings" on public.site_settings for all to authenticated using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
create policy "staff read templates" on public.message_templates for select to authenticated using (public.current_staff_role() in ('admin','receptionist'));
create policy "admin manage templates" on public.message_templates for all to authenticated using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
create policy "admin read audit" on public.audit_log for select to authenticated using (public.current_staff_role()='admin');
-- View is safe to expose: no notification email or internal notes.
grant select on public.public_site_settings to anon, authenticated;
grant select on public.services, public.doctors, public.pricing_plans, public.testimonials, public.gallery_cases, public.faqs to anon, authenticated;
revoke execute on function public.submit_lead(jsonb) from public, anon, authenticated;
grant execute on function public.submit_lead(jsonb) to service_role;
grant execute on function public.get_available_slots(date) to anon, authenticated;
grant select, insert, update on public.leads to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant select, insert, update, delete on public.follow_ups, public.lead_notes, public.subscribers to authenticated;
grant select on public.profiles, public.lead_activity, public.audit_log, public.message_templates to authenticated;

-- Demo content only. All claims/reviews/credentials are examples and must be replaced with verified clinic content before launch.
insert into public.site_settings(id,clinic_name,tagline,phone,whatsapp,email,address,notification_email,seo_title,seo_description) values(1,'Lumière Dental Studio','Smile design, refined.','','','','','','Lumière Dental Studio | Thoughtful Dentistry','Thoughtful dental care. Contact the clinic to request an appointment.') on conflict(id) do nothing;
insert into public.services(slug,title,short_description,long_description,duration,sort_order,is_published) values
('general-dentistry','General dentistry','Preventive visits and everyday dental care.','Consultation, examination and a care plan tailored to your needs.','30–60 min',1,true),
('teeth-whitening','Teeth whitening','A brighter smile, planned with your dentist.','Your dentist will check suitability and explain available whitening options.','45–90 min',2,true),
('clear-aligners','Clear aligners','A considered approach to teeth straightening.','Assessment, digital planning and a review of suitable orthodontic options.','Consultation',3,true),
('dental-implants','Dental implants','Explore options for replacing missing teeth.','A clinical examination is needed to assess bone health and treatment options.','Consultation',4,true),
('veneers-smile-makeover','Veneers & smile design','Personalised cosmetic treatment planning.','Discuss goals, suitability, risks, alternatives and maintenance with a dentist.','Consultation',5,true),
('root-canal','Root canal treatment','Care for teeth affected by deep infection or damage.','Treatment needs and expected visits depend on the clinical examination.','Varies',6,true),
('pediatric-dentistry','Children’s dentistry','Gentle, age-aware dental visits for children.','Preventive guidance and age-appropriate assessment with a parent or guardian.','30–45 min',7,true),
('emergency-care','Emergency dental care','Contact the clinic for urgent dental concerns.','Urgent availability is confirmed by the clinic; severe swelling or breathing difficulty requires emergency medical care.','Call clinic',8,true)
on conflict(slug) do nothing;
insert into public.faqs(question,answer,sort_order,is_published) values
('What happens at a first visit?','Your dentist will discuss your concerns, examine your mouth and explain suitable next steps. Bring relevant medication and dental history information.',1,true),
('Can I request an appointment online?','Yes. Submit your preferred date and time; the clinic must confirm the appointment before it is booked.',2,true),
('How much does treatment cost?','Costs depend on examination findings and treatment options. Ask the clinic for a written estimate before treatment.',3,true),
('What if I have a dental emergency?','Contact the clinic for urgent guidance. Seek emergency medical care for difficulty breathing, rapidly spreading swelling or severe uncontrolled bleeding.',4,true)
on conflict do nothing;

-- Rate-limit support for the Edge Function. Invoke this function before calling submit_lead from a server-side proxy.
create table if not exists public.submit_rate_limits (ip_hash text primary key, window_started_at timestamptz not null default now(), submissions int not null default 1);
alter table public.submit_rate_limits enable row level security;
create or replace function public.check_submit_rate_limit(p_ip_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare n int;
begin
 insert into public.submit_rate_limits(ip_hash,window_started_at,submissions) values(p_ip_hash,now(),1)
 on conflict(ip_hash) do update set
   window_started_at = case when public.submit_rate_limits.window_started_at < now()-interval '1 hour' then now() else public.submit_rate_limits.window_started_at end,
   submissions = case when public.submit_rate_limits.window_started_at < now()-interval '1 hour' then 1 else public.submit_rate_limits.submissions + 1 end
 returning submissions into n;
 return jsonb_build_object('allowed', n <= 5, 'remaining', greatest(0,5-n));
end $$;
revoke all on public.submit_rate_limits from public, anon, authenticated;
grant execute on function public.check_submit_rate_limit(text) to service_role;

create or replace function public.submit_subscriber(p_email text) returns jsonb language plpgsql security definer set search_path=public as $$
declare e text;
begin
 e := lower(trim(coalesce(p_email,'')));
 if length(e)>254 or e !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then raise exception 'Please provide a valid email address.' using errcode='22023'; end if;
 insert into public.subscribers(email) values(e) on conflict(email) do update set is_active=true;
 return jsonb_build_object('ok',true);
end $$;
revoke execute on function public.submit_subscriber(text) from public, anon, authenticated;
grant execute on function public.submit_subscriber(text) to service_role;
