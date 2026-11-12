/**
 * Migration Script: Local SQLite (snapsplit.db) -> Cloud Turso
 * Usage:
 *   1. Set your TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in environment or .env
 *   2. Run: node migrate-to-turso.js
 */

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// Load environment variables from .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
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
}

const remoteUrl = process.env.TURSO_DATABASE_URL;
const remoteToken = process.env.TURSO_AUTH_TOKEN;

if (!remoteUrl || !remoteToken) {
  console.error('\n❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN!');
  console.error('Please set them before running the migration:');
  console.error('   $env:TURSO_DATABASE_URL="libsql://your-db.turso.io"');
  console.error('   $env:TURSO_AUTH_TOKEN="your-token"');
  console.error('   node migrate-to-turso.js\n');
  process.exit(1);
}

const localDbFile = path.join(__dirname, 'snapsplit.db');
if (!fs.existsSync(localDbFile)) {
  console.error(`\n❌ Local database file not found at ${localDbFile}\n`);
  process.exit(1);
}

async function migrate() {
  console.log('🔄 Connecting to local database...');
  const localClient = createClient({ url: `file:${localDbFile}` });

  console.log(`🚀 Connecting to remote Turso database (${remoteUrl})...`);
  const remoteClient = createClient({ url: remoteUrl, authToken: remoteToken });

  console.log('📦 Ensuring remote schema exists...');
  await remoteClient.executeMultiple(`
    create table if not exists users(id integer primary key,email text unique,name text,hash text);
    create table if not exists sessions(token text primary key,user_id integer);
    create table if not exists receipts(id integer primary key,user_id integer,merchant text,date text,category text,tax real,total real,my_share real,is_split integer,items text);
    create table if not exists friends(id integer primary key,user_id integer,name text,unique(user_id,name));
    create table if not exists debts(id integer primary key,user_id integer,receipt_id integer,friend text,amount real,paid real default 0,created text);
    create table if not exists admin_sessions(token text primary key,created_at text);
  `);

  // Migrate Users
  const users = (await localClient.execute('select * from users')).rows;
  console.log(`\n👥 Migrating ${users.length} users...`);
  for (const u of users) {
    await remoteClient.execute({
      sql: 'insert or replace into users(id, email, name, hash) values(?,?,?,?)',
      args: [u.id, u.email, u.name, u.hash]
    });
  }

  // Migrate Sessions
  const sessions = (await localClient.execute('select * from sessions')).rows;
  console.log(`🔑 Migrating ${sessions.length} sessions...`);
  for (const s of sessions) {
    await remoteClient.execute({
      sql: 'insert or replace into sessions(token, user_id) values(?,?)',
      args: [s.token, s.user_id]
    });
  }

  // Migrate Friends
  const friends = (await localClient.execute('select * from friends')).rows;
  console.log(`🤝 Migrating ${friends.length} friends...`);
  for (const f of friends) {
    await remoteClient.execute({
      sql: 'insert or replace into friends(id, user_id, name) values(?,?,?)',
      args: [f.id, f.user_id, f.name]
    });
  }

  // Migrate Receipts
  const receipts = (await localClient.execute('select * from receipts')).rows;
  console.log(`🧾 Migrating ${receipts.length} receipts...`);
  for (const r of receipts) {
    await remoteClient.execute({
      sql: 'insert or replace into receipts(id, user_id, merchant, date, category, tax, total, my_share, is_split, items) values(?,?,?,?,?,?,?,?,?,?)',
      args: [r.id, r.user_id, r.merchant, r.date, r.category, r.tax, r.total, r.my_share, r.is_split, r.items]
    });
  }

  // Migrate Debts
  const debts = (await localClient.execute('select * from debts')).rows;
  console.log(`💸 Migrating ${debts.length} debts...`);
  for (const d of debts) {
    await remoteClient.execute({
      sql: 'insert or replace into debts(id, user_id, receipt_id, friend, amount, paid, created) values(?,?,?,?,?,?,?)',
      args: [d.id, d.user_id, d.receipt_id, d.friend, d.amount, d.paid, d.created]
    });
  }

  console.log('\n✅ All data successfully migrated to Turso!\n');
}

migrate().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
