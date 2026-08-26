/* opengym-api — email code + invite-code auth + per-user state storage for openGym
   No framework, SQLite storage (better-sqlite3), signed session cookies.
   Authentication: e-mail + 6-digit code (SMTP), registration gated by invite codes.
   Admin dashboard: aggregate stats + invite management + user drill-down.          */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { openStore } from './db.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const APP_NAME = process.env.APP_NAME || 'openGym';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
// Admins are matched by e-mail (ADMIN_EMAILS). Matching is case-insensitive.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// Password for the standalone /admin console (separate from the e-mail-code app login).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'gym-admin-2026';
// Invite-only is ON by default: registration always requires a valid invite code,
// unless the e-mail is an admin address.
const INVITE_ONLY = !process.env.INVITE_ONLY || /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY);
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- SMTP (e-mail verification codes) ---------- */
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.qq.com';
const SMTP_PORT = +(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER || 'openGym');
const SMTP_SECURE = process.env.SMTP_SECURE ? /^(1|true|yes|on)$/i.test(process.env.SMTP_SECURE) : SMTP_PORT === 465;

let mailer = null;
if (SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  console.log(`[mail] SMTP ready: ${SMTP_USER} @ ${SMTP_HOST}:${SMTP_PORT}`);
} else {
  console.log('[mail] SMTP not configured — verification codes will be printed to the server log instead of e-mailed.');
}

async function sendMail(to, subject, html) {
  if (!mailer) throw new Error('SMTP not configured');
  await mailer.sendMail({ from: `"${APP_NAME}" <${SMTP_FROM}>`, to, subject, html });
}

/* ---------- secret + SQLite store ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

// All data lives in SQLite (data/app.db). The four relational collections are kept
// in memory as the working copy — exactly the shape the old db object had — and
// persisted by saveDb() inside a transaction. Per-user state documents go straight
// to the user_state table. Legacy db.json / state-*.json are migrated on first open.
const store = openStore(DATA);
const db = store.loadDb();

// Working-set helpers: saveDb persists the four relational collections; readState /
// writeState talk to the user_state table (each user's full state document).
const saveDb = () => store.saveDb(db);
const readState = uid => store.getState(uid);
const writeState = (uid, obj) => store.putState(uid, obj);

const isAdmin = user => !!user && (user.admin === true || (user.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase())));

// Migrate pre-2.0 rows: old users have no e-mail; old invites tracked a single usedBy.
function migrateDb() {
  let dirty = false;
  for (const u of db.users) {
    if (u.email === undefined) { u.email = null; dirty = true; }
  }
  for (const i of db.invites) {
    if (i.usedBy && !i.uses) {
      const u = db.users.find(x => x.id === i.usedBy);
      i.uses = [{ uid: i.usedBy, name: u ? u.name : null, at: i.usedAt || null }];
      delete i.usedBy; delete i.usedAt;
      dirty = true;
    }
    if (!i.uses) i.uses = [];
  }
  if (dirty) saveDb();
}
migrateDb();

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: '休息结束 💪', body: '该开始下一组了。', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; }
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue;
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} 今天` : '今天安排了训练',
      body: '计划已排好，去练吧 💪',
      tag: 'day-reminder'
    });
  }
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
/* ---------- admin console session ----------
 * The /admin console is deliberately decoupled from the app's cookie login: an admin
 * signs in with ADMIN_EMAILS + ADMIN_PASSWORD and gets a bearer token (x-admin-token).
 * Tokens live in memory, expire after 12h, and are wiped on restart. */
const adminSessions = new Map();   // token -> { email, exp }
const ADMIN_SESSION_TTL = 12 * 3600000;
function issueAdminToken(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, { email, exp: Date.now() + ADMIN_SESSION_TTL });
  return token;
}
function readAdminSession(req) {
  const h = req.headers['x-admin-token'];
  const tok = (Array.isArray(h) ? h[0] : h) || '';
  if (!tok) return null;
  const s = adminSessions.get(tok);
  if (!s || s.exp < Date.now()) { adminSessions.delete(tok); return null; }
  return s;
}
function requireAdmin(req, res) {
  const s = readAdminSession(req);
  if (!s) { json(res, 401, { error: '未登录' }); return null; }
  const user = db.users.find(u => u.email && u.email.toLowerCase() === s.email) || null;
  if (!user || user.disabled) { json(res, 401, { error: '未登录' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: '无权限' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- e-mail verification codes ---------- */
const codeStore = new Map(); // email -> { code, exp, attempts, lastSent }
const CODE_TTL = 5 * 60000;
const CODE_COOLDOWN = 60000;
const MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 与前端一致：手机输入法常输出全角字符（＠、。、．），统一清洗后再校验/存储。
function normalizeEmail(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[。．]/g, '.')
    .replace(/\s*@\s*/g, '@')
    .trim()
    .toLowerCase();
}

async function issueCode(email, purpose) {
  email = normalizeEmail(email);
  if (!EMAIL_RE.test(email)) { const e = new Error('邮箱格式不正确'); e.status = 400; throw e; }
  const cur = codeStore.get(email);
  if (cur && Date.now() - cur.lastSent < CODE_COOLDOWN) {
    const e = new Error('发送太频繁，请稍后再试'); e.status = 429; throw e;
  }
  const exists = db.users.some(u => u.email === email);
  if (purpose === 'register' && exists) { const e = new Error('该邮箱已注册，请直接登录'); e.status = 400; throw e; }
  if (purpose === 'login' && !exists) { const e = new Error('该邮箱尚未注册'); e.status = 400; throw e; }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  codeStore.set(email, { code, exp: Date.now() + CODE_TTL, attempts: 0, lastSent: Date.now() });
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e5e5;border-radius:12px">
    <h2 style="margin:0 0 8px">${APP_NAME} 验证码</h2>
    <p style="color:#444;line-height:1.6">你的验证码是：</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#16a34a;margin:8px 0 16px">${code}</p>
    <p style="color:#666;font-size:13px;line-height:1.6">验证码 5 分钟内有效。如果这不是你本人的操作，请忽略本邮件。</p>
  </div>`;
  try { await sendMail(email, `【${APP_NAME}】验证码：${code}`, html); }
  catch (e) {
    console.error('[mail] send failed for', email, e.message);
    const err = new Error('验证码发送失败，请稍后重试或联系管理员'); err.status = 502; throw err;
  }
  // Always log to the server console — the operator needs a fallback when SMTP is down.
  console.log(`[code] ${email} (${purpose}) -> ${code}`);
  return { ok: true };
}

function takeCode(email, code) {
  email = String(email || '').trim().toLowerCase();
  const c = codeStore.get(email);
  if (!c) return { ok: false, error: '请先获取验证码' };
  if (c.exp < Date.now()) { codeStore.delete(email); return { ok: false, error: '验证码已过期，请重新获取' }; }
  if (String(code || '').trim() !== c.code) {
    c.attempts++;
    if (c.attempts >= MAX_ATTEMPTS) codeStore.delete(email);
    return { ok: false, error: '验证码错误' + (MAX_ATTEMPTS - c.attempts > 0 ? `，还可尝试 ${MAX_ATTEMPTS - c.attempts} 次` : '，请重新获取') };
  }
  codeStore.delete(email);
  return { ok: true };
}

/* ---------- invites ---------- */
function normalizeCode(s) { return String(s || '').trim().toUpperCase(); }
// A code is usable when it exists, isn't revoked and (if it has a cap) hasn't hit it.
function findUsableInvite(code) {
  code = normalizeCode(code);
  const i = db.invites.find(x => x.code === code);
  if (!i || i.revoked) return null;
  const uses = (i.uses || []).length;
  if (i.maxUses != null && uses >= i.maxUses) return null;
  return i;
}
function consumeInvite(invite, user) {
  invite.uses = invite.uses || [];
  invite.uses.push({ uid: user.id, name: user.name, email: user.email || null, at: new Date().toISOString() });
}

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

/* ---------- live presence (in-memory) ---------- */
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- admin stats helpers ---------- */
const dayKey = ts => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
function lastNDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return out;
}
function statsForUser(u) {
  const S = readState(u.id) || {};
  const workouts = S.workouts || [];
  const exCount = {};
  for (const w of workouts) for (const ex of (w.ex || [])) if (ex && ex.n) exCount[ex.n] = (exCount[ex.n] || 0) + 1;
  return {
    workouts: workouts.length,
    weighIns: (S.bodyweight || []).length,
    routines: (S.routines || []).length,
    lastWorkout: workouts.length ? workouts[workouts.length - 1].d : null,
    lastSync: S._ts || null,
    unit: S.unit || 'kg',
    exCount,
    workoutDays: workouts.map(w => w.d)
  };
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, email: user.email || null, admin: isAdmin(user) } });
  },

  /* ---- auth: e-mail + code ---- */
  'POST /api/auth/send-code': async (req, res) => {
    const body = await readBody(req);
    try { await issueCode(body.email, body.purpose === 'register' ? 'register' : 'login'); }
    catch (e) { return json(res, e.status || 500, { error: e.message }); }
    json(res, 200, { ok: true });
  },

  'POST /api/auth/register': async (req, res) => {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: '请填写昵称' });
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: '邮箱格式不正确' });
    if (db.users.some(u => u.email === email)) return json(res, 409, { error: '该邮箱已注册，请直接登录' });

    // 先校验邀请码，再消费验证码 —— 邀请码填错时验证码不会被作废。
    const admin = ADMIN_EMAILS.includes(email);
    let invite = null;
    if (INVITE_ONLY && !admin) {
      invite = findUsableInvite(normalizeCode(body.inviteCode));
      if (!invite) return json(res, 403, { error: '邀请码无效或已被用完，请联系管理员获取' });
    }
    const c = takeCode(email, body.code);
    if (!c.ok) return json(res, 400, { error: c.error });

    const uid = crypto.randomBytes(12).toString('base64url');
    const created = new Date().toISOString();
    const user = { id: uid, name, email, created, lastLogin: created };
    if (admin) user.admin = true;
    if (invite) { user.invitedBy = invite.code; consumeInvite(invite, user); }
    db.users.push(user);
    saveDb();
    console.log(`[auth] new user ${user.id} ${name} <${email}> invitedBy=${user.invitedBy || 'admin'}`);
    json(res, 200, { user: { id: user.id, name: user.name, email: user.email, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: '邮箱格式不正确' });
    const user = db.users.find(u => u.email === email);
    if (!user) return json(res, 404, { error: '该邮箱尚未注册' });
    const c = takeCode(email, body.code);
    if (!c.ok) return json(res, 400, { error: c.error });
    if (user.disabled) return json(res, 403, { error: '该账号已被禁用，请联系管理员' });
    user.lastLogin = new Date().toISOString();
    saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, email: user.email, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  /* ---- data sync ---- */
  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { state: readState(user.id) });
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;
    writeState(user.id, body.state);
    user.lastActiveAt = Date.now();
    saveDb();
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  /* ---- push ---- */
  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: APP_NAME, body: '测试通知 ✅', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin: standalone console login ---------- */
  'POST /api/admin/login': async (req, res) => {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!ADMIN_EMAILS.includes(email) || password !== ADMIN_PASSWORD) {
      return json(res, 401, { error: '邮箱或密码错误' });
    }
    const user = db.users.find(u => u.email && u.email.toLowerCase() === email);
    if (!user || user.disabled) return json(res, 401, { error: '账号不可用' });
    const token = issueAdminToken(email);
    console.log(`[admin] ${email} signed in`);
    json(res, 200, { token, expiresIn: ADMIN_SESSION_TTL, admin: { id: user.id, name: user.name, email: user.email } });
  },
  'POST /api/admin/logout': async (req, res) => {
    const h = req.headers['x-admin-token'];
    const tok = (Array.isArray(h) ? h[0] : h) || '';
    if (tok) adminSessions.delete(tok);
    json(res, 200, { ok: true });
  },
  'GET /api/admin/me': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    json(res, 200, { admin: { id: admin.id, name: admin.name, email: admin.email } });
  },

  /* ---------- admin: stats dashboard ---------- */
  'GET /api/admin/stats': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const days = lastNDays(30);
    const regMap = Object.fromEntries(days.map(d => [d, 0]));
    const wktMap = Object.fromEntries(days.map(d => [d, 0]));
    const actMap = Object.fromEntries(days.map(d => [d, 0]));
    const users = db.users.map(u => ({ user: u, st: statsForUser(u) }));
    const totals = {
      users: users.length,
      workouts: 0, weighIns: 0,
      activeToday: 0, active7d: 0, active30d: 0,
      workoutsToday: 0
    };
    const topEx = {};   // exercise name -> count
    const now = Date.now();
    for (const { user: u, st } of users) {
      totals.workouts += st.workouts;
      totals.weighIns += st.weighIns;
      const lastAct = u.lastActiveAt || (st.lastSync ? +st.lastSync : null) || (u.lastLogin ? +new Date(u.lastLogin) : null);
      if (lastAct && now - lastAct < 86400000) totals.activeToday++;
      if (lastAct && now - lastAct < 7 * 86400000) totals.active7d++;
      if (lastAct && now - lastAct < 30 * 86400000) totals.active30d++;
      const createdDay = dayKey(new Date(u.created));
      if (regMap[createdDay] !== undefined) regMap[createdDay]++;
      for (const d of st.workoutDays) if (d && wktMap[d] !== undefined) {
        wktMap[d]++;
        if (d === days[days.length - 1]) totals.workoutsToday++;
      }
      for (const [k, v] of Object.entries(st.exCount)) topEx[k] = (topEx[k] || 0) + v;
    }
    for (const { user: u, st } of users) {
      const lastAct = u.lastActiveAt || (st.lastSync ? +st.lastSync : null);
      if (lastAct) { const k = dayKey(lastAct); if (actMap[k] !== undefined) actMap[k]++; }
    }
    // workoutTrend counts workouts per day; activeTrend counts distinct users active per day
    json(res, 200, {
      totals,
      registrations: days.map(d => ({ d, n: regMap[d] })),
      workoutTrend: days.map(d => ({ d, n: wktMap[d] })),
      activeTrend: days.map(d => ({ d, n: actMap[d] })),
      topExercises: Object.entries(topEx).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
      now
    });
  },

  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const st = statsForUser(u);
      return {
        id: u.id, name: u.name, email: u.email || null, created: u.created || null,
        lastLogin: u.lastLogin || null, lastActiveAt: u.lastActiveAt || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: st.workouts, weighIns: st.weighIns, routines: st.routines,
        lastWorkout: st.lastWorkout, lastSync: st.lastSync,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: {
        id: u.id, name: u.name, email: u.email || null, created: u.created || null,
        lastLogin: u.lastLogin || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null
      },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const invites = db.invites.map(i => {
      const creator = db.users.find(u => u.id === i.createdBy);
      return {
        code: i.code, note: i.note || '', createdBy: i.createdBy,
        createdByName: creator ? creator.name : null,
        created: i.created || null, revoked: !!i.revoked,
        maxUses: i.maxUses != null ? i.maxUses : null,
        usedCount: (i.uses || []).length,
        uses: (i.uses || []).map(x => ({ uid: x.uid, name: x.name, email: x.email || null, at: x.at }))
      };
    });
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code = normalizeCode(body.code);
    if (code) {
      if (!/^[A-Z0-9]{4,32}$/.test(code)) return json(res, 400, { error: '邀请码需为 4-32 位字母或数字' });
      if (db.invites.some(i => i.code === code)) return json(res, 409, { error: '该邀请码已存在' });
    } else {
      do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    }
    let maxUses = null;
    if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== '') {
      maxUses = Math.max(1, Math.min(1000, Math.round(+body.maxUses) || 0));
      if (!maxUses) return json(res, 400, { error: '使用次数需为 1-1000 的数字' });
    }
    const invite = {
      code,
      note: String(body.note || '').slice(0, 60),
      createdBy: admin.id,
      created: new Date().toISOString(),
      maxUses, uses: [], revoked: false
    };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === normalizeCode(body.code));
    if (!inv) return json(res, 404, { error: 'no such code' });
    inv.revoked = true;
    saveDb();
    json(res, 200, { ok: true });
  }
};

http.createServer(async (req, res) => {
  // CORS：允许前端页面（dev server / 部署域名）跨域访问，带 cookie 会话。
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (invite_only=${INVITE_ONLY}, admins=${ADMIN_EMAILS.length})`));
