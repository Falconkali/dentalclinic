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
  console.log('================================================================');
  console.log('       LUMIÈRE DENTAL STUDIO — FULL INTEGRATION VERIFICATION    ');
  console.log('================================================================\n');

  // 1. Patient Booking Form Submission
  console.log('1. [PATIENT] Submitting booking request to public cloud endpoint...');
  const leadPayload = {
    p_payload: {
      name: "Tanya Sen",
      phone: "+91 9123456789",
      email: "tanya.sen@example.com",
      service: "Clear aligners",
      plan: "Smile Refresh",
      preferred_date: "2026-11-15",
      preferred_time: "3:00 PM",
      message: "Consultation for upper dental alignment.",
      source: "booking_form",
      form_started_at: new Date(Date.now() - 45000).toISOString()
    }
  };

  const bookingRes = await request('POST', '/rest/v1/rpc/submit_lead', leadPayload);
  if (!bookingRes.data?.id) {
    throw new Error('Public booking failed to return verified UUID!');
  }
  const leadId = bookingRes.data.id;
  console.log(`   ✓ Verified booking created with Cloud ID: ${leadId}\n`);

  // 2. Receptionist Authentication
  console.log('2. [RECEPTIONIST] Authenticating as front desk...');
  const receptionLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: "reception@lumieredental.example",
    password: process.env.RECEPTION_PASSWORD
  });
  if (!receptionLogin.ok || !receptionLogin.data?.access_token) {
    throw new Error('Receptionist authentication failed!');
  }
  const receptionToken = receptionLogin.data.access_token;
  console.log(`   ✓ Front desk session active for: ${receptionLogin.data.user.email}`);

  // Fetch leads as Receptionist
  const receptionLeads = await request('GET', `/rest/v1/leads?id=eq.${leadId}`, null, {
    'Authorization': `Bearer ${receptionToken}`
  });
  const foundLead = receptionLeads.data?.[0];
  if (!foundLead) {
    throw new Error('Receptionist could not view the newly submitted appointment!');
  }
  console.log(`   ✓ Receptionist sees incoming request for: ${foundLead.name} (${foundLead.service})\n`);

  // 3. Receptionist assigns Doctor (persisting both doctor name AND assigned_to UUID)
  console.log('3. [RECEPTIONIST] Assigning Dr. Ananya Rao (persisting doctor name + assigned_to UUID)...');
  const doctorUuid = "3a1f3621-dcd7-4581-a03e-0b2e2f9149f1";
  const doctorName = "Dr. Ananya Rao";

  const assignRes = await request('PATCH', `/rest/v1/leads?id=eq.${leadId}`, {
    doctor: doctorName,
    assigned_to: doctorUuid,
    status: 'booked',
    staff_notes: 'Confirmed via WhatsApp; allocated to Dr. Rao slot.'
  }, {
    'Authorization': `Bearer ${receptionToken}`,
    'Prefer': 'return=representation'
  });

  const updatedLead = assignRes.data?.[0];
  if (updatedLead?.assigned_to !== doctorUuid || updatedLead?.doctor !== doctorName) {
    throw new Error('Doctor assignment failed to persist UUID and Name!');
  }
  console.log(`   ✓ Lead updated. Status: ${updatedLead.status}, Doctor: ${updatedLead.doctor}, Assigned UUID: ${updatedLead.assigned_to}\n`);

  // 4. Doctor Authentication & Scoped RLS Access
  console.log('4. [DOCTOR] Authenticating as Dr. Ananya Rao...');
  const doctorLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: "dr.rao@lumieredental.example",
    password: process.env.DOCTOR_PASSWORD
  });
  if (!doctorLogin.ok || !doctorLogin.data?.access_token) {
    throw new Error('Doctor authentication failed!');
  }
  const doctorToken = doctorLogin.data.access_token;
  console.log(`   ✓ Doctor session active for: ${doctorLogin.data.user.email}`);

  // Query appointments as Dr. Rao
  const doctorLeads = await request('GET', `/rest/v1/leads?id=eq.${leadId}`, null, {
    'Authorization': `Bearer ${doctorToken}`
  });
  if (!doctorLeads.data?.[0]) {
    throw new Error('RLS Issue: Dr. Rao cannot view the appointment assigned to her!');
  }
  console.log(`   ✓ Dr. Rao successfully retrieves her assigned patient: ${doctorLeads.data[0].name}\n`);

  // 5. Deletion Security Test: Receptionist Forbidden (0 rows), Admin Allowed (1 row)
  console.log('5. [SECURITY] Testing Deletion Permissions (RLS Enforcement)...');
  const receptionDelete = await request('DELETE', `/rest/v1/leads?id=eq.${leadId}`, null, {
    'Authorization': `Bearer ${receptionToken}`,
    'Prefer': 'return=representation'
  });
  const receptionDeletedCount = receptionDelete.data?.length || 0;
  console.log(`   ✓ Receptionist deletion attempt returned: ${receptionDeletedCount} rows (Blocked by RLS as required)`);

  console.log('   [ADMIN] Authenticating as Clinic Admin...');
  const adminLogin = await request('POST', '/auth/v1/token?grant_type=password', {
    email: "admin@lumieredental.example",
    password: process.env.ADMIN_PASSWORD
  });
  const adminToken = adminLogin.data.access_token;

  const adminDelete = await request('DELETE', `/rest/v1/leads?id=eq.${leadId}`, null, {
    'Authorization': `Bearer ${adminToken}`,
    'Prefer': 'return=representation'
  });
  const adminDeletedCount = adminDelete.data?.length || 0;
  console.log(`   ✓ Admin deletion attempt returned: ${adminDeletedCount} rows (Authorized & Executed in cloud)\n`);

  if (receptionDeletedCount !== 0 || adminDeletedCount !== 1) {
    throw new Error('Deletion authorization check failed!');
  }

  console.log('================================================================');
  console.log('   ALL 5/5 END-TO-END SECURITY & CLOUD TESTS PASSED WITH 100%!   ');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
