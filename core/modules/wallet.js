'use strict';
// wallet: one ledger for every healthcare payment. v1 is a ledger over a
// licensed payment aggregator (UPI / cards) with escrow for orders and
// bookings — not a stored-value balance (that needs an RBI PPI licence).

const { must, json, localDay, addMinutes } = require('../util');

const PLANS = {
  family_care: { name: 'Family Care Plan', price: 199, period: 'month', perks: ['Free delivery on all orders', '2 free GP video consults / month', '10% off lab tests'] },
  chronic_care: { name: 'Chronic Care Pack', price: 349, period: 'month', perks: ['Monthly medicine auto-refill', 'Quarterly HbA1c / lipid test', 'Dedicated care coordinator'] },
};

function register(r, c) {
  const { db } = c;

  r.get('/api/wallet', ({ user, query }) => {
    const filter = query.member ? ' AND member_id = ?' : '';
    const args = query.member ? [user.id, query.member] : [user.id];
    if (query.member && query.member !== user.id) c.consent.resolve(user, query.member, 'payments', 'view payments');
    const rows = db.all(
      `SELECT t.*, u.name AS member_name FROM transactions t LEFT JOIN users u ON u.id = t.member_id
       WHERE t.payer_id = ?${filter} ORDER BY t.created_at DESC LIMIT 100`,
      args
    );
    const monthStart = localDay(c.now()).slice(0, 7);
    const thisMonth = rows.filter((t) => t.created_at && localDay(new Date(t.created_at)).slice(0, 7) === monthStart);
    const spent = thisMonth.filter((t) => t.direction === 'debit' && t.status !== 'failed').reduce((a, t) => a + t.amount, 0);
    const refunded = thisMonth.filter((t) => t.direction === 'credit').reduce((a, t) => a + t.amount, 0);
    const byCategory = {};
    for (const t of thisMonth) if (t.direction === 'debit') byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    const held = rows.filter((t) => t.escrow_state === 'held').reduce((a, t) => a + t.amount, 0);
    const byMember = {};
    for (const t of thisMonth) if (t.direction === 'debit') byMember[t.member_name || 'You'] = (byMember[t.member_name || 'You'] || 0) + t.amount;
    return {
      summary: { month: monthStart, spent, refunded, net: spent - refunded, in_escrow: held, by_category: byCategory, by_member: byMember },
      transactions: rows,
      subscriptions: db.all("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'", [user.id]).map((s) => Object.assign(s, { perks: (PLANS[s.plan] || {}).perks || [] })),
      plans: Object.keys(PLANS).map((k) => Object.assign({ id: k }, PLANS[k])),
      offers: db.all('SELECT * FROM offers WHERE active = 1', []),
      method: { label: `UPI · ${user.name.split(' ')[0].toLowerCase()}@okaxis`, note: 'Payments processed by a licensed payment aggregator' },
    };
  });

  r.post('/api/wallet/offers/validate', ({ body }) => {
    const d = offerDiscount(body.code, body.category, Number(body.amount) || 0);
    must(d > 0, 400, 'This code is not valid for this payment');
    return { discount: d };
  });

  r.post('/api/wallet/subscriptions', ({ user, body }) => {
    const plan = PLANS[body.plan];
    must(plan, 400, 'Unknown plan');
    must(!db.get("SELECT id FROM subscriptions WHERE user_id = ? AND plan = ? AND status = 'active'", [user.id, body.plan]), 400, 'You already have this plan');
    const id = c.util.id('sub');
    db.run('INSERT INTO subscriptions (id, user_id, plan, price, period, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      user.id,
      body.plan,
      plan.price,
      plan.period,
      'active',
      localDay(addMinutes(c.now(), 30 * 1440)),
    ]);
    charge({ payer: user.id, member: user.id, category: 'subscription', ref_id: id, description: `${plan.name} · UPI AutoPay mandate`, amount: plan.price, escrow: false });
    return { id };
  });

  r.post('/api/wallet/subscriptions/:id/cancel', ({ user, params }) => {
    const s = db.get('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [params.id, user.id]);
    must(s, 404, 'Subscription not found');
    db.run("UPDATE subscriptions SET status = 'cancelled' WHERE id = ?", [s.id]);
  });

  // Statement for reimbursement / tax (80D) — CSV.
  r.get('/api/wallet/statement', ({ user }) => {
    const rows = db.all(
      'SELECT t.created_at, u.name AS member, t.category, t.description, t.direction, t.amount, t.status FROM transactions t LEFT JOIN users u ON u.id = t.member_id WHERE t.payer_id = ? ORDER BY t.created_at',
      [user.id]
    );
    const head = 'date,member,category,description,type,amount_inr,status';
    const lines = rows.map((t) => [localDay(new Date(t.created_at)), t.member, t.category, `"${t.description.replace(/"/g, "'")}"`, t.direction, t.amount, t.status].join(','));
    return { csv: [head].concat(lines).join('\n'), filename: `aayuvridhi-statement-${localDay(c.now())}.csv` };
  });

  function offerDiscount(code, category, amount) {
    if (!code) return 0;
    const o = db.get('SELECT * FROM offers WHERE code = ? AND active = 1', [String(code).toUpperCase()]);
    if (!o || (o.category !== 'all' && o.category !== category)) return 0;
    return Math.min(o.max_off, Math.round((amount * o.pct) / 100));
  }

  function charge(t) {
    const discount = offerDiscount(t.offer_code, t.category, t.amount);
    const amount = Math.max(0, t.amount - discount);
    const id = c.util.id('txn');
    db.run(
      'INSERT INTO transactions (id, payer_id, member_id, category, ref_id, description, amount, direction, method, status, escrow_state, offer_code, discount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, t.payer, t.member || t.payer, t.category, t.ref_id, t.description, amount, 'debit', 'UPI', 'captured', t.escrow ? 'held' : 'released', discount ? String(t.offer_code).toUpperCase() : null, discount, c.now().toISOString()]
    );
    c.events.emit('payment.captured', { txn_id: id });
    return db.get('SELECT * FROM transactions WHERE id = ?', [id]);
  }

  function release(txnId) {
    if (!txnId) return;
    db.run("UPDATE transactions SET escrow_state = 'released' WHERE id = ? AND escrow_state = 'held'", [txnId]);
  }

  function refund(txnId, amount, reason) {
    const t = db.get('SELECT * FROM transactions WHERE id = ?', [txnId]);
    if (!t) return null;
    const already = db.get("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE ref_id = ? AND direction = 'credit'", [t.id]).s;
    const amt = Math.min(t.amount - already, amount === null || amount === undefined ? t.amount : amount);
    if (amt <= 0) return null;
    const id = c.util.id('rfd');
    db.run(
      'INSERT INTO transactions (id, payer_id, member_id, category, ref_id, description, amount, direction, method, status, escrow_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, t.payer_id, t.member_id, t.category, t.id, `Refund · ${reason || t.description}`, amt, 'credit', t.method, 'refunded_to_source', 'n/a', c.now().toISOString()]
    );
    db.run("UPDATE transactions SET escrow_state = ? WHERE id = ?", [amt + already >= t.amount ? 'refunded' : 'partly_refunded', t.id]);
    c.events.emit('refund.issued', { txn_id: t.id, refund_id: id, amount: amt });
    return id;
  }

  c._wallet = { charge, release, refund, offerDiscount };
}

function api(c) {
  return {
    charge: (t) => c._wallet.charge(t),
    release: (id) => c._wallet.release(id),
    refund: (id, amt, reason) => c._wallet.refund(id, amt, reason),
    offerDiscount: (code, cat, amt) => c._wallet.offerDiscount(code, cat, amt),
  };
}

module.exports = { register, api, PLANS };
