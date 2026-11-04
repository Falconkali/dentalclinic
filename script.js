(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lenis = null, lastY = scrollY;
  const loader = $('#loader'), num = $('#loadNum');

  if (!reduced) {
    let n = 0;
    const timer = setInterval(() => {
      n = Math.min(100, n + Math.ceil(Math.random() * 17));
      num.textContent = String(n).padStart(2, '0');
      if (n >= 100) {
        clearInterval(timer);
        loader.classList.add('done');
      }
    }, 65);
    setTimeout(() => loader?.classList.add('done'), 1650);
  } else {
    loader?.classList.add('done');
  }

  if (!reduced && window.gsap) {
    if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
    if (window.Lenis) {
      try {
        lenis = new Lenis({ duration: 1.05, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
        lenis.on('scroll', () => window.ScrollTrigger && ScrollTrigger.update());
        gsap.ticker.add(t => lenis.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
      } catch (e) {
        lenis = null;
      }
    }
    gsap.from('h1>span', { yPercent: 115, opacity: 0, duration: 1.1, stagger: 0.12, ease: 'power4.out', delay: 0.15 });
    gsap.from('.hero-visual', { y: 30, opacity: 0, duration: 1, ease: 'power3.out', delay: 0.35 });
  }

  const header = $('#header');
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    $('#progress').style.width = (max > 0 ? scrollY / max * 100 : 0) + '%';
    header.classList.toggle('scrolled', scrollY > 20);
    if (scrollY > 180 && scrollY > lastY + 4 && !$('#mobileMenu').classList.contains('open')) header.classList.add('hide');
    if (scrollY < lastY - 4 || scrollY < 80) header.classList.remove('hide');
    lastY = scrollY;
  }, { passive: true });

  function initReveals() {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target);
        }
      }), { threshold: 0.12 });
      $$('.reveal:not(.in-view)').forEach(e => io.observe(e));

      const co = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target, end = +el.dataset.count, start = performance.now(), dur = reduced ? 0 : 900;
          const frame = t => {
            const p = dur ? Math.min(1, (t - start) / dur) : 1;
            el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
            if (p < 1) requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
          co.unobserve(el);
        }
      }));
      $$('[data-count]').forEach(e => co.observe(e));
    } else {
      $$('.reveal').forEach(e => e.classList.add('in-view'));
    }
  }
  initReveals();

  const hamb = $('#hamb'), mobile = $('#mobileMenu');
  function closeMenu() {
    hamb.classList.remove('active');
    hamb.setAttribute('aria-expanded', 'false');
    mobile.classList.remove('open');
    document.body.classList.remove('menu-open');
  }
  hamb.addEventListener('click', () => {
    const open = !mobile.classList.contains('open');
    hamb.classList.toggle('active', open);
    hamb.setAttribute('aria-expanded', String(open));
    mobile.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
  });
  $$('#mobileMenu a').forEach(a => a.addEventListener('click', closeMenu));

  function scrollToEl(el) {
    if (!el) return;
    if (lenis && !reduced) lenis.scrollTo(el, { offset: -70, duration: 1 });
    else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const target = $(a.getAttribute('href'));
    if (target) {
      if (lenis && !reduced) {
        e.preventDefault();
        lenis.scrollTo(target, { offset: -70, duration: 1 });
      }
    }
  }));

  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) $$('.desktop a').forEach(a => a.classList.toggle('active', a.hash === '#' + e.target.id));
    }), { rootMargin: '-30% 0px -60% 0px' });
    ['services', 'about', 'gallery', 'doctors', 'pricing', 'reviews', 'faq'].forEach(id => $('#' + id) && spy.observe($('#' + id)));
  }

  if (!reduced && matchMedia('(pointer:fine)').matches) {
    $$('.magnetic').forEach(b => {
      b.addEventListener('mousemove', e => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.06}px,${(e.clientY - r.top - r.height / 2) * 0.1}px)`;
      });
      b.addEventListener('mouseleave', () => b.style.transform = '');
    });
  }

  // Modals
  const modal = $('#modal');
  let lastFocus = null;
  function openModal(title, text) {
    lastFocus = document.activeElement;
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    $('.close', modal).focus();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    lastFocus?.focus?.();
  }
  $('.close', modal).addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeMenu();
      if (!modal.hidden) closeModal();
    }
  });
  $$('[data-modal]').forEach(b => b.addEventListener('click', () => openModal(
    'Care that begins with listening.',
    'We believe the best care starts with a conversation. Tell us what matters to you, and we’ll explain your options clearly, at your pace.'
  )));

  // Dynamic Dictionaries
  let chosenService = 'General Dentistry', chosenTime = '10:00 AM', chosenPlan = '';
  const serviceInfo = {};
  const doctors = {};

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function bindServiceEvents() {
    $$('[data-service]').forEach(el => {
      el.onclick = e => {
        if (e.target.closest('button') && e.target.closest('button') !== el) return;
        const name = el.dataset.service;
        const info = serviceInfo[name];
        openModal(name, info ? `${info[0]} ${info[1]} Typical duration: ${info[2]}. Your dentist will confirm suitability after examination.` : 'Ask the studio for details.');
        $('.modal-book')?.remove();
        const link = document.createElement('a');
        link.href = '#booking';
        link.className = 'btn coral modal-book';
        link.textContent = 'Book this treatment ↗';
        $('.modal-box').append(link);
        link.addEventListener('click', () => {
          chosenService = name;
          $$('[data-choice]').forEach(b => b.classList.toggle('selected', b.dataset.choice.toLowerCase() === name.toLowerCase()));
          closeModal();
          setTimeout(() => scrollToEl($('#booking')), 100);
        });
      };
    });
  }

  function bindDoctorEvents() {
    $$('[data-doctor]').forEach(b => {
      b.onclick = () => {
        const name = b.dataset.doctor;
        openModal(name, doctors[name] || 'Clinical specialist at Lumière Dental Studio.');
      };
    });
  }

  function bindChoiceEvents() {
    $$('[data-choice]').forEach(b => {
      b.onclick = () => {
        chosenService = b.dataset.choice;
        $$('[data-choice]').forEach(x => x.classList.toggle('selected', x === b));
      };
    });
  }

  function bindPricingEvents() {
    $$('.choose').forEach(b => {
      b.onclick = () => {
        chosenPlan = b.dataset.plan;
        scrollToEl($('#booking'));
        toast(chosenPlan + ' selected — tell us about your goals.');
      };
    });
  }

  // Gallery
  const gallery = [
    { tag: 'WHITENING · ILLUSTRATIVE PHOTOGRAPHY', filter: 'whitening', title: 'A naturally brighter smile.', text: 'Professional whitening begins with a consultation to check suitability and discuss a safe, realistic shade goal.', img: 'photo-1609840114035-3c981b782dfe' },
    { tag: 'CLEAR ALIGNERS · ILLUSTRATIVE PHOTOGRAPHY', filter: 'aligners', title: 'Small steps, a considered plan.', text: 'Clear aligners may help selected tooth movements after an orthodontic assessment and discussion of timelines.', img: 'photo-1606811841689-23dfddce3e95' },
    { tag: 'VENEERS · ILLUSTRATIVE PHOTOGRAPHY', filter: 'veneers', title: 'Design that still feels like you.', text: 'Cosmetic treatment should begin with oral health, realistic expectations and conservative options.', img: 'photo-1606811971618-4486d14f3f99' },
    { tag: 'IMPLANTS · ILLUSTRATIVE PHOTOGRAPHY', filter: 'implants', title: 'A plan for a missing tooth.', text: 'Implant treatment requires assessment of your health, bone and gums, and discussion of alternatives.', img: 'photo-1629909613654-28e377c37b09' }
  ];
  let gi = 0;
  function showGallery(i) {
    gi = (i + gallery.length) % gallery.length;
    const g = gallery[gi], img = $('#galleryImage');
    img.style.opacity = '0.15';
    setTimeout(() => {
      img.src = `https://images.unsplash.com/${g.img}?auto=format&fit=crop&w=1400&q=85`;
      img.alt = g.filter + ' dental care illustrative photo';
      img.style.opacity = '1';
    }, 100);
    $('#galleryTag').textContent = g.tag;
    $('#galleryTitle').textContent = g.title;
    $('#galleryText').textContent = g.text;
    $('#galleryCount').textContent = String(gi + 1).padStart(2, '0') + ' / 04';
  }
  $('#galleryPrev').addEventListener('click', () => showGallery(gi - 1));
  $('#galleryNext').addEventListener('click', () => showGallery(gi + 1));
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
    $$('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
    if (b.dataset.filter === 'all') showGallery(0);
    else {
      const i = gallery.findIndex(g => g.filter === b.dataset.filter);
      if (i >= 0) showGallery(i);
    }
  }));
  let swipeX = 0;
  $('.gallery-img').addEventListener('touchstart', e => swipeX = e.changedTouches[0].clientX, { passive: true });
  $('.gallery-img').addEventListener('touchend', e => {
    const d = e.changedTouches[0].clientX - swipeX;
    if (Math.abs(d) > 45) showGallery(gi + (d < 0 ? 1 : -1));
  }, { passive: true });

  // FAQ Accordion
  $$('.faq>button').forEach(b => b.addEventListener('click', () => {
    const item = b.closest('.faq'), open = item.classList.contains('open');
    $$('.faq').forEach(f => {
      f.classList.remove('open');
      $('button', f).setAttribute('aria-expanded', 'false');
    });
    if (!open) {
      item.classList.add('open');
      b.setAttribute('aria-expanded', 'true');
    }
  }));

  // Pricing Mode Toggle
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => {
    $$('[data-mode]').forEach(x => x.classList.toggle('active', x === b));
    const mode = b.dataset.mode;
    $$('[data-visit]').forEach(el => el.textContent = el.dataset[mode]);
  }));

  // Booking Form Date & Slot Selection
  const date = $('#date'), today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  date.min = today.toISOString().slice(0, 10);
  date.addEventListener('change', () => {
    date.setCustomValidity(date.value && new Date(date.value + 'T00:00:00').getDay() === 0 ? 'Please choose Monday to Saturday. Sundays are emergency enquiries.' : '');
  });
  date.addEventListener('click', () => {
    if (typeof date.showPicker === 'function') {
      try { date.showPicker(); } catch (e) {}
    }
  });

  $$('[data-time]').forEach(b => b.addEventListener('click', () => {
    chosenTime = b.dataset.time;
    $$('[data-time]').forEach(x => x.classList.toggle('selected', x === b));
  }));

  // 3-Step Form Navigation
  const form = $('#bookingForm'), steps = $$('.form-step', form), next = $('#next'), back = $('#back'), submit = $('#submit');
  let step = 1;

  // Anti-Spam & Persistent Session-Based Idempotency Engine
  let formStartedAt = null;

  // Pure random submission session UUID for idempotency across retries & refreshes.
  // Zero patient personal data (PII) is stored or hashed in browser storage.
  const ACTIVE_SUBMISSION_SESSION_KEY = 'lumiere_active_submission_id';

  function getOrGenerateSubmissionId() {
    try {
      const stored = sessionStorage.getItem(ACTIVE_SUBMISSION_SESSION_KEY);
      if (stored && typeof stored === 'string' && stored.length > 8) {
        return stored;
      }
    } catch (e) {}

    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

    try {
      sessionStorage.setItem(ACTIVE_SUBMISSION_SESSION_KEY, newId);
    } catch (e) {}

    return newId;
  }

  function clearActiveSubmissionSession() {
    try {
      sessionStorage.removeItem(ACTIVE_SUBMISSION_SESSION_KEY);
    } catch (e) {}
  }

  const recordFormStart = () => {
    if (!formStartedAt) formStartedAt = new Date().toISOString();
  };
  form.addEventListener('focusin', recordFormStart, { passive: true });
  form.addEventListener('input', recordFormStart, { passive: true });
  form.addEventListener('click', recordFormStart, { passive: true });

  function setStep(n) {
    step = n;
    steps.forEach(s => s.classList.toggle('active', +s.dataset.step === n));
    $('#stepLabel').textContent = `STEP ${String(n).padStart(2, '0')} / 03`;
    $('#formProgress').style.width = (n / 3 * 100) + '%';
    back.disabled = n === 1;
    next.hidden = n === 3;
    submit.hidden = n !== 3;
    if (n === 3) summary();
  }

  function valid1() {
    if (!date.value) {
      $('#err1').textContent = 'Please choose a preferred date.';
      date.focus();
      return false;
    }
    if (date.validationMessage) {
      $('#err1').textContent = date.validationMessage;
      date.focus();
      return false;
    }
    if (date.value < date.min) {
      $('#err1').textContent = 'Choose today or a future date.';
      date.focus();
      return false;
    }
    $('#err1').textContent = '';
    return true;
  }

  function valid2() {
    const name = $('#name'), phone = $('#phone'), email = $('#email');
    if (!name.value.trim()) {
      $('#err2').textContent = 'Please enter your name.';
      name.focus();
      return false;
    }
    if (phone.value.replace(/\D/g, '').length < 8) {
      $('#err2').textContent = 'Please enter a valid phone number.';
      phone.focus();
      return false;
    }
    if (email.value && !email.checkValidity()) {
      $('#err2').textContent = 'Please enter a valid email address.';
      email.focus();
      return false;
    }
    $('#err2').textContent = '';
    return true;
  }

  function summary() {
    const rows = [
      ['Service', chosenService],
      ['Package', chosenPlan || 'No package selected'],
      ['Date', date.value],
      ['Time', chosenTime],
      ['Name', $('#name').value.trim()],
      ['Phone', $('#phone').value.trim()],
      ['Email', $('#email').value.trim() || 'Not provided'],
      ['Message', $('#message').value.trim() || 'None']
    ];
    $('#summary').innerHTML = rows.map(([a, b]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
  }

  next.addEventListener('click', () => {
    if (step === 1 && !valid1()) return;
    if (step === 2 && !valid2()) return;
    if (step === 3) {
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
      return;
    }
    setStep(Math.min(3, step + 1));
  });

  back.addEventListener('click', () => setStep(Math.max(1, step - 1)));
  $('#consent').addEventListener('change', () => {
    if ($('#consent').checked) $('#err3').textContent = '';
  });
  setStep(1);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // Verified Public Form Submission
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!$('#consent').checked) {
      $('#err3').textContent = 'Please agree to be contacted about this request.';
      return;
    }
    if (!valid1() || !valid2()) {
      setStep(1);
      return;
    }
    $('#err3').textContent = '';
    const cfg = window.CLINIC_CONFIG || {};
    const submitBtn = $('#submit');
    const origText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending request to clinic...';

    // Anti-spam verification timing
    const actualFormStart = formStartedAt || new Date().toISOString();

    const leadData = {
      name: $('#name').value.trim(),
      phone: $('#phone').value.trim(),
      email: $('#email').value.trim() || undefined,
      service: chosenService,
      plan: chosenPlan || undefined,
      preferred_date: date.value,
      preferred_time: chosenTime,
      message: $('#message').value.trim() || undefined,
      source: 'booking_form',
      form_started_at: actualFormStart
    };

    // Persistent random submission UUID across retries & page refreshes (zero PII in browser storage)
    leadData.client_submission_id = getOrGenerateSubmissionId();

    try {
      if (!window.ClinicAPI) {
        throw new Error('Clinic API is not initialized. Please call ' + (cfg.phone || 'our reception desk') + ' to book.');
      }

      const res = await window.ClinicAPI.submitAppointment(leadData);
      if (!res || !res.id) {
        throw new Error('Server did not return a valid booking confirmation ID.');
      }

      const refId = res.shortRef || ('LUM-' + res.id.slice(0, 8).toUpperCase());

      // PRIVACY SAFE: Only retain non-PII receipt reference in browser
      try {
        const receipts = JSON.parse(localStorage.getItem('lumiereBookingReceipts') || '[]');
        receipts.unshift({
          refId: refId,
          service: chosenService,
          plan: chosenPlan || '',
          date: date.value,
          time: chosenTime,
          timestamp: new Date().toISOString()
        });
        localStorage.setItem('lumiereBookingReceipts', JSON.stringify(receipts.slice(0, 5)));
        localStorage.removeItem('lumiereAppointmentRequests'); // Clear any legacy PII store
      } catch (e) {}

      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
      form.hidden = true;
      $('#success').hidden = false;
      if ($('#successRef')) $('#successRef').textContent = `Ref: ${refId}`;
      toast('Appointment request received. The clinic will contact you to confirm your slot.');
      // Clear active submission session upon confirmed success
      clearActiveSubmissionSession();
    } catch (err) {
      console.error('Appointment booking error:', err);
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
      const phoneContact = cfg.phone ? ` or call us directly at ${cfg.phone}` : '';
      $('#err3').textContent = `Unable to send booking request: ${err.message || 'Network error'}. Please retry${phoneContact}.`;
      toast('Booking could not be sent. Please check details and retry.');
    }
  });

  $('#newRequest').addEventListener('click', () => {
    form.reset();
    form.hidden = false;
    $('#success').hidden = true;
    $('#err3').textContent = '';
    formStartedAt = null;
    clearActiveSubmissionSession();
    chosenService = 'General Dentistry';
    chosenTime = '10:00 AM';
    chosenPlan = '';
    $$('[data-choice]').forEach(b => b.classList.toggle('selected', b.dataset.choice === chosenService));
    $$('[data-time]').forEach(b => b.classList.toggle('selected', b.dataset.time === chosenTime));
    setStep(1);
  });

  // Reviews Carousel
  let reviews = [
    ['I felt listened to from the moment I walked in. Everything was explained without rushing, and I felt comfortable asking questions.', 'A patient story', 'General dentistry · Illustrative quote'],
    ['The team made sure I understood every option. I appreciated being able to decide at my own pace without feeling pressured.', 'A patient story', 'Consultation · Illustrative quote'],
    ['The visit was friendly and calm. We left with practical advice we could actually follow.', 'A patient story', 'Family dentistry · Illustrative quote']
  ];
  let ri = 0;
  function showReview(i) {
    if (!reviews.length) return;
    ri = (i + reviews.length) % reviews.length;
    $('#quote').textContent = reviews[ri][0];
    $('#reviewName').textContent = reviews[ri][1];
    $('#reviewTreatment').textContent = reviews[ri][2];
  }
  $('#prevReview').addEventListener('click', () => showReview(ri - 1));
  $('#nextReview').addEventListener('click', () => showReview(ri + 1));
  let reviewTimer = setInterval(() => {
    if (!document.hidden && !$('.testimonial:hover')) showReview(ri + 1);
  }, 7000);
  $('.testimonial').addEventListener('mouseenter', () => clearInterval(reviewTimer));

  // Newsletter
  $('#newsletter').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#newsletterEmail');
    if (!input.checkValidity()) {
      input.reportValidity();
      return;
    }
    const email = input.value.trim();
    const msg = $('#newsletterMessage');
    msg.textContent = 'Subscribing...';
    const cfg = window.CLINIC_CONFIG || {};

    try {
      if (window.ClinicAPI) {
        await window.ClinicAPI.subscribeNewsletter(email);
      } else if (cfg.newsletterEndpoint) {
        const res = await fetch(cfg.newsletterEndpoint, {
          method: 'POST',
          headers: { 'apikey': cfg.supabaseAnonKey || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }
      msg.textContent = '✓ Subscribed! You will receive our seasonal notes.';
      input.value = '';
    } catch (err) {
      console.warn('Newsletter error:', err);
      msg.textContent = 'Subscription error: ' + (err.message || 'Please try again later.');
    }
  });

  $('#year').textContent = new Date().getFullYear();
  const cookie = $('#cookie');
  try {
    if (!localStorage.getItem('lumiereCookieChoice')) setTimeout(() => cookie.classList.add('show'), 1800);
  } catch (e) {
    cookie.classList.add('show');
  }
  function cookieChoice(v) {
    try { localStorage.setItem('lumiereCookieChoice', v); } catch (e) {}
    cookie.classList.remove('show');
  }
  $('#accept').addEventListener('click', () => cookieChoice('accepted'));
  $('#decline').addEventListener('click', () => cookieChoice('declined'));

  // ============================================================================
  // Complete Multi-Clinic Dynamic Rendering Engine
  // ============================================================================
  function renderDynamicClinicContent() {
    const cfg = window.CLINIC_CONFIG;
    if (!cfg) return;

    // 1. Identity & Branding
    if (cfg.identity?.shortName) {
      $$('.brand b').forEach(el => el.textContent = cfg.identity.shortName);
    }
    if (cfg.identity?.tagline) {
      const footerTagline = $('.footer-top p em');
      if (footerTagline) footerTagline.textContent = cfg.identity.tagline;
    }
    if (cfg.identity?.intro) {
      const heroIntro = $('.hero-copy .intro');
      if (heroIntro) heroIntro.textContent = cfg.identity.intro;
    }
    if (cfg.identity?.heroProofTitle) {
      const proofTitle = $('.hero-proof strong');
      if (proofTitle) proofTitle.textContent = cfg.identity.heroProofTitle;
    }
    if (cfg.identity?.locationBadge) {
      const badge = $('.hero-bottom span');
      if (badge) badge.textContent = cfg.identity.locationBadge;
    }

    // 2. Services List & Booking Form Chips
    if (Array.isArray(cfg.services) && cfg.services.length) {
      cfg.services.forEach(s => {
        serviceInfo[s.name] = [
          s.description || s.tagline || 'Specialized dental care.',
          'Your dentist will examine your teeth and gums, review history, and discuss recommended care.',
          s.duration || '30–60 min'
        ];
      });

      const serviceListEl = $('.service-list');
      if (serviceListEl) {
        serviceListEl.innerHTML = cfg.services.map(s => `
          <article class="service reveal" data-service="${esc(s.name)}">
            <span class="num">${esc(s.id)}</span>
            <div>
              <h3>${esc(s.name)}</h3>
              <p>${esc(s.tagline)}</p>
            </div>
            <span class="arrow">↗</span>
            <button type="button" data-service="${esc(s.name)}">Explore service</button>
          </article>
        `).join('');
      }

      const chipsEl = $('#serviceChips');
      if (chipsEl) {
        chipsEl.innerHTML = cfg.services.map((s, idx) => `
          <button type="button" class="${idx === 0 ? 'selected' : ''}" data-choice="${esc(s.name)}">${esc(s.name)}</button>
        `).join('');
      }

      bindServiceEvents();
      bindChoiceEvents();
    }

    // 3. Doctors Roster Grid
    if (Array.isArray(cfg.doctors) && cfg.doctors.length) {
      cfg.doctors.forEach(d => {
        doctors[d.name] = `${d.credentials ? d.credentials + '. ' : ''}${d.bio || d.specialty || ''}`;
      });

      const docGridEl = $('.doctors');
      if (docGridEl) {
        docGridEl.innerHTML = cfg.doctors.map(d => `
          <article class="doctor reveal">
            <img loading="lazy" src="${esc(d.image || 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=800&q=85')}" alt="Portrait of ${esc(d.name)}">
            <small>${esc(d.role || 'DENTIST')}</small>
            <div>
              <h3>${esc(d.name)}</h3>
              <p>${esc(d.specialty)}</p>
              <button type="button" data-doctor="${esc(d.name)}">View profile ↗</button>
            </div>
          </article>
        `).join('');
      }

      bindDoctorEvents();
    }

    // 4. Pricing Packages Grid
    if (Array.isArray(cfg.pricing) && cfg.pricing.length) {
      const priceGridEl = $('.prices');
      if (priceGridEl) {
        priceGridEl.innerHTML = cfg.pricing.map(p => {
          const isPop = Boolean(p.popular);
          return `
            <article class="price-card ${isPop ? 'featured' : ''} reveal">
              ${isPop ? '<label>MOST POPULAR</label>' : ''}
              <small>${esc(p.tagline || '')}</small>
              <h3>${esc(p.name)}</h3>
              <p>${esc(p.description || '')}</p>
              <div class="price">
                <b data-visit="${esc(p.visitPrice)}" data-plan="${esc(p.planPrice)}">${esc(p.visitPrice)}</b>
                <small data-visit="/ visit" data-plan="/ plan">/ visit</small>
              </div>
              <ul>
                ${(p.features || []).map(f => `<li>${esc(f)}</li>`).join('')}
              </ul>
              <button type="button" class="btn ${isPop ? 'coral' : 'outline'} choose" data-plan="${esc(p.name)}">
                ${p.name.toLowerCase().includes('makeover') ? 'Discuss your goals ↗' : 'Choose package ↗'}
              </button>
            </article>
          `;
        }).join('');
      }

      bindPricingEvents();
    }

    // 5. Patient Testimonials
    if (Array.isArray(cfg.testimonials) && cfg.testimonials.length) {
      reviews = cfg.testimonials.map(t => [t.quote, t.name, t.treatment]);
      showReview(0);
    }

    // 6. Contact, Hours, Socials, Maps & Address
    if (cfg.hours) {
      const fullHours = cfg.hours + (cfg.sundayNote ? ` · ${cfg.sundayNote}` : '');
      const mobHoursEl = $('#mobileMenu p');
      if (mobHoursEl) {
        mobHoursEl.innerHTML = `${esc(cfg.hours)}<br><a href="tel:${(cfg.phoneClean || cfg.phone || '').replace(/[^\d+]/g, '')}">${esc(cfg.phone || '')}</a>`;
      }
      $$('.contact-details div p').forEach(el => {
        if (el.textContent.includes('Mon-Sat') || el.textContent.includes('Sunday') || el.textContent.includes('9:00')) {
          el.textContent = fullHours;
        }
      });
      $$('.footer-links span').forEach(el => {
        if (el.textContent.includes('Mon-Sat') || el.textContent.includes('9:00')) {
          el.textContent = cfg.hours;
        }
      });
    }

    if (cfg.social) {
      if (cfg.social.instagram) {
        $$('a[href*="instagram.com"]').forEach(a => a.href = cfg.social.instagram);
      }
      if (cfg.social.facebook) {
        $$('a[href*="facebook.com"]').forEach(a => a.href = cfg.social.facebook);
      }
      if (cfg.social.youtube) {
        $$('a[href*="youtube.com"]').forEach(a => a.href = cfg.social.youtube);
      }
    }

    if (cfg.identity?.locationBadge) {
      const locBadge = $('.hero-bottom span');
      if (locBadge) locBadge.textContent = cfg.identity.locationBadge;
    }
    if (cfg.identity?.heroProofTitle) {
      const proofTitle = $('.hero-proof strong');
      if (proofTitle) proofTitle.textContent = cfg.identity.heroProofTitle;
    }
    if (cfg.identity?.heroProofSubtitle) {
      const proofSub = $('.hero-proof small');
      if (proofSub) proofSub.textContent = cfg.identity.heroProofSubtitle;
    }

    if (cfg.disclaimer?.notice) {
      const discEl = $('.footer-bottom span:last-child');
      if (discEl) discEl.textContent = cfg.disclaimer.notice;
    }

    if (cfg.phone) {
      const cleanP = (cfg.phoneClean || cfg.phone).replace(/[^\d+]/g, '');
      $$('a[href^="tel:"]').forEach(a => {
        a.href = 'tel:' + cleanP;
        if (a.textContent.includes('+91') || a.textContent.includes('Call')) {
          a.innerHTML = (a.textContent.startsWith('↗') ? '↗ ' : '') + cfg.phone;
        }
      });
    }

    if (cfg.whatsapp) {
      const cleanW = (cfg.whatsappClean || cfg.whatsapp).replace(/\D/g, '');
      $$('a[href*="wa.me"]').forEach(a => {
        a.href = 'https://wa.me/' + cleanW;
      });
    }

    if (cfg.email) {
      $$('a[href^="mailto:"]').forEach(a => {
        a.href = 'mailto:' + cfg.email;
        a.textContent = cfg.email;
      });
    }

    if (cfg.address) {
      $$('.contact-details div b, .map-overlay small').forEach(el => {
        if (el.textContent.includes('Green Avenue')) el.textContent = cfg.address;
      });
    }

    if (cfg.googleMapsUrl) {
      $$('.map-box a, .map-overlay a').forEach(a => {
        a.href = cfg.googleMapsUrl;
      });
    }
    if (cfg.googleMapsEmbed && $('.map-box iframe')) {
      $('.map-box iframe').src = cfg.googleMapsEmbed;
    }

    // 7. SEO, Canonical Link, Open Graph & JSON-LD Structured Data
    if (cfg.seo?.title) {
      document.title = cfg.seo.title;
    }
    if (cfg.seo?.description) {
      const metaDesc = $('meta[name="description"]');
      if (metaDesc) metaDesc.content = cfg.seo.description;
    }

    // Canonical link tag
    if (cfg.seo?.siteUrl) {
      let canLink = $('link[rel="canonical"]');
      if (!canLink) {
        canLink = document.createElement('link');
        canLink.rel = 'canonical';
        document.head.appendChild(canLink);
      }
      canLink.href = cfg.seo.siteUrl;
    }

    // Open Graph & Twitter meta tags helper
    const updateMetaTag = (attr, val, content) => {
      if (!content) return;
      let el = $(`meta[${attr}="${val}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, val);
        document.head.appendChild(el);
      }
      el.content = content;
    };

    const siteTitle = cfg.seo?.title || cfg.identity?.name || document.title;
    const siteDesc = cfg.seo?.description || cfg.identity?.intro || '';
    updateMetaTag('property', 'og:title', siteTitle);
    updateMetaTag('property', 'og:description', siteDesc);
    updateMetaTag('property', 'og:type', 'website');
    if (cfg.seo?.siteUrl) updateMetaTag('property', 'og:url', cfg.seo.siteUrl);
    if (cfg.identity?.name) updateMetaTag('property', 'og:site_name', cfg.identity.name);
    updateMetaTag('name', 'twitter:card', 'summary_large_image');
    updateMetaTag('name', 'twitter:title', siteTitle);
    updateMetaTag('name', 'twitter:description', siteDesc);

    const jsonLd = $('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        data.name = cfg.name || data.name;
        data.telephone = cfg.phone || data.telephone;
        data.email = cfg.email || data.email;
        if (cfg.hours) {
          data.openingHours = [cfg.hours];
        }
        if (cfg.location) {
          data.address = {
            "@type": "PostalAddress",
            "streetAddress": cfg.location.street || "12 Green Avenue",
            "addressLocality": cfg.location.locality || "Hyderabad",
            "addressRegion": cfg.location.state || "Telangana",
            "addressCountry": cfg.location.country || "IN",
            "postalCode": cfg.location.postalCode || "500081"
          };
        }
        jsonLd.textContent = JSON.stringify(data);
      } catch (e) {}
    }

    // Re-initialize intersection observers for freshly created reveal cards
    initReveals();
  }

  // Initial event bindings & dynamic configuration execution
  bindServiceEvents();
  bindDoctorEvents();
  bindChoiceEvents();
  bindPricingEvents();
  renderDynamicClinicContent();
})();
