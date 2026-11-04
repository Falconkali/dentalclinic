/**
 * LUMIÈRE DENTAL STUDIO — REALTIME WEBSOCKET SUBSCRIPTION & RLS AUDIT
 * 
 * Verifies end-to-end Supabase Realtime WebSocket events over phoenix protocol:
 * 1. Authenticates Admin and Doctor personas via Supabase Auth
 * 2. Connects to wss://<host>/realtime/v1/websocket
 * 3. Joins channels with postgres_changes on public.leads
 * 4. Confirms channel subscription (SUBSCRIBED / phx_reply ok)
 * 5. Inserts controlled test leads:
 *    - Unassigned lead -> Admin receives WS event, Doctor does NOT (RLS isolation)
 *    - Doctor-assigned lead -> Doctor receives WS event
 * 6. Validates real-time payload structure (INSERT / UPDATE)
 * 7. Safely unsubscribes and cleans up test records
 */

const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);
const fs = require('fs');
const path = require('path');
const https = require('https');

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
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const HOST = process.env.SUPABASE_HOST || 'nczxzztlwveocdxphsmk.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DOCTOR_PASSWORD = process.env.DOCTOR_PASSWORD;

function customLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' ? options : {};
  if (opts.all) {
    cb(null, [{ address: '172.64.149.246', family: 4 }]);
  } else {
    cb(null, '172.64.149.246', 4);
  }
}

function request(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: HOST,
      port: 443,
      path: reqPath,
      method: method,
      lookup: customLookup,
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        ...(dataString ? { 'Content-Length': Buffer.byteLength(dataString) } : {}),
        ...headers
      }
    }, (res) => {
      let respBody = '';
      res.on('data', chunk => respBody += chunk);
      res.on('end', () => {
        try {
          const parsed = respBody ? JSON.parse(respBody) : {};
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed, raw: respBody });
        } catch {
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: respBody, raw: respBody });
        }
      });
    });
    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

class RealtimeClient {
  constructor(name, token) {
    this.name = name;
    this.token = token;
    this.ws = null;
    this.refCounter = 1;
    this.receivedEvents = [];
    this.channelJoined = false;
    this.postgresSubscribed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://${HOST}/realtime/v1/websocket?apikey=${ANON_KEY}&vsn=1.0.0`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          this.handleMessage(parsed);
        } catch (e) {
          console.warn(`[${this.name}] Non-JSON message:`, msg.data);
        }
      };
    });
  }

  handleMessage(msg) {
    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
      this.channelJoined = true;
    }
    if (msg.event === 'system' && (msg.payload?.extension === 'postgres_changes' || msg.payload?.message?.includes('Subscribed'))) {
      this.postgresSubscribed = true;
    }
    if (msg.event === 'postgres_changes') {
      this.receivedEvents.push(msg.payload?.data);
    }
  }

  subscribe(topicName) {
    return new Promise((resolve, reject) => {
      const ref = String(this.refCounter++);
      const joinMsg = {
        topic: topicName,
        event: 'phx_join',
        payload: {
          config: {
            postgres_changes: [{
              event: '*',
              schema: 'public',
              table: 'leads'
            }]
          },
          access_token: this.token
        },
        ref
      };

      const timeout = setTimeout(() => {
        reject(new Error(`[${this.name}] Subscription timed out on topic ${topicName}`));
      }, 10000);

      const checkInterval = setInterval(() => {
        if (this.channelJoined && this.postgresSubscribed) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          // 500ms buffer to ensure server-side publication replication slot is 100% warm
          setTimeout(resolve, 500);
        }
      }, 100);

      this.ws.send(JSON.stringify(joinMsg));
    });
  }

  waitForEvent(leadId, timeoutMs = 8000, eventType = null) {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const match = this.receivedEvents.find(e => {
          if (e?.record?.id !== leadId) return false;
          if (eventType && e?.type !== eventType) return false;
          return true;
        });
        if (match) {
          clearInterval(interval);
          resolve(match);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 150);
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

async function run() {
  console.log('========================================================================');
  console.log(' LUMIÈRE DENTAL STUDIO — REALTIME WEBSOCKET INTEGRATION TEST');
  console.log(' Host: ' + HOST);
  console.log(' Time: ' + new Date().toISOString());
  console.log('========================================================================\n');

  // Step 1: Authenticate personas
  console.log('Step 1: Authenticating Test Personas via Supabase Auth...');
  const adminLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: 'admin@lumieredental.example',
    password: ADMIN_PASSWORD
  });
  if (!adminLogin.ok) throw new Error('Admin auth failed: ' + adminLogin.raw);
  const adminToken = adminLogin.data.access_token;
  const adminUid = adminLogin.data.user.id;
  console.log(`  ✓ Admin Authenticated (UID: ${adminUid.slice(0, 8)}...)`);

  const docLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: 'dr.rao@lumieredental.example',
    password: DOCTOR_PASSWORD
  });
  if (!docLogin.ok) throw new Error('Doctor auth failed: ' + docLogin.raw);
  const docToken = docLogin.data.access_token;
  const docUid = docLogin.data.user.id;
  console.log(`  ✓ Doctor Authenticated (UID: ${docUid.slice(0, 8)}...)\n`);

  // Step 2 & 3: Connect and subscribe to Realtime WebSocket
  console.log('Step 2 & 3: Opening WebSocket Channels & Subscribing to postgres_changes...');
  const adminClient = new RealtimeClient('AdminClient', adminToken);
  const docClient = new RealtimeClient('DoctorClient', docToken);

  await adminClient.connect();
  console.log('  ✓ Admin WebSocket Connected');
  await docClient.connect();
  console.log('  ✓ Doctor WebSocket Connected');

  const channelSuffix = Math.random().toString(36).slice(2, 7);
  await adminClient.subscribe(`realtime:leads_admin_${channelSuffix}`);
  console.log('  ✓ Admin Channel Subscribed (status: SUBSCRIBED / phx_reply: ok)');

  await docClient.subscribe(`realtime:leads_doc_${channelSuffix}`);
  console.log('  ✓ Doctor Channel Subscribed (status: SUBSCRIBED / phx_reply: ok)\n');

  const createdLeadIds = [];

  try {
    // Step 4 & 5: Insert Unassigned Lead
    console.log('Step 4 & 5: Inserting Unassigned Test Lead...');
    const unassignedLeadRes = await request('POST', '/rest/v1/leads', {
      name: 'Realtime Unassigned Patient',
      phone: '+1 555-0199',
      service: 'Invisalign Consultation',
      source: 'walk_in',
      status: 'new'
    }, {
      'Authorization': `Bearer ${adminToken}`,
      'Prefer': 'return=representation'
    });

    if (!unassignedLeadRes.ok || !unassignedLeadRes.data?.[0]?.id) {
      throw new Error('Failed to insert unassigned test lead: ' + unassignedLeadRes.raw);
    }
    const unassignedLeadId = unassignedLeadRes.data[0].id;
    createdLeadIds.push(unassignedLeadId);
    console.log(`  ✓ Inserted Unassigned Lead (ID: ${unassignedLeadId})`);

    // Verify Admin receives event
    console.log('  Waiting for Admin WebSocket event...');
    const adminEvent = await adminClient.waitForEvent(unassignedLeadId, 6000);
    console.log(`  [Admin Event Received]: ${adminEvent ? 'YES (' + adminEvent.type + ')' : 'NO'}`);
    if (!adminEvent) {
      throw new Error('Admin failed to receive Realtime WebSocket event for unassigned lead');
    }

    // Verify Doctor does NOT receive event (RLS isolation)
    console.log('  Verifying Doctor does NOT receive event for unassigned lead...');
    const docEventForUnassigned = await docClient.waitForEvent(unassignedLeadId, 2500);
    console.log(`  [Doctor Event Received]: ${docEventForUnassigned ? 'YES (UNEXPECTED)' : 'NO (CORRECT — RLS BLOCKED)'}`);
    if (docEventForUnassigned) {
      throw new Error('Doctor received Realtime event for unassigned lead! RLS isolation failed.');
    }
    console.log('  ✓ PASS: RLS prevents Doctor from receiving unassigned leads over WebSocket\n');

    // Step 6 & 7: Insert Doctor-Assigned Lead
    console.log('Step 6 & 7: Inserting Doctor-Assigned Test Lead...');
    const assignedLeadRes = await request('POST', '/rest/v1/leads', {
      name: 'Realtime Doctor Assigned Patient',
      phone: '+1 555-0188',
      service: 'Cosmetic Veneers',
      source: 'walk_in',
      status: 'new',
      assigned_to: docUid
    }, {
      'Authorization': `Bearer ${adminToken}`,
      'Prefer': 'return=representation'
    });

    if (!assignedLeadRes.ok || !assignedLeadRes.data?.[0]?.id) {
      throw new Error('Failed to insert doctor-assigned test lead: ' + assignedLeadRes.raw);
    }
    const assignedLeadId = assignedLeadRes.data[0].id;
    createdLeadIds.push(assignedLeadId);
    console.log(`  ✓ Inserted Assigned Lead (ID: ${assignedLeadId}, Assigned To: ${docUid.slice(0, 8)}...)`);

    // Verify Doctor receives event for assigned lead
    console.log('  Waiting for Doctor WebSocket event...');
    const docEvent = await docClient.waitForEvent(assignedLeadId, 6000);
    console.log(`  [Doctor Event Received]: ${docEvent ? 'YES (' + docEvent.type + ')' : 'NO'}`);
    if (!docEvent) {
      throw new Error('Doctor failed to receive Realtime WebSocket event for assigned lead');
    }
    console.log('  ✓ PASS: Doctor successfully received assigned lead INSERT event over WebSocket\n');

    // Step 8: Verify Live UPDATE Event Delivery & Doctor RLS
    console.log('Step 8: Verifying Live UPDATE Realtime Event Delivery...');
    // Doctor performs legitimate clinical update on their assigned patient
    const updateRes = await request('PATCH', `/rest/v1/leads?id=eq.${assignedLeadId}`, {
      status: 'completed',
      staff_notes: 'Reviewed panoramic radiograph via Realtime WebSocket'
    }, {
      'Authorization': `Bearer ${docToken}`,
      'Prefer': 'return=representation'
    });

    if (!updateRes.ok) {
      throw new Error('Doctor status update failed during Realtime test: ' + updateRes.raw);
    }
    console.log(`  ✓ Updated Assigned Lead (status: completed)`);

    // Verify Doctor receives live UPDATE event
    console.log('  Waiting for Doctor live UPDATE WebSocket event...');
    const docUpdateEvent = await docClient.waitForEvent(assignedLeadId, 6000, 'UPDATE');
    console.log(`  [Doctor UPDATE Event Received]: ${docUpdateEvent ? 'YES (' + docUpdateEvent.type + ' status=' + docUpdateEvent.record?.status + ')' : 'NO'}`);
    if (!docUpdateEvent || docUpdateEvent.type !== 'UPDATE' || docUpdateEvent.record?.status !== 'completed') {
      throw new Error('Doctor failed to receive verified UPDATE Realtime WebSocket event');
    }

    // Update unassigned lead and verify Doctor client is blocked by RLS from receiving its UPDATE
    await request('PATCH', `/rest/v1/leads?id=eq.${unassignedLeadId}`, {
      status: 'contacted'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    const docBlockedUpdate = await docClient.waitForEvent(unassignedLeadId, 2500, 'UPDATE');
    console.log(`  [Doctor Event for Unassigned UPDATE]: ${docBlockedUpdate ? 'YES (UNEXPECTED)' : 'NO (CORRECT — RLS BLOCKED)'}`);
    if (docBlockedUpdate) {
      throw new Error('Doctor received Realtime UPDATE event for unassigned lead! RLS isolation failed.');
    }
    console.log('  ✓ PASS: Live Realtime UPDATE events delivered and doctor RLS strictly enforced\n');

  } finally {
    // Step 9: Cleanup
    console.log('Step 9: Safe Cleanup of Test Records & Unsubscribing Channels...');
    for (const lid of createdLeadIds) {
      await request('DELETE', `/rest/v1/leads?id=eq.${lid}`, null, {
        'Authorization': `Bearer ${adminToken}`
      });
    }
    adminClient.close();
    docClient.close();
    console.log('  ✓ Cleaned up test leads and disconnected WebSockets.\n');
  }

  console.log('========================================================================');
  console.log(' 🎉 REALTIME VERIFICATION PASSED: 100% SUCCESS');
  console.log(' WebSocket connection, SUBSCRIBED confirmation, and RLS doctor isolation confirmed.');
  console.log('========================================================================\n');
}

run().catch((err) => {
  console.error('\n❌ REALTIME TEST FAILED:', err.message);
  process.exit(1);
});
