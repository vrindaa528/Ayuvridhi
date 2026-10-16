'use strict';
// The single choke point for cross-person access. Every clinical read of
// someone else's data goes through require(), which also writes the audit log.

const { HttpError, json } = require('./util');

const CATEGORIES = ['medicines', 'appointments', 'prescriptions', 'reports', 'vitals', 'location', 'payments'];

function createConsent(c) {
  function familyOf(userId) {
    return c.db.get('SELECT f.* FROM families f JOIN family_members m ON m.family_id = f.id WHERE m.user_id = ?', [userId]);
  }

  function memberRow(familyId, userId) {
    return c.db.get('SELECT * FROM family_members WHERE family_id = ? AND user_id = ?', [familyId, userId]);
  }

  // A guardian manages a dependent (a minor, or a senior without a login).
  function isGuardian(actorId, patientId) {
    const fam = familyOf(patientId);
    if (!fam) return false;
    const p = memberRow(fam.id, patientId);
    const a = memberRow(fam.id, actorId);
    return !!(p && a && p.role === 'dependent' && (a.role === 'leader' || a.role === 'caregiver'));
  }

  function activeGrant(actorId, patientId) {
    const now = c.now().toISOString();
    return c.db.get(
      'SELECT * FROM consents WHERE grantor_id = ? AND grantee_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC',
      [patientId, actorId, now]
    );
  }

  function categoriesFor(actorId, patientId) {
    if (actorId === patientId || isGuardian(actorId, patientId)) return CATEGORIES.slice();
    const g = activeGrant(actorId, patientId);
    return g ? json(g.categories, []) : [];
  }

  function can(actorId, patientId, category) {
    return categoriesFor(actorId, patientId).includes(category);
  }

  function log(actorId, patientId, category, purpose) {
    c.db.run('INSERT INTO access_logs (actor_id, patient_id, category, purpose, at) VALUES (?, ?, ?, ?, ?)', [
      actorId,
      patientId,
      category,
      purpose || 'care',
      c.now().toISOString(),
    ]);
  }

  // Resolve which patient a request is about and enforce consent.
  function resolve(user, memberId, category, purpose) {
    const patientId = memberId || user.id;
    if (patientId !== user.id) {
      if (!can(user.id, patientId, category)) {
        throw new HttpError(403, `No consent to view ${category} for this member`, { consent_required: category });
      }
      log(user.id, patientId, category, purpose);
    }
    return patientId;
  }

  // Everyone who should hear about a patient's event in a category.
  function watchers(patientId, category) {
    const fam = familyOf(patientId);
    if (!fam) return [];
    const members = c.db.all('SELECT * FROM family_members WHERE family_id = ? AND user_id != ?', [fam.id, patientId]);
    return members
      .filter((m) => m.role !== 'dependent' && can(m.user_id, patientId, category))
      .map((m) => m.user_id);
  }

  // Short-lived grant for emergencies and consults (e.g. a hospital during SOS).
  function grantTemporary(patientId, granteeId, categories, purpose, minutes) {
    const id = c.util.id('cns');
    const now = c.now();
    c.db.run('INSERT INTO consents (id, grantor_id, grantee_id, categories, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      patientId,
      granteeId,
      JSON.stringify(categories),
      purpose,
      c.util.addMinutes(now, minutes).toISOString(),
      now.toISOString(),
    ]);
    return id;
  }

  return { CATEGORIES, can, resolve, categoriesFor, isGuardian, watchers, log, familyOf, grantTemporary };
}

module.exports = { createConsent, CATEGORIES };
