/**
 * LUMIÈRE DENTAL STUDIO — PREMIUM DESIGN V2 SCRIPT
 * Handles dynamic content population from clinic.config.js,
 * real appointment submission via ClinicAPI, FAQ accordions,
 * mobile drawer, and subtle editorial GSAP reveals.
 */

(function () {
  'use strict';

  // 1. DOM Helper Shortcuts
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 2. Client-side Submission UUID for Idempotency
  function getOrGenerateSubmissionId() {
    let subId = sessionStorage.getItem('lumiere_v2_sub_id');
    if (!subId) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        subId = crypto.randomUUID();
      } else {
        subId = 'sub_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      sessionStorage.setItem('lumiere_v2_sub_id', subId);
    }
    return subId;
  }

  // 3. Populate Clinic Details from clinic.config.js
  function hydrateClinicBranding() {
    const cfg = window.CLINIC_CONFIG;
    if (!cfg) return;

    // Identity & Titles
    if (cfg.identity?.name) {
      document.title = `${cfg.identity.name} — Care that makes you feel like yourself.`;
      if ($('#navBrandTitle')) $('#navBrandTitle').textContent = cfg.identity.shortName || cfg.identity.name;
      if ($('#footerBrandTitle')) $('#footerBrandTitle').textContent = cfg.identity.name;
    }
    if (cfg.identity?.tagline && $('#footerTagline')) {
      $('#footerTagline').textContent = cfg.identity.tagline;
    }

    // Contact Information
    const phoneDisplay = cfg.contact?.phone || '+91 98765 43210';
    const phoneClean = cfg.contact?.phoneClean || cfg.contact?.phone || '+919876543210';
    
    if ($('#navPhone')) {
      $('#navPhone').textContent = phoneDisplay;
      $('#navPhone').href = `tel:${phoneClean}`;
    }
    if ($('#mobPhone')) {
      $('#mobPhone').textContent = phoneDisplay;
      $('#mobPhone').href = `tel:${phoneClean}`;
    }
    if ($('#footerPhone')) {
      $('#footerPhone').textContent = phoneDisplay;
      $('#footerPhone').href = `tel:${phoneClean}`;
    }
    if (cfg.contact?.email && $('#footerEmail')) {
      $('#footerEmail').textContent = cfg.contact.email;
      $('#footerEmail').href = `mailto:${cfg.contact.email}`;
    }
    if (cfg.contact?.hours) {
      if ($('#mobHours')) $('#mobHours').textContent = cfg.contact.hours;
      if ($('#footerHours')) $('#footerHours').textContent = cfg.contact.hours;
    }
    if (cfg.location?.fullAddress && $('#footerAddress')) {
      $('#footerAddress').textContent = cfg.location.fullAddress;
    }

    // Year
    if ($('#currentYear')) {
      $('#currentYear').textContent = new Date().getFullYear();
    }
  }

  // 4. Render Dynamic Treatments Directory
  function renderTreatments() {
    const cfg = window.CLINIC_CONFIG;
    const container = $('#treatmentListContainer');
    const select = $('#treatmentChoice');
    if (!container || !cfg?.services) return;

    container.innerHTML = cfg.services.map((svc, idx) => {
      const numStr = String(idx + 1).padStart(2, '0');
      return `
        <div class="treatment-row" data-service-name="${esc(svc.name)}">
          <span class="treatment-index">${numStr} /</span>
          <div>
            <div class="treatment-name">${esc(svc.name)}</div>
            <div style="font-size:0.85rem;color:var(--olive);margin-top:2px;">${esc(svc.tagline || '')}</div>
          </div>
          <div class="treatment-desc">${esc(svc.description || '')}</div>
          <div class="treatment-meta">
            <span>${esc(svc.duration || 'Consultation')}</span>
            <div style="margin-top:6px;"><a href="#booking" class="btn-v2-text" style="font-size:0.75rem;" data-prefill="${esc(svc.name)}">Enquire ↗</a></div>
          </div>
        </div>
      `;
    }).join('');

    // Populate Booking Form Dropdown
    if (select) {
      select.innerHTML = '<option value="" disabled selected>Select a treatment...</option>' + 
        cfg.services.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    }

    // Connect "Enquire ↗" links to pre-select service in booking form
    $$('[data-prefill]', container).forEach(btn => {
      btn.addEventListener('click', (e) => {
        const serviceName = btn.dataset.prefill;
        if (select && serviceName) {
          select.value = serviceName;
        }
      });
    });
  }

  // 5. Render Doctors Roster
  function renderDoctors() {
    const cfg = window.CLINIC_CONFIG;
    const container = $('#doctorsGridContainer');
    if (!container || !cfg?.doctors) return;

    container.innerHTML = cfg.doctors.map(doc => {
      return `
        <article class="doctor-card">
          <div class="doctor-image-wrap">
            <img src="${esc(doc.image)}" alt="${esc(doc.name)}" loading="lazy">
          </div>
          <span class="doctor-role">${esc(doc.role || 'DENTAL SPECIALIST')}</span>
          <h3 class="doctor-name">${esc(doc.name)}</h3>
          <div class="doctor-specialty">${esc(doc.specialty || '')} · <span style="font-family:var(--font-mono);font-size:0.8rem;color:var(--olive);">${esc(doc.credentials || '')}</span></div>
          <p class="doctor-bio">${esc(doc.bio || '')}</p>
        </article>
      `;
    }).join('');
  }

  // 6. Render Testimonials (Demonstration Reviews)
  function renderTestimonials() {
    const cfg = window.CLINIC_CONFIG;
    const container = $('#testimonialsContainer');
    if (!container || !cfg?.testimonials) return;

    container.innerHTML = cfg.testimonials.map(item => {
      return `
        <div style="background:#FFFFFF;border:1px solid var(--border-hairline);border-radius:var(--radius-card);padding:32px;box-shadow:0 8px 24px rgba(36,38,32,0.03);">
          <div style="font-size:1.4rem;color:var(--olive);margin-bottom:12px;">“</div>
          <p style="font-style:italic;font-family:var(--font-serif);font-size:1.15rem;line-height:1.6;color:var(--charcoal);margin-bottom:20px;">
            ${esc(item.quote)}
          </p>
          <div style="font-weight:600;font-size:0.92rem;color:var(--charcoal);">${esc(item.name)}</div>
          <div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--subtle-text);margin-top:2px;">
            ${esc(item.treatment || 'Consultation')} · <span style="color:var(--olive);">Verified Demo Review</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // 7. Render FAQ Accordions
  function renderFaqs() {
    const container = $('#faqAccordionContainer');
    if (!container) return;

    const faqs = [
      {
        q: "What can I expect during my first consultation?",
        a: "Your initial visit is a relaxed, thorough assessment. We review your dental history, take gentle high-resolution digital scans if appropriate, listen to your concerns, and outline all available options with transparent pricing."
      },
      {
        q: "How does Lumière accommodate patients with dental anxiety?",
        a: "Our entire studio is designed with low sensory stimulation, natural light, and quiet treatment suites. We proceed strictly at your pace, explain every step before taking it, and provide comfort choices whenever you need them."
      },
      {
        q: "Are the appointment fees and estimates fixed?",
        a: "Yes. Following your examination, you will receive a transparent written estimate explaining all stages of care. We have zero hidden clinic surcharges or surprise billing."
      },
      {
        q: "What is your emergency consultation policy?",
        a: "For acute pain, fractures, or dental trauma, call our studio number immediately. We preserve triage slots daily to accommodate urgent dental emergencies without delay."
      }
    ];

    container.innerHTML = faqs.map((f, i) => `
      <div style="background:#FFFFFF;border:1px solid var(--border-hairline);border-radius:var(--radius-subtle);overflow:hidden;">
        <button type="button" class="faq-btn" data-faq-index="${i}" style="width:100%;text-align:left;padding:20px 24px;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-family:var(--font-serif);font-size:1.25rem;color:var(--charcoal);">
          <span>${esc(f.q)}</span>
          <span class="faq-icon" style="font-family:var(--font-mono);font-size:1.1rem;color:var(--olive);transition:transform 0.2s ease;">+</span>
        </button>
        <div class="faq-content" id="faq-content-${i}" style="display:none;padding:0 24px 20px 24px;font-size:0.95rem;color:var(--muted-text);line-height:1.7;">
          ${esc(f.a)}
        </div>
      </div>
    `).join('');

    $$('.faq-btn', container).forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.faqIndex;
        const panel = $(`#faq-content-${idx}`);
        const icon = $('.faq-icon', btn);
        const isOpen = panel.style.display === 'block';

        // Close all
        $$('.faq-content', container).forEach(c => c.style.display = 'none');
        $$('.faq-icon', container).forEach(ic => { ic.textContent = '+'; ic.style.transform = 'none'; });

        if (!isOpen) {
          panel.style.display = 'block';
          icon.textContent = '−';
          icon.style.transform = 'rotate(180deg)';
        }
      });
    });
  }

  // 8. Mobile Navigation Drawer
  function setupMobileMenu() {
    const toggle = $('#mobileToggle');
    const overlay = $('#mobileOverlay');
    if (!toggle || !overlay) return;

    toggle.addEventListener('click', () => {
      const active = overlay.classList.toggle('active');
      toggle.setAttribute('aria-expanded', active);
    });

    $$('.mobile-nav-link', overlay).forEach(link => {
      link.addEventListener('click', () => {
        overlay.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // 9. Appointment Form Submission via ClinicAPI
  function setupBookingForm() {
    const form = $('#appointmentForm');
    const feedback = $('#formFeedback');
    const submitBtn = $('#submitBtn');
    const confirmationBox = $('#bookingConfirmationBox');
    const confirmationRefCode = $('#confirmationRefCode');

    if (!form) return;

    // Set minimum date to today
    const dateInput = $('#preferredDate');
    if (dateInput) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      dateInput.min = `${yyyy}-${mm}-${dd}`;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Bot honeypot check
      const hp = $('#honeypotField')?.value;
      if (hp && hp.trim().length > 0) {
        console.warn('Bot submission trapped by honeypot.');
        return;
      }

      // Input extraction
      const name = $('#patientName')?.value?.trim();
      const phone = $('#patientPhone')?.value?.trim();
      const email = $('#patientEmail')?.value?.trim();
      const service = $('#treatmentChoice')?.value;
      const date = $('#preferredDate')?.value;
      const time = $('#preferredTime')?.value;
      const message = $('#patientMessage')?.value?.trim();
      const consent = $('#consentCheckbox')?.checked;

      // Validation
      if (!name) {
        showFeedback('Please provide your full name.', true);
        $('#patientName')?.focus();
        return;
      }

      if (!phone || phone.replace(/\D/g, '').length < 8) {
        showFeedback('Please provide a valid contact number (at least 8 digits).', true);
        $('#patientPhone')?.focus();
        return;
      }

      if (!service) {
        showFeedback('Please choose a treatment of interest.', true);
        $('#treatmentChoice')?.focus();
        return;
      }

      if (!consent) {
        showFeedback('Please confirm your consent to be contacted regarding this request.', true);
        $('#consentCheckbox')?.focus();
        return;
      }

      // Check if ClinicAPI is loaded
      if (!window.ClinicAPI || !window.ClinicAPI.submitAppointment) {
        showFeedback('Backend clinical gateway is temporarily initializing. Please call our reception desk directly.', true);
        return;
      }

      // Inflight UI state
      submitBtn.disabled = true;
      const originalBtnText = submitBtn.innerHTML;
      submitBtn.innerHTML = 'Securing Appointment...';
      hideFeedback();

      const payload = {
        name,
        phone,
        email: email || undefined,
        service,
        preferred_date: date || undefined,
        preferred_time: time || undefined,
        message: message || undefined,
        source: 'website_v2_editorial',
        honeypot: '',
        client_submission_id: getOrGenerateSubmissionId()
      };

      try {
        const res = await window.ClinicAPI.submitAppointment(payload);
        
        if (res && (res.id || res.ok)) {
          form.style.display = 'none';
          confirmationBox.style.display = 'block';

          const ref = res.shortRef || (res.id ? 'LUM-' + res.id.slice(0, 8).toUpperCase() : 'LUM-CONFIRMED');
          if (confirmationRefCode) {
            confirmationRefCode.textContent = `Ref: ${ref}`;
          }

          // Generate new submission ID for any future submissions
          sessionStorage.removeItem('lumiere_v2_sub_id');
        } else {
          throw new Error(res?.error || 'Server did not return a confirmation code.');
        }
      } catch (err) {
        console.error('Booking submission error:', err);
        showFeedback(`Submission error: ${err.message || 'Please check your connection or contact our front desk.'}`, true);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
    });

    function showFeedback(msg, isError) {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.style.color = isError ? 'var(--status-cancelled-text)' : 'var(--status-confirmed-text)';
      feedback.style.display = 'block';
    }

    function hideFeedback() {
      if (feedback) feedback.style.display = 'none';
    }
  }

  // 10. GSAP Motion & Editorial Reveals (Honors prefers-reduced-motion)
  function initMotion() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof gsap === 'undefined') return;

    gsap.from('.hero-content', {
      opacity: 0,
      y: 30,
      duration: 1,
      ease: 'power3.out'
    });

    gsap.from('.hero-image-frame', {
      opacity: 0,
      scale: 0.96,
      duration: 1.2,
      delay: 0.2,
      ease: 'power3.out'
    });

    if (typeof ScrollTrigger !== 'undefined') {
      gsap.registerPlugin(ScrollTrigger);

      $$('.pillar-item').forEach((item, idx) => {
        gsap.from(item, {
          scrollTrigger: {
            trigger: item,
            start: 'top 85%'
          },
          opacity: 0,
          y: 25,
          duration: 0.8,
          delay: idx * 0.15,
          ease: 'power2.out'
        });
      });
    }
  }

  // Initialization
  document.addEventListener('DOMContentLoaded', () => {
    hydrateClinicBranding();
    renderTreatments();
    renderDoctors();
    renderTestimonials();
    renderFaqs();
    setupMobileMenu();
    setupBookingForm();
    initMotion();
  });
})();
