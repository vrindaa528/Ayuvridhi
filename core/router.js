'use strict';
const { HttpError } = require('./util');

// Minimal method + path router: '/api/orders/:id/verify' style patterns.
function createRouter() {
  const routes = [];

  function add(method, pattern, opts, handler) {
    if (typeof opts === 'function') {
      handler = opts;
      opts = {};
    }
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '/?$'
    );
    // opts.roles: only these users.role values may call it (checked on every request).
    // opts.rate:  [{ by: 'ip' | 'phone' | 'user', name, limit, windowMs }] rate limits.
    routes.push({ method, pattern, re, keys, handler, auth: opts.auth !== false, roles: opts.roles || null, rate: opts.rate || null });
  }

  function match(method, path) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return null;
  }

  return {
    get: (p, o, h) => add('GET', p, o, h),
    post: (p, o, h) => add('POST', p, o, h),
    put: (p, o, h) => add('PUT', p, o, h),
    del: (p, o, h) => add('DELETE', p, o, h),
    match,
    routes,
  };
}

module.exports = { createRouter, HttpError };
