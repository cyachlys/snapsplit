const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { db, q, one, run, ensureDb } = require('./db');

const ADMIN_KEY = process.env.ADMIN_KEY || 'splitwoi#admin';
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const secureFlag = isProd ? '; Secure' : '';

const send = (res, c, o, h = {}) => {
  if (typeof res.setHeader === 'function') {
    res.statusCode = c;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    for (const [k, v] of Object.entries(h)) {
      res.setHeader(k, v);
    }
    res.end(JSON.stringify(o));
  } else {
    res.writeHead(c, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...h
    });
    res.end(JSON.stringify(o));
  }
};

const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 32).toString('hex');
const check = (p, h) => hash(p, h.split(':')[0]) === h;
const num = v => Math.max(0, Math.round(Number(v) || 0));

const isAuthorizedAdmin = async (req, b) => {
  const tok = req.headers['x-admin-token'] || b?.adminToken;
  const key = req.headers['x-admin-key'];
  if (key === ADMIN_KEY) return true;
  if (!tok) return false;
  const s = await one('select token from admin_sessions where token=?', tok);
  return !!s;
};

function split(items, tax) {
  const sub = {};
  let all = 0;
  for (const it of items) {
    const p = it.people?.length ? it.people : ['Me'];
    p.forEach(n => sub[n] = (sub[n] || 0) + it.price / p.length);
    all += it.price;
  }
  const r = {};
  for (const n in sub) r[n] = Math.round(sub[n] + (all ? tax * sub[n] / all : 0));
  return r;
}

function guessCategory(text) {
  const t = text.toLowerCase();
  if (/coffee|cafe|resto|restaurant|warung|makan|food|bakery|kitchen|bistro|burger|pizza|sushi|tea|dimsum|beverage|kopi|nasi|mie|bakso|ayam|bebek|indomie/i.test(t)) return 'Food';
  if (/mart|supermarket|indomaret|alfamart|store|shop|mall|grocer|market|hypermart|carrefour|lottemart/i.test(t)) return 'Shopping';
  if (/gojek|grab|taxi|fuel|pertamina|transport|toll|parking|spbu|shell|bensin|bbm|bus|ojek|krl|mrt/i.test(t)) return 'Transport';
  if (/cinema|bioskop|xxi|game|ktv|fun|play|karaoke|bowling|esports/i.test(t)) return 'Fun';
  if (/pln|pdam|telkom|wifi|electric|water|bill|token|listrik|air|internet|pulsa|iuran/i.test(t)) return 'Bills';
  return 'Other';
}

function mapRapidApiReceipt(data) {
  let merchant = 'Untitled';
  if (typeof data.merchant === 'string') merchant = data.merchant;
  else if (data.merchant?.name) merchant = data.merchant.name;
  else if (data.vendor?.name) merchant = data.vendor.name;
  else if (data.supplier?.name) merchant = data.supplier.name;

  let date = new Date().toISOString().slice(0, 10);
  const rawDate = data.transaction?.date || data.date || data.invoice_date || data.receipt_date;
  if (rawDate) {
    const ds = String(rawDate);
    if (/^\d{4}-\d{2}-\d{2}/.test(ds)) date = ds.slice(0, 10);
  }

  let tax = 0;
  if (data.totals?.tax != null) tax = Number(data.totals.tax);
  else if (data.totals?.service_charge != null) tax += Number(data.totals.service_charge);
  else if (data.tax != null) tax = Number(data.tax);
  tax = Math.max(0, Math.round(Number(tax) || 0));

  const rawItems = data.line_items || data.items || data.products || [];
  const items = [];
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      const name = String(item.description || item.name || item.item || item.title || 'Item').slice(0, 80);
      // Extract qty and unit_price if present, otherwise use total_price directly
      const qty = Math.max(1, Math.round(Number(item.quantity || item.qty || 1)));
      const unitPrice = Number(item.unit_price || item.price_per_unit || item.unit_cost || 0);
      const totalPrice = Number(item.total_price || item.total || item.amount || item.price || 0);
      // Prefer total_price when available, else qty * unit_price
      const price = Math.round(totalPrice > 0 ? totalPrice : qty * unitPrice);
      if (name && price > 0) {
        items.push({ name, qty, unitPrice: unitPrice > 0 ? Math.round(unitPrice) : Math.round(price / qty), price, people: [] });
      }
    }
  }

  if (!items.length) {
    const total = Number(data.totals?.total || data.total || data.total_amount || 0);
    if (total > 0) {
      items.push({ name: merchant || 'Total Item', qty: 1, unitPrice: Math.max(0, Math.round(total - tax)), price: Math.max(0, Math.round(total - tax)), people: [] });
    }
  }

  const textToScan = merchant + ' ' + items.map(i => i.name).join(' ');
  const category = guessCategory(textToScan);

  return {
    merchant: merchant.slice(0, 60),
    date,
    category,
    tax,
    items: items.length ? items : [{ name: 'Item 1', qty: 1, unitPrice: 0, price: 0, people: [] }]
  };
}

async function scanWithRapidApi(img) {
  const apiKey = process.env.RAPIDAPI_KEY || '18c4b2fd16msh32d393319e95b02p1ebdb6jsncda25d8eb8d3';
  const apiHost = process.env.RAPIDAPI_HOST || 'receipt-and-invoice-ocr-api.p.rapidapi.com';

  const m = /^data:(image\/\w+);base64,(.+)$/.exec(img || '');
  if (!m) throw new Error('Invalid image format');

  const mimeType = m[1];
  const ext = mimeType.split('/')[1] || 'jpeg';
  const buffer = Buffer.from(m[2], 'base64');

  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimeType }), `receipt.${ext}`);
  fd.append('settings', JSON.stringify({ documentType: 'receipt' }));

  const res = await fetch(`https://${apiHost}/recognize`, {
    method: 'POST',
    headers: {
      'x-rapidapi-host': apiHost,
      'x-rapidapi-key': apiKey
    },
    body: fd
  });

  const rawText = await res.text();
  let json = null;
  try {
    json = JSON.parse(rawText);
  } catch {}

  if (!res.ok) {
    const errDetail = json?.error || json?.message || rawText.slice(0, 150);
    throw new Error(`RapidAPI OCR (${res.status}): ${errDetail}`);
  }

  if (!json) throw new Error('RapidAPI OCR returned empty response');
  return mapRapidApiReceipt(json);
}

async function scanWithAnthropic(img) {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(img || '');
  if (!m) throw new Error('Invalid image');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: 'Read this receipt. Reply ONLY with JSON: {"merchant":str,"date":"YYYY-MM-DD","category":"Food|Transport|Shopping|Fun|Bills|Other","tax":number (tax+service total),"items":[{"name":str,"price":number (line total)}]}. Numbers have no currency symbols or separators.' }
        ]
      }]
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Anthropic AI scan failed');
  return JSON.parse(d.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim());
}

async function scan(img) {
  try {
    return await scanWithRapidApi(img);
  } catch (rapidErr) {
    console.warn('RapidAPI OCR failed:', rapidErr.message);
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        return await scanWithAnthropic(img);
      } catch (anthropicErr) {
        console.warn('Anthropic OCR fallback failed:', anthropicErr.message);
      }
    }
    throw rapidErr;
  }
}

function prep(b) {
  const items = (b.items || []).filter(i => i.name && (num(i.price) > 0 || (Number(i.qty) > 0 && Number(i.unitPrice) > 0))).map(i => {
    const qty = Math.max(1, Math.round(Number(i.qty) || 1));
    const unitPrice = Math.max(0, Math.round(Number(i.unitPrice) || 0));
    // If price not set or 0, derive from qty * unitPrice
    const price = num(i.price) > 0 ? num(i.price) : Math.round(qty * unitPrice);
    return {
      name: String(i.name).slice(0, 80),
      qty,
      unitPrice: unitPrice > 0 ? unitPrice : Math.round(price / qty),
      price,
      people: Array.isArray(i.people) ? i.people : []
    };
  });
  if (!items.length) throw new Error('Add at least one item');
  const tax = num(b.tax);
  const total = items.reduce((s, i) => s + i.price, 0) + tax;
  const sp = b.split ? 1 : 0;
  const sh = sp ? split(items, tax) : {};
  return {
    items,
    tax,
    total,
    sp,
    sh,
    merchant: (b.merchant || 'Untitled').slice(0, 60),
    date: b.date || new Date().toISOString().slice(0, 10),
    category: b.category || 'Other',
    mine: sp ? (sh.Me || 0) : total
  };
}

async function mkDebts(uid, rid, sh, old = {}) {
  for (const n in sh) {
    if (n !== 'Me' && sh[n] > 0) {
      await run(
        'insert into debts(user_id,receipt_id,friend,amount,paid,created) values(?,?,?,?,?,coalesce(?,date()))',
        uid,
        rid,
        n,
        sh[n],
        Math.min(sh[n], old[n]?.paid || 0),
        old[n]?.created || null
      );
    }
  }
}

async function login(res, id) {
  const t = crypto.randomBytes(24).toString('hex');
  await run('insert into sessions values(?,?)', t, id);
  send(res, 200, { ok: 1 }, {
    'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureFlag}`
  });
}

const routes = {
  'POST /register': async ({ b, res }) => {
    if (!b.email || !b.name || (b.password || '').length < 6) throw new Error('Fill all fields (password min 6 chars)');
    try {
      const r = await run('insert into users(email,name,hash) values(?,?,?)', b.email.toLowerCase(), b.name, hash(b.password));
      return await login(res, r.lastInsertRowid);
    } catch {
      throw new Error('Email already registered');
    }
  },
  'POST /login': async ({ b, res }) => {
    const u = await one('select * from users where email=?', (b.email || '').toLowerCase());
    if (!u || !check(b.password || '', u.hash)) throw new Error('Wrong email or password');
    return await login(res, u.id);
  },
  'POST /logout': async ({ res, tok }) => {
    await run('delete from sessions where token=?', tok || '');
    send(res, 200, { ok: 1 }, { 'Set-Cookie': `sid=; Max-Age=0; Path=/${secureFlag}` });
  },
  'POST /forgot-password': async ({ b, res }) => {
    const email = (b.email || '').trim().toLowerCase();
    const newPass = (b.password || b.newPassword || '').trim();
    if (!email) throw new Error('Please enter your email address');
    if (newPass.length < 6) throw new Error('New password must be at least 6 characters');
    const u = await one('select * from users where email=?', email);
    if (!u) throw new Error('No account found with this email');
    await run('update users set hash=? where id=?', hash(newPass), u.id);
    return await login(res, u.id);
  },
  'GET /network-info': async ({ res }) => {
    const ips = [];
    const ifaces = os.networkInterfaces();
    for (const name in ifaces) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) ips.push({ name, ip: iface.address });
      }
    }
    ips.sort((a, b) => {
      const isVirt = n => /vEthernet|WSL|Hyper-V|Virtual|VMware/i.test(n);
      const isWifi = n => /wi-?fi|wireless|wlan/i.test(n);
      if (isWifi(a.name) && !isWifi(b.name)) return -1;
      if (!isWifi(a.name) && isWifi(b.name)) return 1;
      if (isVirt(a.name) && !isVirt(b.name)) return 1;
      if (!isVirt(a.name) && isVirt(b.name)) return -1;
      return 0;
    });
    send(res, 200, { port: process.env.PORT || 3000, ips, isVercel: !!process.env.VERCEL });
  },
  'GET /me': async ({ u, res }) => send(res, 200, { id: u.id, name: u.name, email: u.email }),
  'GET /receipts': async ({ u, res }) => {
    const recs = await q('select * from receipts where user_id=? order by date desc,id desc', u.id);
    send(res, 200, recs.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })));
  },
  'POST /receipts': async ({ u, b, res }) => {
    const p = prep(b);
    const r = await run('insert into receipts(user_id,merchant,date,category,tax,total,my_share,is_split,items) values(?,?,?,?,?,?,?,?,?)',
      u.id, p.merchant, p.date, p.category, p.tax, p.total, p.mine, p.sp, JSON.stringify(p.items));
    await mkDebts(u.id, r.lastInsertRowid, p.sh);
    send(res, 201, { id: r.lastInsertRowid, shares: p.sh });
  },
  'PUT /receipts': async ({ u, b, id, res }) => {
    const existing = await one('select id from receipts where id=? and user_id=?', id, u.id);
    if (!existing) throw new Error('Not found');
    const p = prep(b);
    const old = {};
    for (const d of await q('select * from debts where receipt_id=?', id)) old[d.friend] = d;
    await run('update receipts set merchant=?,date=?,category=?,tax=?,total=?,my_share=?,is_split=?,items=? where id=? and user_id=?',
      p.merchant, p.date, p.category, p.tax, p.total, p.mine, p.sp, JSON.stringify(p.items), id, u.id);
    await run('delete from debts where receipt_id=? and user_id=?', id, u.id);
    await mkDebts(u.id, id, p.sh, old);
    send(res, 200, { ok: 1 });
  },
  'DELETE /receipts': async ({ u, id, res }) => {
    await run('delete from debts where receipt_id=? and user_id=?', id, u.id);
    await run('delete from receipts where id=? and user_id=?', id, u.id);
    send(res, 200, { ok: 1 });
  },
  'GET /friends': async ({ u, res }) => send(res, 200, await q('select * from friends where user_id=? order by name', u.id)),
  'POST /friends': async ({ u, b, res }) => {
    const n = (b.name || '').trim().slice(0, 30);
    if (!n || n.toLowerCase() === 'me') throw new Error('Pick another name');
    try {
      await run('insert into friends(user_id,name) values(?,?)', u.id, n);
    } catch {
      throw new Error('Friend already exists');
    }
    send(res, 201, { ok: 1 });
  },
  'DELETE /friends': async ({ u, id, res }) => {
    await run('delete from friends where id=? and user_id=?', id, u.id);
    send(res, 200, { ok: 1 });
  },
  'GET /debts': async ({ u, res }) => send(res, 200, await q('select d.*,r.merchant from debts d join receipts r on r.id=d.receipt_id where d.user_id=? order by (d.paid>=d.amount),d.created', u.id)),
  'POST /pay': async ({ u, id, b, res }) => {
    const d = await one('select * from debts where id=? and user_id=?', id, u.id);
    if (!d) throw new Error('Not found');
    await run('update debts set paid=min(amount,paid+?) where id=?', b.amount == null ? d.amount : num(b.amount), id);
    send(res, 200, { ok: 1 });
  },
  'GET /report': async ({ u, res }) => {
    const monthly = await q('select substr(date,1,7) m,sum(my_share) v from receipts where user_id=? group by m order by m desc limit 6', u.id);
    const categories = await q(`select category c,sum(my_share) v from receipts where user_id=? and substr(date,1,7)=strftime('%Y-%m','now') group by c order by v desc`, u.id);
    const owedRow = await one('select coalesce(sum(amount-paid),0) v from debts where user_id=?', u.id);
    const slow = await q(`select friend,count(*) n,sum(amount-paid) due,cast(julianday('now')-julianday(min(created)) as int) days from debts where user_id=? and paid<amount group by friend order by days desc limit 5`, u.id);
    const countRow = await one('select count(*) n from receipts where user_id=?', u.id);
    send(res, 200, {
      monthly: monthly.reverse(),
      categories,
      owed: owedRow ? owedRow.v : 0,
      slow,
      count: countRow ? countRow.n : 0
    });
  },
  'POST /scan': async ({ b, res }) => send(res, 200, await scan(b.image))
};

async function handleAdmin({ req, res, b, parts }) {
  const action = parts[1] || '';
  const subId = Number(parts[2]) || 0;
  const subAction = parts[3] || '';

  if (req.method === 'POST' && action === 'login') {
    if ((b.key || '') !== ADMIN_KEY) return send(res, 401, { error: 'Access Denied: Invalid Security Key' });
    const tok = crypto.randomBytes(24).toString('hex');
    await run('insert into admin_sessions(token,created_at) values(?,?)', tok, new Date().toISOString());
    return send(res, 200, { ok: 1, token: tok });
  }

  // All subsequent admin routes require authorization
  if (!await isAuthorizedAdmin(req, b)) return send(res, 401, { error: 'Access Denied: Master passkey required' });

  if (req.method === 'GET' && action === 'stats') {
    const dbPath = path.join(process.cwd(), 'snapsplit.db');
    const totDebtsRow = await one('select coalesce(sum(amount),0) v from debts');
    const paidDebtsRow = await one('select coalesce(sum(paid),0) v from debts');
    const usersCountRow = await one('select count(*) c from users');
    const receiptsCountRow = await one('select count(*) c from receipts');
    const totalVolumeRow = await one('select coalesce(sum(total),0) v from receipts');
    const myShareVolumeRow = await one('select coalesce(sum(my_share),0) v from receipts');
    const sessionsCountRow = await one('select count(*) c from sessions');
    const friendsCountRow = await one('select count(*) c from friends');

    const totDebts = totDebtsRow ? totDebtsRow.v : 0;
    const paidDebts = paidDebtsRow ? paidDebtsRow.v : 0;

    return send(res, 200, {
      usersCount: usersCountRow ? usersCountRow.c : 0,
      receiptsCount: receiptsCountRow ? receiptsCountRow.c : 0,
      totalVolume: totalVolumeRow ? totalVolumeRow.v : 0,
      myShareVolume: myShareVolumeRow ? myShareVolumeRow.v : 0,
      totalDebts: totDebts,
      totalPaidDebts: paidDebts,
      unpaidDebts: totDebts - paidDebts,
      sessionsCount: sessionsCountRow ? sessionsCountRow.c : 0,
      friendsCount: friendsCountRow ? friendsCountRow.c : 0,
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      dbSize: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
      aiScanEnabled: true,
      ocrProvider: 'RapidAPI Hub - Receipt and Invoice OCR API'
    });
  }

  if (req.method === 'GET' && action === 'users') {
    const users = await q(`
      select u.id, u.email, u.name,
             (select count(*) from receipts where user_id=u.id) as receipts_count,
             (select coalesce(sum(total),0) from receipts where user_id=u.id) as total_spent,
             (select count(*) from friends where user_id=u.id) as friends_count,
             (select coalesce(sum(amount - paid), 0) from debts where user_id=u.id) as debts_owed,
             (select count(*) from sessions where user_id=u.id) as sessions_count
      from users u order by u.id desc
    `);
    return send(res, 200, users);
  }

  if (req.method === 'POST' && action === 'users' && subAction === 'reset') {
    const newPass = (b.password || '').trim() || 'SplitWoi123!';
    if (newPass.length < 6) return send(res, 400, { error: 'Password min 6 characters' });
    await run('update users set hash=? where id=?', hash(newPass), subId);
    return send(res, 200, { ok: 1, message: 'Password reset successfully', newPass });
  }

  if (req.method === 'DELETE' && action === 'users') {
    await run('delete from sessions where user_id=?', subId);
    await run('delete from debts where user_id=?', subId);
    await run('delete from receipts where user_id=?', subId);
    await run('delete from friends where user_id=?', subId);
    await run('delete from users where id=?', subId);
    return send(res, 200, { ok: 1 });
  }

  if (req.method === 'GET' && action === 'receipts') {
    const recs = await q(`
      select r.id, r.user_id, u.name as user_name, u.email as user_email,
             r.merchant, r.date, r.category, r.tax, r.total, r.my_share, r.is_split, r.items
      from receipts r
      left join users u on u.id = r.user_id
      order by r.id desc limit 60
    `);
    return send(res, 200, recs.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })));
  }

  if (req.method === 'POST' && action === 'clean-sessions') {
    const r = await run('delete from sessions where user_id not in (select id from users)');
    await run('delete from admin_sessions where created_at < datetime("now", "-30 days")');
    return send(res, 200, { ok: 1, cleaned: r.changes });
  }

  if (req.method === 'GET' && action === 'export') {
    const recs = await q('select * from receipts');
    const data = {
      exportedAt: new Date().toISOString(),
      users: await q('select id, email, name from users'),
      receipts: recs.map(r => ({ ...r, items: JSON.parse(r.items || '[]') })),
      friends: await q('select * from friends'),
      debts: await q('select * from debts')
    };
    return send(res, 200, data);
  }

  return send(res, 404, { error: 'Admin endpoint not found' });
}

async function handleRequest(req, res) {
  // CORS Preflight handling
  if (req.method === 'OPTIONS') {
    if (typeof res.setHeader === 'function') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-admin-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      return res.end();
    } else {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, x-admin-key',
        'Access-Control-Allow-Credentials': 'true'
      });
      return res.end();
    }
  }

  await ensureDb();

  let parts = [];
  if (req.query?.path) {
    parts = Array.isArray(req.query.path) ? req.query.path : String(req.query.path).split('/').filter(Boolean);
  }
  if (!parts.length || (parts.length === 1 && parts[0].startsWith('['))) {
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      pathname = pathname.slice(4);
    } else if (pathname === '/api') {
      pathname = '';
    }
    const urlParts = pathname.split('/').filter(Boolean);
    if (urlParts.length && !urlParts[0].startsWith('[')) {
      parts = urlParts;
    }
  }

  const id = Number(parts[1]) || 0;

  try {
    let b = req.body;
    if (b === undefined || typeof b === 'string') {
      let raw = typeof b === 'string' ? b : '';
      if (!raw && typeof req[Symbol.asyncIterator] === 'function') {
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 12e6) throw new Error('File too large');
        }
      }
      b = raw ? JSON.parse(raw) : {};
    }

    const cookieHeader = req.headers.cookie || (req.headers.get ? req.headers.get('cookie') : '') || '';
    const tok = /sid=([a-zA-Z0-9]+)/.exec(cookieHeader)?.[1];

    if (parts[0] === 'admin') {
      return await handleAdmin({ req, res, b, parts });
    }

    let key = req.method + ' /' + (parts[0] || '');
    if (parts[0] === 'debts' && parts[2] === 'pay' && req.method === 'POST') {
      key = 'POST /pay';
    }

    const h = routes[key];
    if (!h) return send(res, 404, { error: 'Not found' });

    let u = null;
    if (!['POST /register', 'POST /login', 'POST /logout', 'POST /forgot-password', 'GET /network-info'].includes(key)) {
      u = tok ? (await one('select u.* from sessions s join users u on u.id=s.user_id where s.token=?', tok)) : null;
      if (!u) return send(res, 401, { error: 'Please log in' });
    }

    await h({ b, u, res, id, tok });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}

module.exports = { handleRequest };
