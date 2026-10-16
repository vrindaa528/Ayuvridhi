/* Module 4: Family Mode — leader dashboard, members, consent, access log. */
'use strict';

const CAT_LABEL = { medicines: 'Medicines', appointments: 'Appointments', prescriptions: 'Prescriptions', reports: 'Reports & records', vitals: 'Vitals', location: 'Location (SOS)', payments: 'Payments' };

route('/family', 'Family', async (el) => {
  const f = await GET('/api/family');
  S.family = f;
  if (!f.family) {
    el.innerHTML = `<div class="card"><h2>Start your family circle</h2><p class="small muted">Add parents, spouse and children. You’ll see medicine alerts and appointments only for members who choose to share them with you.</p>
      <label class="field" for="fn">Family name<input class="input" id="fn" value="${esc(S.me.name.split(' ').pop())} Family"></label><button class="btn primary" id="mk">Create family</button></div>`;
    $('#mk', el).onclick = async (e) => { await act(e.target, () => POST('/api/family', { name: $('#fn', el).value }), 'Family created'); await ensureMe(true); render(); };
    return;
  }
  const lead = f.family.my_role === 'leader' || f.family.my_role === 'caregiver';
  el.innerHTML = `
    <div class="stack tight"><span class="eyebrow">${esc(f.family.name)} · you are ${f.family.my_role === 'leader' ? 'Family Leader' : cap(f.family.my_role)}</span><h1>One family, one view</h1></div>
    <div class="stack" style="gap:12px">${f.members.map((m) => {
      const d = m.doses;
      const shared = m.is_me || m.role === 'dependent' ? null : m.access;
      return `<div class="card">
        <div class="row top"><span class="av lg ${avClass(m.id)}">${initials(m.name)}</span>
          <div class="grow stack tight"><div class="row wrap" style="gap:6px"><strong>${esc(m.name)}${m.is_me ? ' (you)' : ''}</strong><span class="pill ${m.role === 'leader' ? 'brand' : m.role === 'dependent' ? 'sun' : ''}">${m.role === 'dependent' ? 'Dependent' : cap(m.role)}</span></div>
            <span class="small muted">${esc(m.relation)}${m.age !== null ? ' · ' + m.age + ' yrs' : ''}${m.has_login ? '' : ' · managed by guardian'}</span></div>
          ${d && d.total ? ring(d.taken, d.total, d.missed) : ''}</div>
        ${m.active_sos ? `<a class="btn danger sm" href="#/sos">SOS active — open</a>` : ''}
        ${d && d.missed ? `<div class="banner bad">${ic('pill')}<div><strong>${d.missed} missed dose${d.missed > 1 ? 's' : ''} today.</strong> You were alerted as caregiver.</div></div>` : ''}
        ${m.next_appointment ? `<div class="small row"><span class="ico info" style="width:28px;height:28px">${ic('clock')}</span><span class="grow">${esc(m.next_appointment.provider_name)} · ${m.next_appointment.start_at ? dayLabel(m.next_appointment.start_at) + ', ' + tm(m.next_appointment.start_at) : ''}</span></div>` : ''}
        ${m.reminders_due && m.reminders_due.length && (m.access || []).includes('appointments') ? m.reminders_due.map((r) => `<div class="small row"><span class="ico ${r.kind === 'vaccination' ? 'sun' : 'warn'}" style="width:28px;height:28px">${ic(r.kind === 'vaccination' ? 'shield' : 'clock')}</span><span class="grow">${esc(r.title)} · ${dayLabel(r.due_on)}</span></div>`).join('') : ''}
        ${shared ? `<div class="xs muted">${shared.length ? 'Shares with you: ' + shared.map((c) => CAT_LABEL[c] || c).join(', ') : 'Shares nothing with you yet'}</div>` : ''}
        ${!m.is_me ? `<div class="row wrap">
          ${(m.access || []).includes('medicines') ? `<button class="btn sm" data-view="${m.id}">${ic('pill')}Today</button>` : ''}
          ${(m.access || []).includes('reports') ? `<a class="btn sm" href="#/records?member=${m.id}">${ic('records')}Records</a>` : ''}
          ${(m.access || []).includes('appointments') ? `<a class="btn sm" href="#/book?type=doctor" data-for="${m.id}">${ic('doctor')}Book</a>` : ''}
          ${m.role !== 'dependent' ? `<button class="btn sm ghost" data-share="${m.id}" data-name="${esc(m.name)}">${ic('shield')}What I share</button>` : ''}
          ${f.family.my_role === 'leader' && m.role !== 'dependent' && m.role !== 'leader' ? `<button class="btn sm ghost" data-role="${m.id}" data-cur="${m.role}">${m.role === 'caregiver' ? 'Make member' : 'Make caregiver'}</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('')}</div>
    ${lead ? `<button class="btn block" id="add">${ic('plus')}Add family member</button>` : ''}
    <section class="section"><div class="section-head"><h2>Family activity</h2><a href="#/access-log">Access log</a></div>
      <div class="card"><div class="list">${f.activity.map((a) => `<div class="item small"><span class="ico ${a.kind === 'alert' ? 'bad' : a.kind === 'booking' ? 'info' : a.kind === 'record' ? 'sun' : ''}" style="width:30px;height:30px">${ic(a.kind === 'alert' || a.kind === 'dose' ? 'pill' : a.kind === 'booking' ? 'clock' : 'records')}</span><span class="grow">${esc(a.text)}</span><span class="xs muted" style="white-space:nowrap">${ago(a.at)}</span></div>`).join('') || '<div class="empty">Activity from members who share with you appears here.</div>'}</div></div></section>
    <p class="xs muted">Adults decide exactly what they share, and can revoke it any time. Children and seniors without a phone are managed by their guardian until they take over their own account.</p>`;

  on(el, '[data-for]', 'click', (e, b) => { S.bookFor = b.dataset.for; });
  on(el, '[data-view]', 'click', (e, b) => { S.member = b.dataset.view; store.set('member', S.member); go('#/home'); });
  on(el, '[data-share]', 'click', (e, b) => shareSheet(b.dataset.share, b.dataset.name));
  on(el, '[data-role]', 'click', async (e, b) => { await act(b, () => PUT(`/api/family/members/${b.dataset.role}/role`, { role: b.dataset.cur === 'caregiver' ? 'member' : 'caregiver' }), 'Role updated'); render(); });
  const add = $('#add', el);
  if (add) add.onclick = () => sheet(`<h2>Add family member</h2>
    <div class="seg" id="kind"><button class="on" data-k="adult">Adult with phone</button><button data-k="dep">Child / no phone</button></div>
    <label class="field" for="an">Full name<input class="input" id="an" required></label>
    <div class="grid2"><label class="field" for="ar">Relation<select class="input" id="ar"><option>Mother</option><option>Father</option><option>Spouse</option><option>Son</option><option>Daughter</option><option>Grandparent</option><option>Sibling</option><option>Other</option></select></label>
    <label class="field" for="ad">Date of birth<input class="input" id="ad" type="date"></label></div>
    <label class="field" for="ap" id="apw">Mobile number<input class="input num" id="ap" inputmode="numeric" placeholder="10-digit number"></label>
    <p class="xs muted" id="note">They get an SMS invite. Nothing is shared with you until they choose.</p>
    <button class="btn primary" id="go">Add member</button>`, (sh, close) => {
    let kind = 'adult';
    on(sh, '[data-k]', 'click', (e, b) => { kind = b.dataset.k; $$('[data-k]', sh).forEach((x) => x.classList.toggle('on', x === b)); $('#apw', sh).hidden = kind !== 'adult'; $('#note', sh).textContent = kind === 'adult' ? 'They get an SMS invite. Nothing is shared with you until they choose.' : 'You manage their records, reminders and vaccinations as guardian.'; });
    $('#go', sh).onclick = async (e) => {
      const r = await act(e.target, () => POST('/api/family/members', { name: $('#an', sh).value, relation: $('#ar', sh).value, dob: $('#ad', sh).value || undefined, phone: $('#ap', sh).value, dependent: kind === 'dep' }));
      close(); toast(r.note); await ensureMe(true); render();
    };
  });
}, { tab: 'family', root: true });

async function shareSheet(granteeId, name) {
  const c = await GET('/api/consents');
  const cur = (c.given.find((g) => g.grantee_id === granteeId && g.purpose === 'family_care') || { categories: [] }).categories;
  sheet(`<h2>What ${esc(first(name))} can see</h2><p class="small muted">Choose each category. Changes apply immediately and ${esc(first(name))} is notified.</p>
    <div class="list">${c.categories.map((k) => `<label class="item check"><input type="checkbox" value="${k}" ${cur.includes(k) ? 'checked' : ''}><span class="grow">${CAT_LABEL[k] || k}</span></label>`).join('')}</div>
    <button class="btn primary" id="save">Save sharing</button>`, (sh, close) => {
    $('#save', sh).onclick = async (e) => {
      const cats = $$('input[type=checkbox]', sh).filter((x) => x.checked).map((x) => x.value);
      await act(e.target, () => PUT('/api/consents/' + granteeId, { categories: cats }), cats.length ? 'Sharing updated' : 'Sharing stopped');
      close(); render();
    };
  });
}

route('/consents', 'Sharing & consent', async (el) => {
  const c = await GET('/api/consents');
  el.innerHTML = `
    <div class="banner info">${ic('shield')}<div>You decide who sees what. Doctors get time-limited access during a consult; hospitals only during an SOS. Every view is logged.</div></div>
    <section class="section"><h2>You share with</h2>
      <div class="card"><div class="list">${c.given.map((g) => `<div class="item"><span class="av ${avClass(g.grantee_id)}">${initials(g.grantee_name || g.grantee_id)}</span><div class="grow stack tight"><strong>${esc(g.grantee_name || (g.purpose === 'share_link' ? 'Share link' : 'Provider'))}</strong><span class="small muted">${g.categories.map((k) => CAT_LABEL[k] || k.replace('record:', 'one record')).join(', ')}</span><span class="xs muted">${g.purpose === 'family_care' ? 'Family care · until you revoke' : cap(g.purpose) + (g.expires_at ? ' · ends ' + dt(g.expires_at) + ', ' + tm(g.expires_at) : '')}</span></div>${g.purpose === 'family_care' ? `<button class="btn sm" data-share="${g.grantee_id}" data-name="${esc(g.grantee_name)}">Edit</button>` : ''}</div>`).join('') || '<div class="empty">You are not sharing anything.</div>'}</div></div></section>
    <section class="section"><h2>Shared with you</h2>
      <div class="card"><div class="list">${c.received.map((g) => `<div class="item"><span class="av ${avClass(g.grantor_id)}">${initials(g.grantor_name)}</span><div class="grow stack tight"><strong>${esc(g.grantor_name)}</strong><span class="small muted">${g.categories.map((k) => CAT_LABEL[k] || k).join(', ')}</span></div></div>`).join('') || '<div class="empty">Nobody shares with you yet.</div>'}</div></div></section>`;
  on(el, '[data-share]', 'click', (e, b) => shareSheet(b.dataset.share, b.dataset.name));
});

route('/access-log', 'Who saw my data', async (el) => {
  const r = await GET('/api/access-log');
  el.innerHTML = `<p class="small muted">Every time someone other than you opens your health data, it’s recorded here with the reason.</p>
    <div class="card"><div class="list">${r.items.map((a) => `<div class="item small"><span class="av ${avClass(a.actor_id)}" style="width:32px;height:32px;font-size:12px">${initials(a.actor_name)}</span><div class="grow stack tight"><strong>${esc(a.actor_name)}</strong><span class="muted">${esc(CAT_LABEL[a.category] || a.category)} · ${esc(a.purpose)}</span></div><span class="xs muted" style="white-space:nowrap">${ago(a.at)}</span></div>`).join('') || '<div class="empty">No one else has accessed your data.</div>'}</div></div>`;
});
