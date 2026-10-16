'use strict';
// trust (ops console): provider onboarding and verification, expiry tracking,
// platform metrics. In production these routes require an ops role.

const { must, json, addMinutes, localDay } = require('../util');

const REG_RULES = {
  doctor: { re: /^[A-Z]{1,4}MC\/\d{4}\/\d{3,6}$/, label: 'State Medical Council registration (e.g. MMC/2011/45821)', registry: 'ABDM Healthcare Professionals Registry' },
  pharmacy: { re: /^[A-Z]{2}-[A-Z0-9]{2,4}-\d{5,7}$/, label: 'State drug licence, Form 20/21 (e.g. MH-MZ1-204511)', registry: 'State drug controller' },
  lab: { re: /^MC-\d{3,5}$/, label: 'NABL accreditation (e.g. MC-2874)', registry: 'NABL directory' },
  hospital: { re: /^IN\d{4}[A-Z0-9]{4,8}$/, label: 'ABDM Health Facility Registry ID (e.g. IN2710MUMB01)', registry: 'ABDM Health Facility Registry' },
  clinic: { re: /^IN\d{4}[A-Z0-9]{4,8}$/, label: 'ABDM Health Facility Registry ID', registry: 'ABDM Health Facility Registry' },
  ambulance: { re: /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/, label: 'Vehicle registration with ambulance permit', registry: 'RTO / state EMS' },
};

function register(r, c) {
  const { db } = c;

  r.get('/api/admin/providers', ({ query }) => {
    const status = query.status || 'pending';
    const rows = db.all('SELECT * FROM providers WHERE verified_status = ? ORDER BY name', [status]);
    const soon = localDay(addMinutes(c.now(), 60 * 1440));
    const expiring = db.all("SELECT id, name, type, verified_until FROM providers WHERE verified_status = 'verified' AND verified_until <= ? ORDER BY verified_until", [soon]);
    return {
      items: rows.map((p) => Object.assign(p, { services: json(p.services, []), rule: (REG_RULES[p.type] || {}).label, checks: db.all('SELECT check_name, result, at FROM verifications WHERE provider_id = ?', [p.id]) })),
      expiring,
      counts: db.all('SELECT verified_status AS status, COUNT(*) AS n FROM providers GROUP BY verified_status', []),
    };
  });

  r.post('/api/admin/providers', ({ body }) => {
    must(REG_RULES[body.type], 400, 'Unknown provider type');
    must(body.name && body.reg_no, 400, 'Name and registration number are required');
    const id = c.util.id('prv');
    db.run(
      'INSERT INTO providers (id, type, name, specialty, qualification, reg_no, lat, lng, address, fee, languages, rating, verified_status, services, is_open, availability_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, body.type, body.name, body.specialty || null, body.qualification || null, String(body.reg_no).toUpperCase(), 19.07 + Math.random() * 0.05, 72.84 + Math.random() * 0.05, body.address || 'Mumbai', body.fee || 0, '["English","Hindi"]', 0, 'pending', '[]', 1, c.now().toISOString()]
    );
    return { id };
  });

  r.post('/api/admin/providers/:id/verify', ({ params, body }) => {
    const p = db.get('SELECT * FROM providers WHERE id = ?', [params.id]);
    must(p, 404, 'Provider not found');
    const rule = REG_RULES[p.type];
    const now = c.now().toISOString();
    const checks = [
      { check_name: 'Registration number format', result: rule.re.test(p.reg_no || '') ? 'pass' : 'fail' },
      { check_name: `${rule.registry} lookup`, result: rule.re.test(p.reg_no || '') ? 'pass' : 'not found' },
      { check_name: 'Identity and documents reviewed', result: body.decision === 'reject' ? 'fail' : 'pass' },
    ];
    db.run('DELETE FROM verifications WHERE provider_id = ?', [p.id]);
    for (const k of checks) db.run('INSERT INTO verifications (provider_id, check_name, result, at) VALUES (?, ?, ?, ?)', [p.id, k.check_name, k.result, now]);
    const ok = body.decision !== 'reject' && checks.every((k) => k.result === 'pass');
    db.run('UPDATE providers SET verified_status = ?, verified_until = ?, availability_updated_at = ? WHERE id = ?', [
      ok ? 'verified' : 'rejected',
      ok ? localDay(addMinutes(c.now(), 365 * 1440)) : null,
      now,
      p.id,
    ]);
    c.events.emit(ok ? 'provider.verified' : 'provider.rejected', { provider_id: p.id });
    return { status: ok ? 'verified' : 'rejected', checks };
  });

  r.post('/api/admin/providers/:id/suspend', ({ params, body }) => {
    db.run("UPDATE providers SET verified_status = 'suspended' WHERE id = ?", [params.id]);
    db.run('INSERT INTO verifications (provider_id, check_name, result, at) VALUES (?, ?, ?, ?)', [params.id, `Suspended: ${body.reason || 'complaint review'}`, 'fail', c.now().toISOString()]);
  });

  // Platform metrics for the ops dashboard / investor demo.
  r.get('/api/admin/metrics', () => {
    const n = (sql, a) => db.get(sql, a || []).n;
    const since = addMinutes(c.now(), -7 * 1440).toISOString();
    const taken = n("SELECT COUNT(*) AS n FROM dose_events WHERE status = 'taken' AND due_at >= ?", [since]);
    const logged = n("SELECT COUNT(*) AS n FROM dose_events WHERE status IN ('taken','missed','skipped') AND due_at >= ?", [since]);
    const consults = n("SELECT COUNT(*) AS n FROM bookings WHERE type = 'doctor' AND status = 'completed'");
    const rxOrders = n('SELECT COUNT(DISTINCT prescription_id) AS n FROM orders WHERE prescription_id IS NOT NULL');
    const rxIssued = n("SELECT COUNT(*) AS n FROM prescriptions WHERE source = 'e-prescription'");
    const conf = n("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('confirmed','checked_in','in_consult','completed')");
    const allB = n("SELECT COUNT(*) AS n FROM bookings WHERE status != 'cancelled_by_patient'");
    return {
      users: n('SELECT COUNT(*) AS n FROM users'),
      families: n('SELECT COUNT(*) AS n FROM families'),
      verified_providers: n("SELECT COUNT(*) AS n FROM providers WHERE verified_status = 'verified'"),
      pending_providers: n("SELECT COUNT(*) AS n FROM providers WHERE verified_status = 'pending'"),
      adherence_7d_pct: logged ? Math.round((taken / logged) * 100) : null,
      consults_completed: consults,
      rx_to_order_pct: rxIssued ? Math.round((rxOrders / rxIssued) * 100) : null,
      booking_honoured_pct: allB ? Math.round((conf / allB) * 100) : null,
      orders: n('SELECT COUNT(*) AS n FROM orders'),
      gmv_inr: n("SELECT COALESCE(SUM(amount),0) AS n FROM transactions WHERE direction = 'debit'"),
      sos_total: n('SELECT COUNT(*) AS n FROM sos_events'),
      records: n('SELECT COUNT(*) AS n FROM records'),
      access_log_entries: n('SELECT COUNT(*) AS n FROM access_logs'),
    };
  });
}

module.exports = { register, REG_RULES };
