import { useState, useMemo } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { Appointment, Doctor, AppointmentStatus, Lead } from '../types';
import { CalendarDays, Clock, Plus, Search, Filter, Phone, Mail, MessageCircle, AlertCircle, CheckCircle2, XCircle, UserCheck, Calendar, ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react';

interface AppointmentsViewProps {
  supabase: SupabaseClient;
  appointments: Appointment[];
  doctors: Doctor[];
  leads: Lead[];
  onRefresh: () => void;
  onOpenFollowUpWithPatient?: (info: { name: string; phone: string; appointmentId?: string; reason?: string }) => void;
}

export default function AppointmentsView({ supabase, appointments, doctors, leads, onRefresh, onOpenFollowUpWithPatient }: AppointmentsViewProps) {
  const [viewMode, setViewMode] = useState<'table' | 'day' | 'week' | 'month'>('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  
  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Form State for New / Reschedule
  const [formData, setFormData] = useState({
    patient_name: '',
    phone: '',
    email: '',
    service: 'General Dentistry',
    doctor_id: '',
    date: new Date().toISOString().slice(0, 10),
    time: '10:00',
    duration_minutes: 30,
    notes: '',
    internal_notes: '',
    lead_id: ''
  });

  // Cancel reason state
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }

  // Filtered Appointments
  const filtered = useMemo(() => {
    return appointments.filter(a => {
      const matchSearch = `${a.patient_name} ${a.phone} ${a.email || ''} ${a.service || ''}`.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || a.status === statusFilter;
      const matchDoctor = doctorFilter === 'all' || a.doctor_id === doctorFilter;
      return matchSearch && matchStatus && matchDoctor;
    });
  }, [appointments, search, statusFilter, doctorFilter]);

  // Summary Metrics
  const total = appointments.length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = appointments.filter(a => a.starts_at.slice(0, 10) === todayStr && a.status !== 'cancelled').length;
  const confirmedCount = appointments.filter(a => a.status === 'confirmed').length;
  const scheduledCount = appointments.filter(a => a.status === 'scheduled').length;
  const completedCount = appointments.filter(a => a.status === 'completed').length;
  const cancelledCount = appointments.filter(a => a.status === 'cancelled').length;
  const noShowCount = appointments.filter(a => a.status === 'no_show').length;

  // Conflict Checker before DB save
  async function checkConflict(doctorId: string, startsAt: string, endsAt: string, excludeId?: string): Promise<boolean> {
    if (!doctorId) return false;
    const { data, error } = await supabase.rpc('check_appointment_conflict', {
      p_doctor_id: doctorId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_exclude_id: excludeId || null
    });
    if (error) {
      console.warn('Conflict RPC check warning:', error.message);
      return false;
    }
    return Boolean(data);
  }

  // Create Appointment Handler
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');

    try {
      const startsAt = new Date(`${formData.date}T${formData.time}:00`).toISOString();
      const endsDate = new Date(new Date(startsAt).getTime() + formData.duration_minutes * 60000);
      const endsAt = endsDate.toISOString();

      if (new Date(startsAt).getTime() < Date.now() - 300000) {
        setErr('Appointment time must be in the future.');
        setBusy(false);
        return;
      }

      // Check conflict if doctor assigned
      if (formData.doctor_id) {
        const hasConflict = await checkConflict(formData.doctor_id, startsAt, endsAt);
        if (hasConflict) {
          const doc = doctors.find(d => d.id === formData.doctor_id);
          setErr(`${doc?.name || 'The selected dentist'} already has a scheduled appointment overlapping this time slot. Please choose another time.`);
          setBusy(false);
          return;
        }
      }

      const { data, error } = await supabase.from('appointments').insert({
        patient_name: formData.patient_name.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim() || null,
        service: formData.service,
        doctor_id: formData.doctor_id || null,
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'confirmed',
        notes: formData.notes.trim() || null,
        internal_notes: formData.internal_notes.trim() || null,
        lead_id: formData.lead_id || null,
        source: formData.lead_id ? 'lead_conversion' : 'manual'
      }).select().single();

      if (error) throw error;

      // If tied to lead, update lead status to booked
      if (formData.lead_id) {
        await supabase.from('leads').update({ status: 'booked' }).eq('id', formData.lead_id);
      }

      toast(`Appointment created for ${formData.patient_name}!`);
      setShowCreate(false);
      resetForm();
      onRefresh();
    } catch (ex: any) {
      setErr(ex?.message || 'Failed to schedule appointment.');
    } finally {
      setBusy(false);
    }
  }

  // Update Status Handler
  async function handleStatusChange(apptId: string, newStatus: AppointmentStatus, reason?: string) {
    setBusy(true);
    try {
      const updatePayload: any = { status: newStatus };
      if (newStatus === 'cancelled' && reason) {
        updatePayload.cancel_reason = reason;
      }

      const { error } = await supabase.from('appointments').update(updatePayload).eq('id', apptId);
      if (error) throw error;

      toast(`Appointment marked as ${newStatus.replace('_', ' ')}.`);
      
      // If marked as no-show or cancelled, prompt or notify staff
      if (newStatus === 'no_show' && onOpenFollowUpWithPatient && selectedAppt) {
        const patientName = selectedAppt.patient_name;
        const patientPhone = selectedAppt.phone;
        const apptIdRef = selectedAppt.id;
        setSelectedAppt(null);
        if (confirm(`Appointment marked as No-Show. Would you like to create a callback follow-up task for ${patientName}?`)) {
          onOpenFollowUpWithPatient({
            name: patientName,
            phone: patientPhone,
            appointmentId: apptIdRef,
            reason: 'Patient was marked as no-show for appointment. Call back to check in and reschedule.'
          });
        }
      } else {
        setSelectedAppt(null);
      }

      onRefresh();
    } catch (ex: any) {
      alert(ex?.message || 'Failed to update status.');
    } finally {
      setBusy(false);
      setShowCancelPrompt(false);
    }
  }

  function resetForm() {
    setFormData({
      patient_name: '',
      phone: '',
      email: '',
      service: 'General Dentistry',
      doctor_id: '',
      date: new Date().toISOString().slice(0, 10),
      time: '10:00',
      duration_minutes: 30,
      notes: '',
      internal_notes: '',
      lead_id: ''
    });
  }

  function openFromLead(lead: Lead) {
    setFormData({
      patient_name: lead.name,
      phone: lead.phone,
      email: lead.email || '',
      service: lead.service || 'General Dentistry',
      doctor_id: doctors[0]?.id || '',
      date: lead.preferred_date || new Date().toISOString().slice(0, 10),
      time: lead.preferred_time?.includes('12') ? '12:00' : lead.preferred_time?.includes('3') ? '15:00' : lead.preferred_time?.includes('5') ? '17:00' : '10:00',
      duration_minutes: 45,
      notes: lead.message || '',
      internal_notes: `Converted from online lead #${lead.id.slice(0, 8)}`,
      lead_id: lead.id
    });
    setShowCreate(true);
  }

  const doctorMap = useMemo(() => {
    return new Map(doctors.map(d => [d.id, d.name]));
  }, [doctors]);

  // Hourly timeline slots for Day view (09:00 to 19:00)
  const daySlots = Array.from({ length: 11 }, (_, i) => i + 9);

  return (
    <div className="appointments-section">
      {/* Toast Alert */}
      {toastMsg && <div className="admin-toast"><CheckCircle2 size={16} /> {toastMsg}</div>}

      {/* Header */}
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLINICAL SCHEDULE</span>
          <h1>Appointments</h1>
          <p>Schedule, verify availability, and manage patient visits.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="primary" onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus size={16} /> Schedule appointment
          </button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="metric-grid">
        <div className="metric">
          <div className="metric-top"><span>Today's Visits</span><CalendarDays size={16} /></div>
          <strong>{todayCount}</strong>
          <small>{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}</small>
        </div>
        <div className="metric">
          <div className="metric-top"><span>Confirmed</span><CheckCircle2 size={16} /></div>
          <strong>{confirmedCount}</strong>
          <small>Ready for check-in</small>
        </div>
        <div className="metric">
          <div className="metric-top"><span>Pending Requests</span><Clock size={16} /></div>
          <strong>{scheduledCount}</strong>
          <small>Need confirmation</small>
        </div>
        <div className="metric">
          <div className="metric-top"><span>Completed / No-Show</span><UserCheck size={16} /></div>
          <strong>{completedCount} <span style={{ fontSize: '13px', color: '#c0392b' }}>({noShowCount} missed)</span></strong>
          <small>{cancelledCount} cancelled</small>
        </div>
      </div>

      {/* Control Bar: View Toggles & Filters */}
      <div className="panel" style={{ padding: '14px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          
          {/* View Toggles */}
          <div className="view-mode-tabs">
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>Table List</button>
            <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Day Timeline</button>
            <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Weekly View</button>
            <button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Monthly Grid</button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <div className="filter-search" style={{ width: '220px' }}>
              <Search size={15} />
              <input placeholder="Search patient, phone…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <option value="all">All statuses</option>
              <option value="scheduled">Scheduled / Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="no_show">No-Show</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <select value={doctorFilter} onChange={e => setDoctorFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <option value="all">All dentists</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ padding: '7px 9px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)', background: 'white' }} />
          </div>
        </div>
      </div>

      {/* Main Content Area based on ViewMode */}
      {viewMode === 'table' && (
        <div className="panel table-panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Service &amp; Doctor</th>
                  <th>Date &amp; Time</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                      No appointments match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(a => {
                    const startDate = new Date(a.starts_at);
                    const endDate = new Date(a.ends_at);
                    const durationMins = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
                    const isUpcoming = startDate.getTime() >= Date.now();
                    const docName = a.doctor_id ? doctorMap.get(a.doctor_id) || 'Dentist assigned' : 'Unassigned';

                    return (
                      <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedAppt(a)}>
                        <td>
                          <div className="patient">
                            <span className="avatar pale">{a.patient_name.slice(0, 2).toUpperCase()}</span>
                            <div>
                              <b>{a.patient_name}</b>
                              <small>{a.phone} {a.email ? `· ${a.email}` : ''}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <b>{a.service || 'General Dentistry'}</b>
                          <small style={{ display: 'block', color: 'var(--teal)', fontSize: '10px' }}>{docName}</small>
                        </td>
                        <td>
                          <b>{startDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</b>
                          <small style={{ display: 'block', color: 'var(--muted)' }}>{startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</small>
                        </td>
                        <td>
                          <span style={{ fontSize: '11px', color: '#536562' }}>{durationMins > 0 ? `${durationMins} mins` : '30 mins'}</span>
                        </td>
                        <td>
                          <span className={`status-select status-${a.status}`} style={{ display: 'inline-block', padding: '4px 8px' }}>
                            {a.status === 'no_show' ? 'No-Show' : a.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10px', color: '#778787' }}>
                          {a.notes || a.internal_notes || '—'}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="quick-actions">
                            <a title="Call" href={`tel:${a.phone.replace(/\D/g, '')}`}><Phone size={14} /></a>
                            <a 
                              title="WhatsApp confirmation" 
                              target="_blank" 
                              rel="noreferrer" 
                              href={`https://wa.me/${a.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${a.patient_name}, this is Lumière Dental Studio regarding your appointment on ${startDate.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })} at ${startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} with ${docName}. Please let us know if you need any directions!`)}`}
                            >
                              <MessageCircle size={14} />
                            </a>
                            <button 
                              className="text-btn" 
                              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '5px', background: '#eff4f2' }} 
                              onClick={() => setSelectedAppt(a)}
                            >
                              Manage
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Day Timeline View */}
      {viewMode === 'day' && (
        <div className="panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="icon-btn" onClick={() => {
                const prev = new Date(selectedDate);
                prev.setDate(prev.getDate() - 1);
                setSelectedDate(prev.toISOString().slice(0, 10));
              }}><ChevronLeft size={16} /></button>
              <h3 style={{ margin: 0, fontSize: '16px' }}>
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </h3>
              <button className="icon-btn" onClick={() => {
                const next = new Date(selectedDate);
                next.setDate(next.getDate() + 1);
                setSelectedDate(next.toISOString().slice(0, 10));
              }}><ChevronRight size={16} /></button>
            </div>
            <button className="secondary" onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}>Today</button>
          </div>

          {/* Timeline schedule by hour */}
          <div className="day-timeline-grid">
            {daySlots.map(hour => {
              const hourStr = `${String(hour).padStart(2, '0')}:00`;
              const apptsInHour = filtered.filter(a => {
                const d = new Date(a.starts_at);
                return d.toISOString().slice(0, 10) === selectedDate && d.getHours() === hour;
              });

              return (
                <div key={hour} className="timeline-hour-row">
                  <div className="timeline-hour-label">
                    {hour <= 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`}
                  </div>
                  <div className="timeline-slot-container">
                    {apptsInHour.length === 0 ? (
                      <div className="timeline-empty-slot" onClick={() => {
                        setFormData({
                          ...formData,
                          date: selectedDate,
                          time: hourStr
                        });
                        setShowCreate(true);
                      }}>
                        <small>+ Available chair time</small>
                      </div>
                    ) : (
                      apptsInHour.map(a => (
                        <div key={a.id} className={`timeline-appt-card s-${a.status}`} onClick={() => setSelectedAppt(a)}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <b>{a.patient_name}</b>
                            <span className={`status-select status-${a.status}`}>{a.status}</span>
                          </div>
                          <small>{a.service} · {a.doctor_id ? doctorMap.get(a.doctor_id) : 'Unassigned'}</small>
                          <small style={{ color: 'var(--muted)' }}>
                            {new Date(a.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} – {new Date(a.ends_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </small>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weekly View */}
      {viewMode === 'week' && (
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px' }}>7-Day Rolling Clinic Calendar</h3>
          <div className="calendar-scroll-wrap">
            <div className="week-grid">
              {Array.from({ length: 7 }, (_, i) => {
                const day = new Date();
                day.setDate(day.getDate() + i);
                const dayStr = day.toISOString().slice(0, 10);
                const dayAppts = filtered.filter(a => a.starts_at.slice(0, 10) === dayStr);

                return (
                  <div key={dayStr} className="week-day-col">
                    <div className="week-day-head">
                      <span>{day.toLocaleDateString('en', { weekday: 'short' })}</span>
                      <b>{day.getDate()}</b>
                    </div>
                    <div className="week-day-body">
                      {dayAppts.length === 0 ? (
                        <small style={{ color: '#abb8b4', fontSize: '10px' }}>No visits</small>
                      ) : (
                        dayAppts.map(a => (
                          <div key={a.id} className={`week-appt-pill s-${a.status}`} onClick={() => setSelectedAppt(a)}>
                            <b>{new Date(a.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</b>
                            <span>{a.patient_name}</span>
                            <small>{a.service}</small>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Monthly View */}
      {viewMode === 'month' && (
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px' }}>Monthly Overview</h3>
          <div className="calendar-scroll-wrap">
            <div className="month-grid">
              {Array.from({ length: 28 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - d.getDay() + 1 + i);
                const dStr = d.toISOString().slice(0, 10);
                const dayAppts = filtered.filter(a => a.starts_at.slice(0, 10) === dStr);

                return (
                  <div key={dStr} className={`month-cell ${dStr === todayStr ? 'today' : ''}`} onClick={() => { setSelectedDate(dStr); setViewMode('day'); }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600 }}>
                      <span>{d.getDate()}</span>
                      {dayAppts.length > 0 && <span className="month-badge">{dayAppts.length}</span>}
                    </div>
                    <div className="month-cell-content">
                      {dayAppts.slice(0, 2).map(a => (
                        <div key={a.id} className="month-snippet">{a.patient_name}</div>
                      ))}
                      {dayAppts.length > 2 && <small style={{ fontSize: '9px', color: 'var(--teal)' }}>+{dayAppts.length - 2} more</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Pending Online Requests Section */}
      {leads.filter(l => l.status === 'new' && l.preferred_date).length > 0 && (
        <div className="panel" style={{ marginTop: '20px', border: '1px solid #cce5df', background: '#f8fcfa' }}>
          <div className="panel-head">
            <div>
              <h3 style={{ color: 'var(--teal)' }}>Incoming Online Appointment Requests</h3>
              <p>Patients waiting for official chair scheduling and doctor confirmation.</p>
            </div>
            <span className="live">Action needed</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            {leads.filter(l => l.status === 'new' && l.preferred_date).map(l => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e1ebe7' }}>
                <div>
                  <b style={{ fontSize: '13px' }}>{l.name}</b> · <span style={{ fontSize: '12px', color: '#526662' }}>{l.phone}</span>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                    Requested: <strong>{l.service}</strong> on <strong>{l.preferred_date}</strong> at <strong>{l.preferred_time || '10:00 AM'}</strong>
                    {l.plan ? ` · Package: ${l.plan}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="primary" style={{ padding: '8px 12px', fontSize: '11px' }} onClick={() => openFromLead(l)}>
                    Confirm &amp; Schedule ↗
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CREATE APPOINTMENT MODAL */}
      {showCreate && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <form className="drawer" onSubmit={handleCreate}>
            <div className="drawer-head">
              <div>
                <span className="eyebrow">NEW APPOINTMENT</span>
                <h2>Schedule visit</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setShowCreate(false)}><X /></button>
            </div>

            <p className="drawer-intro">Ensure clinic operating hours and check dentist availability.</p>

            {err && <div className="error-box"><AlertCircle size={15} /> {err}</div>}

            <label>Patient Full Name *
              <input required value={formData.patient_name} onChange={e => setFormData({ ...formData, patient_name: e.target.value })} placeholder="e.g. Ramesh Kumar" />
            </label>

            <label>Phone Number *
              <input required type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="e.g. +91 98765 43210" />
            </label>

            <label>Email Address (optional)
              <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="patient@example.com" />
            </label>

            <label>Treatment / Service
              <select value={formData.service} onChange={e => setFormData({ ...formData, service: e.target.value })}>
                <option value="General Dentistry">General dentistry</option>
                <option value="Teeth Whitening">Teeth whitening</option>
                <option value="Clear Aligners">Clear aligners</option>
                <option value="Dental Implants">Dental implants</option>
                <option value="Veneers & Smile Makeover">Veneers &amp; smile design</option>
                <option value="Root Canal">Root canal</option>
                <option value="Pediatric Dentistry">Children's dentistry</option>
                <option value="Emergency Care">Emergency care</option>
              </select>
            </label>

            <label>Assign Dentist
              <select value={formData.doctor_id} onChange={e => setFormData({ ...formData, doctor_id: e.target.value })}>
                <option value="">-- Unassigned (General Chair) --</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>Date *
                <input required type="date" value={formData.date} min={new Date().toISOString().slice(0, 10)} onChange={e => setFormData({ ...formData, date: e.target.value })} />
              </label>

              <label>Start Time *
                <input required type="time" value={formData.time} onChange={e => setFormData({ ...formData, time: e.target.value })} />
              </label>
            </div>

            <label>Duration
              <select value={formData.duration_minutes} onChange={e => setFormData({ ...formData, duration_minutes: Number(e.target.value) })}>
                <option value={15}>15 minutes (Quick review / consult)</option>
                <option value={30}>30 minutes (Routine clean / exam)</option>
                <option value={45}>45 minutes (Standard procedure)</option>
                <option value={60}>60 minutes (Comprehensive / Filling)</option>
                <option value={90}>90 minutes (Aligner scans / Veneer prep)</option>
                <option value={120}>120 minutes (Surgical / Implants)</option>
              </select>
            </label>

            <label>Patient Concerns / Requests
              <textarea rows={2} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Visible to patient & clinic notes" />
            </label>

            <label>Internal Staff Notes (Private)
              <textarea rows={2} value={formData.internal_notes} onChange={e => setFormData({ ...formData, internal_notes: e.target.value })} placeholder="Internal records only" />
            </label>

            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Validating slot…' : 'Confirm & Schedule'}</button>
            </div>
          </form>
        </div>
      )}

      {/* APPOINTMENT DETAIL / ACTIONS MODAL */}
      {selectedAppt && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedAppt(null); }}>
          <div className="drawer">
            <div className="drawer-head">
              <div>
                <span className="eyebrow">APPOINTMENT DETAILS</span>
                <h2>{selectedAppt.patient_name}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelectedAppt(null)}><X /></button>
            </div>

            <div style={{ margin: '14px 0 20px', padding: '14px', background: '#eaf4f0', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`status-select status-${selectedAppt.status}`}>{selectedAppt.status.toUpperCase()}</span>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ID: #LUM-{selectedAppt.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '13px' }}>
                <strong>{selectedAppt.service}</strong> with <strong>{selectedAppt.doctor_id ? doctorMap.get(selectedAppt.doctor_id) : 'Unassigned'}</strong>
              </div>
              <div style={{ marginTop: '4px', fontSize: '12px', color: '#566663' }}>
                📅 {new Date(selectedAppt.starts_at).toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(selectedAppt.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {/* Quick Contact Bar */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <a 
                className="secondary" 
                style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }} 
                href={`tel:${selectedAppt.phone.replace(/\D/g, '')}`}
              >
                <Phone size={14} /> Call {selectedAppt.phone}
              </a>
              <a 
                className="secondary" 
                style={{ flex: 1, textDecoration: 'none', justifyContent: 'center', color: '#1fa6a0', borderColor: '#1fa6a0' }} 
                target="_blank" 
                rel="noreferrer" 
                href={`https://wa.me/${selectedAppt.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${selectedAppt.patient_name}, this is Lumière Dental Studio confirming your appointment for ${selectedAppt.service} on ${new Date(selectedAppt.starts_at).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(selectedAppt.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`)}`}
              >
                <MessageCircle size={14} /> WhatsApp
              </a>
            </div>

            {/* Status Flow Buttons */}
            <h4 style={{ fontSize: '12px', margin: '14px 0 8px', color: 'var(--muted)' }}>UPDATE APPOINTMENT STATUS</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
              {selectedAppt.status !== 'confirmed' && (
                <button className="secondary" onClick={() => handleStatusChange(selectedAppt.id, 'confirmed')}>
                  <CheckCircle2 size={14} color="#1fa6a0" /> Confirm visit
                </button>
              )}
              {selectedAppt.status !== 'completed' && (
                <button className="secondary" onClick={() => handleStatusChange(selectedAppt.id, 'completed')}>
                  <UserCheck size={14} color="#27ae60" /> Mark Completed
                </button>
              )}
              {selectedAppt.status !== 'no_show' && (
                <button className="secondary" onClick={() => handleStatusChange(selectedAppt.id, 'no_show')}>
                  <AlertTriangle size={14} color="#e67e22" /> Mark No-Show
                </button>
              )}
              {selectedAppt.status !== 'cancelled' && (
                <button className="secondary" style={{ color: '#c0392b' }} onClick={() => setShowCancelPrompt(true)}>
                  <XCircle size={14} /> Cancel Appointment
                </button>
              )}
            </div>

            {/* Cancel Prompt */}
            {showCancelPrompt && (
              <div style={{ background: '#fff0ec', border: '1px solid #f9d4cb', padding: '14px', borderRadius: '10px', marginBottom: '16px' }}>
                <b style={{ display: 'block', fontSize: '12px', color: '#c0392b', marginBottom: '8px' }}>Reason for cancellation:</b>
                <input 
                  value={cancelReason} 
                  onChange={e => setCancelReason(e.target.value)} 
                  placeholder="e.g. Patient called to reschedule, medical emergency, illness" 
                  style={{ width: '100%', padding: '8px', fontSize: '11px', borderRadius: '6px', border: '1px solid #e0c0b8' }} 
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                  <button type="button" className="secondary" onClick={() => setShowCancelPrompt(false)}>Back</button>
                  <button type="button" className="primary" style={{ background: '#c0392b' }} onClick={() => handleStatusChange(selectedAppt.id, 'cancelled', cancelReason)}>
                    Confirm Cancellation
                  </button>
                </div>
              </div>
            )}

            {/* Notes Display */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
              <small className="eyebrow">NOTES</small>
              <p style={{ fontSize: '12px', color: '#44524c', lineHeight: 1.6 }}>{selectedAppt.notes || 'No patient concerns noted.'}</p>
              {selectedAppt.internal_notes && (
                <div style={{ background: '#f5f7f6', padding: '10px', borderRadius: '8px', fontSize: '11px', color: '#687773' }}>
                  <b>Internal Staff Note:</b> {selectedAppt.internal_notes}
                </div>
              )}
              {selectedAppt.cancel_reason && (
                <div style={{ background: '#fff5f3', padding: '10px', borderRadius: '8px', fontSize: '11px', color: '#c0392b', marginTop: '8px' }}>
                  <b>Cancellation Reason:</b> {selectedAppt.cancel_reason}
                </div>
              )}
            </div>

            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => setSelectedAppt(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
