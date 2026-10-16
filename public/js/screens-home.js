/* Login, Home (Module 1 on the dashboard), notifications, profile. */
'use strict';

route('/login', 'Log in', async (el) => {
  let phone = '', step = 'phone', isNew = false, demoCode = '', channel = 'demo', sentAt = 0, resendTimer = null;
  const draw = () => {
    el.innerHTML = `
    <div class="login">
      <div class="mark">${LOGO}</div>
      <div class="stack">
        <h1>Aayuvridhi</h1>
        <p class="muted">One patient. One connected healthcare journey — medicines, doctors, labs, family and emergencies in one place.</p>
      </div>
      <form class="card" id="f" novalidate>
        ${step === 'phone' ? `
          <label class="field" for="phone">Mobile number
            <div class="row"><span class="pill" style="height:44px;border-radius:11px">+91</span><input class="input num" id="phone" inputmode="numeric" autocomplete="tel" maxlength="11" placeholder="98765 00001" value="${esc(phone)}"></div>
          </label>
          <button class="btn primary block" type="submit">Send OTP</button>`
        : `
          <p class="small">OTP sent to <strong class="num">+91 ${esc(phone)}</strong> · <button type="button" class="linkbtn" id="change">Change</button></p>
          <label class="field" for="code">6-digit OTP<input class="input num mono" id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••"></label>
          ${demoCode ? `<p class="xs muted">Demo number: use <span class="mono">${demoCode}</span></p>` : channel === 'sms' ? '<p class="xs muted">Sent by SMS. It can take up to a minute to arrive.</p>' : '<p class="xs muted">No SMS provider is connected, so the code is printed in the server console.</p>'}
          <button type="button" class="linkbtn" id="resend" disabled style="align-self:flex-start"></button>
          ${isNew ? `<label class="field" for="name">Your full name<input class="input" id="name" autocomplete="name" placeholder="As on your ABHA / Aadhaar"></label>` : ''}
          <button class="btn primary block" type="submit">${isNew ? 'Create account' : 'Verify & continue'}</button>`}
      </form>
      <div class="stack">
        <p class="eyebrow">Try the demo family</p>
        <div class="list card">
          <button class="item linkbtn" data-demo="9876500001" style="text-align:left;color:inherit"><span class="av c1">RK</span><span class="grow"><strong>Rajesh Kumar</strong><br><span class="small muted">Family Leader · manages parents and son</span></span>${ic('chev')}</button>
          <button class="item linkbtn" data-demo="9876500003" style="text-align:left;color:inherit"><span class="av c2">KD</span><span class="grow"><strong>Kamla Devi</strong><br><span class="small muted">68, diabetic, on 3 medicines</span></span>${ic('chev')}</button>
        </div>
      </div>
      <p class="xs muted">By continuing you agree to share only what you choose. Your health data stays in India and every access is logged.</p>
    </div>`;
    const f = $('#f', el);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]');
      if (step === 'phone') {
        phone = $('#phone', el).value.replace(/\D/g, '').slice(-10);
        const r = await act(btn, () => POST('/api/auth/otp/request', { phone }));
        isNew = r.is_new_user; demoCode = r.demo_code || ''; channel = r.channel; sentAt = Date.now(); step = 'otp'; draw();
        $('#code', el).focus();
      } else {
        const r = await act(btn, () => POST('/api/auth/otp/verify', { phone, code: $('#code', el).value, name: isNew ? $('#name', el).value : undefined }));
        S.token = r.token; store.set('token', r.token); S.me = null; go('#/home');
      }
    });
    clearInterval(resendTimer);
    const rs = $('#resend', el);
    if (rs) {
      const upd = () => { const left = Math.ceil(30 - (Date.now() - sentAt) / 1000); rs.disabled = left > 0; rs.textContent = left > 0 ? `Resend OTP in ${left}s` : 'Resend OTP'; if (left <= 0) clearInterval(resendTimer); };
      upd(); resendTimer = setInterval(upd, 1000);
      rs.onclick = async () => { const r = await act(rs, () => POST('/api/auth/otp/request', { phone }), 'OTP sent again'); channel = r.channel; sentAt = Date.now(); upd(); clearInterval(resendTimer); resendTimer = setInterval(upd, 1000); };
    }
    const ch = $('#change', el);
    if (ch) ch.onclick = () => { step = 'phone'; draw(); };
    on(el, '[data-demo]', 'click', async (e, b) => {
      phone = b.dataset.demo;
      await act(b, () => POST('/api/auth/otp/request', { phone }));
      const r = await act(b, () => POST('/api/auth/otp/verify', { phone, code: '123456' }));
      S.token = r.token; store.set('token', r.token); S.me = null; go('#/home');
    });
  };
  draw();
}, { bare: true });

function doseRow(d, memberId) {
  const canAct = ['due', 'snoozed', 'missed', 'upcoming'].includes(d.status);
  return `<div class="dose ${d.status}">
    <span class="bar"></span>
    <div class="stack tight" style="min-width:0">
      <div class="drug ellipsis">${esc(d.drug)}</div>
      <div class="small muted">${esc(d.dose)}${d.instructions ? ' · ' + esc(d.instructions) : ''}${d.camera_verified ? ' · camera-logged' : ''}</div>
      ${d.status === 'missed' && d.escalated ? '<div class="xs" style="color:var(--danger)">Caregiver alerted</div>' : ''}
      ${d.status === 'snoozed' && d.snooze_until ? `<div class="xs muted">Reminds again at ${tm(d.snooze_until)}</div>` : ''}
      ${canAct ? `<div class="acts">
        <button class="btn sm primary" data-dose="${d.id}" data-a="taken">${ic('check')}${d.status === 'missed' ? 'Took it late' : 'Taken'}</button>
        <label class="btn sm" title="Photograph the strip to help log it">${ic('camera')}<span>Scan pack</span><input type="file" accept="image/*" capture="environment" hidden data-scan="${d.id}"></label>
        ${['due', 'snoozed'].includes(d.status) ? `<button class="btn sm ghost" data-dose="${d.id}" data-a="snooze">Snooze 10m</button>` : ''}
        <button class="btn sm ghost" data-dose="${d.id}" data-a="skip">Skip</button>
      </div>` : ''}
    </div>
    <div class="stack tight" style="align-items:flex-end;text-align:right">
      <span class="when">${tm(d.due_at)}</span>${statusPill[d.status] || ''}
    </div>
  </div>`;
}

function bindDoseActions(el, refresh) {
  on(el, '[data-dose]', 'click', async (e, b) => {
    const a = b.dataset.a;
    let reason;
    if (a === 'skip') reason = 'Skipped from app';
    await act(b, () => POST(`/api/reminders/doses/${b.dataset.dose}`, { action: a, minutes: 10, reason }), a === 'taken' ? 'Dose logged' : a === 'snooze' ? 'Snoozed for 10 minutes' : 'Dose skipped');
    refresh();
  });
  on(el, '[data-scan]', 'change', async (e, inp) => {
    if (!inp.files || !inp.files[0]) return;
    toast('Pack photographed — logging dose');
    await act(null, () => POST(`/api/reminders/doses/${inp.dataset.scan}`, { action: 'taken', camera_verified: true }), 'Dose logged with photo');
    refresh();
  });
}

route('/home', 'Home', async (el) => {
  const memberId = S.member && viewableMembers('medicines').some((m) => m.id === S.member) ? S.member : S.me.id;
  const d = await GET(`/api/dashboard${memberId !== S.me.id ? '?member=' + memberId : ''}`);
  const isMe = memberId === S.me.id;
  const urgent = d.alerts.filter((a) => a.kind === 'missed_dose' || a.kind === 'sos');
  const todos = d.alerts.filter((a) => a.kind !== 'missed_dose' && a.kind !== 'sos').sort((a, b) => (a.due_on || '').localeCompare(b.due_on || '')).slice(0, 6);
  const taken = d.doses.filter((x) => x.status === 'taken').length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  el.innerHTML = `
    <div class="hello">
      <span class="eyebrow">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <h1>${greet}, ${esc(first(S.me.name))}</h1>
    </div>
    ${memberChips('medicines', memberId)}
    ${d.active_sos ? `<a class="card alert" href="#/sos/${d.active_sos}" style="text-decoration:none;color:inherit"><strong class="blink" style="color:var(--danger)">SOS ACTIVE</strong><span class="small">Tap to see live status</span></a>` : ''}
    ${isMe && urgent.length ? `<section class="section" aria-label="Family alerts">
      ${urgent.map((a) => `<div class="card alert">
        <div class="row top"><span class="ico bad">${ic(a.kind === 'sos' ? 'alert' : 'pill')}</span>
        <div class="grow stack tight"><strong>${esc(a.text)}</strong>
          ${a.kind === 'missed_dose' ? `<span class="small muted">Escalated to you as caregiver. Give ${esc(first(a.member))} a call to check in.</span>` : ''}</div></div>
        ${a.kind === 'missed_dose' ? `<div class="row wrap"><button class="btn sm" data-member-go="${a.member_id}">View ${esc(first(a.member))}'s doses</button><button class="btn sm primary" data-dose="${a.dose_id}" data-a="taken">Log as taken</button></div>` : ''}
        ${a.kind === 'sos' ? `<a class="btn sm danger" href="#/sos/${a.sos_id}">Open live SOS</a>` : ''}
      </div>`).join('')}
    </section>` : ''}

    <section class="card" aria-label="Today's medicines">
      <div class="section-head"><h2>${isMe ? "Today's medicines" : esc(first(d.member.name)) + "'s medicines"}</h2><a href="#/schedules${isMe ? '' : '?member=' + memberId}">All</a></div>
      ${d.doses.length ? `
        <div class="row between small"><span class="muted">${taken} of ${d.doses.length} taken</span><span class="muted">${d.doses.filter((x) => x.status === 'missed').length ? '<span style="color:var(--danger)">' + d.doses.filter((x) => x.status === 'missed').length + ' missed</span>' : ''}</span></div>
        <div class="progress"><i style="width:${(taken / d.doses.length) * 100}%"></i></div>
        <div>${d.doses.map((x) => doseRow(x, memberId)).join('')}</div>
        <p class="xs muted">Pack scanning helps you log the right strip. Dosage decisions stay with your doctor.</p>`
      : `<div class="empty">No medicines scheduled today.<br><a href="#/rx">Prescriptions</a> from a consult set reminders automatically.</div>`}
    </section>

    ${isMe ? `<section class="quick" aria-label="Quick actions">
      <a href="#/book?type=doctor"><span class="ico">${ic('doctor')}</span>Consult a doctor</a>
      <a href="#/book?type=lab"><span class="ico info">${ic('lab')}</span>Book a lab test</a>
      <a href="#/rx"><span class="ico">${ic('pill')}</span>Order medicines</a>
      <a href="#/book?type=hospital,clinic"><span class="ico info">${ic('hospital')}</span>Hospitals & clinics</a>
      <a href="#/nuskhe"><span class="ico sun">${ic('leaf')}</span>Dadi Ke Nuskhe</a>
      <a href="#/wellness"><span class="ico">${ic('sun')}</span>Daily wellness</a>
    </section>` : ''}

    ${d.orders.length ? `<section class="section"><div class="section-head"><h2>Medicine orders</h2></div>
      ${d.orders.map((o) => `<a class="card" href="#/order/${o.id}" style="text-decoration:none;color:inherit"><div class="row"><span class="ico">${ic('truck')}</span><div class="grow stack tight"><strong class="ellipsis">${esc(o.pharmacy_name)}</strong><span class="small muted">${o.eta_at && o.status === 'dispatched' ? 'Arriving ' + tm(o.eta_at) : inr(o.total)}</span></div>${orderPill(o.status)}</div></a>`).join('')}
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Upcoming care</h2><a href="#/bookings${isMe ? '' : '?member=' + memberId}">Bookings</a></div>
      ${d.upcoming.length || d.reminders.length ? `<div class="card"><div class="list">
        ${d.upcoming.map((b) => `<a class="item" href="#/booking/${b.id}"><span class="ico ${b.provider_type === 'lab' ? 'info' : ''}">${ic(b.provider_type === 'lab' ? 'lab' : 'doctor')}</span><div class="grow stack tight"><strong class="ellipsis">${esc(b.service)}</strong><span class="small muted ellipsis">${esc(b.provider_name)} · ${b.start_at ? dayLabel(b.start_at) + ', ' + tm(b.start_at) : ''}</span></div>${bookingPill(b.status)}</a>`).join('')}
        ${d.reminders.map((r) => `<a class="item" href="${esc(r.action || '#/home')}"><span class="ico ${r.kind === 'refill' ? 'warn' : r.kind === 'vaccination' ? 'sun' : 'info'}">${ic(r.kind === 'refill' ? 'pill' : r.kind === 'vaccination' ? 'shield' : 'clock')}</span><div class="grow stack tight"><strong class="ellipsis">${esc(r.title)}</strong><span class="small muted">${dayLabel(r.due_on)}</span></div>${ic('chev')}</a>`).join('')}
      </div></div>` : '<div class="card"><div class="empty">Nothing scheduled. Your follow-ups and check-ups will appear here.</div></div>'}
    </section>

    ${isMe && todos.length ? `<section class="section"><div class="section-head"><h2>Family to-dos</h2><a href="#/family">Family</a></div>
      <div class="card"><div class="list">${todos.map((a) => `<a class="item" href="${esc(a.action || '#/family')}"><span class="av ${avClass(a.member_id)}" style="width:32px;height:32px;font-size:12px">${initials(a.member)}</span><div class="grow stack tight"><strong class="small">${esc(a.text.replace(/^[^:]+:\s*/, ''))}</strong><span class="xs muted">${esc(first(a.member))} · ${a.due_on ? dayLabel(a.due_on) : ''}</span></div>${a.kind === 'vaccination' ? '<span class="pill sun">Vaccine</span>' : a.kind === 'refill' ? '<span class="pill warn">Refill</span>' : ''}</a>`).join('')}</div></div>
    </section>` : ''}

    ${isMe && d.routines.length ? `<section class="section"><div class="section-head"><h2>Daily wellness</h2><a href="#/wellness">Open</a></div>
      <div class="grid2">${d.routines.slice(0, 4).map((r) => `<div class="card flat" style="gap:6px"><div class="row"><span class="ico ${r.complete ? '' : 'info'}" style="width:30px;height:30px">${ic(r.icon)}</span><strong class="small grow">${esc(r.title)}</strong></div><span class="small muted num">${r.done}/${r.target} ${esc(r.unit)}${r.streak ? ' · ' + r.streak + '-day streak' : ''}</span></div>`).join('')}</div>
    </section>` : ''}`;

  on(el, '[data-member]', 'click', (e, b) => { S.member = b.dataset.member; store.set('member', S.member); render(); });
  on(el, '[data-member-go]', 'click', (e, b) => { S.member = b.dataset.memberGo; render(); });
  bindDoseActions(el, () => render());
  poll(async () => { try { const m = await GET('/api/me'); if (m.unread !== S.unread) { S.unread = m.unread; setTop(routes.find((r) => r.title === 'Home'), {}); } } catch (e) { /* offline */ } }, 15000);
}, { tab: 'home', root: true });

route('/notifications', 'Notifications', async (el) => {
  const r = await GET('/api/notifications');
  el.innerHTML = r.items.length ? `<div class="card"><div class="list">${r.items.map((n) => `
    <a class="item" href="${esc(n.link || '#/home')}" style="${n.is_read ? '' : 'font-weight:500'}">
      <span class="ico ${['missed_dose', 'sos'].includes(n.kind) ? 'bad' : n.kind === 'refill' ? 'warn' : n.kind === 'rx' ? '' : 'info'}">${ic({ missed_dose: 'pill', dose: 'pill', sos: 'alert', booking: 'clock', order: 'truck', rx: 'records', refill: 'pill', record: 'lab', consent: 'shield' }[n.kind] || 'bell')}</span>
      <div class="grow stack tight"><strong>${esc(n.title)}</strong><span class="small muted">${esc(n.body)}</span>
      <span class="xs muted">${ago(n.created_at)} · ${n.channels.map((c) => c === 'sms' ? 'SMS' : c === 'call' ? 'Auto-call' : 'Push').join(' + ')}</span></div>
    </a>`).join('')}</div></div>` : '<div class="card"><div class="empty">No notifications yet.</div></div>';
  await POST('/api/notifications/read');
  S.unread = 0;
});

route('/profile', 'Profile', async (el) => {
  const me = S.me;
  const card = await GET('/api/emergency-card');
  el.innerHTML = `
    <div class="card"><div class="row"><span class="av lg ${avClass(me.id)}">${initials(me.name)}</span><div class="grow stack tight"><h2>${esc(me.name)}</h2><span class="small muted num">+91 ${esc(me.phone)}${me.age ? ' · ' + me.age + ' yrs' : ''}${me.blood_group ? ' · ' + esc(me.blood_group) : ''}</span></div></div>
      <dl class="kv"><dt>ABHA ID</dt><dd class="mono">${esc(me.abha_id || 'Not linked')}</dd><dt>Family</dt><dd>${esc(S.familyInfo ? `${S.familyInfo.name} · ${cap(S.familyInfo.role)}` : 'Not in a family group')}</dd><dt>City</dt><dd>${esc(me.city || '')}</dd></dl>
      <label class="field" for="lang">App language<select class="input" id="lang"><option value="en" ${me.language === 'en' ? 'selected' : ''}>English</option><option value="hi" ${me.language === 'hi' ? 'selected' : ''}>हिन्दी (Hindi)</option><option value="mr" ${me.language === 'mr' ? 'selected' : ''}>मराठी (Marathi)</option></select></label>
    </div>
    <div class="card"><div class="list">
      <a class="item" href="#/emergency-card"><span class="ico bad">${ic('card')}</span><div class="grow stack tight"><strong>Emergency Card</strong><span class="small muted">${esc(card.blood_group || '—')} · ${card.allergies.length} allergies · ${card.contacts.length} contacts</span></div>${ic('chev')}</a>
      <a class="item" href="#/schedules"><span class="ico">${ic('pill')}</span><strong class="grow">Medicine schedules</strong>${ic('chev')}</a>
      <a class="item" href="#/rx"><span class="ico">${ic('records')}</span><strong class="grow">Prescriptions</strong>${ic('chev')}</a>
      <a class="item" href="#/bookings"><span class="ico info">${ic('clock')}</span><strong class="grow">Bookings</strong>${ic('chev')}</a>
      <a class="item" href="#/consents"><span class="ico">${ic('shield')}</span><div class="grow stack tight"><strong>Sharing & consent</strong><span class="small muted">What your family can see</span></div>${ic('chev')}</a>
      <a class="item" href="#/access-log"><span class="ico info">${ic('eye')}</span><div class="grow stack tight"><strong>Who saw my data</strong><span class="small muted">Every access is logged</span></div>${ic('chev')}</a>
      <a class="item" href="#/store"><span class="ico">${ic('cart')}</span><strong class="grow">Medical store</strong>${ic('chev')}</a>
    </div></div>
    <div class="stack"><p class="eyebrow">Behind the scenes (demo)</p>
    <div class="card"><div class="list">
      <a class="item" href="#/console"><span class="ico info">${ic('console')}</span><div class="grow stack tight"><strong>Partner console</strong><span class="small muted">Act as clinic, doctor, lab, pharmacy, delivery</span></div>${ic('chev')}</a>
      <a class="item" href="#/ops"><span class="ico">${ic('chart')}</span><div class="grow stack tight"><strong>Trust & operations</strong><span class="small muted">Provider verification, platform metrics</span></div>${ic('chev')}</a>
      <button class="item linkbtn" id="theme" style="color:inherit;text-align:left"><span class="ico">${ic('moon')}</span><strong class="grow">Theme: <span id="themeName"></span></strong></button>
      <button class="item linkbtn" id="reset" style="color:inherit;text-align:left"><span class="ico warn">${ic('refresh')}</span><div class="grow stack tight"><strong>Reset demo data</strong><span class="small muted">Restore the Kumar family</span></div></button>
    </div></div></div>
    <button class="btn block" id="logout">${ic('logout')}Log out</button>`;
  $('#lang', el).onchange = async (e) => { await act(null, () => PUT('/api/me', { language: e.target.value }), 'Language saved'); S.me.language = e.target.value; };
  $('#logout', el).onclick = logout;
  const themes = ['system', 'light', 'dark'];
  const showTheme = () => ($('#themeName', el).textContent = cap(store.get('theme', 'system')));
  showTheme();
  $('#theme', el).onclick = () => { const t = themes[(themes.indexOf(store.get('theme', 'system')) + 1) % 3]; store.set('theme', t); applyTheme(); showTheme(); };
  $('#reset', el).onclick = (e) => {
    sheet(`<h2>Reset demo data?</h2><p class="small muted">All bookings, orders and changes you made are cleared and the Kumar family is restored.</p><div class="row"><button class="btn grow" data-close>Keep my changes</button><button class="btn danger grow" id="doReset">Reset</button></div>`, (sh, close) => {
      $('#doReset', sh).onclick = async (ev) => { await act(ev.target, () => (window.AY_RESET ? window.AY_RESET() : POST('/api/demo/reset'))); close(); S.me = null; S.member = null; toast('Demo data restored'); logout(); };
    });
  };
});

function applyTheme() {
  const t = store.get('theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
applyTheme();
