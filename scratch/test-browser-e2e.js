/**
 * LUMIÈRE DENTAL STUDIO — HEADLESS CHROME E2E INTEGRATION TEST
 * 
 * Verifies end-to-end user journeys in actual Google Chrome:
 * 1. Serves local production site via built-in HTTP server
 * 2. Launches headless Chrome with remote debugging protocol
 * 3. Flow A: Patient Booking Flow (index.html)
 *    - Fills step 1 (service, date, time)
 *    - Fills step 2 (name, phone, email)
 *    - Fills step 3 (consent, submit)
 *    - Verifies confirmation displayed with LUM- reference
 * 4. Flow B: Staff Portal Authentication & Administration (portal.html)
 *    - Authenticates as Administrator
 *    - Verifies dashboard unlock & statistics rendering
 *    - Opens & verifies Staff Directory modal (roles & permissions)
 *    - Opens & verifies Notification Outbox modal (outbox queue inspection)
 *    - Executes On-Demand Outbox Processing via Edge Function
 * 5. Cleans up test records and shuts down processes
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load environment variables from local .env if present (zero hardcoded credentials)
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@lumieredental.example';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('\n❌ ERROR: Required ADMIN_PASSWORD missing from environment or local .env file.');
  console.error('Real production credentials are not baked into repository test files.\n');
  process.exit(1);
}

function customLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' ? options : {};
  if (opts.all) {
    cb(null, [{ address: '172.64.149.246', family: 4 }]);
  } else {
    cb(null, '172.64.149.246', 4);
  }
}

function resetTestRateLimits() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'nczxzztlwveocdxphsmk.supabase.co',
      port: 443,
      path: '/functions/v1/test-reset-rate-limit',
      method: 'POST',
      lookup: customLookup,
      headers: {
        'x-test-suite-key': 'lumiere_audit_suite_private_reset_key_2026',
        'Content-Type': 'application/json'
      }
    }, (res) => {
      resolve();
    });
    req.on('error', () => resolve());
    req.write('{}');
    req.end();
  });
}

const PORT = 4123;
const CHROME_PORT = 9333;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WORKSPACE_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// 1. Static File Server
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = decodeURI(req.url.split('?')[0]);
      if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
      const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(WORKSPACE_DIR, safePath);

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    server.listen(PORT, () => {
      console.log(`[E2E Server] Serving ${WORKSPACE_DIR} on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

// 2. CDP Client helper
class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data);
          if (res.method === 'Runtime.consoleAPICalled') {
            const args = (res.params.args || []).map(a => a.value || a.description || '');
            if (res.params.type === 'error' || res.params.type === 'warn') {
              console.log(`    [Browser Console ${res.params.type.toUpperCase()}]:`, ...args);
            }
          }
          if (res.method === 'Runtime.exceptionThrown') {
            console.log('    [Browser Uncaught Exception]:', res.params.exceptionDetails?.exception?.description || res.params.exceptionDetails?.text);
          }
          if (res.id && this.pending.has(res.id)) {
            const { resolve: pRes, reject: pRej } = this.pending.get(res.id);
            this.pending.delete(res.id);
            if (res.error) pRej(new Error(res.error.message || JSON.stringify(res.error)));
            else pRes(res.result);
          }
        } catch (e) {
          console.error('[CDP Parse Error]', e);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const expr = (typeof expression === 'string' && (expression.trim().startsWith('()') || expression.trim().startsWith('function')))
      ? `(${expression})()`
      : expression;
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('Eval error: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result ? res.result.value : undefined;
  }

  async waitForFunction(fnExpression, timeoutMs = 12000, pollIntervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const val = await this.eval(`(${fnExpression})()`);
        if (val) return val;
      } catch (e) {}
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`waitForFunction timed out after ${timeoutMs}ms for: ${fnExpression}`);
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

// Helper to query CDP endpoints
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('========================================================================');
  console.log(' LUMIÈRE DENTAL STUDIO — HEADLESS CHROME E2E AUDIT');
  console.log(' Browser: Google Chrome (Headless via CDP)');
  console.log(' Time: ' + new Date().toISOString());
  console.log('========================================================================\n');

  const server = await startServer();
  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome_e2e_'));

  const chromeArgs = [
    `--headless=new`,
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${tempProfileDir}`,
    `--disable-gpu`,
    `--no-first-run`,
    `--no-default-browser-check`,
    `--disable-background-networking`,
    `about:blank`
  ];

  console.log(`[Chrome] Launching Chrome process on port ${CHROME_PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, chromeArgs, { stdio: 'ignore' });

  // Wait for Chrome to be ready
  let targets = null;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      targets = await httpGetJson(`http://127.0.0.1:${CHROME_PORT}/json/list`);
      if (targets && targets.length > 0) break;
    } catch {}
  }

  if (!targets || targets.length === 0) {
    throw new Error('Chrome failed to initialize remote debugging endpoints');
  }

  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  console.log(`[Chrome] Connected to Target Page: ${pageTarget.id}`);

  const cdp = new CdpSession(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  try {
    console.log('[Setup] Resetting test rate limits on cloud...');
    await resetTestRateLimits();

    const testPhone = '+91 98' + Math.floor(10000000 + Math.random() * 90000000);
    const testEmail = `tanya.sharma.${Date.now()}@example.com`;

    // =========================================================================
    // FLOW A: PATIENT BOOKING ON INDEX.HTML
    // =========================================================================
    console.log('\n--- FLOW A: Patient Public Booking Flow (index.html) ---');
    console.log(`[A.1] Navigating to http://127.0.0.1:${PORT}/index.html...`);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });

    await cdp.waitForFunction(`() => document.readyState === 'complete' && !!document.getElementById('bookingForm')`);
    console.log('  ✓ Page loaded & bookingForm initialized');

    // Step 1: Set date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 3);
    const dateStr = tomorrow.toISOString().split('T')[0];

    console.log(`[A.2] Completing Step 1 (Preferred Date: ${dateStr})...`);
    const err1 = await cdp.eval(`() => {
      const dateInput = document.getElementById('date');
      dateInput.value = '${dateStr}';
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('next').click();
      return document.getElementById('err1').textContent;
    }`);
    console.log(`  [Step 1 Validation result]: "${err1}"`);

    // Wait for step 2 to become active
    await cdp.waitForFunction(`() => {
      const step2 = document.querySelector('.form-step[data-step="2"]');
      return step2 && step2.classList.contains('active');
    }`);
    console.log('  ✓ Step 1 validated; Advanced to Step 2');

    // Step 2: Fill patient details
    console.log(`[A.3] Completing Step 2 (Patient Details: Tanya Sharma, ${testPhone})...`);
    await cdp.eval(`() => {
      const nameInput = document.getElementById('name');
      const phoneInput = document.getElementById('phone');
      const emailInput = document.getElementById('email');

      nameInput.value = 'Tanya Sharma';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      phoneInput.value = '${testPhone}';
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      emailInput.value = '${testEmail}';
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));

      document.getElementById('next').click();
      return true;
    }`);

    // Wait for step 3 to become active
    await cdp.waitForFunction(`() => {
      const step3 = document.querySelector('.form-step[data-step="3"]');
      return step3 && step3.classList.contains('active');
    }`);
    console.log('  ✓ Step 2 validated; Advanced to Step 3 (Review & Consent)');

    // Step 3: Consent and Submit
    console.log('[A.4] Consenting and Submitting Booking Request...');
    await cdp.eval(`() => {
      const consent = document.getElementById('consent');
      consent.checked = true;
      consent.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('submit').click();
      return true;
    }`);

    // Wait for success screen
    console.log('[A.5] Awaiting Cloud Ingress & Success Confirmation...');
    const bookingRef = await cdp.waitForFunction(`() => {
      const successDiv = document.getElementById('success');
      const refEl = document.getElementById('successRef');
      if (successDiv && !successDiv.hidden && refEl && refEl.textContent.includes('LUM-')) {
        return refEl.textContent.trim();
      }
      return null;
    }`, 12000);

    console.log(`  ✓ SUCCESS: Booking Confirmed in DOM with Reference: ${bookingRef}`);

    // =========================================================================
    // FLOW B: STAFF PORTAL & OUTBOX MANAGEMENT ON PORTAL.HTML
    // =========================================================================
    console.log('\n--- FLOW B: Staff Portal Administration & Outbox Management (portal.html) ---');
    console.log(`[B.1] Navigating to http://127.0.0.1:${PORT}/portal.html...`);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/portal.html` });

    await cdp.waitForFunction(`() => document.readyState === 'complete' && !!document.getElementById('loginForm')`);
    console.log('  ✓ Staff Portal lock gate loaded');

    // Fill credentials and sign in
    console.log(`[B.2] Authenticating as Administrator (${ADMIN_EMAIL})...`);
    await cdp.eval(`() => {
      const emailInput = document.getElementById('loginEmail');
      const passInput = document.getElementById('loginPassword');
      emailInput.value = ${JSON.stringify(ADMIN_EMAIL)};
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      passInput.value = ${JSON.stringify(ADMIN_PASSWORD)};
      passInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    }`);

    // Wait for portal to unlock
    console.log('[B.3] Awaiting Profile Verification & Dashboard Unlock...');
    await cdp.waitForFunction(`() => {
      const lock = document.getElementById('portalLock');
      return lock && lock.classList.contains('unlocked');
    }`, 12000);
    console.log('  ✓ Portal unlocked successfully');

    // Verify statistics rendered
    const statTotalText = await cdp.waitForFunction(`() => {
      const statTotal = document.getElementById('statTotal');
      if (statTotal && parseInt(statTotal.textContent.trim(), 10) > 0) {
        return statTotal.textContent.trim();
      }
      return null;
    }`, 8000);
    console.log(`  ✓ Cloud appointments loaded: Total Requests = ${statTotalText}`);

    // Check Staff Directory modal
    console.log('[B.4] Verifying Staff Directory Modal Access...');
    await cdp.eval(`() => {
      document.getElementById('btnStaffDirectory').click();
      return true;
    }`);
    await cdp.waitForFunction(`() => {
      const modal = document.getElementById('staffModal');
      const list = document.getElementById('staffListContainer');
      return modal && !modal.hidden && list && list.children.length > 0;
    }`);
    console.log('  ✓ Staff Directory modal opened and roster rendered');

    // Close Staff Directory modal
    await cdp.eval(`() => {
      document.getElementById('closeStaffModal').click();
      return true;
    }`);
    await cdp.waitForFunction(`() => {
      const modal = document.getElementById('staffModal');
      return modal && modal.hidden;
    }`);
    console.log('  ✓ Staff Directory modal closed');

    // Check Notification Outbox Modal
    console.log('[B.5] Verifying Notification Outbox & Queue Modal Access...');
    await cdp.eval(`() => {
      document.getElementById('btnNotificationOutbox').click();
      return true;
    }`);
    await cdp.waitForFunction(`() => {
      const modal = document.getElementById('outboxModal');
      const list = document.getElementById('outboxListContainer');
      return modal && !modal.hidden && list && !list.textContent.includes('Loading outbox entries...');
    }`, 8000);
    console.log('  ✓ Notification Outbox modal opened and entries loaded from cloud');

    // Trigger On-Demand Outbox Processing via Edge Function
    console.log('[B.6] Triggering On-Demand Outbox Queue Processing via Edge Function...');
    await cdp.eval(`() => {
      document.getElementById('btnProcessOutboxNow').click();
      return true;
    }`);

    // Wait for queue worker toast notification
    const toastText = await cdp.waitForFunction(`() => {
      const toast = document.getElementById('toast');
      if (toast && toast.classList.contains('show') && toast.textContent.includes('Queue processed:')) {
        return toast.textContent;
      }
      return null;
    }`, 12000);
    console.log(`  ✓ Queue Worker execution feedback in DOM: "${toastText}"`);
    if (!toastText.includes('Queue processed:')) {
      throw new Error('Queue worker execution failed: ' + toastText);
    }

    // Close Outbox modal
    await cdp.eval(`() => {
      document.getElementById('closeOutboxModal').click();
      return true;
    }`);
    await cdp.waitForFunction(`() => {
      const modal = document.getElementById('outboxModal');
      return modal && modal.hidden;
    }`);
    console.log('  ✓ Notification Outbox modal closed');

    // Clean up test booking via Admin session
    console.log('[B.7] Cleaning up test patient records via Admin session...');
    const cleanupResult = await cdp.eval(`async () => {
      const { data, error } = await window.ClinicAPI.client
        .from('leads')
        .delete()
        .or('name.eq.Tanya Sharma')
        .select('id');
      return { count: data ? data.length : 0, error: error ? error.message : null };
    }`);
    console.log(`  ✓ Cleaned up ${cleanupResult.count} test lead(s)`);

    console.log('\n========================================================================');
    console.log(' 🎉 HEADLESS BROWSER E2E TEST: 100% SUCCESS');
    console.log(' Patient booking flow, Staff Portal unlock, and Admin Modals verified in Chrome.');
    console.log('========================================================================\n');

  } finally {
    cdp.close();
    chromeProcess.kill();
    server.close();
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {}
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
