'use strict';
// family: one Family Leader dashboard, members, roles and per-category consent.

const { must, json, ageFrom, localDay } = require('../util');

function register(r, c) {
  const { db } = c;

  function myFamily(userId) {
    return c.consent.familyOf(userId);
  }

  function myRole(famId, userId) {
    const m = db.get('SELECT role FROM family_members WHERE family_id = ? AND user_id = ?', [famId, userId]);
    return m ? m.role : null;
  }

  function memberStatus(viewerId, m) {
    const cats = c.consent.categoriesFor(viewerId, m.user_id);
    const out = { access: cats };
    if (cats.includes('medicines')) {
      const doses = c.api.dosesForDay(m.user_id, c.now());
      out.doses = {
        total: doses.length,
        taken: doses.filter((d) => d.status === 'taken').length,
        missed: doses.filter((d) => d.status === 'missed').length,
        due: doses.filter((d) => d.status === 'due' || d.status === 'snoozed').length,
      };
    }
    if (cats.includes('appointments')) {
      out.next_appointment = db.get(
        `SELECT b.id, b.status, p.name AS provider_name, s.start_at FROM bookings b
         JOIN providers p ON p.id = b.provider_id LEFT JOIN slots s ON s.id = b.slot_id
         WHERE b.patient_id = ? AND b.status IN ('requested','confirmed') ORDER BY s.start_at LIMIT 1`,
        [m.user_id]
      );
    }
    out.reminders_due = db.all('SELECT title, due_on, kind FROM reminders WHERE patient_id = ? AND done = 0 ORDER BY due_on LIMIT 3', [m.user_id]);
    out.active_sos = !!db.get("SELECT 1 AS x FROM sos_events WHERE patient_id = ? AND status = 'active'", [m.user_id]);
    return out;
  }

  r.get('/api/family', ({ user }) => {
    const fam = myFamily(user.id);
    if (!fam) return { family: null, members: [] };
    const rows = db.all(
      `SELECT m.*, u.name, u.dob, u.sex, u.phone, u.blood_group FROM family_members m JOIN users u ON u.id = m.user_id
       WHERE m.family_id = ? ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'caregiver' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.dob`,
      [fam.id]
    );
    const members = rows.map((m) => {
      const base = {
        id: m.user_id,
        name: m.name,
        relation: m.relation,
        role: m.role,
        age: m.dob ? ageFrom(m.dob, c.now()) : null,
        sex: m.sex,
        is_me: m.user_id === user.id,
        has_login: !!m.phone,
      };
      if (m.user_id === user.id) return Object.assign(base, memberStatus(user.id, m));
      const granted = c.consent.categoriesFor(m.user_id, user.id); // what I share with them
      return Object.assign(base, memberStatus(user.id, m), { i_share: m.role === 'dependent' ? [] : granted });
    });
    return { family: { id: fam.id, name: fam.name, my_role: myRole(fam.id, user.id) }, members, activity: activity(user.id, rows) };
  });

  function activity(viewerId, rows) {
    const items = [];
    for (const m of rows) {
      const cats = c.consent.categoriesFor(viewerId, m.user_id);
      const who = m.user_id === viewerId ? 'You' : m.name.split(' ')[0];
      if (cats.includes('medicines')) {
        for (const d of db.all(
          `SELECT d.*, s.drug FROM dose_events d JOIN schedules s ON s.id = d.schedule_id
           WHERE d.patient_id = ? AND d.status IN ('taken','missed','skipped') ORDER BY COALESCE(d.acted_at, d.due_at) DESC LIMIT 4`,
          [m.user_id]
        )) {
          items.push({
            at: d.acted_at || d.due_at,
            kind: d.status === 'missed' ? 'alert' : 'dose',
            text: d.status === 'missed' ? `${who} missed ${d.drug}` : `${who} ${d.status === 'taken' ? 'took' : 'skipped'} ${d.drug}`,
          });
        }
      }
      if (cats.includes('appointments')) {
        for (const b of db.all(
          'SELECT b.*, p.name AS pn FROM bookings b JOIN providers p ON p.id = b.provider_id WHERE b.patient_id = ? ORDER BY b.created_at DESC LIMIT 2',
          [m.user_id]
        )) {
          items.push({ at: b.updated_at || b.created_at, kind: 'booking', text: `${who}: ${b.service || 'appointment'} with ${b.pn} — ${b.status.replace('_', ' ')}` });
        }
      }
      if (cats.includes('reports')) {
        for (const rec of db.all('SELECT * FROM records WHERE patient_id = ? ORDER BY created_at DESC LIMIT 2', [m.user_id])) {
          items.push({ at: rec.created_at, kind: 'record', text: `${who}: ${rec.title} added to records` });
        }
      }
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 15);
  }

  r.post('/api/family', ({ user, body }) => {
    must(!myFamily(user.id), 400, 'You are already in a family group');
    const id = c.util.id('fam');
    db.run('INSERT INTO families (id, name, leader_id) VALUES (?, ?, ?)', [id, body.name || `${user.name.split(' ').pop()} Family`, user.id]);
    db.run('INSERT INTO family_members (family_id, user_id, role, relation) VALUES (?, ?, ?, ?)', [id, user.id, 'leader', 'Self']);
    return { id };
  });

  r.post('/api/family/members', ({ user, body }) => {
    const fam = myFamily(user.id);
    must(fam, 400, 'Create a family group first');
    must(['leader', 'caregiver'].includes(myRole(fam.id, user.id)), 403, 'Only the Family Leader or a caregiver can add members');
    must(body.name && body.relation, 400, 'Name and relation are required');
    let memberId;
    let role;
    if (body.dependent) {
      memberId = c.util.id('usr');
      db.run('INSERT INTO users (id, phone, name, dob, sex, blood_group, city, lat, lng, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)', [
        memberId,
        body.name,
        body.dob || null,
        body.sex || null,
        body.blood_group || null,
        user.city,
        user.lat,
        user.lng,
        c.now().toISOString(),
      ]);
      db.run('INSERT INTO emergency_cards (patient_id, blood_group, allergies, conditions, medicines, contacts, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        memberId,
        body.blood_group || null,
        '[]',
        '[]',
        '[]',
        JSON.stringify([{ name: user.name, phone: user.phone, relation: 'Guardian' }]),
        c.now().toISOString(),
      ]);
      role = 'dependent';
    } else {
      const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
      must(phone.length === 10, 400, 'Adults are invited by mobile number');
      let u = db.get('SELECT * FROM users WHERE phone = ?', [phone]);
      if (!u) {
        memberId = c.util.id('usr');
        db.run('INSERT INTO users (id, phone, name, dob, sex, city, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          memberId,
          phone,
          body.name,
          body.dob || null,
          body.sex || null,
          user.city,
          user.lat,
          user.lng,
          c.now().toISOString(),
        ]);
        db.run('INSERT INTO emergency_cards (patient_id, allergies, conditions, medicines, contacts, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
          memberId,
          '[]',
          '[]',
          '[]',
          '[]',
          c.now().toISOString(),
        ]);
      } else {
        must(!c.consent.familyOf(u.id), 400, 'This person is already in a family group');
        memberId = u.id;
      }
      role = 'member';
      c.log('sms', `Invite sent to ${phone}: ${user.name} invited you to their Aayuvridhi family.`);
    }
    db.run('INSERT INTO family_members (family_id, user_id, role, relation) VALUES (?, ?, ?, ?)', [fam.id, memberId, role, body.relation]);
    c.events.emit('member.added', { family_id: fam.id, user_id: memberId, by: user.id });
    return {
      id: memberId,
      role,
      note: role === 'dependent' ? 'Managed by you as guardian' : 'Invite sent. They choose what to share with you — nothing is shared by default.',
    };
  });

  r.put('/api/family/members/:id/role', ({ user, params, body }) => {
    const fam = myFamily(user.id);
    must(fam && myRole(fam.id, user.id) === 'leader', 403, 'Only the Family Leader can change roles');
    must(['caregiver', 'member'].includes(body.role), 400, 'Role must be caregiver or member');
    const m = db.get('SELECT * FROM family_members WHERE family_id = ? AND user_id = ?', [fam.id, params.id]);
    must(m && m.role !== 'dependent' && m.role !== 'leader', 400, 'That member’s role cannot be changed');
    db.run('UPDATE family_members SET role = ? WHERE family_id = ? AND user_id = ?', [body.role, fam.id, params.id]);
  });

  // Consents I have given and received.
  r.get('/api/consents', ({ user }) => {
    const now = c.now().toISOString();
    const given = db.all(
      `SELECT k.*, u.name AS grantee_name FROM consents k LEFT JOIN users u ON u.id = k.grantee_id
       WHERE k.grantor_id = ? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?) ORDER BY k.created_at DESC`,
      [user.id, now]
    );
    const received = db.all(
      `SELECT k.*, u.name AS grantor_name FROM consents k JOIN users u ON u.id = k.grantor_id
       WHERE k.grantee_id = ? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?)`,
      [user.id, now]
    );
    const fix = (k) => Object.assign(k, { categories: json(k.categories, []) });
    return { categories: c.consent.CATEGORIES, given: given.map(fix), received: received.map(fix) };
  });

  // Set exactly which categories I share with a family member (empty = revoke).
  r.put('/api/consents/:granteeId', ({ user, params, body }) => {
    const cats = (body.categories || []).filter((x) => c.consent.CATEGORIES.includes(x));
    const now = c.now().toISOString();
    const prev = db.get(
      "SELECT * FROM consents WHERE grantor_id = ? AND grantee_id = ? AND purpose = 'family_care' AND revoked_at IS NULL",
      [user.id, params.granteeId]
    );
    if (prev) db.run('UPDATE consents SET revoked_at = ? WHERE id = ?', [now, prev.id]);
    if (cats.length) {
      db.run('INSERT INTO consents (id, grantor_id, grantee_id, categories, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        c.util.id('cns'),
        user.id,
        params.granteeId,
        JSON.stringify(cats),
        'family_care',
        now,
      ]);
    }
    c.events.emit(cats.length ? 'consent.granted' : 'consent.revoked', { grantor: user.id, grantee: params.granteeId, categories: cats });
    c.notify.send(params.granteeId, {
      kind: 'consent',
      title: cats.length ? `${user.name.split(' ')[0]} updated what they share with you` : `${user.name.split(' ')[0]} stopped sharing health data with you`,
      body: cats.length ? `Now sharing: ${cats.join(', ')}` : 'Access removed immediately.',
    });
    return { categories: cats };
  });

  r.get('/api/access-log', ({ user, query }) => {
    const patientId = query.member && c.consent.isGuardian(user.id, query.member) ? query.member : user.id;
    const rows = db.all(
      `SELECT a.*, COALESCE(u.name, p.name, a.actor_id) AS actor_name FROM access_logs a
       LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN providers p ON p.id = a.actor_id
       WHERE a.patient_id = ? ORDER BY a.id DESC LIMIT 50`,
      [patientId]
    );
    return { items: rows };
  });
}

function api(c) {
  return {
    // Missed doses today and due vaccinations for everyone the user watches.
    familyAlerts(userId) {
      const fam = c.consent.familyOf(userId);
      if (!fam) return [];
      const out = [];
      const members = c.db.all(
        'SELECT m.user_id, m.role, u.name FROM family_members m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? AND m.user_id != ?',
        [fam.id, userId]
      );
      const today = localDay(c.now());
      for (const m of members) {
        if (c.consent.can(userId, m.user_id, 'medicines')) {
          for (const d of c.api.dosesForDay(m.user_id, c.now())) {
            if (d.status === 'missed') {
              out.push({ kind: 'missed_dose', member_id: m.user_id, member: m.name, text: `${m.name.split(' ')[0]} missed ${d.drug} (${d.time_label})`, dose_id: d.id });
            }
          }
        }
        if (c.consent.can(userId, m.user_id, 'appointments')) {
          for (const rem of c.db.all("SELECT * FROM reminders WHERE patient_id = ? AND done = 0 AND due_on <= date(?, '+14 day')", [m.user_id, today])) {
            out.push({ kind: rem.kind, member_id: m.user_id, member: m.name, text: `${m.name.split(' ')[0]}: ${rem.title}`, due_on: rem.due_on, action: rem.action });
          }
        }
        const sos = c.db.get("SELECT id FROM sos_events WHERE patient_id = ? AND status = 'active'", [m.user_id]);
        if (sos && c.consent.can(userId, m.user_id, 'location')) {
          out.unshift({ kind: 'sos', member_id: m.user_id, member: m.name, sos_id: sos.id, text: `SOS active for ${m.name}` });
        }
      }
      return out;
    },
  };
}

module.exports = { register, api };
