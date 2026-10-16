/* Module 2 (medical store, order from Rx, delivery) and Module 1 schedules. */
'use strict';

const freqText = (f) => (/weekly/i.test(f) ? 'Once a week' : /sos/i.test(f) ? 'When needed' : f);

route('/rx', 'Prescriptions', async (el, _, q) => {
  const member = q.member || S.me.id;
  const r = await GET('/api/prescriptions' + (member !== S.me.id ? '?member=' + member : ''));
  el.innerHTML = `${memberChips('prescriptions', member)}
    <div class="stack" style="gap:12px">${r.items.map((x) => `<a class="card" href="#/rx/${x.id}" style="text-decoration:none;color:inherit">
      <div class="row between top"><div class="stack tight"><strong>${esc(x.doctor_name || 'Uploaded prescription')}</strong><span class="small muted">${esc(x.diagnosis || '')}</span></div><span class="small muted">${dt(x.issued_at)}</span></div>
      <div class="row wrap" style="gap:6px">${x.items.map((i) => `<span class="pill">${esc(i.drug)}</span>`).join('')}</div>
      <div class="row between"><span class="small">${x.signed ? `<span class="verified">${ic('shield')}Digitally signed</span>` : '<span class="pill warn">Needs pharmacist check</span>'}</span><span class="linkbtn">Order medicines ${'›'}</span></div></a>`).join('') || '<div class="card"><div class="empty">No prescriptions yet. Consult a doctor and the e-prescription lands here.</div></div>'}</div>
    <button class="btn block" id="up">${ic('upload')}Upload a paper prescription</button>
    <a class="btn block ghost" href="#/store">${ic('cart')}Shop medical store (no prescription needed items)</a>`;
  on(el, '[data-member]', 'click', (e, b) => go('#/rx?member=' + b.dataset.member));
  $('#up', el).onclick = () => sheet(`<h2>Upload prescription</h2>
    <label class="field" for="upf">Photo of the prescription<input class="input" type="file" id="upf" accept="image/*,application/pdf"></label>
    <label class="field" for="updoc">Doctor’s name<input class="input" id="updoc" placeholder="Dr. …"></label>
    <label class="field" for="upitems">Medicines (one per line, as written)<textarea class="input" id="upitems" placeholder="Paracetamol 650mg\nCetirizine 10mg"></textarea></label>
    <label class="field" for="upwho">For${memberSelect('prescriptions', 'upwho', member)}</label>
    <p class="xs muted">A licensed pharmacist verifies uploaded prescriptions before any medicine is dispensed.</p>
    <button class="btn primary" id="upgo">Save prescription</button>`, (sh, close) => {
    $('#upgo', sh).onclick = async (e) => {
      const lines = $('#upitems', sh).value.split('\n').map((s) => s.trim()).filter(Boolean);
      const f = $('#upf', sh).files[0];
      const rx = await act(e.target, () => POST('/api/prescriptions/upload', { member_id: $('#upwho', sh).value, doctor_name: $('#updoc', sh).value, file_name: f ? f.name : 'prescription.jpg', items: lines.map((d) => ({ drug: d, dose: '1 tablet', frequency: '1-0-1', days: 5 })) }), 'Prescription saved to records');
      close(); go('#/rx/' + rx.id);
    };
  });
});

route('/rx/:id', 'Prescription', async (el, { id }) => {
  const [rx, ph] = await Promise.all([GET('/api/prescriptions/' + id), GET(`/api/prescriptions/${id}/pharmacies`)]);
  let pick = (ph.options.find((o) => o.all_available) || ph.options[0] || {}).pharmacy;
  el.innerHTML = `
    <article class="rx">
      <header><div class="stack tight"><strong style="font-family:var(--font-display);font-size:17px">${esc(rx.doctor_name || 'Paper prescription')}</strong><span class="small muted">${esc(rx.qualification || '')}${rx.specialty ? ' · ' + esc(rx.specialty) : ''}</span>${rx.reg_no ? `<span class="xs muted">Reg. No. <span class="mono">${esc(rx.reg_no)}</span></span>` : ''}</div>
        <div class="stack tight" style="text-align:right"><span class="small">${dt(rx.issued_at)}</span><span class="xs muted mono">${esc(rx.id.slice(0, 14))}</span></div></header>
      <div class="body">
        <dl class="kv small"><dt>Patient</dt><dd>${esc(rx.patient_name)}</dd>${rx.diagnosis ? `<dt>Diagnosis</dt><dd>${esc(rx.diagnosis)}</dd>` : ''}</dl>
        <div class="row top"><span class="sym" aria-hidden="true">℞</span>
          <div class="tablewrap grow"><table><thead><tr><th>Medicine</th><th>Dose</th><th>M-A-N</th><th>Days</th></tr></thead><tbody>
          ${rx.items.map((i) => `<tr><td><strong>${esc(i.drug)}</strong><br><span class="xs muted">${esc(i.food || '')}</span></td><td>${esc(i.dose || '')}</td><td class="mono">${esc(freqText(i.frequency))}</td><td class="num">${esc(i.days || '')}</td></tr>`).join('')}
          </tbody></table></div></div>
        ${rx.notes ? `<p class="small"><strong>Advice:</strong> ${esc(rx.notes)}</p>` : ''}
        ${rx.follow_up_on ? `<p class="small"><strong>Follow-up:</strong> ${dt(rx.follow_up_on)}</p>` : ''}
        <div class="sig"><span class="xs muted">${rx.signed ? 'Digitally signed e-prescription<br><span class="mono">' + esc(rx.signature) + '</span>' : 'Uploaded copy · pharmacist verification required'}</span>${rx.signed ? `<span class="verified">${ic('shield')}Valid</span>` : ''}</div>
      </div>
    </article>
    <section class="section">
      <div class="section-head"><h2>Order from this prescription</h2></div>
      <p class="small muted">Verified pharmacies within 10 km, with live stock and the full price before you pay.</p>
      <div class="stack" id="opts">${ph.options.map((o) => `<label class="card" style="cursor:pointer;${o.pharmacy.id === (pick && pick.id) ? 'border-color:var(--brand);box-shadow:0 0 0 2px var(--brand-soft)' : ''}" data-ph="${o.pharmacy.id}">
        <div class="row top"><input type="radio" name="ph" value="${o.pharmacy.id}" ${o.pharmacy.id === (pick && pick.id) ? 'checked' : ''} style="margin-top:4px;accent-color:var(--brand)">
          <div class="grow stack tight"><div class="row wrap" style="gap:6px"><strong>${esc(o.pharmacy.name)}</strong>${verifiedTag()}</div>
            <span class="small muted">${o.distance_km} km · arrives in ~${o.eta_min} min · ${esc(o.pharmacy.accreditation || '')}</span>
            <div class="row wrap" style="gap:6px">${o.all_available ? '<span class="pill ok">All in stock</span>' : `<span class="pill warn">Missing: ${esc(o.missing.join(', '))}</span>`}${o.stock_freshness === 'live' ? '<span class="pill brand">● Live stock</span>' : '<span class="pill warn">Stock unconfirmed</span>'}</div></div>
          <div class="stack tight" style="text-align:right"><span class="amt" style="font-size:18px">${inr(o.total)}</span><span class="xs muted">${o.delivery_fee ? 'incl. ' + inr(o.delivery_fee) + ' delivery' : 'free delivery'}</span></div></div>
      </label>`).join('') || '<div class="card"><div class="empty">No verified pharmacy nearby has these medicines.</div></div>'}</div>
      <div class="card" id="sum"></div>
    </section>`;
  const drawSum = () => {
    const o = ph.options.find((x) => pick && x.pharmacy.id === pick.id);
    if (!o) { $('#sum', el).hidden = true; return; }
    $('#sum', el).innerHTML = `
      <div class="list small">${o.lines.map((l) => `<div class="item"><span class="grow">${esc(l.drug)} <span class="muted">× ${l.qty} ${esc(l.unit)}${l.qty > 1 ? 's' : ''}</span></span>${l.available ? `<span class="amt">${inr(l.line_total)}</span>` : '<span class="pill warn">Not in stock</span>'}</div>`).join('')}
        <div class="item"><span class="grow">Delivery</span><span class="amt">${o.delivery_fee ? inr(o.delivery_fee) : 'Free'}</span></div>
        <div class="item"><strong class="grow">Total</strong><span class="amt" style="font-size:18px">${inr(o.total)}</span></div></div>
      <label class="field" for="rxoffer">Offer code (optional)<input class="input mono" id="rxoffer" placeholder="RXSAVE"></label>
      <button class="btn primary block" id="place">${o.all_available ? 'Pay ' + inr(o.total) + ' & place order' : 'Order available items'}</button>
      <p class="xs muted">Price locked for 15 minutes. Payment is held until you confirm delivery. Substitutes are never made without your approval.</p>`;
    $('#place', el).onclick = async (e) => {
      const ord = await act(e.target, () => POST('/api/orders', { prescription_id: id, pharmacy_id: o.pharmacy.id, allow_partial: !o.all_available, offer_code: $('#rxoffer', el).value.trim() || undefined }), 'Order placed');
      go('#/order/' + ord.id);
    };
  };
  on(el, '[data-ph]', 'click', (e, lab) => { pick = ph.options.find((x) => x.pharmacy.id === lab.dataset.ph).pharmacy; $$('[data-ph]', el).forEach((x) => { const sel = x === lab; x.style.borderColor = sel ? 'var(--brand)' : ''; x.style.boxShadow = sel ? '0 0 0 2px var(--brand-soft)' : ''; x.querySelector('input').checked = sel; }); drawSum(); });
  drawSum();
});

function routeSvg(o) {
  const p = o.delivery ? o.delivery.progress : 0;
  const x1 = 40, y1 = 110, x2 = 300, y2 = 40;
  const cx = x1 + (x2 - x1) * p, cy = y1 + (y2 - y1) * p - Math.sin(p * Math.PI) * 26;
  const path = `M${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - 52} ${x2} ${y2}`;
  return `<svg class="route" viewBox="0 0 340 150" role="img" aria-label="Delivery ${Math.round(p * 100)} percent of the way">
    <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--line)" stroke-width="1"/></pattern></defs>
    <rect width="340" height="150" fill="url(#g)"/>
    <path d="${path}" fill="none" stroke="var(--line)" stroke-width="6" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="6" stroke-linecap="round" pathLength="1" stroke-dasharray="${p} 1"/>
    <circle cx="${x1}" cy="${y1}" r="9" fill="var(--surface)" stroke="var(--brand)" stroke-width="3"/><text x="${x1}" y="${y1 + 26}" text-anchor="middle" font-size="11" fill="var(--muted)">Pharmacy</text>
    <circle cx="${x2}" cy="${y2}" r="9" fill="var(--brand)"/><text x="${x2}" y="${y2 - 16}" text-anchor="middle" font-size="11" fill="var(--muted)">Home</text>
    ${o.status !== 'placed' && o.status !== 'verified' && o.status !== 'substitution_pending' ? `<g transform="translate(${cx - 13} ${cy - 13})"><circle cx="13" cy="13" r="14" fill="var(--saffron)"/><g transform="translate(4 4) scale(0.75)" stroke="#fff" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P.truck}</g></g>` : ''}
  </svg>`;
}

route('/order/:id', 'Order', async (el, { id }) => {
  async function draw() {
    const o = await GET('/api/orders/' + id);
    const order = ['placed', 'verified', 'dispatched', 'delivered', 'completed'];
    const map = { substitution_pending: 'placed', arrived: 'dispatched' };
    const idx = order.indexOf(map[o.status] || o.status);
    el.innerHTML = `
      <div class="card">
        <div class="row between top"><div class="stack tight"><span class="eyebrow">${o.prescription_id ? 'Order from prescription' : 'Store order'}</span><h2>${esc(o.pharmacy_name)}</h2><span class="small muted">For ${esc(o.patient_name)} · ${dt(o.created_at)}</span></div>${orderPill(o.status)}</div>
        ${routeSvg(o)}
        ${o.delivery && ['dispatched', 'arrived'].includes(o.status) ? `<div class="row between"><div class="stack tight"><strong>${o.status === 'arrived' ? 'Delivery partner is at your door' : `Arriving in ${o.delivery.eta_min_left} min`}</strong><span class="small muted">${esc(o.delivery.partner)} · ETA ${tm(o.delivery.eta_at)}</span></div><span class="pill info">Live</span></div>` : ''}
      </div>
      ${o.otp ? `<div class="card sun"><div class="row between top"><div class="stack tight"><strong>Delivery OTP</strong><span class="small">Share only when the medicines are in your hand.</span></div><div class="otp" aria-label="OTP ${o.otp.split('').join(' ')}">${o.otp.split('').map((d) => `<span>${d}</span>`).join('')}</div></div></div>` : ''}
      ${o.status === 'substitution_pending' && o.substitution ? `<div class="card alert"><strong>Pharmacist suggests a substitute</strong>
        <p class="small"><strong>${esc(o.substitution.from)}</strong> is unavailable. Same salt alternative: <strong>${esc(o.substitution.to)}</strong> at ${inr(o.substitution.unit_price)}/unit.</p>
        <div class="row"><button class="btn grow" data-sub="0">Remove item</button><button class="btn primary grow" data-sub="1">Approve substitute</button></div></div>` : ''}
      <div class="card"><div class="steps">${[['placed', 'Order placed · payment held'], ['verified', 'Verified by licensed pharmacist'], ['dispatched', 'Out for delivery'], ['delivered', 'Handed over with OTP'], ['completed', 'You confirmed · payment released']].map(([k, l], i) => `<div class="step ${o.status === 'cancelled' ? '' : i < idx || o.status === 'completed' ? 'done' : i === idx ? 'now' : ''}"><span class="dotc">${i < idx || o.status === 'completed' ? ic('check') : ''}</span><strong class="small">${l}</strong></div>`).join('')}</div></div>
      <div class="card"><div class="list small">${o.items.map((l) => `<div class="item"><span class="grow">${esc(l.drug)} <span class="muted">× ${l.qty}</span>${l.substituted_from ? `<br><span class="xs muted">substitute for ${esc(l.substituted_from)}</span>` : ''}</span><span class="amt">${inr(l.line_total)}</span></div>`).join('')}
        <div class="item"><span class="grow">Delivery</span><span class="amt">${o.delivery_fee ? inr(o.delivery_fee) : 'Free'}</span></div>
        <div class="item"><strong class="grow">Paid</strong><span class="amt">${inr(o.total)}</span></div></div></div>
      ${o.status === 'delivered' ? `<button class="btn primary block" id="confirm">${ic('check')}I received everything — release payment</button>` : ''}
      ${['dispatched', 'arrived'].includes(o.status) ? `<div class="card tint"><span class="eyebrow">Delivery partner app (demo)</span><p class="small muted">The partner enters the OTP you tell them at the door.</p><div class="row"><input class="input mono num grow" id="otpin" inputmode="numeric" maxlength="4" placeholder="4-digit OTP" aria-label="OTP"><button class="btn primary" id="hand">Hand over</button></div></div>` : ''}
      ${['placed', 'verified'].includes(o.status) ? `<button class="btn block ghost" id="cancel">Cancel order</button><p class="xs muted" style="text-align:center">Demo: the pharmacy verifies and dispatches within seconds, or use the <a href="#/console">Partner console</a>.</p>` : ''}`;
    on(el, '[data-sub]', 'click', async (e, b) => { await act(b, () => POST(`/api/orders/${id}/substitution`, { approve: b.dataset.sub === '1' }), b.dataset.sub === '1' ? 'Substitute approved' : 'Item removed and refunded'); draw(); });
    const cf = $('#confirm', el); if (cf) cf.onclick = async (e) => { await act(e.target, () => POST(`/api/orders/${id}/confirm-receipt`), 'Payment released to pharmacy'); draw(); };
    const hd = $('#hand', el); if (hd) hd.onclick = async (e) => { await act(e.target, () => POST(`/api/provider/orders/${id}/handover`, { otp: $('#otpin', el).value }), 'Delivered'); draw(); };
    const cn = $('#cancel', el); if (cn) cn.onclick = async (e) => { await act(e.target, () => POST(`/api/orders/${id}/cancel`), 'Order cancelled · full refund'); draw(); };
    return o;
  }
  const o = await draw();
  if (!['completed', 'cancelled'].includes(o.status)) poll(async () => { if (document.activeElement && document.activeElement.id === 'otpin') return; await draw(); }, 3000);
});

route('/store', 'Medical store', async (el, _, q) => {
  const r = await GET('/api/store' + (q.q ? '?q=' + encodeURIComponent(q.q) : ''));
  const cart = store.get('cart', {});
  const draw = () => {
    const items = Object.entries(cart).filter(([, n]) => n > 0);
    const total = items.reduce((a, [d, n]) => a + ((r.items.find((x) => x.drug === d) || {}).best_price || 0) * n, 0);
    el.innerHTML = `
      <form class="searchbox" id="sf">${ic('search')}<input class="input" id="q" type="search" placeholder="Search medicines and devices" value="${esc(q.q || '')}"></form>
      <div class="banner info">${ic('info')}<div>Prescription medicines are ordered from your prescription so a pharmacist can verify them. Schedule X and narcotic drugs are never sold online.</div></div>
      <div class="card"><div class="list">${r.items.map((x) => `<div class="item"><span class="ico ${x.rx_required ? 'warn' : ''}">${ic('pill')}</span>
        <div class="grow stack tight"><strong>${esc(x.drug)}</strong><span class="small muted">${x.best_price ? `${inr(x.best_price)} / ${esc(x.unit)} · ${esc(x.pharmacy_name)}` : 'Out of stock nearby'}</span>${x.rx_required ? '<span class="pill warn" style="align-self:flex-start">Prescription required</span>' : ''}</div>
        ${x.rx_required ? '<a class="btn sm" href="#/rx">Use Rx</a>' : x.best_price ? `<div class="row" style="gap:4px"><button class="iconbtn" data-dec="${esc(x.drug)}" aria-label="Remove one">${ic('minus')}</button><span class="num" style="min-width:18px;text-align:center">${cart[x.drug] || 0}</span><button class="iconbtn" data-inc="${esc(x.drug)}" aria-label="Add one">${ic('plus')}</button></div>` : ''}
      </div>`).join('')}</div></div>
      ${items.length ? `<div class="card" style="position:sticky;bottom:76px"><div class="row between"><strong>${items.length} item${items.length > 1 ? 's' : ''} · ${inr(total)}</strong><span class="small muted">+ delivery if under ₹499</span></div>
        <label class="field" for="phs">Pharmacy<select class="input" id="phs"><option value="prv_ph_sanjeevani">Sanjeevani Pharmacy</option><option value="prv_ph_healthfirst">HealthFirst Chemist</option><option value="prv_ph_apna">Apna Medical Store</option></select></label>
        <button class="btn primary block" id="buy">Pay & order</button></div>` : ''}`;
    on(el, '[data-inc]', 'click', (e, b) => { cart[b.dataset.inc] = (cart[b.dataset.inc] || 0) + 1; store.set('cart', cart); draw(); });
    on(el, '[data-dec]', 'click', (e, b) => { cart[b.dataset.dec] = Math.max(0, (cart[b.dataset.dec] || 0) - 1); store.set('cart', cart); draw(); });
    $('#sf', el).onsubmit = (e) => { e.preventDefault(); go('#/store?q=' + encodeURIComponent($('#q', el).value)); };
    const buy = $('#buy', el);
    if (buy) buy.onclick = async () => {
      const o = await act(buy, () => POST('/api/orders', { pharmacy_id: $('#phs', el).value, items: items.map(([drug, qty]) => ({ drug, qty })) }), 'Order placed');
      store.set('cart', {}); go('#/order/' + o.id);
    };
  };
  draw();
});

route('/schedules', 'Medicine schedules', async (el, _, q) => {
  const member = q.member || S.me.id;
  const r = await GET('/api/schedules' + (member !== S.me.id ? '?member=' + member : ''));
  el.innerHTML = `${memberChips('medicines', member)}
    <div class="stack" style="gap:12px">${r.items.map((s) => `<div class="card">
      <div class="row between top"><div class="stack tight"><strong>${esc(s.drug)}</strong><span class="small muted">${esc(s.dose)} · ${s.times.map((t) => esc(t)).join(', ')}${s.instructions ? ' · ' + esc(s.instructions) : ''}</span><span class="xs muted">Until ${dt(s.end_on)}${s.prescription_id ? ' · from prescription' : ' · added manually'}</span></div>
        ${s.adherence_7d === null ? '' : `<span class="pill ${s.adherence_7d >= 80 ? 'ok' : s.adherence_7d >= 60 ? 'warn' : 'bad'}">${s.adherence_7d}% this week</span>`}</div>
      <div class="row between small"><span class="${s.days_left !== null && s.days_left <= 5 ? '' : 'muted'}" style="${s.days_left !== null && s.days_left <= 5 ? 'color:var(--warn);font-weight:600' : ''}">${s.days_left === null ? 'Stock not tracked' : s.days_left + ' days of stock left'}</span>
        <span class="row">${s.prescription_id && s.days_left !== null && s.days_left <= 5 ? `<a class="btn sm primary" href="#/rx/${s.prescription_id}">Refill</a>` : ''}<button class="btn sm ghost" data-stop="${s.id}">Stop</button></span></div>
    </div>`).join('') || '<div class="card"><div class="empty">No active medicines.</div></div>'}</div>
    <details class="card"><summary style="cursor:pointer;font-weight:600">${ic('plus')} Add a medicine manually</summary>
      <form id="add" class="stack" style="margin-top:10px">
        <label class="field" for="drug">Medicine<input class="input" id="drug" required placeholder="e.g. Vitamin B12 1500mcg"></label>
        <div class="grid2"><label class="field" for="t1">Time<input class="input" id="t1" type="time" value="09:00"></label><label class="field" for="days">For days<input class="input num" id="days" type="number" value="30"></label></div>
        <label class="field" for="instr">Instructions<input class="input" id="instr" placeholder="after food"></label>
        <button class="btn primary">Add reminder</button></form></details>`;
  on(el, '[data-member]', 'click', (e, b) => go('#/schedules?member=' + b.dataset.member));
  on(el, '[data-stop]', 'click', async (e, b) => { await act(b, () => PUT('/api/schedules/' + b.dataset.stop, { active: false }), 'Reminder stopped'); render(); });
  $('#add', el).onsubmit = async (e) => { e.preventDefault(); await act(e.submitter, () => POST('/api/schedules', { member_id: member, drug: $('#drug', el).value, times: [$('#t1', el).value], days: Number($('#days', el).value), instructions: $('#instr', el).value }), 'Reminder added'); render(); };
});
