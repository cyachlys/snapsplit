const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// Auto-load .env for local development if present
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    }
  } catch {}
}

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'snapsplit.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient({
  url,
  authToken
});

const q = async (s, ...a) => {
  const r = await db.execute({ sql: s, args: a });
  return Array.from(r.rows);
};

const one = async (s, ...a) => {
  const r = await db.execute({ sql: s, args: a });
  return r.rows[0];
};

const run = async (s, ...a) => {
  const r = await db.execute({ sql: s, args: a });
  return {
    changes: r.rowsAffected,
    lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : 0
  };
};

let initPromise = null;
async function ensureDb() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.executeMultiple(`
        create table if not exists users(id integer primary key,email text unique,name text,hash text);
        create table if not exists sessions(token text primary key,user_id integer);
        create table if not exists receipts(id integer primary key,user_id integer,merchant text,date text,category text,tax real,total real,my_share real,is_split integer,items text);
        create table if not exists friends(id integer primary key,user_id integer,name text,unique(user_id,name));
        create table if not exists debts(id integer primary key,user_id integer,receipt_id integer,friend text,amount real,paid real default 0,created text);
        create table if not exists admin_sessions(token text primary key,created_at text);
      `);
    })();
  }
  return initPromise;
}

module.exports = { db, q, one, run, ensureDb };
