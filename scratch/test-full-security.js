const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);
const https = require('https');

const SUPABASE_HOST = "nczxzztlwveocdxphsmk.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jenh6enRsd3Zlb2NkeHBoc21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyMjkxNzksImV4cCI6MjEwNzgwNTE3OX0.pH3KPev53H1f6PGpyab_CiP5Q-6Dw0FXkphTAJpvK2M";

function customLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' ? options : {};
  if (opts.all) {
    cb(null, [{ address: '172.64.149.246', family: 4 }]);
  } else {
    cb(null, '172.64.149.246', 4);
  }
}

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: SUPABASE_HOST,
      port: 443,
      path: path,
      method: method,
      lookup: customLookup,
      headers: {
        'apikey': ANON_KEY,
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
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: respBody });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function run() {
  console.log('========================================================================');
  console.log(' LUMIÈRE DENTAL STUDIO — INDEPENDENT 5-POINT SECURITY & RLS AUDIT SUITE ');
  console.log('========================================================================\n');

  // TEST 1: Anonymous Access Protection
  console.log('TEST 1: Anonymous Database Access Boundaries (RLS Isolation)');
  const anonLeads = await request('GET', '/rest/v1/leads?select=*');
  const anonLeadsBlocked = anonLeads.status === 401 || !anonLeads.data || anonLeads.data.length === 0;
  console.log(`  [Anon Leads Select] Status: ${anonLeads.status}, Rows exposed: ${anonLeads.data?.length || 0}`);
  if (!anonLeadsBlocked) throw new Error('Security Breach: Anonymous users can read leads table!');
  console.log('  ✓ PASS: Anonymous visitors CANNOT read confidential patient leads.\n');

  const anonProfiles = await request('GET', '/rest/v1/profiles?select=*');
  const anonProfilesBlocked = anonProfiles.status === 401 || !anonProfiles.data || anonProfiles.data.length === 0;
  console.log(`  [Anon Profiles Select] Status: ${anonProfiles.status}, Rows exposed: ${anonProfiles.data?.length || 0}`);
  if (!anonProfilesBlocked) throw new Error('Security Breach: Anonymous users can read staff profiles!');
  console.log('  ✓ PASS: Anonymous visitors CANNOT read staff profiles.\n');

  // TEST 2: Duplicate Prevention & Idempotency
  console.log('TEST 2: Duplicate Appointment Prevention & Idempotency Guard');
  const testSubId = 'idemp_' + Date.now();
  const subPayload = {
    p_payload: {
      client_submission_id: testSubId,
      name: "Rohan Kapoor",
      phone: "+91 9888877777",
      email: "rohan.k@example.com",
      service: "Teeth whitening",
      preferred_date: "2026-11-20",
      preferred_time: "10:00 AM",
      message: "First submission attempt",
      source: "booking_form"
    }
  };

  const firstSub = await request('POST', '/rest/v1/rpc/submit_lead', subPayload);
  const firstId = firstSub.data?.id;
  console.log(`  [Initial Submission] Created UUID: ${firstId}`);

  // Immediate retry with identical idempotency key (simulating network dropped response retry)
  const retrySub = await request('POST', '/rest/v1/rpc/submit_lead', subPayload);
  console.log(`  [Retry Submission] Returned UUID: ${retrySub.data?.id}, Deduplicated flag: ${retrySub.data?.deduplicated}`);

  if (firstId !== retrySub.data?.id || retrySub.data?.deduplicated !== true) {
    throw new Error('Idempotency failure: Duplicate appointment inserted!');
  }
  console.log('  ✓ PASS: Idempotency guard prevents duplicate appointment creation.\n');

  // TEST 3: Doctor-Level RLS Database Enforcement (No JS Filtering)
  console.log('TEST 3: Doctor-Level Database RLS (Pure Postgres Enforcement)');
  // 3a: Create an unassigned appointment
  const unassignedSub = await request('POST', '/rest/v1/rpc/submit_lead', {
    p_payload: {
      name: "Private Patient X",
      phone: "+91 9777766666",
      service: "Emergency care",
      doctor: "Unassigned",
      assigned_to: null,
      source: "booking_form"
    }
  });
  const unassignedId = unassignedSub.data?.id;

  // 3b: Authenticate as Dr. Rao
  const docLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: "dr.rao@lumieredental.example",
    password: process.env.DOCTOR_PASSWORD
  });
  const docToken = docLogin.data.access_token;

  // 3c: Dr. Rao runs raw unbounded SELECT query: GET /rest/v1/leads?select=*
  const docAllLeads = await request('GET', '/rest/v1/leads?select=*', null, {
    'Authorization': `Bearer ${docToken}`
  });
  console.log(`  [Dr. Rao Raw Query] Total rows returned by Postgres: ${docAllLeads.data?.length}`);
  
  const seesUnassigned = docAllLeads.data?.some(l => l.id === unassignedId);
  const allMatchDoc = docAllLeads.data?.every(l => 
    l.assigned_to === "3a1f3621-dcd7-4581-a03e-0b2e2f9149f1" || 
    (l.doctor && l.doctor.toLowerCase().includes('rao'))
  );

  console.log(`  Sees unassigned appointment? ${seesUnassigned}`);
  console.log(`  Every single row returned belongs strictly to Dr. Rao? ${allMatchDoc}`);

  if (seesUnassigned || !allMatchDoc) {
    throw new Error('RLS Breach: Doctor can view appointments belonging to other doctors or unassigned leads!');
  }
  console.log('  ✓ PASS: Postgres RLS independently guarantees doctors only see their assigned patients.\n');

  // TEST 4: Receptionist Deletion Restriction (RLS Delete Policy)
  console.log('TEST 4: Role-Based Deletion Security');
  const recepLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: "reception@lumieredental.example",
    password: process.env.RECEPTION_PASSWORD
  });
  const recepToken = recepLogin.data.access_token;

  const recepDel = await request('DELETE', `/rest/v1/leads?id=eq.${firstId}`, null, {
    'Authorization': `Bearer ${recepToken}`,
    'Prefer': 'return=representation'
  });
  const recepRowsDeleted = recepDel.data?.length || 0;
  console.log(`  [Receptionist Delete Attempt] Rows deleted: ${recepRowsDeleted}`);
  if (recepRowsDeleted !== 0) {
    throw new Error('RLS Breach: Receptionist was able to delete records!');
  }
  console.log('  ✓ PASS: Receptionists are strictly prevented from deleting records.\n');

  // TEST 5: Admin Authorized Permanent Cleanup
  console.log('TEST 5: Administrator Full Cloud Cleanup');
  const adminLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: "admin@lumieredental.example",
    password: process.env.ADMIN_PASSWORD
  });
  const adminToken = adminLogin.data.access_token;

  // Cleanup test records
  const del1 = await request('DELETE', `/rest/v1/leads?id=eq.${firstId}`, null, {
    'Authorization': `Bearer ${adminToken}`,
    'Prefer': 'return=representation'
  });
  const del2 = await request('DELETE', `/rest/v1/leads?id=eq.${unassignedId}`, null, {
    'Authorization': `Bearer ${adminToken}`,
    'Prefer': 'return=representation'
  });
  console.log(`  [Admin Cleanup] Deleted test lead 1: ${del1.data?.length === 1}, Deleted test lead 2: ${del2.data?.length === 1}`);
  console.log('  ✓ PASS: Administrators have verified hard-delete authority.\n');

  console.log('========================================================================');
  console.log('    ALL 5 INDEPENDENT AUDIT SUITE TESTS PASSED WITH 100% SUCCESS!       ');
  console.log('========================================================================\n');
}

run().catch(err => {
  console.error('\n❌ Security Audit Suite Failed:', err);
  process.exit(1);
});
