import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Activity,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Plus,
  RefreshCw,
  Phone,
  Mail,
  MessageCircle,
  AlertCircle,
  Clock,
  CheckCircle2,
  Calendar,
  Menu,
  X,
  ExternalLink
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts';

import {
  Appointment,
  FollowUp,
  Doctor,
  ServiceItem,
  PricingPlan,
  Testimonial,
  GalleryCase,
  FaqItem,
  BlogPost,
  SiteSettings,
  Profile,
  Lead
} from './types';

const AppointmentsView = lazy(() => import('./components/AppointmentsView'));
const FollowUpsView = lazy(() => import('./components/FollowUpsView'));
const WebsiteContentView = lazy(() => import('./components/WebsiteContentView'));

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://nczxzztlwveocdxphsmk.supabase.co';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jenh6enRsd3Zlb2NkeHBoc21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyMjkxNzksImV4cCI6MjEwNzgwNTE3OX0.pH3KPev53H1f6PGpyab_CiP5Q-6Dw0FXkphTAJpvK2M';
const supabase: SupabaseClient | null = url && anon ? createClient(url, anon) : null;

const nav = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'leads', label: 'Leads & Enquiries', icon: Users },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'followups', label: 'Follow-ups', icon: Activity },
  { id: 'content', label: 'Website Content', icon: FileText },
  { id: 'settings', label: 'Clinic Settings', icon: Settings },
];

function initials(s = 'Staff') {
  return s
    .split(' ')
    .map(x => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [page, setPage] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showAddLead, setShowAddLead] = useState(false);
  const [dark, setDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // App Data States
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [galleryCases, setGalleryCases] = useState<GalleryCase[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Cross-component transition state
  const [followUpInitialData, setFollowUpInitialData] = useState<{
    name: string;
    phone: string;
    appointmentId?: string;
    reason?: string;
  } | null>(null);

  const [newLead, setNewLead] = useState({
    name: '',
    phone: '',
    email: '',
    service: 'General Dentistry',
    message: '',
  });

  // Auth setup
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Main loader
  async function load() {
    if (!supabase || !session) return;
    setLoading(true);
    setErr('');
    try {
      const { data: userData } = await supabase.auth.getUser();
      setProfile(userData.user);

      // Fetch leads
      const { data: leadsData, error: lErr } = await supabase
        .from('leads')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!lErr && leadsData) setLeads(leadsData);

      // Fetch appointments with doctor info
      const { data: apptsData, error: aErr } = await supabase
        .from('appointments')
        .select(`
          id,
          lead_id,
          patient_name,
          phone,
          email,
          service,
          doctor_id,
          starts_at,
          ends_at,
          status,
          notes,
          internal_notes,
          cancel_reason,
          source,
          created_at,
          updated_at,
          doctor:doctors(id, name, specialty, photo_url)
        `)
        .order('starts_at', { ascending: false })
        .limit(300);
      if (!aErr && apptsData) setAppointments(apptsData as any);

      // Fetch follow-ups
      const { data: followData, error: fErr } = await supabase
        .from('follow_ups')
        .select(`
          id,
          lead_id,
          appointment_id,
          title,
          description,
          due_at,
          priority,
          status,
          contact_method,
          outcome,
          cancel_reason,
          next_follow_up_at,
          assigned_to,
          created_by,
          done,
          created_at,
          updated_at,
          lead:leads(id, name, phone, email, service)
        `)
        .order('due_at', { ascending: true })
        .limit(300);
      if (!fErr && followData) setFollowUps(followData as any);

      // Fetch doctors
      const { data: docsData } = await supabase
        .from('doctors')
        .select('*')
        .order('sort_order', { ascending: true });
      if (docsData) setDoctors(docsData);

      // Fetch services
      const { data: servData } = await supabase
        .from('services')
        .select('*')
        .order('sort_order', { ascending: true });
      if (servData) setServices(servData);

      // Fetch pricing plans
      const { data: priceData } = await supabase
        .from('pricing_plans')
        .select('*')
        .order('sort_order', { ascending: true });
      if (priceData) setPricingPlans(priceData);

      // Fetch testimonials
      const { data: testData } = await supabase
        .from('testimonials')
        .select('*')
        .order('sort_order', { ascending: true });
      if (testData) setTestimonials(testData);

      // Fetch gallery cases
      const { data: galData } = await supabase
        .from('gallery_cases')
        .select('*')
        .order('sort_order', { ascending: true });
      if (galData) setGalleryCases(galData);

      // Fetch faqs
      const { data: faqData } = await supabase
        .from('faqs')
        .select('*')
        .order('sort_order', { ascending: true });
      if (faqData) setFaqs(faqData);

      // Fetch blog posts
      const { data: blogData } = await supabase
        .from('blog_posts')
        .select('*')
        .order('sort_order', { ascending: true });
      if (blogData) setBlogPosts(blogData);

      // Fetch site settings
      const { data: settingsData } = await supabase
        .from('site_settings')
        .select('*')
        .limit(1)
        .single();
      if (settingsData) setSettings(settingsData);

      // Fetch active staff profiles
      const { data: profData } = await supabase
        .from('profiles')
        .select('id, full_name, role, avatar_url, is_active')
        .eq('is_active', true);
      if (profData) setProfiles(profData);
    } catch (e: any) {
      setErr(e?.message || 'Error loading dashboard data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [session]);

  // Realtime subscription across core tables
  useEffect(() => {
    if (!supabase || !session) return;
    const ch = supabase
      .channel('admin-workspace-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [session]);

  const filteredLeads = useMemo(
    () =>
      leads.filter(
        l =>
          `${l.name} ${l.phone} ${l.email || ''} ${l.service || ''}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (filter === 'all' || l.status === filter)
      ),
    [leads, search, filter]
  );

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setErr('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to admin/.env first.');
      return;
    }
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
  }

  async function updateLeadStatus(id: string, status: string) {
    if (!supabase) return;
    const { error } = await supabase.from('leads').update({ status }).eq('id', id);
    if (error) setErr(error.message);
    else setLeads(v => v.map(l => (l.id === id ? { ...l, status: status as any } : l)));
  }

  async function addLead(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from('leads').insert({
      ...newLead,
      source: 'manual',
      status: 'new',
      priority: 'normal',
    });
    if (error) {
      setErr(error.message);
    } else {
      setShowAddLead(false);
      setNewLead({ name: '', phone: '', email: '', service: 'General Dentistry', message: '' });
      load();
    }
    setBusy(false);
  }

  if (!session) {
    return (
      <div className="login-page">
        <div className="login-visual">
          <div className="wordmark">
            <span className="mark">✳</span>
            <span>
              LUMIÈRE<small>DENTAL STUDIO</small>
            </span>
          </div>
          <div className="login-message">
            <span className="eyebrow">THE CLINIC WORKSPACE</span>
            <h1>
              Care that feels
              <br />
              <em>considered.</em>
            </h1>
            <p>Every patient conversation, appointment, and detail — in one calm place.</p>
            <div className="login-stats">
              <div>
                <b>01</b>
                <span>Appointments</span>
              </div>
              <div>
                <b>02</b>
                <span>Follow-ups</span>
              </div>
              <div>
                <b>03</b>
                <span>Live Studio CMS</span>
              </div>
            </div>
          </div>
          <div className="visual-footer">PRIVATE STAFF PORTAL • SECURE ACCESS</div>
        </div>
        <form className="login-form" onSubmit={signIn}>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to your workspace</h2>
          <p>Use your clinic staff account to continue.</p>
          {!supabase && (
            <div className="notice">
              <AlertCircle size={17} /> Configure the Supabase keys in <code>admin/.env</code> to enable sign-in.
            </div>
          )}
          {err && <div className="error-box">{err}</div>}
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@lumieredental.example"
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Your password"
              required
              autoComplete="current-password"
            />
          </label>
          <button className="primary wide" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in securely'} <span>↗</span>
          </button>
          <small className="login-foot">
            <ShieldCheck size={14} /> Protected by Supabase Auth and database policies
          </small>
        </form>
      </div>
    );
  }

  // Dashboard calculations
  const totalLeads = leads.length;
  const newCount = leads.filter(l => l.status === 'new').length;
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayAppts = appointments.filter(a => a.starts_at && a.starts_at.slice(0, 10) === todayStr);
  const scheduledAppts = appointments.filter(a => a.status === 'scheduled');
  const confirmedAppts = appointments.filter(a => a.status === 'confirmed');

  const pendingFollowUps = followUps.filter(f => f.status === 'pending');
  const nowIso = new Date().toISOString();
  const overdueFollowUps = pendingFollowUps.filter(f => f.due_at && f.due_at < nowIso);

  return (
    <div className={dark ? 'app dark' : 'app'}>
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}
      <aside className={'sidebar ' + (mobileMenuOpen ? 'mobile-open' : '')}>
        <div className="sidebar-top-row">
          <a className="wordmark" href="#" onClick={e => { e.preventDefault(); setPage('overview'); setMobileMenuOpen(false); }}>
            <span className="mark">✳</span>
            <span>
              LUMIÈRE<small>DENTAL STUDIO</small>
            </span>
          </a>
          <button className="mobile-close-btn" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div className="workspace">
          <span className="avatar">LS</span>
          <span>
            <b>Clinic workspace</b>
            <small>{settings?.clinic_name || 'Hyderabad · Live'}</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        {nav.map(n => {
          let badge: number | null = null;
          if (n.id === 'leads' && newCount > 0) badge = newCount;
          if (n.id === 'appointments' && (todayAppts.length > 0 || scheduledAppts.length > 0)) {
            badge = todayAppts.length || scheduledAppts.length;
          }
          if (n.id === 'followups' && overdueFollowUps.length > 0) badge = overdueFollowUps.length;

          return (
            <button
              key={n.id}
              className={'nav-item ' + (page === n.id ? 'active' : '')}
              onClick={() => {
                setPage(n.id);
                setMobileMenuOpen(false);
                if (n.id === 'followups') {
                  setFollowUpInitialData(null);
                }
              }}
            >
              <n.icon size={17} />
              {n.label}
              {badge !== null && <span className="count">{badge}</span>}
            </button>
          );
        })}
        <div className="sidebar-bottom">
          <div className="secure">
            <ShieldCheck size={17} />
            <div>
              <b>Workspace security</b>
              <small>Supabase RLS Active</small>
            </div>
          </div>
          <button className="nav-item" onClick={() => setDark(!dark)}>
            <Moon size={17} />
            {dark ? 'Light appearance' : 'Dark appearance'}
          </button>
          <button className="nav-item" onClick={signOut}>
            <LogOut size={17} />
            Sign out
          </button>
          <div className="staff">
            <span className="avatar muted">{initials(profile?.email || 'Admin')}</span>
            <span>
              <b>{profile?.email || 'Clinic staff'}</b>
              <small>Authenticated staff</small>
            </span>
            <button aria-label="Sign out" onClick={signOut}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="mobile-menu-trigger" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
            <div className="breadcrumb">
              Workspace <span>/</span> <b>{nav.find(n => n.id === page)?.label || page}</b>
            </div>
          </div>
          <div className="top-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                placeholder="Search clinic records…"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  if (e.target.value && page === 'overview') setPage('leads');
                }}
              />
              <kbd>⌘ K</kbd>
            </div>
            <button className="icon-btn" onClick={load} aria-label="Refresh dashboard" title="Refresh data">
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
            <button className="icon-btn mobile-only-btn" onClick={() => setDark(!dark)} title="Toggle theme">
              <Moon size={16} />
            </button>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="secondary view-site-btn"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              title="Open public website in a new tab"
            >
              <span>Live Website</span> <ExternalLink size={13} />
            </a>
          </div>
        </header>

        {page === 'overview' && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR CLINIC, AT A GLANCE</span>
                <h1>Good day.</h1>
                <p>Real-time overview of patient bookings, appointments, and care follow-ups.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="secondary" onClick={() => setPage('appointments')}>
                  <CalendarDays size={16} /> View Appointments
                </button>
                <button className="primary" onClick={() => setShowAddLead(true)}>
                  <Plus size={17} /> Add lead
                </button>
              </div>
            </div>

            {err && <div className="error-box">{err}</div>}

            <div className="metric-grid">
              <Metric
                label="Today's Appointments"
                value={todayAppts.length}
                hint={`${confirmedAppts.length} confirmed across calendar`}
                icon={<CalendarDays />}
              />
              <Metric
                label="New Enquiries"
                value={newCount}
                hint="Website & walk-in leads"
                icon={<Users />}
              />
              <Metric
                label="Follow-ups Due"
                value={pendingFollowUps.length}
                hint={overdueFollowUps.length > 0 ? `${overdueFollowUps.length} overdue callbacks` : 'All tasks on schedule'}
                icon={<Activity />}
              />
              <Metric
                label="Published Services"
                value={services.filter(s => s.is_published).length}
                hint={`${doctors.filter(d => d.is_published).length} active dentists`}
                icon={<CheckCircle2 />}
              />
            </div>

            <div className="content-grid">
              <section className="panel chart-panel">
                <div className="panel-head">
                  <div>
                    <h3>Patient Enquiry Activity</h3>
                    <p>New enquiries received over the last 7 days</p>
                  </div>
                  <span className="live">
                    <i /> Live Supabase sync
                  </span>
                </div>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weekData(leads)}>
                      <defs>
                        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1FA6A0" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#1FA6A0" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="leads" stroke="#1FA6A0" strokeWidth={2.5} fill="url(#fill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel source-panel">
                <div className="panel-head">
                  <div>
                    <h3>Appointments by Status</h3>
                    <p>Current distribution in scheduling</p>
                  </div>
                </div>
                {[
                  { status: 'confirmed', label: 'Confirmed', count: appointments.filter(a => a.status === 'confirmed').length, color: '#1fa6a0' },
                  { status: 'scheduled', label: 'Pending Request', count: appointments.filter(a => a.status === 'scheduled').length, color: '#f59e0b' },
                  { status: 'completed', label: 'Completed', count: appointments.filter(a => a.status === 'completed').length, color: '#3b82f6' },
                  { status: 'no_show', label: 'No Show', count: appointments.filter(a => a.status === 'no_show').length, color: '#ef4444' },
                  { status: 'cancelled', label: 'Cancelled', count: appointments.filter(a => a.status === 'cancelled').length, color: '#94a3b8' }
                ].map(item => {
                  const total = appointments.length || 1;
                  return (
                    <div className="pipeline-row" key={item.status}>
                      <span className={'status-dot s-' + item.status} />
                      <span>{item.label}</span>
                      <div className="pipeline-track">
                        <i style={{ width: `${(item.count / total) * 100}%`, background: item.color }} />
                      </div>
                      <b>{item.count}</b>
                    </div>
                  );
                })}
                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <button className="text-btn" onClick={() => setPage('appointments')} style={{ width: '100%', textAlign: 'center', fontSize: '0.85rem' }}>
                    Open Appointment Calendar →
                  </button>
                </div>
              </section>
            </div>

            <section className="panel table-panel">
              <div className="panel-head">
                <div>
                  <h3>Latest Enquiries</h3>
                  <p>Recent patients requesting consultation.</p>
                </div>
                <button className="text-btn" onClick={() => setPage('leads')}>
                  View all leads ↗
                </button>
              </div>
              <LeadTable leads={leads.slice(0, 5)} onStatus={updateLeadStatus} />
            </section>
          </>
        )}

        {page === 'leads' && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">PATIENT RELATIONSHIPS</span>
                <h1>Leads & Enquiries</h1>
                <p>Track prospective patients from first inquiry through to consultation.</p>
              </div>
              <button className="primary" onClick={() => setShowAddLead(true)}>
                <Plus size={17} /> Add lead
              </button>
            </div>
            {err && <div className="error-box">{err}</div>}
            <div className="panel table-panel">
              <div className="filterbar">
                <div className="filter-search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search name, phone, email, treatment…"
                  />
                </div>
                <select value={filter} onChange={e => setFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  {['new', 'contacted', 'qualified', 'booked', 'completed', 'lost', 'spam'].map(s => (
                    <option key={s} value={s}>
                      {title(s)}
                    </option>
                  ))}
                </select>
                <button className="icon-btn" onClick={load} title="Refresh leads">
                  <RefreshCw size={16} />
                </button>
              </div>
              {loading ? (
                <div className="empty">Loading enquiries…</div>
              ) : filteredLeads.length ? (
                <LeadTable leads={filteredLeads} onStatus={updateLeadStatus} />
              ) : (
                <div className="empty">
                  <span className="empty-icon">
                    <Users size={24} />
                  </span>
                  <h3>{search || filter !== 'all' ? 'No matching leads' : 'Your lead inbox is ready'}</h3>
                  <p>
                    {search || filter !== 'all'
                      ? 'Try changing your search or filters.'
                      : 'Website bookings and enquiries will automatically appear here.'}
                  </p>
                  <button className="secondary" onClick={() => setShowAddLead(true)}>
                    <Plus size={16} /> Add your first lead
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <Suspense fallback={
          <div className="placeholder-panel">
            <div className="placeholder-icon">
              <Activity size={24} />
            </div>
            <h2>Loading workspace…</h2>
            <p>Syncing clinic data securely</p>
          </div>
        }>
          {page === 'appointments' && supabase && (
            <AppointmentsView
              supabase={supabase}
              appointments={appointments}
              doctors={doctors}
              leads={leads}
              onRefresh={load}
              onOpenFollowUpWithPatient={info => {
                setFollowUpInitialData(info);
                setPage('followups');
              }}
            />
          )}

          {page === 'followups' && supabase && (
            <FollowUpsView
              supabase={supabase}
              followUps={followUps}
              leads={leads}
              profiles={profiles}
              currentUserId={session?.user?.id}
              onRefresh={load}
              initialNewData={followUpInitialData}
              onClearInitialData={() => setFollowUpInitialData(null)}
            />
          )}

          {page === 'content' && supabase && (
            <WebsiteContentView
              supabase={supabase}
              services={services}
              doctors={doctors}
              pricingPlans={pricingPlans}
              testimonials={testimonials}
              galleryCases={galleryCases}
              faqs={faqs}
              blogPosts={blogPosts}
              settings={settings}
              onRefresh={load}
              initialTab="services"
            />
          )}

          {page === 'settings' && supabase && (
            <WebsiteContentView
              key="settings-view"
              supabase={supabase}
              services={services}
              doctors={doctors}
              pricingPlans={pricingPlans}
              testimonials={testimonials}
              galleryCases={galleryCases}
              faqs={faqs}
              blogPosts={blogPosts}
              settings={settings}
              onRefresh={load}
              initialTab="settings"
            />
          )}
        </Suspense>

        <footer className="app-footer">
          <span>© {new Date().getFullYear()} Lumière Dental Studio</span>
          <span>
            <i className="online-dot" /> Connected to Supabase Cloud
          </span>
          <span>HIPAA & Patient Privacy Standards</span>
        </footer>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav">
        <button className={'mobile-tab ' + (page === 'overview' ? 'active' : '')} onClick={() => setPage('overview')}>
          <LayoutDashboard size={18} />
          <span>Overview</span>
        </button>
        <button className={'mobile-tab ' + (page === 'appointments' ? 'active' : '')} onClick={() => setPage('appointments')}>
          <CalendarDays size={18} />
          <span>Appts</span>
          {(todayAppts.length > 0 || scheduledAppts.length > 0) && (
            <span className="mobile-badge">{todayAppts.length || scheduledAppts.length}</span>
          )}
        </button>
        <button className={'mobile-tab ' + (page === 'followups' ? 'active' : '')} onClick={() => { setPage('followups'); setFollowUpInitialData(null); }}>
          <Activity size={18} />
          <span>Follow-up</span>
          {overdueFollowUps.length > 0 && (
            <span className="mobile-badge danger">{overdueFollowUps.length}</span>
          )}
        </button>
        <button className={'mobile-tab ' + (page === 'leads' ? 'active' : '')} onClick={() => setPage('leads')}>
          <Users size={18} />
          <span>Leads</span>
          {newCount > 0 && (
            <span className="mobile-badge">{newCount}</span>
          )}
        </button>
        <button className={'mobile-tab ' + (page === 'content' ? 'active' : '')} onClick={() => setPage('content')}>
          <FileText size={18} />
          <span>CMS</span>
        </button>
        <button className="mobile-tab" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={18} />
          <span>More</span>
        </button>
      </nav>

      {showAddLead && (
        <div
          className="overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setShowAddLead(false);
          }}
        >
          <form className="drawer" onSubmit={addLead}>
            <div className="drawer-head">
              <div>
                <span className="eyebrow">NEW RECORD</span>
                <h2>Add a patient lead</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setShowAddLead(false)}>
                ✕
              </button>
            </div>
            <p className="drawer-intro">Capture a phone enquiry, walk-in consultation, or referral.</p>
            <label>
              Full name *
              <input
                required
                value={newLead.name}
                onChange={e => setNewLead({ ...newLead, name: e.target.value })}
                placeholder="e.g. Ananya Sharma"
              />
            </label>
            <label>
              Phone number *
              <input
                required
                value={newLead.phone}
                onChange={e => setNewLead({ ...newLead, phone: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </label>
            <label>
              Email (optional)
              <input
                type="email"
                value={newLead.email}
                onChange={e => setNewLead({ ...newLead, email: e.target.value })}
                placeholder="patient@example.com"
              />
            </label>
            <label>
              Requested Treatment
              <select
                value={newLead.service}
                onChange={e => setNewLead({ ...newLead, service: e.target.value })}
              >
                {[
                  'General Dentistry',
                  'Teeth Whitening',
                  'Clear Aligners',
                  'Dental Implants',
                  'Veneers & Smile Makeover',
                  'Root Canal Therapy',
                  'Pediatric Care',
                  'Emergency Care',
                ].map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Notes & Clinical Concerns
              <textarea
                rows={4}
                value={newLead.message}
                onChange={e => setNewLead({ ...newLead, message: e.target.value })}
                placeholder="Patient mentioned sensitivity on upper molar..."
              />
            </label>
            {err && <div className="error-box">{err}</div>}
            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => setShowAddLead(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save lead'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: any;
  hint: string;
  icon: any;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function title(s: string) {
  return s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function weekData(leads: Lead[]) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return {
      day: d.toLocaleDateString('en', { weekday: 'short' }),
      leads: leads.filter(
        l => new Date(l.created_at).toDateString() === d.toDateString()
      ).length,
    };
  });
}

function LeadTable({
  leads,
  onStatus,
}: {
  leads: Lead[];
  onStatus: (id: string, status: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Patient / Lead</th>
            <th>Service</th>
            <th>Source</th>
            <th>Status</th>
            <th>Received</th>
            <th>Quick Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(l => {
            const refCode = '#LUM-' + l.id.slice(0, 8).toUpperCase();
            const cleanPhone = l.phone.replace(/\D/g, '');
            const waText = encodeURIComponent(
              `Hello ${l.name}, this is Lumière Dental Studio.\n\nWe are pleased to confirm your appointment for ${
                l.service || 'Dental Consultation'
              } on ${l.preferred_date || 'your requested date'} (Ref: ${refCode}).\n\nClinic: 12 Green Avenue, Hyderabad\nGoogle Maps: https://maps.google.com/?q=12+Green+Avenue+Hyderabad\n\nPlease let us know if you need to reschedule or have any questions. See you soon!`
            );
            const mailSub = encodeURIComponent(
              `Appointment Confirmation — Lumière Dental Studio (${refCode})`
            );
            const mailBody = encodeURIComponent(
              `Dear ${l.name},\n\nYour appointment for ${
                l.service || 'Dental Consultation'
              } has been confirmed for ${l.preferred_date || 'your requested date'}.\n\nReference: ${refCode}\nClinic: 12 Green Avenue, Hyderabad\nPhone: +91 98765 43210\n\nWarm regards,\nLumière Dental Studio`
            );

            return (
              <tr key={l.id}>
                <td>
                  <div className="patient">
                    <span className="avatar pale">{initials(l.name)}</span>
                    <span>
                      <b>{l.name}</b>
                      <small>
                        {l.phone}
                        {l.email ? ' · ' + l.email : ''}
                      </small>
                    </span>
                  </div>
                </td>
                <td>{l.service || '—'}</td>
                <td>
                  <span className="source-pill">{title(l.source || 'website')}</span>
                </td>
                <td>
                  <select
                    className={'status-select status-' + l.status}
                    value={l.status}
                    onChange={e => onStatus(l.id, e.target.value)}
                    aria-label={'Status for ' + l.name}
                  >
                    {['new', 'contacted', 'qualified', 'booked', 'completed', 'lost', 'spam'].map(s => (
                      <option key={s} value={s}>
                        {title(s)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="date-cell">
                  {new Date(l.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </td>
                <td>
                  <div className="quick-actions">
                    <a title={'Call ' + l.name} href={'tel:' + cleanPhone}>
                      <Phone size={15} />
                    </a>
                    {l.email && (
                      <a
                        title={'Send confirmation email to ' + l.name}
                        href={`mailto:${l.email}?subject=${mailSub}&body=${mailBody}`}
                      >
                        <Mail size={15} />
                      </a>
                    )}
                    <a
                      title={'Send WhatsApp confirmation to ' + l.name}
                      target="_blank"
                      rel="noreferrer"
                      href={`https://wa.me/${cleanPhone}?text=${waText}`}
                    >
                      <MessageCircle size={15} />
                    </a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
