'use strict';
// Notification adapter. Writes the in-app feed and hands push/SMS to the host
// (console in development; FCM + MSG91 in production).

function createNotify(c) {
  function send(userId, n) {
    const channels = n.channels || ['push'];
    c.db.run(
      'INSERT INTO notifications (user_id, kind, title, body, channels, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, n.kind || 'info', n.title, n.body || '', JSON.stringify(channels), n.link || null, c.now().toISOString()]
    );
    if (c.deps.onNotify) c.deps.onNotify(userId, n, channels);
  }
  return { send };
}

module.exports = { createNotify };
