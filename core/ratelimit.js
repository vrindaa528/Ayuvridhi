'use strict';
// Sliding-window rate limiter kept in memory. Good for one instance; for
// several instances put the same interface on Redis (see docs/DECISIONS.md).
// Works in Node and in the browser prototype (no Node APIs).

function createRateLimiter(now) {
  const hits = new Map(); // key -> array of timestamps (ms)

  // Returns { ok: true } or { ok: false, retry_after_sec }.
  function take(key, limit, windowMs) {
    const t = now().getTime();
    const fresh = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (fresh.length >= limit) {
      hits.set(key, fresh);
      return { ok: false, retry_after_sec: Math.ceil((fresh[0] + windowMs - t) / 1000) };
    }
    fresh.push(t);
    hits.set(key, fresh);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
    }
    return { ok: true };
  }

  function reset() {
    hits.clear();
  }

  return { take, reset };
}

module.exports = { createRateLimiter };
