'use strict';
// SQLite adapter on Node's built-in node:sqlite (Node 22.5+). Swap this file
// for a pg adapter with the same four methods to run on PostgreSQL.

const { DatabaseSync } = require('node:sqlite');

function clean(params) {
  return (params || []).map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 3000;');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const plain = (row) => (row ? Object.assign({}, row) : row);
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, params) => stmt(sql).all(...clean(params)).map(plain),
    get: (sql, params) => plain(stmt(sql).get(...clean(params))),
    run: (sql, params) => stmt(sql).run(...clean(params)),
    close: () => db.close(),
  };
}

module.exports = { openDb };
