/**
 * Lumière Dental Studio — Staff Portal Controller
 * 
 * Secure role-based staff dashboard wired directly to Supabase Auth & Cloud Database.
 * Supports Admin, Receptionist, and Doctor roles with real-time appointment synchronisation.
 * Strictly fails closed on missing authorization; no client-side credentials embedded.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cfg = window.CLINIC_CONFIG || {};

  // State
  let currentUser = null;
  let currentProfile = null;
  let staffDoctors = [];
  let bookings = [];
  let currentFilter = 'all';
  let currentService = 'all';
  let searchQuery = '';
  let activeWaItem = null;
  let viewMode = localStorage.getItem('lumierePortalView') || 'cards';
  let realtimeUnsubscribe = null;

  // DOM Elements - Auth & Header
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

  // DOM Elements - Content & Toolbar
  const rookieBanner = $('#rookieBanner');
  const dismissBanner = $('#dismissBanner');
  const viewCardsBtn = $('#viewCardsBtn');
  const viewTableBtn = $('#viewTableBtn');
  const bookingsCards = $('#bookingsCards');
  const bookingsTable = $('#bookingsTable');
  const tableBody = $('#bookingsTbody');
  const emptyState = $('#emptyState');
  const searchInput = $('#searchInput');
  const clearSearch = $('#clearSearch');
  const serviceFilter = $('#serviceFilter');
  const toastEl = $('#toast');
  const btnRefresh = $('#btnRefresh');
  const emptyRefreshBtn = $('#emptyRefreshBtn');

  // Stats Elements
  const statTotal = $('#statTotal');
  const statPending = $('#statPending');
  const statConfirmed = $('#statConfirmed');
  const statToday = $('#statToday');
  const countAll = $('#countAll');
  const countPending = $('#countPending');
  const countConfirmed = $('#countConfirmed');
  const countCompleted = $('#countCompleted');
  const countCancelled = $('#countCancelled');

  // Modals
  const waModal = $('#waConfirmModal');
  const waSummary = $('#waSummary');
  const waMessageText = $('#waMessageText');
  const sendWaBtn = $('#sendWaBtn');
  const skipWaBtn = $('#skipWaBtn');
  const closeWaModal = $('#closeWaModal');

  const editModal = $('#editModal');
  const editForm = $('#editForm');
  const editDoctor = $('#editDoctor');
  const newModal = $('#newBookingModal');
  const newForm = $('#newBookingForm');
  const modalDoctor = $('#modalDoctor');
  const modalDate = $('#modalDate');

  const todayIso = new Date().toISOString().slice(0, 10);
  $('#todayDateLabel').textContent = `Today: ${todayIso}`;

  // 1. Toast Notification Helper
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
  }

  // 2. Formatters & Helpers
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
    if (!dateStr) return 'Flexible Date';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return dateStr;
      const today = new Date();
      if (d.toDateString() === today.toDateString()) return 'Today';
      return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  function normalizeLead(lead) {
    const rawStatus = (lead.status || 'new').toLowerCase();
    let displayStatus = 'Pending';
    if (rawStatus === 'confirmed' || rawStatus === 'booked') displayStatus = 'Confirmed';
    else if (rawStatus === 'completed') displayStatus = 'Completed';
    else if (rawStatus === 'cancelled' || rawStatus === 'lost') displayStatus = 'Cancelled';

    const shortId = lead.id ? (lead.id.length > 12 ? 'LUM-' + lead.id.slice(0, 8).toUpperCase() : lead.id) : ('LUM-' + Date.now());

    return {
      rawId: lead.id,
      id: shortId,
      name: lead.name || 'Anonymous Patient',
      phone: lead.phone || '',
      email: lead.email || '',
      service: lead.service || 'General Dentistry',
      plan: lead.plan || '',
      date: lead.preferred_date || lead.date || todayIso,
      time: lead.preferred_time || lead.time || '10:00 AM',
      status: displayStatus,
      doctor: lead.doctor || 'Unassigned',
      assignedTo: lead.assigned_to || null,
      message: lead.message || '',
      staffNotes: lead.staff_notes || lead.staffNotes || '',
      createdAt: lead.created_at || lead.createdAt || new Date().toISOString()
    };
  }

  // 3. Authentication & Role Handling (Strictly Fail Closed)
  async function initAuth() {
    if (!window.ClinicAPI) {
      console.error('ClinicAPI is not loaded');
      return;
    }

    try {
      const session = await window.ClinicAPI.auth.getSession();
      if (session && session.user) {
        await handleAuthenticatedUser(session.user);
      } else {
        showLoginScreen();
      }
    } catch (err) {
      console.warn('Initial session check failed:', err);
      showLoginScreen();
    }
  }

  async function handleAuthenticatedUser(user) {
    currentUser = user;
    try {
      const profile = await window.ClinicAPI.auth.getProfile(user.id);

      // SECURITY: Strictly fail closed. If no profile exists or user is not active, DENY ACCESS.
      if (!profile || profile.is_active !== true) {
        console.warn('Unauthorized access attempt: No active staff profile found for', user.email);
        await window.ClinicAPI.auth.signOut();
        showLoginScreen('Access denied: No active staff profile is associated with this account. Please contact clinic administration.');
        return;
      }

      currentProfile = profile;
      applyRoleUI(currentProfile);
      portalLock.classList.add('unlocked');
      await loadStaffDoctors();
      await loadAppointmentsFromCloud();
      setupRealtime();
    } catch (err) {
      console.error('Failed to load user profile:', err);
      await window.ClinicAPI.auth.signOut();
      showLoginScreen('Authentication error: Unable to verify staff authorization. Access denied.');
    }
  }

  function showLoginScreen(errorMsg = '') {
    currentUser = null;
    currentProfile = null;
    bookings = [];
    portalLock.classList.remove('unlocked');
    loginError.textContent = errorMsg;
    if (realtimeUnsubscribe) {
      try { realtimeUnsubscribe(); } catch (e) {}
      realtimeUnsubscribe = null;
    }
    loginEmail.focus();
  }

  function applyRoleUI(profile) {
    const role = (profile.role || 'receptionist').toLowerCase();
    userNameDisplay.textContent = profile.full_name || currentUser.email;
    userEmailDisplay.textContent = currentUser.email;

    userRoleBadge.className = 'role-badge role-' + role;
    userRoleBadge.textContent = role.toUpperCase();

    // Admin staff directory button visibility
    const btnStaffDirectory = $('#btnStaffDirectory');
    if (btnStaffDirectory) {
      btnStaffDirectory.hidden = (role !== 'admin');
    }
    const btnNotificationOutbox = $('#btnNotificationOutbox');
    if (btnNotificationOutbox) {
      btnNotificationOutbox.hidden = (role !== 'admin');
    }

    // Doctor specific view
    if (role === 'doctor') {
      doctorBanner.hidden = false;
      doctorNameDisplay.textContent = profile.full_name;
    } else {
      doctorBanner.hidden = true;
    }

    // Rookie guide visibility
    if (role === 'admin' || localStorage.getItem('lumiereDismissGuide') === '1') {
      rookieBanner.style.display = 'none';
    } else {
      rookieBanner.style.display = 'flex';
    }
  }

  // Login Form Submission
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (!email || !password) {
      loginError.textContent = 'Please enter both email and password.';
      return;
    }

    const origText = btnLoginSubmit.innerHTML;
    btnLoginSubmit.disabled = true;
    btnLoginSubmit.innerHTML = 'Verifying credentials...';

    try {
      const { user } = await window.ClinicAPI.auth.signIn(email, password);
      await handleAuthenticatedUser(user);
      toast(`Welcome back, ${currentProfile?.full_name || 'Staff Member'}!`);
    } catch (err) {
      console.error('Login error:', err);
      loginError.textContent = err.message || 'Invalid email or password.';
    } finally {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.innerHTML = origText;
    }
  });

  // Logout Button
  btnLogout.addEventListener('click', async () => {
    try {
      await window.ClinicAPI.auth.signOut();
      showLoginScreen();
      toast('Signed out securely.');
    } catch (err) {
      console.error('Logout error:', err);
    }
  });

  // 4. Staff Doctors Roster (Loads active doctors from database profiles)
  async function loadStaffDoctors() {
    try {
      staffDoctors = await window.ClinicAPI.getStaffDoctors();
      const optionsHtml = `
        <option value="">Unassigned</option>
        ${staffDoctors.map(d => `<option value="${d.id}" data-name="${esc(d.full_name)}">${esc(d.full_name)} (Doctor)</option>`).join('')}
      `;
      if (editDoctor) editDoctor.innerHTML = optionsHtml;
      if (modalDoctor) modalDoctor.innerHTML = optionsHtml;
    } catch (err) {
      console.warn('Could not load staff doctors roster:', err);
    }
  }

  // 5. Cloud Appointment Operations (RLS strictly enforced in Postgres)
  async function loadAppointmentsFromCloud() {
    if (!currentUser) return;
    try {
      // Postgres RLS automatically filters leads based on the authenticated staff role
      const rawLeads = await window.ClinicAPI.getAppointments();
      bookings = rawLeads.map(normalizeLead);
      render();
    } catch (err) {
      console.error('Failed to load appointments from cloud:', err);
      toast('Could not sync appointments with cloud: ' + (err.message || 'Error'));
    }
  }

  async function persistLeadUpdate(item, newStatus, newDoctorName, newDoctorId, notes) {
    if (!item || !item.rawId) return;
    const updates = {};
    if (newStatus) {
      item.status = newStatus;
      updates.status = newStatus === 'Confirmed' ? 'booked' : (newStatus === 'Completed' ? 'completed' : (newStatus === 'Cancelled' ? 'lost' : 'new'));
    }
    if (newDoctorName !== undefined) {
      item.doctor = newDoctorName;
      updates.doctor = newDoctorName;
    }
    if (newDoctorId !== undefined) {
      item.assignedTo = newDoctorId;
      updates.assigned_to = newDoctorId;
    }
    if (notes !== undefined) {
      item.staffNotes = notes;
      updates.staff_notes = notes;
    }

    try {
      await window.ClinicAPI.updateAppointment(item.rawId, updates);
      toast(`Record updated in clinic cloud.`);
      render();
    } catch (err) {
      console.error('Failed to update appointment:', err);
      toast('Cloud update failed: ' + (err.message || 'Check permissions'));
      await loadAppointmentsFromCloud();
    }
  }

  async function deleteLeadCloud(item) {
    if (!item || !item.rawId) return;

    if (currentProfile?.role !== 'admin') {
      alert('Permission Denied: Only Admin users can delete clinic records.');
      return;
    }

    const confirmed = confirm(`Are you sure you want to permanently delete appointment for "${item.name}" (${item.id})?\n\nThis will remove the record from the Supabase cloud database.`);
    if (!confirmed) return;

    try {
      await window.ClinicAPI.deleteAppointment(item.rawId);
      bookings = bookings.filter(b => b.rawId !== item.rawId);
      render();
      toast(`Appointment for ${item.name} permanently deleted.`);
    } catch (err) {
      console.error('Delete error:', err);
      toast('Delete failed: ' + (err.message || 'Check permissions'));
    }
  }

  // 6. Realtime Synchronisation
  function setupRealtime() {
    if (realtimeUnsubscribe) {
      try { realtimeUnsubscribe(); } catch (e) {}
      realtimeUnsubscribe = null;
    }

    realtimeUnsubscribe = window.ClinicAPI.subscribeRealtime((payload) => {
      console.log('Realtime change received:', payload);
      toast('🔔 Live update received from studio database!');
      loadAppointmentsFromCloud();
    });
  }

  // 7. Stats Computation
  function updateStats() {
    const total = bookings.length;
    const pending = bookings.filter(b => b.status === 'Pending').length;
    const confirmed = bookings.filter(b => b.status === 'Confirmed').length;
    const completed = bookings.filter(b => b.status === 'Completed').length;
    const cancelled = bookings.filter(b => b.status === 'Cancelled').length;
    const todayCount = bookings.filter(b => b.date === todayIso).length;

    statTotal.textContent = total;
    statPending.textContent = pending;
    statConfirmed.textContent = confirmed;
    statToday.textContent = todayCount;

    countAll.textContent = total;
    countPending.textContent = pending;
    countConfirmed.textContent = confirmed;
    countCompleted.textContent = completed;
    countCancelled.textContent = cancelled;
  }

  // 8. Filter Logic
  function getFilteredBookings() {
    return bookings.filter(b => {
      if (currentFilter !== 'all' && b.status !== currentFilter) return false;
      if (currentService !== 'all' && b.service.toLowerCase() !== currentService.toLowerCase()) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = (b.name || '').toLowerCase().includes(q);
        const matchPhone = (b.phone || '').toLowerCase().includes(q);
        const matchEmail = (b.email || '').toLowerCase().includes(q);
        const matchService = (b.service || '').toLowerCase().includes(q);
        const matchMessage = (b.message || '').toLowerCase().includes(q);
        const matchDoctor = (b.doctor || '').toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchEmail && !matchService && !matchMessage && !matchDoctor) {
          return false;
        }
      }
      return true;
    });
  }

  // 9. Render Cards View
  function renderCards(filtered) {
    const isAdmin = currentProfile?.role === 'admin';
    bookingsCards.innerHTML = filtered.map((b) => {
      const originalIdx = bookings.findIndex(x => x.id === b.id);
      const isPending = b.status === 'Pending';
      const isConfirmed = b.status === 'Confirmed';
      const phoneDigits = cleanPhone(b.phone);
      const clinicName = cfg.name || 'Lumière Dental Studio';
      const waText = encodeURIComponent(`Hello ${b.name}, this is ${clinicName} regarding your appointment for ${b.service}.`);
      const waLink = phoneDigits ? `https://wa.me/${phoneDigits}?text=${waText}` : '#';

      const statusBadge = isPending 
        ? `<span class="badge-status pending">🟡 Needs Action</span>`
        : (isConfirmed 
          ? `<span class="badge-status confirmed">🟢 Confirmed</span>`
          : (b.status === 'Completed' 
            ? `<span class="badge-status completed">🔵 Completed</span>`
            : `<span class="badge-status cancelled">⚪ Cancelled</span>`));

      const cardModifier = isPending ? 'needs-action' : (isConfirmed ? 'confirmed-card' : '');

      return `
        <article class="patient-card ${cardModifier}" data-id="${esc(b.id)}">
          <div class="card-top">
            <div>
              <h3 class="card-patient-name">${esc(b.name)}</h3>
              <span class="card-ref">Ref: ${esc(b.id)}</span>
            </div>
            ${statusBadge}
          </div>

          <div class="card-slot-badge">
            <span class="card-slot-date">📅 ${formatDisplayDate(b.date)}</span>
            <span class="card-slot-time">⏰ ${esc(b.time || '10:00 AM')}</span>
          </div>

          <div class="card-details-row">
            <span class="card-service-pill">🦷 ${esc(b.service)}</span>
            ${b.plan ? `<span class="card-service-pill" style="color:var(--mint);border-color:rgba(168,230,207,0.3);">✦ ${esc(b.plan)}</span>` : ''}
            ${b.doctor && b.doctor !== 'Unassigned' ? `<span class="card-doctor-pill">👨‍⚕️ ${esc(b.doctor)}</span>` : '<span class="card-doctor-pill" style="opacity:0.65;">👨‍⚕️ Doctor Unassigned</span>'}
          </div>

          ${b.message ? `<div class="card-message-box">💬 "${esc(b.message)}"</div>` : ''}
          ${b.staffNotes ? `<div class="card-message-box" style="border-color:var(--mint);color:#bde7dc;">📝 Note: ${esc(b.staffNotes)}</div>` : ''}

          <div class="card-contact-row">
            <a class="card-phone-link" href="tel:${esc(b.phone)}" title="Click to call">
              📞 ${esc(b.phone)}
            </a>
            <div class="card-quick-icons">
              <a class="quick-icon-btn" href="tel:${esc(b.phone)}" title="Call Patient">📞</a>
              <a class="quick-icon-btn wa" href="${waLink}" target="_blank" rel="noreferrer" title="Chat on WhatsApp">💬</a>
            </div>
          </div>

          <div class="card-actions-row">
            ${isPending ? `
              <button class="card-btn-confirm" data-action="confirm-flow" data-index="${originalIdx}" title="Confirm appointment and prepare WhatsApp message">
                ✓ Confirm & WhatsApp 💬
              </button>
            ` : ''}
            ${isConfirmed ? `
              <button class="card-btn-confirm" style="background:var(--teal);color:white;" data-action="complete" data-index="${originalIdx}" title="Mark visit finished">
                ✓ Mark Completed
              </button>
            ` : ''}
            <button class="card-btn-manage" data-action="edit" data-index="${originalIdx}" title="Change status or assign doctor">
              Manage / Notes ⚙
            </button>
            ${isAdmin ? `
              <button class="card-btn-manage" style="flex:0.3;border-color:rgba(235,107,86,0.3);color:#ff9888;" data-action="delete" data-index="${originalIdx}" title="Admin Delete">
                ✕
              </button>
            ` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  // 10. Render Table View
  function renderTable(filtered) {
    const isAdmin = currentProfile?.role === 'admin';
    tableBody.innerHTML = filtered.map((b) => {
      const originalIdx = bookings.findIndex(x => x.id === b.id);
      const statusClass = (b.status || 'pending').toLowerCase();
      const phoneDigits = cleanPhone(b.phone);
      const clinicName = cfg.name || 'Lumière Dental Studio';
      const waText = encodeURIComponent(`Hello ${b.name}, this is ${clinicName} regarding your appointment for ${b.service}.`);
      const waLink = phoneDigits ? `https://wa.me/${phoneDigits}?text=${waText}` : '#';

      return `
        <tr data-id="${esc(b.id)}">
          <td>
            <div class="patient-info">
              <strong>${esc(b.name)}</strong>
              <small>Ref: ${esc(b.id)}</small>
            </div>
          </td>
          <td>
            <div class="contact-cell">
              <a href="tel:${esc(b.phone)}" title="Call patient">📞 ${esc(b.phone)}</a>
              ${b.email ? `<a href="mailto:${esc(b.email)}" title="Send email">✉ ${esc(b.email)}</a>` : ''}
              <div class="contact-quick">
                <a class="quick-icon-btn" href="tel:${esc(b.phone)}" title="Call">📞</a>
                <a class="quick-icon-btn wa" href="${waLink}" target="_blank" rel="noreferrer" title="Chat on WhatsApp">💬</a>
              </div>
            </div>
          </td>
          <td>
            <span class="service-tag">${esc(b.service)}</span>
            ${b.plan ? `<span class="package-tag">✦ ${esc(b.plan)}</span>` : ''}
          </td>
          <td>
            <div class="datetime-cell">
              <strong>📅 ${esc(b.date || 'Flexible')}</strong>
              <small>⏰ ${esc(b.time || '10:00 AM')}</small>
            </div>
          </td>
          <td>
            <span class="badge-status ${statusClass}">${esc(b.status)}</span>
            ${b.doctor && b.doctor !== 'Unassigned' ? `<span class="staff-doctor-tag">Dr: ${esc(b.doctor)}</span>` : ''}
          </td>
          <td>
            <div class="message-cell" title="${esc(b.message || b.staffNotes || 'No notes')}">
              ${b.message ? esc(b.message) : '<em style="color:#60736e">None</em>'}
            </div>
            ${b.staffNotes ? `<small style="color:var(--mint);display:block;font-size:8px;">Note: ${esc(b.staffNotes)}</small>` : ''}
          </td>
          <td class="text-right">
            <div class="row-actions">
              ${b.status === 'Pending' ? `
                <button class="action-btn confirm" data-action="confirm-flow" data-index="${originalIdx}" title="Confirm appointment and open WhatsApp">
                  ✓ Confirm 💬
                </button>
              ` : ''}
              ${b.status === 'Confirmed' ? `
                <button class="action-btn" data-action="complete" data-index="${originalIdx}" title="Mark completed">
                  Done
                </button>
              ` : ''}
              <button class="action-btn" data-action="edit" data-index="${originalIdx}" title="Manage record & assign doctor">
                Manage
              </button>
              ${isAdmin ? `
                <button class="action-btn danger" data-action="delete" data-index="${originalIdx}" title="Admin Delete">
                  ×
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 11. Main Render
  function render() {
    updateStats();
    const filtered = getFilteredBookings();

    if (bookings.length === 0) {
      bookingsCards.hidden = true;
      bookingsTable.hidden = true;
      emptyState.hidden = false;
      $('#emptyMessage').textContent = 'No appointment requests yet. Book through the patient website or add a walk-in patient above.';
      return;
    }

    if (filtered.length === 0) {
      bookingsCards.hidden = true;
      bookingsTable.hidden = true;
      emptyState.hidden = false;
      $('#emptyMessage').textContent = 'No appointments match the current filter or search criteria.';
      return;
    }

    emptyState.hidden = true;

    if (viewMode === 'cards') {
      bookingsCards.hidden = false;
      bookingsTable.hidden = true;
      renderCards(filtered);
    } else {
      bookingsCards.hidden = true;
      bookingsTable.hidden = false;
      renderTable(filtered);
    }
  }

  // 12. View Switcher
  viewCardsBtn.addEventListener('click', () => {
    viewMode = 'cards';
    localStorage.setItem('lumierePortalView', 'cards');
    viewCardsBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
    render();
  });

  viewTableBtn.addEventListener('click', () => {
    viewMode = 'table';
    localStorage.setItem('lumierePortalView', 'table');
    viewTableBtn.classList.add('active');
    viewCardsBtn.classList.remove('active');
    render();
  });

  if (viewMode === 'table') {
    viewTableBtn.classList.add('active');
    viewCardsBtn.classList.remove('active');
  } else {
    viewCardsBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
  }

  // 13. Actions Dispatcher
  function handleActionClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.index, 10);
    const item = bookings[idx];
    if (!item) return;

    if (action === 'confirm-flow') {
      openWhatsAppConfirmation(item);
    } else if (action === 'complete') {
      persistLeadUpdate(item, 'Completed', item.doctor, item.assignedTo);
      toast(`Appointment for ${item.name} marked as Completed.`);
    } else if (action === 'edit') {
      openEditModal(idx);
    } else if (action === 'delete') {
      deleteLeadCloud(item);
    }
  }

  bookingsCards.addEventListener('click', handleActionClick);
  tableBody.addEventListener('click', handleActionClick);

  // 14. WhatsApp Confirmation Modal
  function openWhatsAppConfirmation(item) {
    activeWaItem = item;
    const clinicName = cfg.name || 'Lumière Dental Studio';
    const clinicAddr = cfg.address || '12 Green Avenue, Hyderabad';
    const doctorStr = (item.doctor && item.doctor !== 'Unassigned') ? `with ${item.doctor}` : 'with our dental specialist';

    waSummary.innerHTML = `
      <div class="summary-row"><span>Patient:</span><strong>${esc(item.name)}</strong></div>
      <div class="summary-row"><span>Phone:</span><strong>${esc(item.phone)}</strong></div>
      <div class="summary-row"><span>Treatment:</span><strong>${esc(item.service)}</strong></div>
      <div class="summary-row"><span>Scheduled:</span><strong>${esc(item.date)} at ${esc(item.time)}</strong></div>
    `;

    const defaultMsg = `Hello ${item.name}, this is ${clinicName}. We are pleased to confirm your appointment for ${item.service} on ${item.date} at ${item.time} ${doctorStr}.\n\nStudio Address: ${clinicAddr}.\n\nPlease arrive 10 minutes prior to your slot. If you need to make any changes, simply reply to this message. See you soon! 🦷`;
    waMessageText.value = defaultMsg;

    updateWhatsAppLink();
    waModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function updateWhatsAppLink() {
    if (!activeWaItem) return;
    const digits = cleanPhone(activeWaItem.phone);
    const encoded = encodeURIComponent(waMessageText.value);
    sendWaBtn.href = digits ? `https://wa.me/${digits}?text=${encoded}` : '#';
  }

  waMessageText.addEventListener('input', updateWhatsAppLink);

  sendWaBtn.addEventListener('click', () => {
    if (activeWaItem) {
      persistLeadUpdate(activeWaItem, 'Confirmed', activeWaItem.doctor, activeWaItem.assignedTo);
    }
    closeWhatsAppModal();
  });

  skipWaBtn.addEventListener('click', () => {
    if (activeWaItem) {
      persistLeadUpdate(activeWaItem, 'Confirmed', activeWaItem.doctor, activeWaItem.assignedTo);
    }
    closeWhatsAppModal();
  });

  function closeWhatsAppModal() {
    waModal.hidden = true;
    document.body.classList.remove('modal-open');
    activeWaItem = null;
  }

  closeWaModal.addEventListener('click', closeWhatsAppModal);
  waModal.addEventListener('click', (e) => {
    if (e.target === waModal) closeWhatsAppModal();
  });

  // 15. Edit Modal & Doctor Assignment
  function openEditModal(idx) {
    const item = bookings[idx];
    if (!item) return;

    $('#editIndex').value = idx;
    $('#editStatus').value = item.status || 'Pending';
    $('#editStaffNotes').value = item.staffNotes || '';

    // Match doctor dropdown by assignedTo UUID or name
    if (editDoctor) {
      if (item.assignedTo) {
        editDoctor.value = item.assignedTo;
      } else if (item.doctor && item.doctor !== 'Unassigned') {
        const match = staffDoctors.find(d => d.full_name.toLowerCase() === item.doctor.toLowerCase());
        editDoctor.value = match ? match.id : '';
      } else {
        editDoctor.value = '';
      }
    }

    $('#editSummary').innerHTML = `
      <div class="summary-row"><span>Patient:</span><strong>${esc(item.name)}</strong></div>
      <div class="summary-row"><span>Phone:</span><strong>${esc(item.phone)}</strong></div>
      <div class="summary-row"><span>Treatment:</span><strong>${esc(item.service)} (${esc(item.plan || 'Standard')})</strong></div>
      <div class="summary-row"><span>Scheduled:</span><strong>${esc(item.date)} at ${esc(item.time)}</strong></div>
      ${item.message ? `<div class="summary-row"><span>Patient Request:</span><strong>${esc(item.message)}</strong></div>` : ''}
    `;

    editModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeEditModal() {
    editModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  $('#closeEditModal').addEventListener('click', closeEditModal);
  $('#cancelEditModal').addEventListener('click', closeEditModal);
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idx = parseInt($('#editIndex').value, 10);
    const item = bookings[idx];
    if (!item) return;

    const newStatus = $('#editStatus').value;
    const selectedOpt = editDoctor ? editDoctor.selectedOptions[0] : null;
    const newDocId = (editDoctor && editDoctor.value) ? editDoctor.value : null;
    const newDocName = (newDocId && selectedOpt) ? (selectedOpt.dataset.name || selectedOpt.text.split(' (')[0]) : 'Unassigned';
    const notes = $('#editStaffNotes').value.trim();

    closeEditModal();
    await persistLeadUpdate(item, newStatus, newDocName, newDocId, notes);
  });

  // 16. Walk-in Modal with Session & Fingerprint-Based Idempotency
  modalDate.min = todayIso;
  modalDate.value = todayIso;

  function computeWalkInFingerprint(p) {
    return [
      (p.phone || '').replace(/\D/g, ''),
      (p.name || '').trim().toLowerCase(),
      (p.preferred_date || '').trim(),
      (p.preferred_time || '').trim().toLowerCase(),
      (p.service || '').trim().toLowerCase(),
      (p.doctor || '').trim().toLowerCase()
    ].join('|');
  }

  function getOrGenerateWalkInId(p) {
    const fingerprint = computeWalkInFingerprint(p);
    const KEY = 'lumiere_active_walkin_sub';
    try {
      const stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (stored && stored.fingerprint === fingerprint && stored.submissionId) {
        return stored.submissionId;
      }
    } catch (e) {}

    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'walkin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        fingerprint,
        submissionId: newId,
        createdAt: new Date().toISOString()
      }));
    } catch (e) {}

    return newId;
  }

  function clearWalkInSession() {
    try {
      sessionStorage.removeItem('lumiere_active_walkin_sub');
    } catch (e) {}
  }

  function openNewModal() {
    newForm.reset();
    modalDate.value = todayIso;
    if (modalDoctor) modalDoctor.value = '';
    $('#modalError').textContent = '';
    clearWalkInSession();
    newModal.hidden = false;
    document.body.classList.add('modal-open');
    $('#modalName').focus();
  }

  function closeNewModal() {
    newModal.hidden = true;
    document.body.classList.remove('modal-open');
    clearWalkInSession();
  }

  $('#openNewBookingModal').addEventListener('click', openNewModal);
  $('#emptyCreateBtn').addEventListener('click', openNewModal);
  $('#closeNewBookingModal').addEventListener('click', closeNewModal);
  $('#cancelModal').addEventListener('click', closeNewModal);
  newModal.addEventListener('click', (e) => {
    if (e.target === newModal) closeNewModal();
  });

  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#modalName').value.trim();
    const phone = $('#modalPhone').value.trim();
    const email = $('#modalEmail').value.trim();
    const service = $('#modalService').value;
    const plan = $('#modalPlan').value;
    const date = $('#modalDate').value;
    const time = $('#modalTime').value;
    const status = $('#modalStatus').value;
    const message = $('#modalMessage').value.trim();

    const selectedOpt = modalDoctor ? modalDoctor.selectedOptions[0] : null;
    const assignedDocId = (modalDoctor && modalDoctor.value) ? modalDoctor.value : null;
    const assignedDocName = (assignedDocId && selectedOpt) ? (selectedOpt.dataset.name || selectedOpt.text.split(' (')[0]) : 'Unassigned';

    if (!name) {
      $('#modalError').textContent = 'Please provide patient full name.';
      $('#modalName').focus();
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      $('#modalError').textContent = 'Please provide a valid phone number.';
      $('#modalPhone').focus();
      return;
    }

    const payload = {
      name,
      phone,
      email: email || undefined,
      service,
      plan: plan || undefined,
      preferred_date: date,
      preferred_time: time,
      status,
      message: message || undefined,
      doctor: assignedDocName,
      assigned_to: assignedDocId,
      staff_notes: 'Logged at reception desk'
    };

    // Obtain fingerprint-backed idempotency key
    payload.client_submission_id = getOrGenerateWalkInId(payload);

    const submitBtn = $('button[type="submit"]', newForm);
    const origText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving to database...';

    try {
      const savedLead = await window.ClinicAPI.createWalkIn(payload);
      clearWalkInSession();
      closeNewModal();
      toast(`Walk-in appointment recorded for ${name}!`);
      await loadAppointmentsFromCloud();
    } catch (err) {
      console.error('Walk-in creation error:', err);
      $('#modalError').textContent = 'Database error: ' + (err.message || 'Unable to save walk-in.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  });

  // 17. Filters, Search & Refresh
  $('#statusTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.status;
    render();
  });

  serviceFilter.addEventListener('change', () => {
    currentService = serviceFilter.value;
    render();
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    clearSearch.hidden = !searchQuery;
    render();
  });

  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearch.hidden = true;
    render();
    searchInput.focus();
  });

  btnRefresh.addEventListener('click', async () => {
    toast('Synchronizing with Supabase cloud...');
    await loadAppointmentsFromCloud();
    toast('Cloud synchronization complete.');
  });

  if (emptyRefreshBtn) {
    emptyRefreshBtn.addEventListener('click', async () => {
      await loadAppointmentsFromCloud();
    });
  }

  // 18. Export CSV
  $('#btnExport').addEventListener('click', () => {
    if (bookings.length === 0) {
      toast('No data to export.');
      return;
    }
    const headers = ['Ref ID', 'Patient Name', 'Phone', 'Email', 'Service', 'Package', 'Date', 'Time', 'Status', 'Doctor', 'Patient Message', 'Staff Notes', 'Created At'];
    const rows = bookings.map(b => [
      b.id, b.name, b.phone, b.email || '',
      b.service, b.plan || '', b.date, b.time,
      b.status, b.doctor || '',
      (b.message || '').replace(/"/g, '""'),
      (b.staffNotes || '').replace(/"/g, '""'),
      b.createdAt || ''
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.map(f => `"${f}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `lumiere_appointments_${todayIso}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('Roster exported to CSV.');
  });

  // Rookie Guide Dismissal
  if (dismissBanner) {
    dismissBanner.addEventListener('click', () => {
      rookieBanner.style.display = 'none';
      localStorage.setItem('lumiereDismissGuide', '1');
    });
  }

  // Live Clock
  function updateClock() {
    const now = new Date();
    const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    $('#clockText').textContent = now.toLocaleDateString('en-IN', opts);
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Admin Staff Directory Modal
  const staffModal = $('#staffModal');
  const btnStaffDirectory = $('#btnStaffDirectory');
  const closeStaffModal = $('#closeStaffModal');
  const staffListContainer = $('#staffListContainer');

  async function loadStaffDirectory() {
    if (!ClinicAPI.client) return;
    staffListContainer.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0;">Loading staff roster...</div>';
    try {
      const { data: profiles, error } = await ClinicAPI.client
        .from('profiles')
        .select('*')
        .order('role', { ascending: true })
        .order('full_name', { ascending: true });

      if (error) throw error;
      if (!profiles || profiles.length === 0) {
        staffListContainer.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0;">No staff profiles found.</div>';
        return;
      }

      staffListContainer.innerHTML = profiles.map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;gap:12px;">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--ink-light);">${esc(p.full_name || 'Unnamed Staff')}</div>
            <div style="font-size:10px;color:var(--muted);">${esc(p.email)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="role-badge role-${p.role}" style="font-size:9px;">${(p.role || '').toUpperCase()}</span>
            <span style="font-size:10px;font-weight:600;color:${p.is_active ? 'var(--mint)' : 'var(--coral)'};">${p.is_active ? 'Active' : 'Inactive'}</span>
            ${p.id !== currentProfile?.id ? `
              <select class="btn-change-role" data-id="${p.id}" style="font-size:9px;padding:4px 6px;background:rgba(255,255,255,0.06);color:var(--ink-light);border:1px solid var(--border);border-radius:4px;cursor:pointer;">
                <option value="receptionist" ${p.role === 'receptionist' ? 'selected' : ''}>Receptionist</option>
                <option value="doctor" ${p.role === 'doctor' ? 'selected' : ''}>Doctor</option>
                <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
              <button class="btn ghost-light small btn-toggle-active" data-id="${p.id}" data-active="${p.is_active}" style="padding:4px 8px;font-size:9px;">
                ${p.is_active ? 'Deactivate' : 'Activate'}
              </button>
            ` : '<span style="font-size:9px;color:var(--muted);">(You)</span>'}
          </div>
        </div>
      `).join('');

      $$('.btn-toggle-active', staffListContainer).forEach(btn => {
        btn.addEventListener('click', async () => {
          const targetId = btn.dataset.id;
          const currentActive = btn.dataset.active === 'true';
          btn.disabled = true;
          btn.textContent = 'Updating...';
          try {
            const { error: updateErr } = await ClinicAPI.client
              .from('profiles')
              .update({ is_active: !currentActive })
              .eq('id', targetId);
            if (updateErr) throw updateErr;
            toast(`Staff member ${!currentActive ? 'activated' : 'deactivated'}.`);
            await loadStaffDirectory();
          } catch (err) {
            toast('Failed to update status: ' + err.message);
            btn.disabled = false;
            btn.textContent = currentActive ? 'Deactivate' : 'Activate';
          }
        });
      });

      $$('.btn-change-role', staffListContainer).forEach(sel => {
        sel.addEventListener('change', async () => {
          const targetId = sel.dataset.id;
          const newRole = sel.value;
          sel.disabled = true;
          try {
            const { error: roleErr } = await ClinicAPI.client
              .from('profiles')
              .update({ role: newRole })
              .eq('id', targetId);
            if (roleErr) throw roleErr;
            toast(`Role updated to ${newRole}.`);
            await loadStaffDirectory();
          } catch (err) {
            toast('Failed to update role: ' + err.message);
            sel.disabled = false;
          }
        });
      });
    } catch (err) {
      staffListContainer.innerHTML = `<div style="font-size:11px;color:var(--coral);padding:10px 0;">Failed to load staff roster: ${esc(err.message)}</div>`;
    }
  }

  if (btnStaffDirectory) {
    btnStaffDirectory.addEventListener('click', () => {
      if (staffModal) {
        staffModal.hidden = false;
        document.body.classList.add('modal-open');
        loadStaffDirectory();
      }
    });
  }

  if (closeStaffModal) {
    closeStaffModal.addEventListener('click', () => {
      if (staffModal) {
        staffModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
    });
  }

  if (staffModal) {
    staffModal.addEventListener('click', (e) => {
      if (e.target === staffModal) {
        staffModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
    });
  }

  // Admin Notification Outbox Modal
  const outboxModal = $('#outboxModal');
  const btnNotificationOutbox = $('#btnNotificationOutbox');
  const closeOutboxModal = $('#closeOutboxModal');
  const outboxListContainer = $('#outboxListContainer');
  const btnProcessOutboxNow = $('#btnProcessOutboxNow');
  const btnRefreshOutbox = $('#btnRefreshOutbox');

  async function loadOutboxEntries() {
    if (!ClinicAPI.client || !outboxListContainer) return;
    outboxListContainer.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0;">Loading outbox entries...</div>';
    try {
      const { data: entries, error } = await ClinicAPI.client
        .from('lead_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      if (!entries || entries.length === 0) {
        outboxListContainer.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0;">No outbox entries found.</div>';
        return;
      }

      outboxListContainer.innerHTML = entries.map(e => `
        <div style="display:flex;flex-direction:column;gap:6px;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-size:11px;font-weight:600;color:var(--ink-light);">${esc(e.event_id || e.id)}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="role-badge" style="font-size:9px;background:${e.status === 'delivered' ? 'rgba(31,166,160,0.2)' : e.status === 'failed' ? 'rgba(235,94,85,0.2)' : 'rgba(255,255,255,0.1)'};color:${e.status === 'delivered' ? 'var(--mint)' : e.status === 'failed' ? 'var(--coral)' : 'var(--ink-light)'};">
                ${(e.status || '').toUpperCase()}
              </span>
              <span style="font-size:10px;color:var(--muted);">Attempts: ${e.attempts}/${e.max_attempts}</span>
            </div>
          </div>
          <div style="font-size:10px;color:var(--muted);display:flex;justify-content:space-between;">
            <span>Enqueued: ${new Date(e.created_at).toLocaleString()}</span>
            ${e.next_retry_at ? `<span>Next retry: ${new Date(e.next_retry_at).toLocaleTimeString()}</span>` : ''}
          </div>
          ${e.error_log ? `<div style="font-size:9px;color:var(--coral);background:rgba(235,94,85,0.08);padding:4px 8px;border-radius:4px;">Error: ${esc(e.error_log)}</div>` : ''}
        </div>
      `).join('');
    } catch (err) {
      outboxListContainer.innerHTML = `<div style="font-size:11px;color:var(--coral);padding:10px 0;">Failed to load outbox: ${esc(err.message)}</div>`;
    }
  }

  async function triggerProcessOutbox() {
    if (!btnProcessOutboxNow) return;
    btnProcessOutboxNow.disabled = true;
    btnProcessOutboxNow.textContent = 'Processing queue...';
    try {
      const supabaseUrl = window.CLINIC_CONFIG?.supabaseUrl || window.CLINIC_CONFIG?.integrations?.supabaseUrl || ClinicAPI.supabaseUrl;
      const anonKey = window.CLINIC_CONFIG?.supabaseAnonKey || window.CLINIC_CONFIG?.integrations?.supabaseAnonKey || ClinicAPI.supabaseAnonKey;
      const session = ClinicAPI.client?.auth ? (await ClinicAPI.client.auth.getSession())?.data?.session : null;
      const token = session?.access_token || anonKey;
      const res = await fetch(`${supabaseUrl}/functions/v1/process-notification-outbox`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ batch_size: 10 })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(`Queue processed: ${data.delivered || 0} delivered, ${data.failed || 0} failed (${data.claimed || 0} claimed).`);
        await loadOutboxEntries();
      } else {
        throw new Error(data.error || 'Worker returned status ' + res.status);
      }
    } catch (err) {
      toast('Failed to process queue: ' + err.message);
    } finally {
      btnProcessOutboxNow.disabled = false;
      btnProcessOutboxNow.textContent = 'Process Queue / Retry Failed ↗';
    }
  }

  if (btnNotificationOutbox) {
    btnNotificationOutbox.addEventListener('click', () => {
      if (outboxModal) {
        outboxModal.hidden = false;
        document.body.classList.add('modal-open');
        loadOutboxEntries();
      }
    });
  }

  if (closeOutboxModal) {
    closeOutboxModal.addEventListener('click', () => {
      if (outboxModal) {
        outboxModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
    });
  }

  if (outboxModal) {
    outboxModal.addEventListener('click', (e) => {
      if (e.target === outboxModal) {
        outboxModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
    });
  }

  if (btnRefreshOutbox) {
    btnRefreshOutbox.addEventListener('click', loadOutboxEntries);
  }

  if (btnProcessOutboxNow) {
    btnProcessOutboxNow.addEventListener('click', triggerProcessOutbox);
  }

  // Global ESC Key Listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!newModal.hidden) closeNewModal();
      if (!editModal.hidden) closeEditModal();
      if (!waModal.hidden) closeWhatsAppModal();
      if (staffModal && !staffModal.hidden) {
        staffModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
      if (outboxModal && !outboxModal.hidden) {
        outboxModal.hidden = true;
        document.body.classList.remove('modal-open');
      }
    }
  });

  // Start Auth Flow
  initAuth();
})();
