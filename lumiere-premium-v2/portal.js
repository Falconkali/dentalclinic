/**
 * LUMIÈRE DENTAL STUDIO — STAFF PORTAL CRM CONTROLLER V2
 * Linear-Inspired Clean Architecture · Supabase Auth & Realtime Integration
 * Role-Based Access Control (Admin, Receptionist, Doctor)
 */

(() => {
  'use strict';

  // 1. DOM Helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cfg = window.CLINIC_CONFIG || {};

  // 2. State
  let currentUser = null;
  let currentProfile = null;
  let staffDoctors = [];
  let bookings = [];
  let currentFilter = 'all';
  let currentService = 'all';
  let searchQuery = '';
  let activeWaItem = null;
  let viewMode = 'cards';
  let realtimeUnsubscribe = null;

  // 3. Elements
  const portalLock = $('#portalLock');
  const loginForm = $('#loginForm');
  const loginEmail = $('#loginEmail');
  const loginPassword = $('#loginPassword');
  const loginError = $('#loginError');
  const btnLoginSubmit = $('#btnLoginSubmit');
  const btnLogout = $('#btnLogout');
  const userNameDisplay = $('#userNameDisplay');
  const userEmailDisplay = $('#userEmailDisplay');
  const userRoleBadge = $('#userRoleBadge');
  const doctorBanner = $('#doctorBanner');
  const doctorNameDisplay = $('#doctorNameDisplay');
  const portalMain = $('#portalMain');
  const liveClock = $('#clockText');

  // Stats & Filters
  const statTotal = $('#statTotal');
  const statPending = $('#statPending');
  const statConfirmed = $('#statConfirmed');
  const statToday = $('#statToday');
  const statTodayLabel = $('#statTodayLabel');

  const countAll = $('#countAll');
  const countPending = $('#countPending');
  const countConfirmed = $('#countConfirmed');
  const countCompleted = $('#countCompleted');
  const countCancelled = $('#countCancelled');

  const searchInput = $('#searchInput');
  const serviceFilter = $('#serviceFilter');
  const viewBtnCards = $('#viewBtnCards');
  const viewBtnTable = $('#viewBtnTable');
  const cardsContainer = $('#cardsContainer');
  const tableContainer = $('#tableContainer');
  const tableBody = $('#tableBody');
  const btnSync = $('#btnSync');
  const btnExportCsv = $('#btnExportCsv');

  // Modals
  const newBookingModal = $('#newBookingModal');
  const openNewBookingModal = $('#openNewBookingModal');
  const closeNewBookingModal = $('#closeNewBookingModal');
  const cancelWalkinBtn = $('#cancelWalkinBtn');
  const newBookingForm = $('#newBookingForm');
  const walkinService = $('#walkinService');
  const walkinDoctor = $('#walkinDoctor');
  const walkinDate = $('#walkinDate');
  const walkinError = $('#walkinError');

  const editModal = $('#editModal');
  const closeEditModal = $('#closeEditModal');
  const cancelEditModal = $('#cancelEditModal');
  const editForm = $('#editForm');
  const editLeadId = $('#editLeadId');
  const editSummary = $('#editSummary');
  const editStatus = $('#editStatus');
  const editDoctor = $('#editDoctor');
  const editStaffNotes = $('#editStaffNotes');

  const waModal = $('#waConfirmModal');
  const closeWaModal = $('#closeWaModal');
  const skipWaBtn = $('#skipWaBtn');
  const waSummary = $('#waSummary');
  const waMessageText = $('#waMessageText');
  const sendWaBtn = $('#sendWaBtn');

  const btnStaffDirectory = $('#btnStaffDirectory');
  const staffModal = $('#staffModal');
  const closeStaffModal = $('#closeStaffModal');
  const staffListContainer = $('#staffListContainer');

  const btnNotificationOutbox = $('#btnNotificationOutbox');
  const outboxModal = $('#outboxModal');
  const closeOutboxModal = $('#closeOutboxModal');
  const outboxListContainer = $('#outboxListContainer');
  const btnProcessOutboxNow = $('#btnProcessOutboxNow');
  const btnRefreshOutbox = $('#btnRefreshOutbox');

  const toastEl = $('#toast');

  // 4. Local Date Calculations (Prevents UTC Date Skew)
  const todayIso = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  if (statTodayLabel) {
    statTodayLabel.textContent = `Today: ${todayIso}`;
  }

  // 5. Toast Helper
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastEl.style.display = 'none'; }, 3200);
  }

  // 6. Sanitization & Phone Helpers
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function cleanPhone(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    return digits;
  }

  function formatDisplayDate(dateStr) {
    if (!dateStr || dateStr === 'null' || dateStr === 'undefined') return 'Flexible Date';
    try {
      const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const y = parseInt(match[1], 10);
        const m = parseInt(match[2], 10) - 1;
        const d = parseInt(match[3], 10);
        const targetDate = new Date(y, m, d);
        const today = new Date();
        const isToday = (
          today.getFullYear() === y &&
          today.getMonth() === m &&
          today.getDate() === d
        );
        const formatted = targetDate.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
        return isToday ? `Today (${formatted})` : formatted;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  }

  // 7. Data Normalization
  function normalizeLead(lead) {
    const rawStatus = (lead.status || 'new').toLowerCase();
    let displayStatus = 'Pending';
    if (rawStatus === 'confirmed' || rawStatus === 'booked') displayStatus = 'Confirmed';
    else if (rawStatus === 'completed') displayStatus = 'Completed';
    else if (rawStatus === 'cancelled' || rawStatus === 'lost') displayStatus = 'Cancelled';

    const shortId = lead.id ? (lead.id.length > 12 ? 'LUM-' + lead.id.slice(0, 8).toUpperCase() : lead.id) : ('LUM-' + Date.now());

    return {
      id: lead.id,
      ref: shortId,
      name: lead.name || 'Anonymous Patient',
      phone: lead.phone || '',
      email: lead.email || '',
      service: lead.service || 'General Consultation',
      date: lead.preferred_date || null,
      time: lead.preferred_time || '10:00 AM',
      doctor: lead.doctor || 'Unassigned',
      assigned_to: lead.assigned_to || null,
      status: displayStatus,
      rawStatus: rawStatus,
      message: lead.message || '',
      staff_notes: lead.staff_notes || '',
      created_at: lead.created_at || new Date().toISOString()
    };
  }

  // 8. Live Clock
  function startLiveClock() {
    if (!liveClock) return;
    const update = () => {
      const now = new Date();
      liveClock.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    update();
    setInterval(update, 1000);
  }

  // 9. Load Staff Doctors for Dropdowns
  async function loadDoctorsDropdown() {
    try {
      staffDoctors = await window.ClinicAPI.getStaffDoctors();
    } catch (e) {
      staffDoctors = [];
    }

    const docOptions = [
      '<option value="Unassigned">Unassigned</option>',
      ...staffDoctors.map(d => `<option value="${esc(d.name)}" data-uid="${d.id || ''}">${esc(d.name)} (${esc(d.specialty || d.role)})</option>`)
    ].join('');

    if (walkinDoctor) walkinDoctor.innerHTML = docOptions;
    if (editDoctor) editDoctor.innerHTML = docOptions;
  }

  // 10. Load Service Catalog Filter
  function loadServiceCatalog() {
    if (!serviceFilter || !cfg.services) return;
    const opts = ['<option value="all">All Treatments</option>', ...cfg.services.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`)];
    serviceFilter.innerHTML = opts.join('');
    if (walkinService) {
      walkinService.innerHTML = '<option value="" disabled selected>Select treatment...</option>' + 
        cfg.services.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    }
  }

  // 11. Fetch Appointments from Cloud
  async function loadAppointments() {
    try {
      const rawLeads = await window.ClinicAPI.fetchAppointments();
      bookings = (rawLeads || []).map(normalizeLead);
      updateStats();
      renderCurrentView();
    } catch (err) {
      console.error('Fetch appointments error:', err);
      toast('Failed to load live appointments: ' + (err.message || 'Check network'));
    }
  }

  // 12. Update Dashboard Statistics
  function updateStats() {
    const total = bookings.length;
    const pending = bookings.filter(b => b.status === 'Pending').length;
    const confirmed = bookings.filter(b => b.status === 'Confirmed').length;
    const completed = bookings.filter(b => b.status === 'Completed').length;
    const cancelled = bookings.filter(b => b.status === 'Cancelled').length;

    const todayCount = bookings.filter(b => {
      if (!b.date) return false;
      return b.date.slice(0, 10) === todayIso;
    }).length;

    if (statTotal) statTotal.textContent = total;
    if (statPending) statPending.textContent = pending;
    if (statConfirmed) statConfirmed.textContent = confirmed;
    if (statToday) statToday.textContent = todayCount;

    if (countAll) countAll.textContent = total;
    if (countPending) countPending.textContent = pending;
    if (countConfirmed) countConfirmed.textContent = confirmed;
    if (countCompleted) countCompleted.textContent = completed;
    if (countCancelled) countCancelled.textContent = cancelled;
  }

  // 13. Filter & Search Logic
  function getFilteredAppointments() {
    return bookings.filter(b => {
      // Status filter
      if (currentFilter === 'pending' && b.status !== 'Pending') return false;
      if (currentFilter === 'confirmed' && b.status !== 'Confirmed') return false;
      if (currentFilter === 'completed' && b.status !== 'Completed') return false;
      if (currentFilter === 'cancelled' && b.status !== 'Cancelled') return false;

      // Service filter
      if (currentService !== 'all' && b.service.toLowerCase() !== currentService.toLowerCase()) return false;

      // Search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = b.name.toLowerCase().includes(q);
        const matchesPhone = b.phone.includes(q);
        const matchesRef = b.ref.toLowerCase().includes(q);
        const matchesDoctor = b.doctor.toLowerCase().includes(q);
        const matchesService = b.service.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesRef && !matchesDoctor && !matchesService) return false;
      }

      return true;
    });
  }

  // 14. Render Patient Cards Grid
  function renderCards(list) {
    if (!cardsContainer) return;

    if (list.length === 0) {
      cardsContainer.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:48px 20px;background:#FFFFFF;border:1px solid var(--portal-border);border-radius:var(--radius-md);">
          <div style="font-size:1.8rem;margin-bottom:8px;">🔍</div>
          <h3 style="font-size:1.2rem;margin-bottom:4px;">No appointments found</h3>
          <p style="font-size:0.85rem;color:var(--portal-muted);">Try adjusting your search query or filter criteria.</p>
        </div>
      `;
      return;
    }

    const isAdmin = currentProfile?.role === 'admin';

    cardsContainer.innerHTML = list.map(b => {
      const isPending = b.status === 'Pending';
      const isConfirmed = b.status === 'Confirmed';
      const isCompleted = b.status === 'Completed';

      const phoneDigits = cleanPhone(b.phone);
      const clinicName = cfg.name || 'Lumière Dental Studio';
      const waText = encodeURIComponent(`Hello ${b.name}, this is ${clinicName} regarding your consultation for ${b.service}.`);
      const waLink = phoneDigits ? `https://wa.me/${phoneDigits}?text=${waText}` : '#';

      let statusClass = 'pending';
      let statusLabel = 'Needs Action';
      if (isConfirmed) { statusClass = 'confirmed'; statusLabel = 'Confirmed'; }
      else if (isCompleted) { statusClass = 'completed'; statusLabel = 'Completed'; }
      else if (b.status === 'Cancelled') { statusClass = 'cancelled'; statusLabel = 'Cancelled'; }

      return `
        <div class="patient-card status-${statusClass}" data-lead-id="${b.id}">
          <div>
            <div class="card-top">
              <div>
                <div class="patient-name">${esc(b.name)}</div>
                <div class="patient-ref">${esc(b.ref)}</div>
              </div>
              <span class="badge-status ${statusClass}">
                ${statusLabel}
              </span>
            </div>

            <div class="card-details">
              <div class="detail-line">
                <span class="icon">📅</span>
                <span><strong>${esc(formatDisplayDate(b.date))}</strong> at ${esc(b.time)}</span>
              </div>
              <div class="detail-line">
                <span class="icon">🦷</span>
                <span>${esc(b.service)}</span>
              </div>
              <div class="detail-line">
                <span class="icon">🩺</span>
                <span>${esc(b.doctor || 'Doctor Unassigned')}</span>
              </div>
              <div class="detail-line">
                <span class="icon">📞</span>
                <span><a href="tel:${esc(b.phone)}" style="color:var(--portal-text);text-decoration:none;">${esc(b.phone || 'No phone')}</a></span>
                ${phoneDigits ? `<a href="${waLink}" target="_blank" rel="noreferrer" title="Chat on WhatsApp" style="margin-left:6px;font-size:0.95rem;">💬</a>` : ''}
              </div>
              ${b.staff_notes ? `
                <div style="margin-top:4px;padding:6px 10px;background:var(--portal-bg);border-radius:4px;font-size:0.75rem;color:var(--portal-muted);">
                  <strong>Note:</strong> ${esc(b.staff_notes)}
                </div>
              ` : ''}
            </div>
          </div>

          <div class="card-actions">
            ${isPending ? `
              <button class="card-btn primary btn-confirm-wa" data-id="${b.id}">
                ✓ Confirm &amp; WhatsApp
              </button>
            ` : ''}
            <button class="card-btn btn-open-manage" data-id="${b.id}">
              Manage / Notes ⚙
            </button>
            ${isAdmin ? `
              <button class="card-btn btn-delete-lead" data-id="${b.id}" style="color:var(--status-cancelled-text);" title="Delete appointment">
                ✕
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    attachCardHandlers();
  }

  // 15. Render Spreadsheet / Table View
  function renderTable(list) {
    if (!tableBody) return;

    if (list.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--portal-muted);">No matching appointments found.</td></tr>`;
      return;
    }

    const isAdmin = currentProfile?.role === 'admin';

    tableBody.innerHTML = list.map(b => {
      let statusClass = 'pending';
      let statusLabel = 'Needs Action';
      if (b.status === 'Confirmed') { statusClass = 'confirmed'; statusLabel = 'Confirmed'; }
      else if (b.status === 'Completed') { statusClass = 'completed'; statusLabel = 'Completed'; }
      else if (b.status === 'Cancelled') { statusClass = 'cancelled'; statusLabel = 'Cancelled'; }

      return `
        <tr>
          <td>
            <div style="font-weight:600;">${esc(b.name)}</div>
            <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--portal-muted);">${esc(b.ref)}</div>
          </td>
          <td>
            <div>${esc(b.phone)}</div>
            <div style="font-size:0.75rem;color:var(--portal-muted);">${esc(b.email)}</div>
          </td>
          <td>${esc(b.service)}</td>
          <td>${esc(formatDisplayDate(b.date))} (${esc(b.time)})</td>
          <td>${esc(b.doctor)}</td>
          <td>
            <span class="badge-status ${statusClass}">${statusLabel}</span>
          </td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="crm-btn crm-btn-secondary btn-open-manage" data-id="${b.id}" style="padding:4px 8px;font-size:0.75rem;">Manage</button>
              ${isAdmin ? `<button class="crm-btn crm-btn-danger btn-delete-lead" data-id="${b.id}" style="padding:4px 8px;font-size:0.75rem;">✕</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    attachCardHandlers();
  }

  // 16. Attach Event Handlers to Rendered Cards & Table Rows
  function attachCardHandlers() {
    // Confirm & WhatsApp Action
    $$('.btn-confirm-wa').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const item = bookings.find(x => x.id === id);
        if (!item) return;

        try {
          btn.disabled = true;
          await window.ClinicAPI.updateAppointment(id, { status: 'booked' });
          item.status = 'Confirmed';
          item.rawStatus = 'booked';
          updateStats();
          renderCurrentView();

          // Open WhatsApp Confirmation Modal
          openWhatsAppModal(item);
        } catch (err) {
          toast('Error confirming visit: ' + err.message);
          btn.disabled = false;
        }
      };
    });

    // Manage / Notes Action
    $$('.btn-open-manage').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const item = bookings.find(x => x.id === id);
        if (!item) return;
        openEditModal(item);
      };
    });

    // Delete Lead (Admin Only)
    $$('.btn-delete-lead').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const item = bookings.find(x => x.id === id);
        if (!item) return;

        if (!confirm(`Are you sure you want to permanently delete appointment for ${item.name}?`)) return;

        try {
          btn.disabled = true;
          await window.ClinicAPI.deleteAppointment(id);
          bookings = bookings.filter(x => x.id !== id);
          updateStats();
          renderCurrentView();
          toast('Appointment record deleted.');
        } catch (err) {
          toast('Failed to delete: ' + err.message);
          btn.disabled = false;
        }
      };
    });
  }

  // 17. Render View Switcher
  function renderCurrentView() {
    const filtered = getFilteredAppointments();
    if (viewMode === 'cards') {
      if (cardsContainer) cardsContainer.style.display = 'grid';
      if (tableContainer) tableContainer.style.display = 'none';
      renderCards(filtered);
    } else {
      if (cardsContainer) cardsContainer.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'block';
      renderTable(filtered);
    }
  }

  // 18. WhatsApp Modal Handler
  function openWhatsAppModal(item) {
    if (!waModal) return;
    activeWaItem = item;

    const phoneClean = cleanPhone(item.phone);
    const clinicName = cfg.identity?.name || 'Lumière Dental Studio';
    const dateFormatted = formatDisplayDate(item.date);
    const doctorStr = (item.doctor && item.doctor !== 'Unassigned') ? `with ${item.doctor}` : 'with our dental specialist';
    const clinicAddr = cfg.location?.fullAddress || '12 Green Avenue, Hyderabad';

    if (waSummary) {
      waSummary.innerHTML = `
        <div><strong>Patient:</strong> ${esc(item.name)}</div>
        <div><strong>Contact:</strong> ${esc(item.phone)}</div>
        <div><strong>Treatment:</strong> ${esc(item.service)}</div>
        <div><strong>Scheduled:</strong> ${esc(dateFormatted)} at ${esc(item.time)}</div>
      `;
    }

    const defaultMsg = `Hello ${item.name}, this is ${clinicName}. We are pleased to confirm your appointment for ${item.service} on ${dateFormatted} at ${item.time} ${doctorStr}.\n\nStudio Address: ${clinicAddr}.\n\nPlease arrive 10 minutes prior to your slot. If you need to make any changes, simply reply to this message. See you soon!`;

    if (waMessageText) waMessageText.value = defaultMsg;

    if (sendWaBtn) {
      sendWaBtn.onclick = () => {
        const text = encodeURIComponent(waMessageText?.value || defaultMsg);
        window.open(`https://wa.me/${phoneClean}?text=${text}`, '_blank');
        waModal.classList.remove('active');
      };
    }

    waModal.classList.add('active');
  }

  // 19. Edit Modal Handler
  function openEditModal(item) {
    if (!editModal) return;

    if (editLeadId) editLeadId.value = item.id;
    if (editStatus) editStatus.value = item.status;
    if (editDoctor) editDoctor.value = item.doctor || 'Unassigned';
    if (editStaffNotes) editStaffNotes.value = item.staff_notes || '';

    // If current user is doctor, restrict fields
    const isDoctor = currentProfile?.role === 'doctor';
    if (editDoctor) editDoctor.disabled = isDoctor;

    if (editSummary) {
      editSummary.innerHTML = `
        <div><strong>Patient:</strong> ${esc(item.name)} (${esc(item.ref)})</div>
        <div><strong>Phone:</strong> ${esc(item.phone)} · <strong>Email:</strong> ${esc(item.email || 'None')}</div>
        <div><strong>Service:</strong> ${esc(item.service)}</div>
        <div><strong>Scheduled:</strong> ${esc(formatDisplayDate(item.date))} at ${esc(item.time)}</div>
        ${item.message ? `<div><strong>Patient Request:</strong> ${esc(item.message)}</div>` : ''}
      `;
    }

    editModal.classList.add('active');
  }

  // 20. Staff Directory Modal (Admin Only)
  async function loadStaffDirectory() {
    if (!staffListContainer) return;
    staffListContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--portal-muted);">Loading staff accounts...</div>';

    try {
      const { data: profiles, error } = await window.ClinicAPI.client
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (!profiles || profiles.length === 0) {
        staffListContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--portal-muted);">No staff accounts found.</div>';
        return;
      }

      staffListContainer.innerHTML = profiles.map(p => {
        const isSelf = p.id === currentUser?.id;
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--portal-bg);border:1px solid var(--portal-border);border-radius:var(--radius-sm);gap:12px;">
            <div>
              <div style="font-weight:600;font-size:0.88rem;">${esc(p.full_name || 'Staff Member')}</div>
              <div style="font-size:0.75rem;color:var(--portal-muted);">${esc(p.email)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="role-tag">${esc((p.role || '').toUpperCase())}</span>
              ${!isSelf ? `
                <select class="crm-select-role" data-id="${p.id}" style="padding:4px 6px;font-size:0.75rem;border:1px solid var(--portal-border);border-radius:4px;background:#FFFFFF;">
                  <option value="receptionist" ${p.role === 'receptionist' ? 'selected' : ''}>Receptionist</option>
                  <option value="doctor" ${p.role === 'doctor' ? 'selected' : ''}>Doctor</option>
                  <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="crm-btn crm-btn-secondary btn-toggle-active" data-id="${p.id}" data-active="${p.is_active}" style="padding:4px 8px;font-size:0.75rem;">
                  ${p.is_active ? 'Deactivate' : 'Activate'}
                </button>
              ` : '<span style="font-size:0.75rem;color:var(--portal-muted);">(You)</span>'}
            </div>
          </div>
        `;
      }).join('');

      // Attach role changer & activate/deactivate
      $$('.crm-select-role', staffListContainer).forEach(sel => {
        sel.onchange = async () => {
          const targetId = sel.dataset.id;
          const newRole = sel.value;
          sel.disabled = true;
          try {
            const { error: updErr } = await window.ClinicAPI.client.from('profiles').update({ role: newRole }).eq('id', targetId);
            if (updErr) throw updErr;
            toast(`Role updated to ${newRole}`);
            loadStaffDirectory();
          } catch (e) {
            toast('Failed to update role: ' + e.message);
            sel.disabled = false;
          }
        };
      });

      $$('.btn-toggle-active', staffListContainer).forEach(btn => {
        btn.onclick = async () => {
          const targetId = btn.dataset.id;
          const currentActive = btn.dataset.active === 'true';
          btn.disabled = true;
          try {
            const { error: actErr } = await window.ClinicAPI.client.from('profiles').update({ is_active: !currentActive }).eq('id', targetId);
            if (actErr) throw actErr;
            toast(currentActive ? 'Account deactivated' : 'Account activated');
            loadStaffDirectory();
          } catch (e) {
            toast('Failed to toggle status: ' + e.message);
            btn.disabled = false;
          }
        };
      });
    } catch (err) {
      staffListContainer.innerHTML = `<div style="font-size:0.85rem;color:var(--status-cancelled-text);">Failed to load staff roster: ${esc(err.message)}</div>`;
    }
  }

  // 21. Notification Outbox Modal (Admin Only)
  async function loadOutbox() {
    if (!outboxListContainer) return;
    outboxListContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--portal-muted);">Loading outbox entries...</div>';

    try {
      const { data: entries, error } = await window.ClinicAPI.client
        .from('lead_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      if (!entries || entries.length === 0) {
        outboxListContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--portal-muted);">No outbox entries found.</div>';
        return;
      }

      outboxListContainer.innerHTML = entries.map(e => {
        let badgeColor = 'var(--status-pending-text)';
        if (e.status === 'delivered') badgeColor = 'var(--status-confirmed-text)';
        if (e.status === 'failed') badgeColor = 'var(--status-cancelled-text)';

        return `
          <div style="padding:10px 14px;background:var(--portal-bg);border:1px solid var(--portal-border);border-radius:var(--radius-sm);font-size:0.82rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-weight:600;font-family:var(--font-mono);font-size:0.75rem;">${esc(e.event_id)}</span>
              <span style="font-weight:600;color:${badgeColor};">${(e.status || '').toUpperCase()}</span>
            </div>
            <div style="color:var(--portal-muted);font-size:0.75rem;">
              Attempts: ${e.attempts}/${e.max_attempts} · Created: ${new Date(e.created_at).toLocaleString('en-IN')}
            </div>
            ${e.error_log ? `
              <div style="margin-top:4px;color:var(--status-cancelled-text);font-size:0.72rem;font-family:var(--font-mono);">
                Error: ${esc(e.error_log)}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    } catch (err) {
      outboxListContainer.innerHTML = `<div style="font-size:0.85rem;color:var(--status-cancelled-text);">Failed to load outbox: ${esc(err.message)}</div>`;
    }
  }

  // 22. Realtime Subscriptions
  function setupRealtime() {
    if (realtimeUnsubscribe) {
      try { realtimeUnsubscribe(); } catch (e) {}
      realtimeUnsubscribe = null;
    }

    realtimeUnsubscribe = window.ClinicAPI.subscribeRealtime((payload) => {
      console.log('Realtime update received:', payload?.eventType, payload?.table);
      toast('🔔 Live update received from clinical database');
      loadAppointments();
    });
  }

  // 23. Setup UI & Event Listeners
  function setupEvents() {
    // Auth Login
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = loginEmail?.value?.trim();
        const password = loginPassword?.value;
        if (!email || !password) return;

        btnLoginSubmit.disabled = true;
        btnLoginSubmit.innerHTML = 'Verifying credentials...';
        if (loginError) loginError.style.display = 'none';

        try {
          const { user, profile } = await window.ClinicAPI.login(email, password);
          currentUser = user;
          currentProfile = profile;
          handleAuthenticated();
        } catch (err) {
          if (loginError) {
            loginError.textContent = err.message || 'Invalid credentials';
            loginError.style.display = 'block';
          }
          btnLoginSubmit.disabled = false;
          btnLoginSubmit.innerHTML = 'Sign In to CRM <span>↗</span>';
        }
      });
    }

    // Sign Out
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        await window.ClinicAPI.logout();
        window.location.reload();
      });
    }

    // Filter Tabs
    $$('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.filter-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        currentFilter = tab.dataset.tab;
        renderCurrentView();
      });
    });

    // Search Input
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderCurrentView();
      });
    }

    // Service Filter
    if (serviceFilter) {
      serviceFilter.addEventListener('change', (e) => {
        currentService = e.target.value;
        renderCurrentView();
      });
    }

    // View Toggles
    if (viewBtnCards) {
      viewBtnCards.onclick = () => {
        viewMode = 'cards';
        viewBtnCards.classList.add('active');
        viewBtnTable?.classList.remove('active');
        renderCurrentView();
      };
    }
    if (viewBtnTable) {
      viewBtnTable.onclick = () => {
        viewMode = 'table';
        viewBtnTable.classList.add('active');
        viewBtnCards?.classList.remove('active');
        renderCurrentView();
      };
    }

    // Sync Button
    if (btnSync) {
      btnSync.onclick = async () => {
        btnSync.disabled = true;
        btnSync.textContent = 'Syncing...';
        await loadAppointments();
        btnSync.disabled = false;
        btnSync.textContent = '⟳ Sync';
        toast('Clinical database synchronized');
      };
    }

    // Export CSV
    if (btnExportCsv) {
      btnExportCsv.onclick = () => {
        const filtered = getFilteredAppointments();
        if (filtered.length === 0) {
          toast('No records to export');
          return;
        }

        const headers = ['Reference', 'Patient Name', 'Phone', 'Email', 'Service', 'Date', 'Time', 'Doctor', 'Status', 'Notes'];
        const rows = filtered.map(b => [
          `"${b.ref}"`,
          `"${b.name.replace(/"/g, '""')}"`,
          `"${b.phone}"`,
          `"${b.email}"`,
          `"${b.service.replace(/"/g, '""')}"`,
          `"${b.date || ''}"`,
          `"${b.time}"`,
          `"${b.doctor}"`,
          `"${b.status}"`,
          `"${(b.staff_notes || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `lumiere_appointments_${todayIso}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };
    }

    // Modals Open/Close
    if (openNewBookingModal) {
      openNewBookingModal.onclick = () => {
        if (walkinDate) walkinDate.min = todayIso;
        if (newBookingModal) newBookingModal.classList.add('active');
      };
    }
    if (closeNewBookingModal) closeNewBookingModal.onclick = () => newBookingModal?.classList.remove('active');
    if (cancelWalkinBtn) cancelWalkinBtn.onclick = () => newBookingModal?.classList.remove('active');

    if (closeEditModal) closeEditModal.onclick = () => editModal?.classList.remove('active');
    if (cancelEditModal) cancelEditModal.onclick = () => editModal?.classList.remove('active');

    if (closeWaModal) closeWaModal.onclick = () => waModal?.classList.remove('active');
    if (skipWaBtn) skipWaBtn.onclick = () => waModal?.classList.remove('active');

    // Walk-in Form Submission
    if (newBookingForm) {
      newBookingForm.onsubmit = async (e) => {
        e.preventDefault();
        const name = $('#walkinName')?.value?.trim();
        const phone = $('#walkinPhone')?.value?.trim();
        const email = $('#walkinEmail')?.value?.trim();
        const service = walkinService?.value;
        const date = walkinDate?.value;
        const time = $('#walkinTime')?.value;
        const doctor = walkinDoctor?.value || 'Unassigned';
        const message = $('#walkinMessage')?.value?.trim();

        if (!name || !phone || !service) {
          if (walkinError) {
            walkinError.textContent = 'Please fill all required fields (Name, Phone, Service).';
            walkinError.style.display = 'block';
          }
          return;
        }

        const saveBtn = $('#saveWalkinBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
          const selectedDoctorOpt = walkinDoctor?.selectedOptions?.[0];
          const doctorUid = selectedDoctorOpt?.dataset?.uid || null;

          await window.ClinicAPI.submitWalkIn({
            name,
            phone,
            email: email || undefined,
            service,
            preferred_date: date || undefined,
            preferred_time: time || undefined,
            doctor,
            assigned_to: doctorUid,
            status: 'confirmed',
            message: message || undefined,
            source: 'staff_portal_walkin'
          });

          newBookingModal?.classList.remove('active');
          newBookingForm.reset();
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Appointment <span>↗</span>'; }
          toast('Walk-in booking recorded successfully');
          await loadAppointments();
        } catch (err) {
          if (walkinError) {
            walkinError.textContent = err.message || 'Failed to save booking.';
            walkinError.style.display = 'block';
          }
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Appointment <span>↗</span>'; }
        }
      };
    }

    // Edit Form Submission
    if (editForm) {
      editForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = editLeadId?.value;
        if (!id) return;

        const statusChoice = editStatus?.value;
        let dbStatus = 'new';
        if (statusChoice === 'Confirmed') dbStatus = 'booked';
        if (statusChoice === 'Completed') dbStatus = 'completed';
        if (statusChoice === 'Cancelled') dbStatus = 'cancelled';

        const doctorVal = editDoctor?.value;
        const selectedDoctorOpt = editDoctor?.selectedOptions?.[0];
        const doctorUid = selectedDoctorOpt?.dataset?.uid || null;
        const notes = editStaffNotes?.value?.trim();

        const saveBtn = $('#saveEditBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
          const updates = {
            status: dbStatus,
            staff_notes: notes || null
          };

          // Only admins and receptionists can reassign doctor
          if (currentProfile?.role !== 'doctor') {
            updates.doctor = doctorVal;
            if (doctorUid) updates.assigned_to = doctorUid;
          }

          await window.ClinicAPI.updateAppointment(id, updates);
          editModal?.classList.remove('active');
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Changes <span>↗</span>'; }
          toast('Record updated successfully');
          await loadAppointments();
        } catch (err) {
          toast('Failed to update record: ' + err.message);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Changes <span>↗</span>'; }
        }
      };
    }

    // Admin Modals
    if (btnStaffDirectory) {
      btnStaffDirectory.onclick = () => {
        loadStaffDirectory();
        staffModal?.classList.add('active');
      };
    }
    if (closeStaffModal) closeStaffModal.onclick = () => staffModal?.classList.remove('active');

    if (btnNotificationOutbox) {
      btnNotificationOutbox.onclick = () => {
        loadOutbox();
        outboxModal?.classList.add('active');
      };
    }
    if (closeOutboxModal) closeOutboxModal.onclick = () => outboxModal?.classList.remove('active');
    if (btnRefreshOutbox) btnRefreshOutbox.onclick = () => loadOutbox();

    if (btnProcessOutboxNow) {
      btnProcessOutboxNow.onclick = async () => {
        btnProcessOutboxNow.disabled = true;
        btnProcessOutboxNow.textContent = 'Processing outbox...';
        try {
          const res = await window.ClinicAPI.processNotificationOutbox();
          toast(`Outbox processed: ${res.delivered || 0} delivered, ${res.failed || 0} failed`);
          loadOutbox();
        } catch (e) {
          toast('Outbox process error: ' + e.message);
        } finally {
          btnProcessOutboxNow.disabled = false;
          btnProcessOutboxNow.textContent = 'Process Queue / Retry Failed ↗';
        }
      };
    }
  }

  // 24. Authenticated State Setup
  function handleAuthenticated() {
    if (portalLock) portalLock.classList.remove('active');
    if (portalMain) portalMain.style.display = 'block';

    const role = (currentProfile?.role || 'staff').toUpperCase();
    if (userRoleBadge) {
      userRoleBadge.textContent = role;
    }
    if (userNameDisplay) {
      userNameDisplay.textContent = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'Staff Member';
    }
    if (userEmailDisplay) {
      userEmailDisplay.textContent = currentUser?.email || '';
    }

    // Role-specific button visibility
    const isAdmin = currentProfile?.role === 'admin';
    const isDoctor = currentProfile?.role === 'doctor';

    if (btnStaffDirectory) btnStaffDirectory.hidden = !isAdmin;
    if (btnNotificationOutbox) btnNotificationOutbox.hidden = !isAdmin;

    if (isDoctor && doctorBanner) {
      doctorBanner.hidden = false;
      if (doctorNameDisplay) {
        doctorNameDisplay.textContent = currentProfile?.full_name || 'Assigned Doctor';
      }
    }

    // Load initial data
    loadDoctorsDropdown();
    loadServiceCatalog();
    loadAppointments();
    setupRealtime();
    startLiveClock();
  }

  // 25. Initialization
  document.addEventListener('DOMContentLoaded', async () => {
    setupEvents();

    // Check existing Supabase session
    try {
      const session = await window.ClinicAPI.getSession();
      if (session?.user) {
        currentUser = session.user;
        currentProfile = await window.ClinicAPI.getUserProfile();
        handleAuthenticated();
      } else {
        if (portalLock) portalLock.classList.add('active');
      }
    } catch (e) {
      console.warn('Session check warning:', e);
      if (portalLock) portalLock.classList.add('active');
    }
  });
})();
