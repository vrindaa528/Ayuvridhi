/* Module 3 (booking + smart serviceability) and Module 2 (virtual doctor). */
'use strict';

function providerCard(p) {
  const slotTxt = p.next_slot ? `${dayLabel(p.next_slot)}, ${tm(p.next_slot)}` : 'No open slot';
  return `<a class="card pcard" href="#/provider/${p.id}">
    <div class="row top">
      <span class="av ${avClass(p.id)}">${p.type === 'doctor' ? initials(p.name) : ic(p.type === 'lab' ? 'lab' : 'hospital')}</span>
      <div class="grow stack tight">
        <div class="row wrap" style="gap:6px"><strong>${esc(p.name)}</strong>${p.verified ? verifiedTag() : ''}</div>
        <span class="small muted">${esc(p.specialty || '')}${p.qualification ? ' · ' + esc(p.qualification) : ''}${p.accreditation && p.type !== 'doctor' ? ' · ' + esc(p.accreditation) : ''}</span>
        <div class="row wrap" style="gap:6px">${servPill(p.serviceability)}${freshPill(p)}${p.has_er ? '<span class="pill bad">24×7 ER</span>' : ''}${p.home_collection ? '<span class="pill info">Home collection</span>' : ''}</div>
      </div>
    </div>
    <div class="facts">
      <div class="fact"><div class="k">Next slot</div><div class="v ${p.serviceability === 'Available' ? 'go' : ''}">${slotTxt}</div></div>
      <div class="fact"><div class="k">${p.type === 'lab' ? 'Tests from' : 'Fee'}</div><div class="v">${p.type === 'lab' && p.services.length ? inr(Math.min(...p.services.map((s) => s.price))) : inr(p.fee)} <span class="xs muted">all-in</span></div></div>
      <div class="fact"><div class="k">Distance</div><div class="v">${p.distance_km} km · ${p.travel_min} min</div></div>
      <div class="fact"><div class="k">Est. wait</div><div class="v">${p.wait_min[0]}–${p.wait_min[1]} min</div></div>
    </div>
  </a>`;
}

route('/book', 'Find care', async (el, _, q) => {
  const type = q.type || 'doctor';
  const tabs = [['doctor', 'Doctors'], ['lab', 'Lab tests'], ['hospital,clinic', 'Hospitals']];
  const specs = type === 'doctor' ? (await GET('/api/specialties')).items.filter((s) => s !== 'Emergency Medicine') : [];
  const params = new URLSearchParams();
  params.set('type', type);
  if (q.specialty) params.set('specialty', q.specialty);
  if (q.q) params.set('q', q.q);
  if (q.sort) params.set('sort', q.sort);
  if (q.home) params.set('home', '1');
  const r = await GET('/api/providers?' + params.toString());
  const nav = (patch) => { const n = Object.assign({}, q, patch); Object.keys(n).forEach((k) => (n[k] === '' || n[k] === undefined) && delete n[k]); go('#/book?' + Object.entries(n).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')); };
  el.innerHTML = `
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${k === type ? 'on' : ''}" data-type="${k}">${l}</button>`).join('')}</div>
    <form class="searchbox" id="sf">${ic('search')}<input class="input" id="q" type="search" placeholder="${type === 'lab' ? 'Search tests (HbA1c, lipid…)' : type === 'doctor' ? 'Search doctors or specialties' : 'Search hospitals'}" value="${esc(q.q || '')}"></form>
    ${specs.length ? `<div class="chips"><button class="chip ${!q.specialty ? 'on' : ''}" data-spec="">All</button>${specs.map((s) => `<button class="chip ${q.specialty === s ? 'on' : ''}" data-spec="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <div class="row between wrap">
      <span class="small muted">${r.items.length} verified ${type === 'doctor' ? 'doctors' : type === 'lab' ? 'labs' : 'facilities'} near Andheri West</span>
      <div class="row">
        ${type === 'lab' ? `<label class="check small"><input type="checkbox" id="home" ${q.home ? 'checked' : ''}>Home collection</label>` : ''}
        <select class="input" id="sort" style="min-height:34px;width:auto;padding:4px 8px;font-size:13px" aria-label="Sort by">
          <option value="next" ${!q.sort || q.sort === 'next' ? 'selected' : ''}>Soonest slot</option><option value="distance" ${q.sort === 'distance' ? 'selected' : ''}>Nearest</option><option value="price" ${q.sort === 'price' ? 'selected' : ''}>Lowest price</option>
        </select>
      </div>
    </div>
    <div class="stack" style="gap:12px">${r.items.map(providerCard).join('') || '<div class="card"><div class="empty">No verified provider matches. Try another search.</div></div>'}</div>
    <p class="xs muted">Only providers verified against medical council, drug licence, NABL or ABDM registries appear. “Live” means availability synced in the last 15 minutes.</p>`;
  on(el, '[data-type]', 'click', (e, b) => go('#/book?type=' + b.dataset.type));
  on(el, '[data-spec]', 'click', (e, b) => nav({ specialty: b.dataset.spec }));
  $('#sf', el).onsubmit = (e) => { e.preventDefault(); nav({ q: $('#q', el).value }); };
  $('#sort', el).onchange = (e) => nav({ sort: e.target.value });
  const h = $('#home', el); if (h) h.onchange = (e) => nav({ home: e.target.checked ? '1' : '' });
}, { tab: 'care' });

route('/provider/:id', 'Book appointment', async (el, { id }, q) => {
  const p = await GET('/api/providers/' + id);
  let date = q.date || today();
  let slotId = null, mode = p.type === 'doctor' ? 'video' : p.type === 'lab' ? (p.home_collection ? 'home' : 'centre') : 'clinic';
  let service = p.type === 'lab' ? (p.services.find((s) => q.q && s.name.toLowerCase().includes(q.q.toLowerCase())) || p.services[0] || {}).name : null;
  let member = S.bookFor && viewableMembers('appointments').some((m) => m.id === S.bookFor) ? S.bookFor : S.me.id, offer = '';
  const days = [0, 1, 2, 3].map(plusDays);
  async function draw() {
    const slots = (await GET(`/api/providers/${id}/slots?date=${date}`)).items;
    el.innerHTML = `
      <div class="card">
        <div class="row top"><span class="av lg ${avClass(p.id)}">${p.type === 'doctor' ? initials(p.name) : ic(p.type === 'lab' ? 'lab' : 'hospital')}</span>
          <div class="grow stack tight"><h2>${esc(p.name)}</h2><span class="small muted">${esc(p.specialty || '')} · ${esc(p.qualification || p.accreditation || '')}</span><span class="small muted">${esc(p.address)}</span></div></div>
        <div class="facts">
          <div class="fact"><div class="k">Next available</div><div class="v go">${p.next_slot ? dayLabel(p.next_slot) + ', ' + tm(p.next_slot) : '—'}</div></div>
          <div class="fact"><div class="k">Estimated wait</div><div class="v">~${p.wait_min[0]}–${p.wait_min[1]} min</div></div>
          <div class="fact"><div class="k">Distance</div><div class="v">${p.distance_km} km away</div></div>
          <div class="fact"><div class="k">${p.type === 'lab' ? 'Accreditation' : 'Consultation fee'}</div><div class="v">${p.type === 'lab' ? esc(p.accreditation || '') : inr(p.fee) + ' <span class="xs muted">no hidden cost</span>'}</div></div>
        </div>
        <details><summary class="small" style="cursor:pointer"><span class="verified">${ic('shield')}Credential verified</span> <span class="muted">· reg. <span class="mono">${esc(p.reg_no)}</span></span></summary>
          <div class="list small" style="margin-top:6px">${p.checks.map((k) => `<div class="item">${k.result === 'pass' ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">' + esc(k.result) + '</span>'}<span class="grow">${esc(k.check_name)}</span><span class="xs muted">${dshort(k.at)}</span></div>`).join('')}</div></details>
      </div>

      ${p.type === 'lab' ? `<div class="card"><h3>Choose test</h3><div class="list">${p.services.map((s) => `<label class="item check"><input type="radio" name="svc" value="${esc(s.name)}" ${s.name === service ? 'checked' : ''}><span class="grow">${esc(s.name)}</span><span class="amt">${inr(s.price)}</span></label>`).join('')}</div></div>` : ''}

      <div class="card">
        <div class="row between"><h3>Pick a slot</h3>${freshPill(p)}</div>
        <div class="chips">${days.map((d) => `<button class="chip ${d === date ? 'on' : ''}" data-date="${d}">${dayLabel(d)}</button>`).join('')}</div>
        ${slots.length ? `<div class="slots">${slots.map((s) => `<button class="slot num ${s.id === slotId ? 'on' : ''}" data-slot="${s.id}" ${s.status !== 'open' ? 'disabled aria-label="Booked"' : ''}>${tm(s.start_at).replace(' ', '')}</button>`).join('')}</div>` : '<div class="empty">No more slots this day. Try the next day.</div>'}
        <p class="xs muted">Struck-through slots are already booked. Slots refresh from the ${p.type === 'lab' ? 'lab' : 'clinic'}’s live calendar.</p>
      </div>

      <div class="card">
        ${p.type !== 'hospital' && p.type !== 'clinic' ? `<div class="seg">${(p.type === 'doctor' ? [['video', 'Video consult'], ['clinic', 'Visit clinic']] : [['home', 'Home collection'], ['centre', 'Visit centre']]).map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>` : ''}
        <label class="field" for="who">Booking for${memberSelect('appointments', 'who', member)}</label>
        <label class="field" for="offer">Offer code (optional)<input class="input mono" id="offer" placeholder="${p.type === 'lab' ? 'FIRSTLAB' : 'CARE10'}" value="${esc(offer)}"></label>
        <div id="quote"></div>
        <button class="btn primary block" id="book" ${slotId ? '' : 'disabled'}>Pay & request booking</button>
        <p class="xs muted">Payment is held safely until the ${p.type === 'lab' ? 'lab' : 'clinic'} confirms. If they don’t confirm within 10 minutes, you get a full refund automatically.</p>
      </div>`;
    on(el, '[data-date]', 'click', (e, b) => { date = b.dataset.date; slotId = null; draw(); });
    on(el, '[data-slot]', 'click', (e, b) => { slotId = b.dataset.slot; $$('.slot', el).forEach((x) => x.classList.toggle('on', x === b)); $('#book', el).disabled = false; quote(); });
    on(el, '[data-mode]', 'click', (e, b) => { mode = b.dataset.mode; $$('[data-mode]', el).forEach((x) => x.classList.toggle('on', x === b)); quote(); });
    on(el, 'input[name=svc]', 'change', (e, b) => { service = b.value; quote(); });
    $('#who', el).onchange = (e) => (member = e.target.value);
    $('#offer', el).onchange = (e) => { offer = e.target.value.trim(); quote(); };
    $('#book', el).onclick = async (e) => {
      const b = await act(e.target, () => POST('/api/bookings', { slot_id: slotId, mode, service, member_id: member, offer_code: offer || undefined }), 'Booking requested');
      go('#/booking/' + b.id);
    };
    if (slotId) quote();
  }
  async function quote() {
    if (!slotId) return;
    try {
      const qt = await POST('/api/bookings/quote', { slot_id: slotId, mode, service, offer_code: offer || undefined });
      $('#quote', el).innerHTML = `<dl class="kv small"><dt>${esc(qt.service)}</dt><dd class="amt" style="text-align:right">${inr(qt.price)}</dd>
        ${qt.collection ? `<dt>Home sample collection</dt><dd class="amt" style="text-align:right">${inr(qt.collection)}</dd>` : ''}
        <dt>Platform fee</dt><dd class="amt" style="text-align:right">${inr(qt.platform_fee)}</dd>
        ${qt.discount ? `<dt>Offer ${esc(offer.toUpperCase())}</dt><dd class="amt plus" style="text-align:right">−${inr(qt.discount)}</dd>` : offer ? '<dt></dt><dd class="xs" style="color:var(--danger);text-align:right">Code not valid here</dd>' : ''}
        <dt><strong>Total payable</strong></dt><dd class="amt" style="text-align:right;font-size:18px">${inr(qt.total - qt.discount)}</dd></dl>`;
    } catch (err) { toast(err.message, true); }
  }
  await draw();
}, { tab: 'care' });

const BOOKING_STEPS = [['requested', 'Requested · payment held'], ['confirmed', 'Confirmed by provider'], ['checked_in', 'Checked in / sample collected'], ['in_consult', 'In consultation'], ['completed', 'Completed']];

route('/booking/:id', 'Booking', async (el, { id }) => {
  async function draw() {
    const b = await GET('/api/bookings/' + id);
    const order = BOOKING_STEPS.map((s) => s[0]);
    const idx = order.indexOf(b.status);
    const cancelled = b.status.startsWith('cancelled') || b.status === 'no_show';
    const isDoc = b.provider_type === 'doctor';
    el.innerHTML = `
      <div class="card">
        <div class="row between top"><div class="stack tight"><span class="eyebrow">${esc(isDoc ? (b.mode === 'video' ? 'Video consult' : 'Clinic visit') : b.provider_type === 'lab' ? (b.mode === 'home' ? 'Home sample collection' : 'Lab visit') : 'OPD visit')}</span><h2>${esc(b.service)}</h2><span class="small muted">${esc(b.provider_name)} · for ${esc(b.patient_name)}</span></div>${bookingPill(b.status)}</div>
        <div class="facts">
          <div class="fact"><div class="k">When</div><div class="v">${b.start_at ? dayLabel(b.start_at) + ', ' + tm(b.start_at) : '—'}</div></div>
          <div class="fact"><div class="k">Token</div><div class="v mono">${esc(b.token_no || '—')}</div></div>
          <div class="fact"><div class="k">Paid</div><div class="v">${inr(b.price)}</div></div>
          <div class="fact"><div class="k">Where</div><div class="v small ellipsis" title="${esc(b.address)}">${b.mode === 'video' ? 'In app' : b.mode === 'home' ? 'Your home' : esc(b.address)}</div></div>
        </div>
      </div>
      ${b.status === 'requested' ? `<div class="banner info">${ic('clock')}<div>Waiting for ${esc(b.provider_name)} to confirm. If not confirmed by <strong>${tm(b.confirm_by)}</strong>, it cancels automatically with a full refund.</div></div>` : ''}
      ${!cancelled ? `<div class="card"><div class="steps">${BOOKING_STEPS.filter((s) => isDoc || s[0] !== 'in_consult').map(([k, l]) => {
        const i = order.indexOf(k);
        const cls = i < idx || b.status === 'completed' ? 'done' : i === idx ? 'now' : '';
        return `<div class="step ${cls}"><span class="dotc">${cls === 'done' ? ic('check') : ''}</span><div class="stack tight"><strong class="small">${l}</strong></div></div>`;
      }).join('')}</div></div>` : `<div class="banner bad">${ic('info')}<div>${b.status === 'no_show' ? 'This appointment was missed.' : 'This booking was cancelled. Any refund goes back to your UPI account — see Wallet.'}</div></div>`}
      <div class="stack">
        ${isDoc && ['confirmed', 'checked_in', 'in_consult'].includes(b.status) ? `<a class="btn primary block" href="#/consult/${b.id}">${ic('video')}${b.status === 'in_consult' ? 'Rejoin consult' : b.mode === 'video' ? 'Join video consult' : 'Start consult'}</a>` : ''}
        ${b.status === 'confirmed' && b.mode !== 'video' ? `<button class="btn block" id="checkin">${ic('pin')}I’ve arrived — check in</button>` : ''}
        ${b.status === 'completed' && isDoc ? `<a class="btn block" href="#/rx">View prescription</a>` : ''}
        ${b.status === 'completed' && b.provider_type === 'lab' ? `<a class="btn block" href="#/records?member=${b.patient_id}">View report in records</a>` : ''}
        ${['requested', 'confirmed'].includes(b.status) ? `<button class="btn block ghost" id="cancel">Cancel booking</button>` : ''}
        ${['requested', 'confirmed', 'checked_in'].includes(b.status) ? `<a class="small muted" href="#/console" style="text-align:center">Demo: act as the ${b.provider_type === 'lab' ? 'lab' : 'clinic'} in the Partner console</a>` : ''}
      </div>`;
    const ci = $('#checkin', el); if (ci) ci.onclick = async (e) => { await act(e.target, () => POST(`/api/bookings/${id}/checkin`), 'Checked in — you’re in the queue'); draw(); };
    const cc = $('#cancel', el);
    if (cc) cc.onclick = () => sheet(`<h2>Cancel this booking?</h2><p class="small muted">Free cancellation up to 2 hours before. Later cancellations refund 50%.</p><div class="row"><button class="btn grow" data-close>Keep it</button><button class="btn danger grow" id="yes">Cancel booking</button></div>`, (sh, close) => {
      $('#yes', sh).onclick = async (e) => { const r = await act(e.target, () => POST(`/api/bookings/${id}/cancel`, { reason: 'Patient cancelled' })); close(); toast(`Cancelled · ${r.refund_pct}% refund initiated`); draw(); };
    });
    return b;
  }
  const b = await draw();
  if (['requested', 'confirmed', 'checked_in'].includes(b.status)) poll(draw, 3000);
});

route('/bookings', 'Bookings', async (el, _, q) => {
  const member = q.member || S.me.id;
  const r = await GET('/api/bookings' + (member !== S.me.id ? '?member=' + member : ''));
  el.innerHTML = `${memberChips('appointments', member)}
    <div class="card"><div class="list">${r.items.map((b) => `<a class="item" href="#/booking/${b.id}"><span class="ico ${b.provider_type === 'lab' ? 'info' : ''}">${ic(b.provider_type === 'lab' ? 'lab' : b.provider_type === 'doctor' ? 'doctor' : 'hospital')}</span><div class="grow stack tight"><strong class="ellipsis">${esc(b.service || 'Appointment')}</strong><span class="small muted ellipsis">${esc(b.provider_name)}${b.start_at ? ' · ' + dt(b.start_at) : ''}</span></div>${bookingPill(b.status)}</a>`).join('') || '<div class="empty">No bookings yet. <a href="#/book">Find care</a></div>'}</div></div>`;
  on(el, '[data-member]', 'click', (e, b) => go('#/bookings?member=' + b.dataset.member));
});

route('/consult/:id', 'Video consult', async (el, { id }) => {
  const room = await POST(`/api/consultations/${id}/start`);
  const d = room.doctor;
  let items = room.template.items.map((x) => Object.assign({}, x));
  const started = Date.now();
  el.innerHTML = `
    <div class="video"><span class="tag" id="clock">● Connected · 00:00</span>
      <div class="stack" style="align-items:center;gap:10px"><div class="big">${initials(d.name)}</div><strong>${esc(d.name)}</strong><span class="small" style="opacity:.8">${esc(d.specialty)} · ${esc(d.qualification)}</span></div>
      <div class="self">${initials(room.booking.patient_name)}</div></div>
    <div class="callbar"><button aria-label="Mute">${ic('mic')}</button><button aria-label="Camera">${ic('video')}</button><button class="end" aria-label="End call" id="end">${ic('phone')}</button></div>
    <div class="banner info">${ic('shield')}<div>${esc(d.name)} can see ${esc(first(room.booking.patient_name))}’s prescriptions, reports and medicines for 72 hours. Access is logged and ends automatically.</div></div>
    <div class="card tint">
      <div class="row between"><span class="eyebrow">Doctor’s screen (demo)</span><span class="pill info">Reg. ${esc(d.reg_no)}</span></div>
      <label class="field" for="dx">Diagnosis<input class="input" id="dx" value="${esc(room.template.diagnosis)}"></label>
      <div id="items"></div>
      <button class="btn sm" id="add" type="button">${ic('plus')}Add medicine</button>
      <label class="field" for="notes">Advice<textarea class="input" id="notes">${esc(room.template.notes)}</textarea></label>
      <label class="field" for="fu">Follow-up after (days)<input class="input num" id="fu" type="number" min="0" value="${room.template.follow_up_days}"></label>
      <button class="btn primary block" id="sign">${ic('key')}Sign & issue e-prescription</button>
      <p class="xs muted">Signing saves the prescription to the patient’s records and sets dose reminders automatically.</p>
    </div>`;
  const drawItems = () => {
    $('#items', el).innerHTML = items.map((it, i) => `<div class="card flat" style="gap:8px"><div class="row"><input class="input grow" data-i="${i}" data-k="drug" value="${esc(it.drug)}" aria-label="Medicine"><button class="iconbtn" data-rm="${i}" aria-label="Remove">${ic('x')}</button></div>
      <div class="grid3"><input class="input" data-i="${i}" data-k="frequency" value="${esc(it.frequency)}" aria-label="Frequency (morning-afternoon-night)" title="Morning-Afternoon-Night"><input class="input" data-i="${i}" data-k="food" value="${esc(it.food)}" aria-label="With food"><input class="input num" type="number" data-i="${i}" data-k="days" value="${it.days}" aria-label="Days"></div></div>`).join('');
  };
  drawItems();
  on(el, '[data-k]', 'input', (e, inp) => { const v = inp.dataset.k === 'days' ? Number(inp.value) : inp.value; items[inp.dataset.i][inp.dataset.k] = v; });
  on(el, '[data-rm]', 'click', (e, b) => { items.splice(Number(b.dataset.rm), 1); drawItems(); });
  $('#add', el).onclick = () => { items.push({ drug: 'Paracetamol 650mg', dose: '1 tablet', frequency: 'sos', food: 'after food', days: 3 }); drawItems(); };
  $('#end', el).onclick = () => history.back();
  $('#sign', el).onclick = async (e) => {
    const rx = await act(e.target, () => POST(`/api/provider/consultations/${id}/prescription`, { diagnosis: $('#dx', el).value, notes: $('#notes', el).value, follow_up_days: Number($('#fu', el).value) || 0, items }), 'Prescription issued');
    go('#/rx/' + rx.id);
  };
  poll(() => { const s = Math.floor((Date.now() - started) / 1000); const c = $('#clock'); if (c) c.textContent = `● Connected · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 1000);
});
