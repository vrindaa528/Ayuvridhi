'use strict';
// Transactional outbox: modules emit() inside their own work; drain() delivers
// to subscribers afterwards. In production a worker drains the same table.

function createEvents(c) {
  const subs = {};
  let draining = false;

  function on(type, fn) {
    (subs[type] = subs[type] || []).push(fn);
  }

  function emit(type, payload) {
    c.db.run('INSERT INTO outbox (type, payload, created_at) VALUES (?, ?, ?)', [type, JSON.stringify(payload), c.now().toISOString()]);
  }

  function drain() {
    if (draining) return;
    draining = true;
    try {
      for (let guard = 0; guard < 50; guard++) {
        const rows = c.db.all('SELECT * FROM outbox WHERE processed_at IS NULL ORDER BY id LIMIT 100', []);
        if (!rows.length) break;
        for (const row of rows) {
          c.db.run('UPDATE outbox SET processed_at = ? WHERE id = ?', [c.now().toISOString(), row.id]);
          const payload = JSON.parse(row.payload);
          for (const fn of subs[row.type] || []) {
            try {
              fn(payload);
            } catch (e) {
              c.log('error', `subscriber for ${row.type} failed: ${e && e.stack ? e.stack : e}`);
            }
          }
        }
      }
    } finally {
      draining = false;
    }
  }

  return { on, emit, drain };
}

module.exports = { createEvents };
