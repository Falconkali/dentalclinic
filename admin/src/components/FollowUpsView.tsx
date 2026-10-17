import { useState, useMemo } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { FollowUp, Lead, Profile, FollowUpStatus, FollowUpPriority, ContactMethod } from '../types';
import { Activity, Plus, Search, CheckCircle2, Clock, AlertTriangle, Phone, Mail, MessageCircle, X, User, ArrowRight, Calendar, AlertCircle } from 'lucide-react';

interface FollowUpsViewProps {
  supabase: SupabaseClient;
  followUps: FollowUp[];
  leads: Lead[];
  profiles: Profile[];
  currentUserId?: string;
  onRefresh: () => void;
  initialNewData?: { name: string; phone: string; appointmentId?: string; reason?: string } | null;
  onClearInitialData?: () => void;
}

export default function FollowUpsView({
  supabase,
  followUps,
  leads,
  profiles,
  currentUserId,
  onRefresh,
  initialNewData,
  onClearInitialData
}: FollowUpsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [timelineFilter, setTimelineFilter] = useState<string>('all');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');
  
  // Modals & form state
  const [showCreate, setShowCreate] = useState(Boolean(initialNewData));
  const [selectedTask, setSelectedTask] = useState<FollowUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  // Outcome modal when completing
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [scheduleNextFollowUp, setScheduleNextFollowUp] = useState(false);
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  // Create form state
  const [form, setForm] = useState({
    title: initialNewData?.reason ? 'No-Show Callback' : 'Patient Follow-up',
    lead_id: '',
    patient_name: initialNewData?.name || '',
    phone: initialNewData?.phone || '',
    due_at: new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 16),
    priority: (initialNewData?.reason ? 'high' : 'normal') as FollowUpPriority,
    contact_method: 'phone' as ContactMethod,
    assigned_to: currentUserId || '',
    description: initialNewData?.reason || '',
    appointment_id: initialNewData?.appointmentId || ''
  });

  function toast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }

  // Filtered list
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    return followUps.filter(f => {
      const matchSearch = `${f.title} ${f.description || ''} ${f.outcome || ''} ${f.lead?.name || ''} ${f.lead?.phone || ''}`.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || f.status === statusFilter;
      const matchPriority = priorityFilter === 'all' || f.priority === priorityFilter;
      const matchAssigned = assignedFilter === 'all' || (assignedFilter === 'me' ? f.assigned_to === currentUserId : f.assigned_to === assignedFilter);

      let matchTimeline = true;
      const due = new Date(f.due_at);
      const isOverdue = due < now && f.status !== 'completed' && f.status !== 'cancelled';
      const isToday = f.due_at.slice(0, 10) === todayStr;

      if (timelineFilter === 'overdue') matchTimeline = isOverdue;
      else if (timelineFilter === 'today') matchTimeline = isToday;
      else if (timelineFilter === 'upcoming') matchTimeline = due > now;

      return matchSearch && matchStatus && matchPriority && matchAssigned && matchTimeline;
    });
  }, [followUps, search, statusFilter, priorityFilter, assignedFilter, timelineFilter, currentUserId]);

  // Metrics
  const dueTodayCount = followUps.filter(f => f.due_at.slice(0, 10) === todayStr && f.status !== 'completed' && f.status !== 'cancelled').length;
  const overdueCount = followUps.filter(f => new Date(f.due_at) < now && f.status !== 'completed' && f.status !== 'cancelled').length;
  const upcomingCount = followUps.filter(f => new Date(f.due_at) > now && f.status !== 'completed' && f.status !== 'cancelled').length;
  const completedCount = followUps.filter(f => f.status === 'completed').length;
  const myTasksCount = followUps.filter(f => f.assigned_to === currentUserId && f.status !== 'completed' && f.status !== 'cancelled').length;

  const profileMap = useMemo(() => {
    return new Map(profiles.map(p => [p.id, p.full_name || p.email || 'Staff']));
  }, [profiles]);

  // Handle Create
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');

    try {
      let leadId = form.lead_id;

      // If user typed custom patient name and phone without choosing an existing lead, create lead
      if (!leadId && form.patient_name.trim()) {
        const { data: newL, error: leadErr } = await supabase.from('leads').insert({
          name: form.patient_name.trim(),
          phone: form.phone.trim(),
          service: 'Follow-up enquiry',
          source: 'manual',
          status: 'contacted'
        }).select().single();
        if (leadErr) throw leadErr;
        leadId = newL.id;
      }

      const { error } = await supabase.from('follow_ups').insert({
        lead_id: leadId || null,
        appointment_id: form.appointment_id || null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        due_at: new Date(form.due_at).toISOString(),
        priority: form.priority,
        status: 'pending',
        contact_method: form.contact_method,
        assigned_to: form.assigned_to || null,
        created_by: currentUserId || null,
        done: false
      });

      if (error) throw error;

      toast('Follow-up task created successfully!');
      setShowCreate(false);
      if (onClearInitialData) onClearInitialData();
      onRefresh();
    } catch (ex: any) {
      setErr(ex?.message || 'Failed to create follow-up task.');
    } finally {
      setBusy(false);
    }
  }

  // Handle Mark Completed with Outcome
  async function handleCompleteTask() {
    if (!selectedTask) return;
    setBusy(true);

    try {
      const { error } = await supabase.from('follow_ups').update({
        status: 'completed',
        done: true,
        outcome: outcomeNotes.trim() || 'Completed contact with patient.'
      }).eq('id', selectedTask.id);

      if (error) throw error;

      // If requested to schedule next follow-up
      if (scheduleNextFollowUp && nextFollowUpDate) {
        await supabase.from('follow_ups').insert({
          lead_id: selectedTask.lead_id || null,
          appointment_id: selectedTask.appointment_id || null,
          title: `Next step: ${selectedTask.title}`,
          description: `Previous outcome: ${outcomeNotes.trim()}`,
          due_at: new Date(nextFollowUpDate).toISOString(),
          priority: selectedTask.priority,
          status: 'pending',
          contact_method: selectedTask.contact_method,
          assigned_to: selectedTask.assigned_to || currentUserId,
          created_by: currentUserId,
          done: false
        });
        toast('Task completed & next follow-up scheduled!');
      } else {
        toast('Task marked as completed!');
      }

      setShowCompleteModal(false);
      setSelectedTask(null);
      setOutcomeNotes('');
      setScheduleNextFollowUp(false);
      setNextFollowUpDate('');
      onRefresh();
    } catch (ex: any) {
      alert(ex?.message || 'Failed to complete task.');
    } finally {
      setBusy(false);
    }
  }

  // Update Status
  async function updateStatus(taskId: string, newStatus: FollowUpStatus) {
    try {
      const { error } = await supabase.from('follow_ups').update({
        status: newStatus,
        done: newStatus === 'completed'
      }).eq('id', taskId);
      if (error) throw error;
      toast(`Task marked as ${newStatus}.`);
      onRefresh();
    } catch (ex: any) {
      alert(ex?.message || 'Failed to update task.');
    }
  }

  return (
    <div className="followups-section">
      {/* Toast Alert */}
      {toastMsg && <div className="admin-toast"><CheckCircle2 size={16} /> {toastMsg}</div>}

      {/* Header */}
      <div className="page-heading">
        <div>
          <span className="eyebrow">PATIENT RETENTION &amp; CARE CONTINUITY</span>
          <h1>Follow-ups</h1>
          <p>Organize enquiries, recalls, treatment decisions, and callback reminders.</p>
        </div>
        <button className="primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New follow-up
        </button>
      </div>

      {/* Metric Cards */}
      <div className="metric-grid">
        <div className="metric" style={{ borderLeft: '3px solid #ff6b4a' }}>
          <div className="metric-top"><span>Overdue Attention</span><AlertTriangle size={16} color="#c0392b" /></div>
          <strong style={{ color: overdueCount > 0 ? '#c0392b' : 'inherit' }}>{overdueCount}</strong>
          <small>Needs immediate contact</small>
        </div>
        <div className="metric" style={{ borderLeft: '3px solid #1fa6a0' }}>
          <div className="metric-top"><span>Due Today</span><Clock size={16} color="var(--teal)" /></div>
          <strong>{dueTodayCount}</strong>
          <small>Scheduled for today</small>
        </div>
        <div className="metric">
          <div className="metric-top"><span>Assigned to Me</span><User size={16} /></div>
          <strong>{myTasksCount}</strong>
          <small>Your open assignments</small>
        </div>
        <div className="metric">
          <div className="metric-top"><span>Upcoming &amp; Done</span><CheckCircle2 size={16} color="#27ae60" /></div>
          <strong>{upcomingCount} <span style={{ fontSize: '12px', color: '#688279' }}>({completedCount} done)</span></strong>
          <small>Future pipeline reminders</small>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="panel" style={{ padding: '14px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          
          <div className="filter-search" style={{ width: '280px' }}>
            <Search size={15} />
            <input placeholder="Search title, patient, notes…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <select value={timelineFilter} onChange={e => setTimelineFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <option value="all">All dates</option>
              <option value="overdue">⚠️ Overdue tasks</option>
              <option value="today">📅 Due today</option>
              <option value="upcoming">Future tasks</option>
            </select>

            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>

            <select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '11px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <option value="all">All staff</option>
              <option value="me">Assigned to me</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Task &amp; Patient</th>
                <th>Contact</th>
                <th>Due Date</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Outcome / Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                    No follow-up tasks match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map(t => {
                  const dueDate = new Date(t.due_at);
                  const isOverdue = dueDate < now && t.status !== 'completed' && t.status !== 'cancelled';
                  const isToday = t.due_at.slice(0, 10) === todayStr;
                  const patientName = t.lead?.name || 'General Patient';
                  const patientPhone = t.lead?.phone || '';

                  return (
                    <tr 
                      key={t.id} 
                      style={{ cursor: 'pointer', background: isOverdue ? '#fff8f6' : 'inherit' }}
                      onClick={() => setSelectedTask(t)}
                    >
                      <td>
                        <span className={`priority-badge priority-${t.priority}`}>
                          {t.priority.toUpperCase()}
                        </span>
                      </td>

                      <td>
                        <b>{t.title}</b>
                        <small style={{ display: 'block', color: 'var(--teal)', fontSize: '11px' }}>
                          👤 {patientName} {patientPhone ? `· ${patientPhone}` : ''}
                        </small>
                      </td>

                      <td>
                        <span className="contact-method-pill">
                          {t.contact_method === 'phone' && '📞 Phone'}
                          {t.contact_method === 'whatsapp' && '💬 WhatsApp'}
                          {t.contact_method === 'email' && '✉️ Email'}
                          {t.contact_method === 'in_person' && '🏥 In-person'}
                          {t.contact_method === 'other' && '📋 Note'}
                        </span>
                      </td>

                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isOverdue && <AlertTriangle size={14} color="#c0392b" />}
                          <div>
                            <b style={{ color: isOverdue ? '#c0392b' : isToday ? 'var(--teal)' : 'inherit', fontSize: '11px' }}>
                              {dueDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                            </b>
                            <small style={{ display: 'block', color: 'var(--muted)', fontSize: '10px' }}>
                              {dueDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span style={{ fontSize: '11px', color: '#536562' }}>
                          {t.assigned_to ? profileMap.get(t.assigned_to) || 'Staff' : 'Unassigned'}
                        </span>
                      </td>

                      <td>
                        <span className={`status-select status-${t.status}`}>
                          {t.status.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>

                      <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', color: '#687773' }}>
                        {t.outcome ? (
                          <span style={{ color: '#27ae60' }}>✓ {t.outcome}</span>
                        ) : (
                          t.description || '—'
                        )}
                      </td>

                      <td onClick={e => e.stopPropagation()}>
                        <div className="quick-actions">
                          {patientPhone && (
                            <>
                              <a title="Call" href={`tel:${patientPhone.replace(/\D/g, '')}`}><Phone size={14} /></a>
                              <a 
                                title="WhatsApp" 
                                target="_blank" 
                                rel="noreferrer" 
                                href={`https://wa.me/${patientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${patientName}, this is Lumière Dental Studio following up with you regarding: ${t.title}. Please let us know if we can assist you with your smile!`)}`}
                              >
                                <MessageCircle size={14} />
                              </a>
                            </>
                          )}
                          {t.status !== 'completed' && (
                            <button 
                              className="text-btn" 
                              style={{ background: '#eaf4f0', color: '#1fa6a0', borderRadius: '5px', fontSize: '10px' }}
                              onClick={() => { setSelectedTask(t); setShowCompleteModal(true); }}
                            >
                              Done ✓
                            </button>
                          )}
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

      {/* CREATE FOLLOW-UP MODAL */}
      {showCreate && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) { setShowCreate(false); if (onClearInitialData) onClearInitialData(); } }}>
          <form className="drawer" onSubmit={handleCreate}>
            <div className="drawer-head">
              <div>
                <span className="eyebrow">NEW RECORD</span>
                <h2>Create follow-up</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => { setShowCreate(false); if (onClearInitialData) onClearInitialData(); }}><X /></button>
            </div>

            <p className="drawer-intro">Ensure patients receive timely calls, post-treatment support, and inquiry answers.</p>

            {err && <div className="error-box"><AlertCircle size={15} /> {err}</div>}

            <label>Follow-up Title *
              <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. 48hr Post-Extraction Check-in, Treatment Quote Decision" />
            </label>

            <label>Link to Existing Lead / Patient
              <select 
                value={form.lead_id} 
                onChange={e => {
                  const chosenL = leads.find(l => l.id === e.target.value);
                  setForm({
                    ...form,
                    lead_id: e.target.value,
                    patient_name: chosenL ? chosenL.name : form.patient_name,
                    phone: chosenL ? chosenL.phone : form.phone
                  });
                }}
              >
                <option value="">-- Choose existing lead (or enter patient below) --</option>
                {leads.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.phone}) - {l.service || 'Enquiry'}</option>
                ))}
              </select>
            </label>

            {!form.lead_id && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label>Patient Name
                  <input value={form.patient_name} onChange={e => setForm({ ...form, patient_name: e.target.value })} placeholder="e.g. Maya Iyer" />
                </label>
                <label>Phone Number
                  <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
                </label>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>Due Date &amp; Time *
                <input required type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} />
              </label>

              <label>Priority
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as FollowUpPriority })}>
                  <option value="low">Low priority</option>
                  <option value="normal">Normal priority</option>
                  <option value="high">High priority</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>Contact Method
                <select value={form.contact_method} onChange={e => setForm({ ...form, contact_method: e.target.value as ContactMethod })}>
                  <option value="phone">Phone call</option>
                  <option value="whatsapp">WhatsApp chat</option>
                  <option value="email">Email</option>
                  <option value="in_person">In-person</option>
                  <option value="other">Internal note</option>
                </select>
              </label>

              <label>Assign To Staff
                <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                  <option value="">-- Unassigned --</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.full_name || p.email} ({p.role})</option>
                  ))}
                </select>
              </label>
            </div>

            <label>Task Instructions / Description
              <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Details of what to ask or confirm with the patient…" />
            </label>

            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => { setShowCreate(false); if (onClearInitialData) onClearInitialData(); }}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Create task'}</button>
            </div>
          </form>
        </div>
      )}

      {/* COMPLETE TASK WITH OUTCOME MODAL */}
      {selectedTask && showCompleteModal && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowCompleteModal(false); }}>
          <div className="drawer">
            <div className="drawer-head">
              <div>
                <span className="eyebrow">COMPLETE TASK</span>
                <h2>Record outcome</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setShowCompleteModal(false)}><X /></button>
            </div>

            <p className="drawer-intro">Document the conversation notes and outcome for <strong>{selectedTask.title}</strong>.</p>

            <label>Conversation Outcome &amp; Patient Response *
              <textarea 
                required 
                rows={4} 
                value={outcomeNotes} 
                onChange={e => setOutcomeNotes(e.target.value)} 
                placeholder="e.g. Spoke to patient; feeling great after filling, no pain. Scheduled next check-up."
              />
            </label>

            <div style={{ margin: '18px 0', padding: '14px', background: '#f5faf7', borderRadius: '10px', border: '1px solid #dbeae2' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
                <input 
                  type="checkbox" 
                  checked={scheduleNextFollowUp} 
                  onChange={e => setScheduleNextFollowUp(e.target.checked)} 
                  style={{ width: '18px', height: '18px', accentColor: 'var(--teal)' }}
                />
                <span style={{ fontSize: '12px', fontWeight: 600 }}>Schedule another follow-up task for this patient?</span>
              </label>

              {scheduleNextFollowUp && (
                <div style={{ marginTop: '12px' }}>
                  <label style={{ fontSize: '11px', margin: '4px 0' }}>Next Due Date:
                    <input 
                      type="datetime-local" 
                      value={nextFollowUpDate} 
                      onChange={e => setNextFollowUpDate(e.target.value)}
                      style={{ marginTop: '6px' }}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => setShowCompleteModal(false)}>Cancel</button>
              <button className="primary" disabled={busy || !outcomeNotes.trim()} onClick={handleCompleteTask}>
                {busy ? 'Saving…' : 'Complete task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TASK DETAIL MODAL */}
      {selectedTask && !showCompleteModal && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedTask(null); }}>
          <div className="drawer">
            <div className="drawer-head">
              <div>
                <span className="eyebrow">TASK DETAILS</span>
                <h2>{selectedTask.title}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSelectedTask(null)}><X /></button>
            </div>

            <div style={{ margin: '14px 0 20px', padding: '14px', background: '#f4f8f6', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`priority-badge priority-${selectedTask.priority}`}>{selectedTask.priority.toUpperCase()}</span>
                <span className={`status-select status-${selectedTask.status}`}>{selectedTask.status.toUpperCase()}</span>
              </div>
              <div style={{ marginTop: '10px', fontSize: '13px' }}>
                Patient: <strong>{selectedTask.lead?.name || 'General Record'}</strong>
                {selectedTask.lead?.phone && <span> · {selectedTask.lead?.phone}</span>}
              </div>
              <div style={{ marginTop: '4px', fontSize: '12px', color: '#687b76' }}>
                📅 Due: {new Date(selectedTask.due_at).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(selectedTask.due_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {/* Quick Contact buttons if phone exists */}
            {selectedTask.lead?.phone && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                <a className="secondary" style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }} href={`tel:${selectedTask.lead.phone.replace(/\D/g, '')}`}>
                  <Phone size={14} /> Call
                </a>
                <a 
                  className="secondary" 
                  style={{ flex: 1, textDecoration: 'none', justifyContent: 'center', color: '#1fa6a0', borderColor: '#1fa6a0' }} 
                  target="_blank" 
                  rel="noreferrer" 
                  href={`https://wa.me/${selectedTask.lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${selectedTask.lead.name}, this is Lumière Dental Studio following up on: ${selectedTask.title}.`)}`}
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
              </div>
            )}

            {/* Status change buttons */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              {selectedTask.status !== 'in_progress' && selectedTask.status !== 'completed' && (
                <button className="secondary" onClick={() => updateStatus(selectedTask.id, 'in_progress')}>
                  Mark In-Progress
                </button>
              )}
              {selectedTask.status !== 'completed' && (
                <button className="primary" onClick={() => setShowCompleteModal(true)}>
                  Complete with Outcome ↗
                </button>
              )}
              {selectedTask.status !== 'cancelled' && (
                <button className="secondary" style={{ color: '#c0392b' }} onClick={() => updateStatus(selectedTask.id, 'cancelled')}>
                  Cancel Task
                </button>
              )}
            </div>

            {/* Description and Outcome */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
              <small className="eyebrow">INSTRUCTIONS</small>
              <p style={{ fontSize: '12px', color: '#44524c', lineHeight: 1.6 }}>{selectedTask.description || 'No special instructions.'}</p>

              {selectedTask.outcome && (
                <div style={{ background: '#eaf7f1', padding: '12px', borderRadius: '8px', border: '1px solid #c2e8d7', marginTop: '12px' }}>
                  <b style={{ color: '#27ae60', fontSize: '11px', display: 'block', marginBottom: '4px' }}>Recorded Outcome:</b>
                  <p style={{ margin: 0, fontSize: '12px', color: '#2c4b3f' }}>{selectedTask.outcome}</p>
                </div>
              )}
            </div>

            <div className="drawer-actions">
              <button type="button" className="secondary" onClick={() => setSelectedTask(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
