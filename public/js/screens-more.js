/* Module 7 (SOS), Module 8 (Dadi Ke Nuskhe), wellness, partner + ops consoles. */
'use strict';

route('/sos', 'Emergency SOS', async (el) => {
  const active = await GET('/api/sos/active');
  if (active.items.length === 1) return go('#/sos/' + active.items[0].id);
  const members = viewableMembers('location');
  el.innerHTML = `
    ${active.items.map((s) => `<a class="card alert" href="#/sos/${s.id}" style="text-decoration:none;color:inherit"><strong class="blink" style="color:var(--danger)">SOS ACTIVE · ${esc(s.patient.name)}</strong><span class="small">Started ${tm(s.started_at)} · tap for live status</span></a>`).join('')}
    <div class="sos-hero">
      <p class="small muted" style="max-width:300px">Hold the button for 3 seconds. Your family, the nearest ER and an ambulance are alerted with your live location and Emergency Card.</p>
      <button class="sos-ring" id="hold" aria-label="Hold for 3 seconds to send SOS">
        <svg class="prog" viewBox="0 0 210 210"><circle cx="105" cy="105" r="98" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 616" id="arc"/></svg>
        <span>SOS<small id="holdtxt">Hold 3 seconds</small></span></button>
      ${members.length > 1 ? `<label class="field" for="who" style="width:100%;text-align:left">This emergency is for${memberSelect('location', 'who', S.me.id)}</label>` : ''}
    </div>
    <div class="card"><strong>Call emergency services directly</strong>
      <div class="helpline"><a class="btn danger" href="tel:112">${ic('phone')}112 · Emergency</a><a class="btn" href="tel:108">${ic('phone')}108 · Ambulance</a></div>
      <p class="xs muted">If the call button doesn’t open your dialler, dial <strong class="mono">112</strong> or <strong class="mono">108</strong> yourself. Aayuvridhi supports these services — it does not replace them.</p></div>`;
  const btn = $('#hold', el), arc = $('#arc', el), txt = $('#holdtxt', el);
  let t0 = 0, raf = 0, fired = false;
  const reset = () => { cancelAnimationFrame(raf); t0 = 0; arc.setAttribute('stroke-dasharray', '0 616'); if (!fired) txt.textContent = 'Hold 3 seconds'; };
  const tickHold = () => {
    const p = Math.min(1, (performance.now() - t0) / 3000);
    arc.setAttribute('stroke-dasharray', `${616 * p} 616`);
    txt.textContent = p < 1 ? `Sending in ${Math.ceil(3 - p * 3)}…` : 'Sending…';
    if (p >= 1 && !fired) { fired = true; trigger(); return; }
    raf = requestAnimationFrame(tickHold);
  };
  const start = (e) => { e.preventDefault(); if (fired) return; t0 = performance.now(); raf = requestAnimationFrame(tickHold); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', reset);
  btn.addEventListener('pointerleave', reset);
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !t0) start(e); });
  btn.addEventListener('keyup', reset);
  async function trigger() {
    let lat, lng;
    try {
      const pos = await new Promise((res, rej) => { if (!navigator.geolocation) return rej(); navigator.geolocation.getCurrentPosition(res, rej, { timeout: 2500, maximumAge: 60000 }); });
      lat = pos.coords.latitude; lng = pos.coords.longitude;
    } catch (e) { /* fall back to home address on the server */ }
    const who = $('#who', el);
    try {
      const s = await POST('/api/sos', { member_id: who ? who.value : undefined, lat, lng, source: 'hold button' });
      go('#/sos/' + s.id);
    } catch (e) { fired = false; reset(); toast(e.message + ' — call 112 now', true); }
  }
});

const SOS_LABEL = { triggered: 'SOS raised', location_shared: 'Live location shared', contacts_notified: 'Family & contacts notified', hospital_notified: 'Hospital ER notified', ambulance_assigned: 'Ambulance assigned', ambulance_fallback: 'Ambulance', emergency_card_shared: 'Emergency Card shared with responders', doctor_joined: 'Emergency doctor joined', ambulance_arrived: 'Ambulance arrived', closed: 'SOS closed' };

route('/sos/:id', 'SOS', async (el, { id }) => {
  async function draw() {
    const s = await GET('/api/sos/' + id);
    const live = s.status === 'active';
    const card = s.emergency_card;
    el.innerHTML = `
      <div class="sos-live" style="${live ? '' : 'border-color:var(--line);background:var(--surface)'}">
        <div class="head"><span class="${live ? 'blink' : ''}">${live ? 'SOS ACTIVE' : 'SOS CLOSED'}</span><span class="pill ${live ? 'bad' : ''}">${live ? 'Priority 1 dispatch' : 'Closed ' + tm(s.closed_at)}</span></div>
        <div class="row"><span class="av ${avClass(s.patient.id)}">${initials(s.patient.name)}</span><div class="grow stack tight"><strong>${esc(s.patient.name)}${s.is_me ? ' (you)' : ''}</strong><span class="small mono">${s.location.lat.toFixed(4)}, ${s.location.lng.toFixed(4)}</span></div><a class="btn sm" href="https://maps.google.com/?q=${s.location.lat},${s.location.lng}" target="_blank" rel="noopener">${ic('pin')}Map</a></div>
        ${s.ambulance && live ? `<div class="fact" style="background:var(--surface)"><div class="k">Ambulance</div><div class="v">${s.ambulance.arrived ? 'Arrived — ' + esc(s.ambulance.unit) : `${esc(s.ambulance.unit)} · ETA ${s.ambulance.eta_min_left} min`}</div></div>` : ''}
        ${s.hospital ? `<div class="fact" style="background:var(--surface)"><div class="k">Receiving hospital</div><div class="v">${esc(s.hospital.name)}</div><div class="xs muted">${esc(s.hospital.address)}</div></div>` : ''}
        <div class="steps">${s.steps.map((st) => `<div class="step done"><span class="dotc">${ic('check')}</span><div class="stack tight"><strong class="small">${esc(SOS_LABEL[st.step] || cap(st.step))}</strong><span class="xs muted">${tm(st.at)} · ${esc(st.detail)}</span></div></div>`).join('')}</div>
        <div class="banner bad" style="background:var(--surface)">${ic('card')}<div class="small"><strong>Emergency Card shared:</strong> Blood group ${esc(card.blood_group || '—')} · ${esc(card.conditions.join(', ') || 'no conditions')} · Allergies: ${esc(card.allergies.join(', ') || 'none')}</div></div>
      </div>
      ${live ? `
        <div class="helpline"><a class="btn danger" href="tel:112">${ic('phone')}Call 112</a><a class="btn" href="tel:108">${ic('phone')}Call 108</a></div>
        <button class="btn block" id="doc">${ic('video')}Get an emergency doctor on video</button>
        <div class="row"><button class="btn grow" id="false">False alarm</button><button class="btn primary grow" id="safe">${ic('check')}We’re safe — close SOS</button></div>
        <p class="xs muted">Location updates every 10 seconds while SOS is active. Hospital access to the Emergency Card ends automatically when SOS closes.</p>` : `<a class="btn block" href="#/home">Back to home</a>`}`;
    const d = $('#doc', el); if (d) d.onclick = async (e) => { await act(e.target, () => POST(`/api/sos/${id}/doctor`), 'Doctor joining'); draw(); };
    const sf = $('#safe', el); if (sf) sf.onclick = async (e) => { await act(e.target, () => POST(`/api/sos/${id}/close`, { reason: 'resolved' }), 'SOS closed · family informed'); draw(); };
    const fa = $('#false', el); if (fa) fa.onclick = async (e) => { await act(e.target, () => POST(`/api/sos/${id}/close`, { reason: 'false_alarm' }), 'Marked as false alarm'); draw(); };
    return s;
  }
  const s = await draw();
  if (s.status === 'active') {
    poll(draw, 4000);
    if (s.is_me && navigator.geolocation) poll(() => navigator.geolocation.getCurrentPosition((p) => POST(`/api/sos/${id}/location`, { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {}), () => {}, { timeout: 3000 }), 10000);
  }
});

const SEASON = { summer: 'Grishma ritu · summer', monsoon: 'Varsha ritu · monsoon', autumn: 'Sharad ritu · post-monsoon', winter: 'Hemant–Shishir ritu · winter' };

route('/nuskhe', 'Dadi Ke Nuskhe', async (el, _, q) => {
  const r = await GET('/api/remedies' + (q.q ? '?q=' + encodeURIComponent(q.q) : ''));
  el.innerHTML = `
    <div class="stack tight"><span class="eyebrow" style="color:var(--saffron)">${esc(SEASON[r.season] || r.season)}</span><h1 class="hi">दादी के नुस्खे</h1><p class="muted">Time-tested home remedies and seasonal routines, reviewed by an Ayurveda practitioner and kept separate from medical treatment.</p></div>
    <div class="banner sun">${ic('info')}<div>${esc(r.disclaimer)}</div></div>
    <form class="card" id="chk"><h3>How are you feeling?</h3><div class="row"><input class="input grow" id="sym" placeholder="e.g. sore throat, bloating after dinner"><button class="btn primary">Check</button></div><div id="res"></div></form>
    ${r.hidden.length ? `<div class="banner info">${ic('shield')}<div class="small"><strong>${r.hidden.length} remed${r.hidden.length > 1 ? 'ies' : 'y'} hidden for you:</strong> ${r.hidden.map((h) => `${esc(h.title)} (${esc(h.reason.toLowerCase())})`).join('; ')}.</div></div>` : ''}
    <form class="searchbox" id="sf">${ic('search')}<input class="input" id="q" type="search" placeholder="Search remedies" value="${esc(q.q || '')}"></form>
    <div class="stack" style="gap:12px">${r.items.map((x) => `<details class="card ${x.in_season ? 'sun' : ''}">
      <summary style="cursor:pointer;list-style:none" class="row top"><span class="ico sun">${ic('leaf')}</span><div class="grow stack tight"><div class="row wrap" style="gap:6px"><strong>${esc(x.title)}</strong><span class="hi muted">${esc(x.hindi)}</span></div><span class="small muted">${esc(x.goal)}</span>${x.in_season ? '<span class="pill sun" style="align-self:flex-start">In season now</span>' : ''}</div>${ic('chev')}</summary>
      <div class="stack small" style="margin-top:8px"><div><strong>You need:</strong> ${x.ingredients.map(esc).join(', ')}</div><div><strong>How:</strong> ${esc(x.method)}</div><div><strong>When:</strong> ${esc(x.when_to_use)}</div>
        <div class="banner bad" style="padding:8px 10px">${ic('alert')}<div><strong>See a doctor if:</strong> ${esc(x.see_doctor)}</div></div>
        <span class="xs muted">Reviewed by ${esc(x.reviewed_by)}</span></div></details>`).join('')}</div>`;
  $('#sf', el).onsubmit = (e) => { e.preventDefault(); go('#/nuskhe?q=' + encodeURIComponent($('#q', el).value)); };
  $('#chk', el).onsubmit = async (e) => {
    e.preventDefault();
    const res = await act(e.submitter, () => POST('/api/remedies/check', { text: $('#sym', el).value }));
    $('#res', el).innerHTML = res.route === 'sos' ? `<div class="banner bad">${ic('alert')}<div class="stack"><strong>${esc(res.message)}</strong><span>This needs emergency care, not a home remedy.</span><div class="row wrap"><a class="btn sm danger" href="tel:112">Call 112</a><a class="btn sm" href="#/sos">Open SOS</a></div></div></div>`
      : res.route === 'doctor' ? `<div class="banner info">${ic('doctor')}<div class="stack"><strong>${esc(res.message)}</strong><a class="btn sm primary" href="#/book?type=doctor&specialty=General%20Physician" style="align-self:flex-start">Consult a doctor now</a></div></div>`
      : `<div class="banner ok">${ic('leaf')}<div class="stack"><span>${esc(res.message)}</span>${res.matches.length ? `<span>${res.matches.map((m) => `<strong>${esc(m.title)}</strong>`).join(', ')}</span>` : '<a href="#/book?type=doctor">Talk to a doctor</a>'}</div></div>`;
  };
});

route('/wellness', 'Daily wellness', async (el) => {
  const w = await GET('/api/wellness');
  el.innerHTML = `
    <section class="section"><div class="section-head"><h2>Today’s routines</h2><span class="small muted">${w.routines.filter((r) => r.complete).length}/${w.routines.length} done</span></div>
      <div class="stack">${w.routines.map((r) => `<div class="card"><div class="row"><span class="ico ${r.complete ? '' : 'info'}">${ic(r.icon)}</span><div class="grow stack tight"><strong>${esc(r.title)}</strong><span class="small muted num">${r.done} / ${r.target} ${esc(r.unit)}${r.streak ? ` · ${r.streak}-day streak` : ''}</span></div>
        <div class="row" style="gap:4px"><button class="iconbtn" data-log="${r.id}" data-d="-1" aria-label="Undo one">${ic('minus')}</button><button class="iconbtn" data-log="${r.id}" data-d="1" aria-label="Log one" style="${r.complete ? '' : 'background:var(--brand);color:var(--brand-ink);border-color:var(--brand)'}">${ic('plus')}</button></div></div>
        <div class="progress"><i style="width:${Math.min(100, (r.done / r.target) * 100)}%"></i></div></div>`).join('') || '<div class="card"><div class="empty">Add a routine to start a streak.</div></div>'}</div>
      <form class="row" id="add"><input class="input grow" id="t" placeholder="New routine, e.g. 10 min stretching" aria-label="New routine"><button class="btn">Add</button></form></section>
    <section class="section"><h2>Preventive care for you</h2>
      <div class="card"><div class="list">${w.guidance.map((g) => `<a class="item" href="${esc(g.action)}"><span class="ico info">${ic('shield')}</span><div class="grow stack tight"><strong>${esc(g.title)}</strong><span class="small muted">${esc(g.why)}</span></div>${ic('chev')}</a>`).join('')}</div></div>
      <p class="xs muted">Based on your age and the conditions on your Emergency Card. General guidance only; your doctor decides what tests you need.</p></section>
    <a class="card sun" href="#/nuskhe" style="text-decoration:none;color:inherit"><div class="row"><span class="ico sun">${ic('leaf')}</span><div class="grow stack tight"><strong>Dadi Ke Nuskhe</strong><span class="small muted">Seasonal home remedies for ${esc(SEASON[w.season] || w.season)}</span></div>${ic('chev')}</div></a>`;
  on(el, '[data-log]', 'click', async (e, b) => { await act(b, () => POST(`/api/wellness/routines/${b.dataset.log}/log`, { delta: Number(b.dataset.d) })); render(); });
  $('#add', el).onsubmit = async (e) => { e.preventDefault(); const t = $('#t', el).value.trim(); if (!t) return; await act(e.submitter, () => POST('/api/wellness/routines', { title: t, target: 1, unit: 'today', icon: 'spark' }), 'Routine added'); render(); };
});

route('/console', 'Partner console', async (el) => {
  const tpl = (await GET('/api/consultations/templates')).items;
  async function draw() {
    const q = await GET('/api/provider/queue');
    el.innerHTML = `
      <div class="banner info">${ic('console')}<div class="small">Demo console. In production each clinic, doctor, lab, pharmacy and delivery partner works in their own app; here you can play every role to move a booking or order forward.</div></div>
      <section class="section"><div class="section-head"><h2>Clinic, lab & doctor</h2><span class="small muted">${q.bookings.length} active</span></div>
        ${q.bookings.map((b) => `<div class="card"><div class="row between top"><div class="stack tight"><strong>${esc(b.provider_name)}</strong><span class="small muted">${esc(b.service)} · ${esc(b.patient_name)} · ${b.start_at ? dayLabel(b.start_at) + ' ' + tm(b.start_at) : ''}</span></div>${bookingPill(b.status)}</div>
          <div class="row wrap">
            ${b.status === 'requested' ? `<button class="btn sm primary" data-bk="confirm" data-id="${b.id}">Confirm & issue token</button><button class="btn sm" data-bk="reject" data-id="${b.id}">Can’t take it</button>` : ''}
            ${b.provider_type === 'doctor' && ['confirmed', 'checked_in', 'in_consult'].includes(b.status) ? `<button class="btn sm" data-rx="${b.id}" data-spec="${esc(b.provider_name)}">Write prescription</button>` : ''}
            ${b.provider_type === 'lab' && ['confirmed', 'checked_in'].includes(b.status) ? `<button class="btn sm primary" data-bk="report" data-id="${b.id}">Sample done · upload report</button>` : ''}
          </div></div>`).join('') || '<div class="card"><div class="empty">No bookings waiting. Book a doctor or lab test from the app.</div></div>'}
      </section>
      <section class="section"><div class="section-head"><h2>Pharmacy & delivery</h2><span class="small muted">${q.orders.length} active</span></div>
        ${q.orders.map((o) => `<div class="card"><div class="row between top"><div class="stack tight"><strong>${esc(o.pharmacy_name)}</strong><span class="small muted">${esc(o.patient_name)} · ${o.items.map((i) => esc(i.drug) + ' ×' + i.qty).join(', ')}</span></div>${orderPill(o.status)}</div>
          <div class="row wrap">
            ${o.status === 'placed' ? `<button class="btn sm primary" data-or="verify" data-id="${o.id}">Verify prescription</button><button class="btn sm" data-sub="${o.id}" data-drug="${esc(o.items[0] ? o.items[0].drug : '')}" data-price="${o.items[0] ? Math.round(o.items[0].unit_price * 0.6 * 100) / 100 : 0}">Suggest generic for ${esc(o.items[0] ? o.items[0].drug : '')}</button>` : ''}
            ${o.status === 'verified' ? `<button class="btn sm primary" data-or="dispatch" data-id="${o.id}">Pack & dispatch</button>` : ''}
            ${['dispatched', 'arrived'].includes(o.status) ? `<input class="input mono" style="width:110px;min-height:32px" placeholder="OTP" id="otp-${o.id}" aria-label="OTP from patient"><button class="btn sm primary" data-hand="${o.id}">Hand over</button>` : ''}
          </div></div>`).join('') || '<div class="card"><div class="empty">No medicine orders in progress.</div></div>'}
      </section>`;
  }
  await draw();
  on(el, '[data-bk]', 'click', async (e, b) => { await act(b, () => POST(`/api/provider/bookings/${b.dataset.id}/${b.dataset.bk}`, {}), b.dataset.bk === 'confirm' ? 'Booking confirmed' : b.dataset.bk === 'report' ? 'Report sent to patient records' : 'Booking declined · patient refunded'); draw(); });
  on(el, '[data-or]', 'click', async (e, b) => { await act(b, () => POST(`/api/provider/orders/${b.dataset.id}/${b.dataset.or}`, {}), b.dataset.or === 'verify' ? 'Prescription verified' : 'Dispatched'); draw(); });
  on(el, '[data-sub]', 'click', async (e, b) => { await act(b, () => POST(`/api/provider/orders/${b.dataset.sub}/verify`, { substitute: { from: b.dataset.drug, to: b.dataset.drug + ' (generic)', unit_price: Number(b.dataset.price) } }), 'Substitute sent for patient approval'); draw(); });
  on(el, '[data-hand]', 'click', async (e, b) => { await act(b, () => POST(`/api/provider/orders/${b.dataset.hand}/handover`, { otp: $('#otp-' + b.dataset.hand, el).value }), 'Delivered'); draw(); });
  on(el, '[data-rx]', 'click', (e, b) => go('#/consult/' + b.dataset.rx));
  poll(() => { if (!document.activeElement || !document.activeElement.id.startsWith('otp-')) draw(); }, 5000);
});

route('/ops', 'Trust & operations', async (el) => {
  async function draw() {
    const [m, pend] = await Promise.all([GET('/api/admin/metrics'), GET('/api/admin/providers?status=pending')]);
    const pct = (v) => (v === null ? '—' : v + '%');
    el.innerHTML = `
      <section class="section"><h2>Platform health</h2>
        <div class="tiles">
          <div class="tile"><div class="v">${pct(m.adherence_7d_pct)}</div><div class="k">Dose adherence, last 7 days (target ≥ 80%)</div></div>
          <div class="tile"><div class="v">${pct(m.rx_to_order_pct)}</div><div class="k">e-Prescriptions ordered in app (target ≥ 35%)</div></div>
          <div class="tile"><div class="v">${pct(m.booking_honoured_pct)}</div><div class="k">Bookings honoured as confirmed (target ≥ 95%)</div></div>
          <div class="tile"><div class="v">${inr(m.gmv_inr)}</div><div class="k">Payments processed</div></div>
          <div class="tile"><div class="v">${m.verified_providers}</div><div class="k">Verified providers · ${m.pending_providers} pending</div></div>
          <div class="tile"><div class="v">${m.access_log_entries}</div><div class="k">Audited data accesses</div></div>
        </div><p class="xs muted">Live from this database: ${m.users} users, ${m.families} families, ${m.records} records, ${m.orders} orders, ${m.sos_total} SOS events.</p></section>
      <section class="section"><div class="section-head"><h2>Verification queue</h2><span class="small muted">${pend.items.length} pending</span></div>
        ${pend.items.map((p) => `<div class="card"><div class="row between top"><div class="stack tight"><strong>${esc(p.name)}</strong><span class="small muted">${esc(cap(p.type))}${p.specialty ? ' · ' + esc(p.specialty) : ''} · ${esc(p.address)}</span></div><span class="pill warn">Pending</span></div>
          <dl class="kv small"><dt>Registration</dt><dd class="mono">${esc(p.reg_no)}</dd><dt>Expected</dt><dd>${esc(p.rule)}</dd></dl>
          <div class="row"><button class="btn sm primary" data-v="approve" data-id="${p.id}">Run checks & approve</button><button class="btn sm" data-v="reject" data-id="${p.id}">Reject</button></div></div>`).join('') || '<div class="card"><div class="empty">Queue is clear.</div></div>'}
      </section>
      <form class="card" id="onb"><h3>Onboard a provider</h3>
        <div class="grid2"><label class="field" for="ot">Type<select class="input" id="ot"><option value="doctor">Doctor</option><option value="pharmacy">Pharmacy</option><option value="lab">Lab</option><option value="hospital">Hospital</option></select></label><label class="field" for="or">Registration no.<input class="input mono" id="or" placeholder="MMC/2015/55210"></label></div>
        <label class="field" for="on">Name<input class="input" id="on" placeholder="Dr. Anjali Deshpande"></label>
        <label class="field" for="os">Specialty (doctors)<input class="input" id="os" placeholder="Gynaecologist"></label>
        <button class="btn">Add to verification queue</button></form>`;
  }
  await draw();
  on(el, '[data-v]', 'click', async (e, b) => {
    const r = await act(b, () => POST(`/api/admin/providers/${b.dataset.id}/verify`, { decision: b.dataset.v }));
    toast(r.status === 'verified' ? 'Verified — now visible to patients' : 'Rejected: ' + (r.checks.find((c) => c.result !== 'pass') || {}).check_name, r.status !== 'verified');
    draw();
  });
  on(el, '#onb', 'submit', async (e) => { e.preventDefault(); await act(e.submitter, () => POST('/api/admin/providers', { type: $('#ot', el).value, reg_no: $('#or', el).value, name: $('#on', el).value, specialty: $('#os', el).value, fee: 500 }), 'Added to queue'); draw(); });
});
