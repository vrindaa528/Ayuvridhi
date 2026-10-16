/* Module 6 (records + lifelong timeline + Emergency Card) and Module 5 (wallet). */
'use strict';

const STAGES = [['early_childhood', 'Early childhood', '0–5'], ['youth', 'Youth & fitness', '6–17'], ['adulthood', 'Adulthood', '18–59'], ['senior', 'Senior care', '60+']];

route('/records', 'Health records', async (el, _, q) => {
  const member = q.member || S.me.id;
  const type = q.type || '';
  const [t, trends] = await Promise.all([
    GET(`/api/records/timeline?${member !== S.me.id ? 'member=' + member + '&' : ''}${type ? 'type=' + type : ''}${q.q ? '&q=' + encodeURIComponent(q.q) : ''}`),
    GET('/api/records/trends' + (member !== S.me.id ? '?member=' + member : '')),
  ]);
  const p = t.patient;
  const byYear = {};
  for (const r of t.items) (byYear[r.date.slice(0, 4)] = byYear[r.date.slice(0, 4)] || []).push(r);
  const years = Object.keys(byYear).sort().reverse();
  const nav = (patch) => { const n = Object.assign({ member: member !== S.me.id ? member : '' }, q, patch); go('#/records?' + Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')); };
  const total = Object.values(t.counts).reduce((a, b) => a + b, 0);
  el.innerHTML = `
    ${memberChips('reports', member)}
    <div class="card">
      <div class="row top"><span class="av lg ${avClass(p.id)}">${initials(p.name)}</span><div class="grow stack tight"><h2>${esc(p.name)}</h2><span class="small muted">${p.age !== null ? p.age + ' yrs · ' : ''}${total} records${p.abha_id ? ` · ABHA <span class="mono">${esc(p.abha_id)}</span>` : ''}</span></div>
      <a class="btn sm" href="#/emergency-card${member !== S.me.id ? '?member=' + member : ''}">${ic('card')}Emergency Card</a></div>
      <div class="stack tight"><span class="eyebrow">Life stage</span>
        <div class="grid2" style="grid-template-columns:repeat(4,1fr);gap:6px">${STAGES.map(([k, l, a]) => `<div class="fact" style="${p.stage && p.stage.key === k ? 'border-color:var(--brand);background:var(--brand-soft)' : ''}"><div class="k">${a}</div><div class="v small" style="font-size:12.5px">${l}</div></div>`).join('')}</div></div>
    </div>
    ${trends.items.length ? `<section class="section"><div class="section-head"><h2>Trends</h2></div>
      <div class="stack">${trends.items.map((tr) => { const last = tr.points[tr.points.length - 1]; const prev = tr.points[tr.points.length - 2]; const nums = (String(tr.ref_range).match(/[\d.]+/g) || []).map(Number); const ref = nums.length ? nums[nums.length - 1] : NaN; const lowerBetter = !String(tr.ref_range).includes('>'); const better = lowerBetter ? last.value <= prev.value : last.value >= prev.value; return `<div class="card">
        <div class="row between"><strong>${esc(tr.test)}</strong><span class="pill ${better ? 'ok' : 'warn'}">${better ? 'Improving' : 'Watch'} · ${last.value} ${esc(tr.unit)}</span></div>
        ${spark(tr.points, isNaN(ref) ? null : ref)}
        <div class="row between xs muted"><span>${dshort(tr.points[0].date)}</span><span>Target ${esc(tr.ref_range)} ${esc(tr.unit)} (dashed)</span><span>${dshort(last.date)}</span></div></div>`; }).join('')}</div></section>` : ''}
    <form class="searchbox" id="sf">${ic('search')}<input class="input" id="q" type="search" placeholder="Search reports, doctors, tests" value="${esc(q.q || '')}"></form>
    <div class="chips"><button class="chip ${!type ? 'on' : ''}" data-type="">All</button>${t.types.filter((k) => t.counts[k]).map((k) => `<button class="chip ${type === k ? 'on' : ''}" data-type="${k}">${typeLabel[k]} <span class="muted">${t.counts[k]}</span></button>`).join('')}</div>
    ${t.upcoming.length && !type ? `<div class="card tint"><span class="eyebrow">Upcoming care</span><div class="list">${t.upcoming.map((r) => `<a class="item small" href="${esc(r.action || '#/home')}"><span class="ico ${r.kind === 'vaccination' ? 'sun' : 'info'}" style="width:30px;height:30px">${ic(r.kind === 'vaccination' ? 'shield' : 'clock')}</span><span class="grow">${esc(r.title)}</span><span class="muted">${dayLabel(r.due_on)}</span></a>`).join('')}</div></div>` : ''}
    <section class="section" aria-label="Care journey timeline">
      ${years.map((y) => `<div class="stack" style="gap:4px"><div class="year">${y}<span class="xs muted" style="font-weight:500">${byYear[y][0].stage ? esc(byYear[y][0].stage.label) + ' · age ' + byYear[y][0].age_at : ''}</span></div>
        ${byYear[y].map((r) => `<a class="tl" href="#/record/${r.id}"><span class="ico ${r.type === 'lab_report' ? 'info' : r.type === 'vaccination' || r.type === 'milestone' ? 'sun' : r.type === 'emergency' ? 'bad' : ''}">${ic(typeIcon[r.type] || 'records')}</span>
          <div class="stack tight" style="min-width:0"><div class="row between"><strong class="ellipsis">${esc(r.title)}</strong><span class="xs muted" style="white-space:nowrap">${dshort(r.date)}</span></div><span class="small muted ellipsis">${esc(typeLabel[r.type] || '')}${r.provider ? ' · ' + esc(r.provider) : ''}</span>${r.summary ? `<span class="small ellipsis">${esc(r.summary)}</span>` : ''}</div></a>`).join('')}</div>`).join('') || '<div class="card"><div class="empty">No records match.</div></div>'}
    </section>
    <button class="btn primary block" id="up">${ic('upload')}Upload a report or document</button>`;
  on(el, '[data-member]', 'click', (e, b) => go('#/records?member=' + b.dataset.member));
  on(el, '[data-type]', 'click', (e, b) => nav({ type: b.dataset.type }));
  $('#sf', el).onsubmit = (e) => { e.preventDefault(); nav({ q: $('#q', el).value }); };
  $('#up', el).onclick = () => sheet(`<h2>Add to ${esc(first(p.name))}’s records</h2>
    <label class="field" for="rf">File<input class="input" type="file" id="rf" accept="image/*,application/pdf"></label>
    <label class="field" for="rt">Title<input class="input" id="rt" placeholder="Auto-filled from the file name"></label>
    <div class="grid2"><label class="field" for="rty">Type<select class="input" id="rty"><option value="">Detect automatically</option>${t.types.map((k) => `<option value="${k}">${typeLabel[k]}</option>`).join('')}</select></label>
    <label class="field" for="rd">Date<input class="input" type="date" id="rd" value="${today()}"></label></div>
    <label class="field" for="rp">Doctor / lab / hospital<input class="input" id="rp"></label>
    <details><summary class="small" style="cursor:pointer">Add a test value (for trends)</summary><div class="grid3" style="margin-top:8px"><input class="input" id="vt" placeholder="Test e.g. HbA1c"><input class="input num" id="vv" placeholder="Value"><input class="input" id="vu" placeholder="Unit"></div></details>
    <button class="btn primary" id="save">Save record</button>`, (sh, close) => {
    $('#rf', sh).onchange = (e) => { const f = e.target.files[0]; if (f && !$('#rt', sh).value) $('#rt', sh).value = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '); };
    $('#save', sh).onclick = async (e) => {
      const f = $('#rf', sh).files[0];
      const vals = $('#vt', sh).value && $('#vv', sh).value ? [{ test: $('#vt', sh).value, value: Number($('#vv', sh).value), unit: $('#vu', sh).value }] : [];
      const r = await act(e.target, () => POST('/api/records', { member_id: member, title: $('#rt', sh).value || undefined, file_name: f ? f.name : undefined, type: $('#rty', sh).value || undefined, date: $('#rd', sh).value, provider: $('#rp', sh).value, values: vals }));
      close(); toast(r.auto_classified ? `Saved as ${typeLabel[r.type]}` : 'Saved to records'); render();
    };
  });
}, { tab: 'records', root: true });

route('/record/:id', 'Record', async (el, { id }) => {
  const r = await GET('/api/records/' + id);
  el.innerHTML = `
    <div class="card"><div class="row top"><span class="ico">${ic(typeIcon[r.type] || 'records')}</span><div class="grow stack tight"><span class="eyebrow">${esc(typeLabel[r.type] || r.type)}</span><h2>${esc(r.title)}</h2><span class="small muted">${esc(r.provider || '')} · ${dt(r.date)}</span></div></div>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
      ${r.values.length ? `<div class="tablewrap"><table class="small" style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:6px 0">Test</th><th style="text-align:right">Result</th><th style="text-align:right">Reference</th></tr></thead><tbody>${r.values.map((v) => `<tr style="border-top:1px solid var(--line)"><td style="padding:8px 0">${esc(v.test)}</td><td class="num" style="text-align:right;font-weight:600">${v.value} ${esc(v.unit)}</td><td class="muted" style="text-align:right">${esc(v.ref_range)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <dl class="kv small"><dt>File</dt><dd class="mono">${esc(r.file_name || '—')}</dd><dt>Source</dt><dd>${esc({ consult: 'In-app consultation', partner_lab: 'Partner lab (auto-ingested)', pharmacy: 'Pharmacy order', upload: 'Uploaded by you', sos: 'Emergency SOS', seed: 'Imported history' }[r.source] || r.source)}</dd></dl></div>
    <div class="card"><h3>Share with a doctor</h3><p class="small muted">Creates a link that expires. Every opening is logged.</p>
      <div class="row"><select class="input grow" id="ttl"><option value="60">1 hour</option><option value="1440" selected>24 hours</option><option value="10080">7 days</option></select><button class="btn primary" id="share">${ic('share')}Create link</button></div><div id="link"></div></div>`;
  $('#share', el).onclick = async (e) => {
    const s = await act(e.target, () => POST(`/api/records/${id}/share`, { minutes: Number($('#ttl', el).value) }));
    const url = (window.AY_TRANSPORT ? 'https://aayuvridhi.app' : location.origin) + s.path;
    $('#link', el).innerHTML = `<div class="banner ok" style="margin-top:8px"><div class="stack tight" style="min-width:0"><span class="mono xs" style="overflow-wrap:anywhere">${esc(url)}</span><span class="xs muted">Expires ${dt(s.expires_at)}, ${tm(s.expires_at)}</span><button class="btn sm" id="cp" style="align-self:flex-start">${ic('copy')}Copy link</button></div></div>`;
    $('#cp', el).onclick = () => copyText(url);
  };
});

route('/emergency-card', 'Emergency Card', async (el, _, q) => {
  const member = q.member || S.me.id;
  const c = await GET('/api/emergency-card' + (member !== S.me.id ? '?member=' + member : ''));
  const list = (arr) => arr.join(', ');
  el.innerHTML = `
    <div class="sos-live" style="border-width:1px">
      <div class="head"><span>EMERGENCY CARD</span><span class="pill bad">Shared only during SOS</span></div>
      <div class="row"><span class="av lg ${avClass(c.patient_id)}">${initials(c.name)}</span><div class="grow stack tight"><h2>${esc(c.name)}</h2><span class="small">${c.age !== null ? c.age + ' yrs · ' : ''}Blood group <strong>${esc(c.blood_group || 'not set')}</strong></span></div></div>
      <dl class="kv small"><dt>Allergies</dt><dd>${esc(list(c.allergies) || 'None listed')}</dd><dt>Conditions</dt><dd>${esc(list(c.conditions) || 'None listed')}</dd><dt>Medicines</dt><dd>${esc(list(c.medicines) || 'None')}</dd><dt>Contacts</dt><dd>${c.contacts.map((x) => `${esc(x.name)} (${esc(x.relation)}) <span class="mono">${esc(x.phone)}</span>`).join('<br>') || 'None — add one'}</dd></dl>
    </div>
    <form class="card" id="f"><h3>Edit</h3>
      <label class="field" for="bg">Blood group<select class="input" id="bg">${['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => `<option ${b === c.blood_group ? 'selected' : ''} value="${b}">${b || 'Unknown'}</option>`).join('')}</select></label>
      <label class="field" for="al">Allergies (comma separated)<input class="input" id="al" value="${esc(list(c.allergies))}"></label>
      <label class="field" for="co">Chronic conditions<input class="input" id="co" value="${esc(list(c.conditions))}"></label>
      <label class="field" for="ct">Emergency contacts (Name | Relation | Phone, one per line)<textarea class="input" id="ct">${esc(c.contacts.map((x) => `${x.name} | ${x.relation} | ${x.phone}`).join('\n'))}</textarea></label>
      <button class="btn primary">Save Emergency Card</button></form>`;
  $('#f', el).onsubmit = async (e) => {
    e.preventDefault();
    const split = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
    const contacts = $('#ct', el).value.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((x) => x[0]).map(([name, relation, phone]) => ({ name, relation: relation || '', phone: phone || '' }));
    await act(e.submitter, () => PUT('/api/emergency-card', { member_id: member, blood_group: $('#bg', el).value, allergies: split($('#al', el).value), conditions: split($('#co', el).value), contacts }), 'Emergency Card saved');
    render();
  };
});

route('/wallet', 'Wallet', async (el) => {
  const w = await GET('/api/wallet');
  const s = w.summary;
  const cats = Object.entries(s.by_category).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));
  const members = Object.keys(s.by_member);
  el.innerHTML = `
    <div class="pass">
      <div class="row between"><span class="k">Aayuvridhi Healthcare Pass</span>${ic('wallet')}</div>
      <div class="stack tight"><span class="k">Spent on health · ${new Date(s.month + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span><span class="big num">${inr(s.net)}</span></div>
      <div class="row between small" style="opacity:.9"><span>${esc(S.me.name)} · ${members.length} member${members.length === 1 ? '' : 's'} paid for</span><span>${esc(w.method.label)}</span></div>
    </div>
    <div class="tiles"><div class="tile"><div class="v">${inr(s.in_escrow)}</div><div class="k">Held safely until delivery or confirmation</div></div><div class="tile"><div class="v" style="color:var(--ok)">${inr(s.refunded)}</div><div class="k">Refunded this month</div></div></div>
    ${cats.length ? `<div class="card"><h3>Where it went</h3><div class="bars">${cats.map(([k, v]) => `<div class="barrow"><span>${esc(catLabel[k] || cap(k))}</span><span class="track"><i style="width:${(v / maxCat) * 100}%"></i></span><span class="amt" style="text-align:right">${inr(v)}</span></div>`).join('')}</div></div>` : ''}
    <section class="section"><div class="section-head"><h2>Transactions</h2><button class="linkbtn" id="stmt">Statement (CSV)</button></div>
      <div class="card"><div class="list">${w.transactions.map((t) => `<div class="item"><span class="ico ${t.direction === 'credit' ? '' : 'info'}">${ic(t.category === 'pharmacy' ? 'pill' : t.category === 'lab' ? 'lab' : t.category === 'subscription' ? 'refresh' : 'doctor')}</span>
        <div class="grow stack tight"><strong class="small ellipsis">${esc(t.description)}</strong><span class="xs muted">${dshort(t.created_at)} · ${esc(t.member_name ? first(t.member_name) : '')}${t.escrow_state === 'held' ? ' · <span style="color:var(--warn)">held in escrow</span>' : t.escrow_state === 'refunded' ? ' · refunded' : t.escrow_state === 'partly_refunded' ? ' · partly refunded' : ''}${t.discount ? ' · saved ' + inr(t.discount) : ''}</span></div>
        <span class="amt ${t.direction === 'credit' ? 'plus' : ''}">${t.direction === 'credit' ? '+' : '−'}${inr(t.amount)}</span></div>`).join('') || '<div class="empty">No payments yet.</div>'}</div></div></section>
    <section class="section"><h2>Plans</h2>
      ${w.plans.map((p) => { const active = w.subscriptions.find((x) => x.plan === p.id); return `<div class="card ${active ? 'tint' : ''}"><div class="row between"><strong>${esc(p.name)}</strong><span class="amt">${inr(p.price)}<span class="xs muted">/${p.period}</span></span></div>
        <ul class="small" style="margin:0;padding-left:18px">${p.perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${active ? `<div class="row between"><span class="pill ok">Active · renews ${dshort(active.renews_on)}</span><button class="btn sm ghost" data-cancel="${active.id}">Cancel</button></div>` : `<button class="btn sm primary" data-plan="${p.id}" style="align-self:flex-start">Subscribe with UPI AutoPay</button>`}</div>`; }).join('')}
    </section>
    <section class="section"><h2>Offers</h2><div class="card"><div class="list">${w.offers.map((o) => `<div class="item"><span class="ico sun">${ic('spark')}</span><div class="grow stack tight"><strong class="mono">${esc(o.code)}</strong><span class="small muted">${esc(o.title)}</span></div><button class="btn sm" data-copy="${esc(o.code)}">Copy</button></div>`).join('')}</div></div></section>
    <p class="xs muted">${esc(w.method.note)}. Aayuvridhi does not store card or bank details. Refunds always return to the original payment method.</p>`;
  on(el, '[data-plan]', 'click', async (e, b) => { await act(b, () => POST('/api/wallet/subscriptions', { plan: b.dataset.plan }), 'Subscribed'); render(); });
  on(el, '[data-cancel]', 'click', async (e, b) => { await act(b, () => POST(`/api/wallet/subscriptions/${b.dataset.cancel}/cancel`), 'Plan cancelled'); render(); });
  on(el, '[data-copy]', 'click', (e, b) => copyText(b.dataset.copy));
  $('#stmt', el).onclick = async () => {
    const st = await GET('/api/wallet/statement');
    sheet(`<h2>Statement</h2><p class="small muted">For insurance reimbursement or Section 80D. Copy and paste into a spreadsheet.</p><textarea class="input mono xs" id="csv" rows="10" readonly>${esc(st.csv)}</textarea><div class="row"><button class="btn grow" data-close>Close</button><button class="btn primary grow" id="cp">${ic('copy')}Copy CSV</button></div>`, (sh) => { $('#cp', sh).onclick = () => copyText(st.csv); });
  };
}, { tab: 'wallet', root: true });
