/* opengym storage — SQLite (better-sqlite3)
   Replaces the old JSON-file store (data/db.json + data/state-<uid>.json).

   Design:
   · relational tables: users / creds / subs / invites (one row per record)
   · user_state: each user's full state document (routines, workouts, bodyweight,
     settings) stored as a JSON column — the frontend owns this document wholesale,
     so a blob column keeps the API contract unchanged while getting transactions,
     WAL crash-safety and a single backup file.
   · the server keeps an in-memory working copy of the four relational tables
     (same shape as the old db object) and persists it with saveDb() inside a
     transaction; state documents are read/written straight through to SQLite.
   · first open: one-time migration from legacy db.json + state-*.json files.     */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  created TEXT,
  last_login TEXT,
  last_active_at INTEGER,
  admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  invited_by TEXT,
  sv INTEGER NOT NULL DEFAULT 0,
  last_reminder TEXT
);
CREATE TABLE IF NOT EXISTS creds (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  public_key TEXT,
  counter INTEGER,
  transports TEXT
);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT,
  keys TEXT,
  created TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  note TEXT,
  created_by TEXT,
  created TEXT,
  max_uses INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  uses TEXT
);
CREATE TABLE IF NOT EXISTS user_state (
  uid TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creds_user ON creds(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subs(user_id);
`;

/* ---------- row ↔ object mapping ---------- */
const rowToUser = r => r && ({
  id: r.id, name: r.name, email: r.email, created: r.created,
  lastLogin: r.last_login, lastActiveAt: r.last_active_at,
  admin: !!r.admin, disabled: !!r.disabled,
  invitedBy: r.invited_by, sv: r.sv, lastReminder: r.last_reminder
});
const rowToCred = r => r && ({
  id: r.id, userId: r.user_id, publicKey: r.public_key,
  counter: r.counter, transports: r.transports ? JSON.parse(r.transports) : []
});
const rowToSub = r => r && ({
  userId: r.user_id, endpoint: r.endpoint, keys: JSON.parse(r.keys), created: r.created
});
const rowToInvite = r => r && ({
  code: r.code, note: r.note, createdBy: r.created_by, created: r.created,
  maxUses: r.max_uses, revoked: !!r.revoked,
  uses: r.uses ? JSON.parse(r.uses) : []
});

/* ---------- legacy JSON → SQLite (one time) ---------- */
function migrateLegacy(dataDir, db) {
  const legacyDbFile = path.join(dataDir, 'db.json');
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0 || !fs.existsSync(legacyDbFile)) return false;

  let legacy;
  try { legacy = JSON.parse(fs.readFileSync(legacyDbFile, 'utf8')); }
  catch { return false; }

  const insUser = db.prepare(`INSERT INTO users
    (id,name,email,created,last_login,last_active_at,admin,disabled,invited_by,sv,last_reminder)
    VALUES (@id,@name,@email,@created,@last_login,@last_active_at,@admin,@disabled,@invited_by,@sv,@last_reminder)`);
  const insCred = db.prepare(`INSERT INTO creds (id,user_id,public_key,counter,transports)
    VALUES (@id,@user_id,@public_key,@counter,@transports)`);
  const insSub = db.prepare(`INSERT INTO subs (endpoint,user_id,keys,created)
    VALUES (@endpoint,@user_id,@keys,@created)`);
  const insInvite = db.prepare(`INSERT INTO invites (code,note,created_by,created,max_uses,revoked,uses)
    VALUES (@code,@note,@created_by,@created,@max_uses,@revoked,@uses)`);
  const insState = db.prepare('INSERT OR REPLACE INTO user_state (uid,json) VALUES (?,?)');

  const migrate = db.transaction(() => {
    for (const u of legacy.users || []) {
      if (u.email === undefined) u.email = null;
      insUser.run({
        id: u.id, name: u.name, email: u.email, created: u.created || null,
        last_login: u.lastLogin || null, last_active_at: u.lastActiveAt ?? null,
        admin: u.admin ? 1 : 0, disabled: u.disabled ? 1 : 0,
        invited_by: u.invitedBy || null, sv: u.sv ?? 0, last_reminder: u.lastReminder || null
      });
    }
    for (const c of legacy.creds || []) {
      insCred.run({
        id: c.id, user_id: c.userId || c.user_id || null,
        public_key: c.publicKey || null, counter: c.counter ?? 0,
        transports: JSON.stringify(c.transports || [])
      });
    }
    for (const s of legacy.subs || []) {
      insSub.run({ endpoint: s.endpoint, user_id: s.userId, keys: JSON.stringify(s.keys || {}), created: s.created || null });
    }
    for (const i of legacy.invites || []) {
      // same pre-2.0 fix the old in-memory migrateDb() applied: usedBy → uses[]
      if (i.usedBy && !i.uses) {
        const u = (legacy.users || []).find(x => x.id === i.usedBy);
        i.uses = [{ uid: i.usedBy, name: u ? u.name : null, at: i.usedAt || null }];
      }
      i.uses = i.uses || [];
      insInvite.run({
        code: i.code, note: i.note || '', created_by: i.createdBy || null,
        created: i.created || null, max_uses: i.maxUses ?? null,
        revoked: i.revoked ? 1 : 0, uses: JSON.stringify(i.uses)
      });
    }
    // per-user state files → user_state table
    for (const f of fs.readdirSync(dataDir)) {
      if (!f.startsWith('state-') || !f.endsWith('.json')) continue;
      const uid = f.slice('state-'.length, -'.json'.length);
      try { insState.run(uid, fs.readFileSync(path.join(dataDir, f), 'utf8')); }
      catch { /* skip unreadable */ }
    }
  });
  migrate();

  // keep the old files as a backup, out of the way so they are never re-imported
  try { fs.renameSync(legacyDbFile, legacyDbFile + '.legacy'); } catch {}
  try {
    for (const f of fs.readdirSync(dataDir)) {
      if (f.startsWith('state-') && f.endsWith('.json')) fs.renameSync(path.join(dataDir, f), path.join(dataDir, f + '.legacy'));
    }
  } catch {}
  console.log('[db] migrated legacy JSON files → ' + path.join(dataDir, 'app.db'));
  return true;
}

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'app.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  migrateLegacy(dataDir, db);

  const insUser = db.prepare(`INSERT INTO users
    (id,name,email,created,last_login,last_active_at,admin,disabled,invited_by,sv,last_reminder)
    VALUES (@id,@name,@email,@created,@last_login,@last_active_at,@admin,@disabled,@invited_by,@sv,@last_reminder)`);
  const insCred = db.prepare(`INSERT INTO creds (id,user_id,public_key,counter,transports)
    VALUES (@id,@user_id,@public_key,@counter,@transports)`);
  const insSub = db.prepare(`INSERT INTO subs (endpoint,user_id,keys,created)
    VALUES (@endpoint,@user_id,@keys,@created)`);
  const insInvite = db.prepare(`INSERT INTO invites (code,note,created_by,created,max_uses,revoked,uses)
    VALUES (@code,@note,@created_by,@created,@max_uses,@revoked,@uses)`);

  const persist = db.transaction((dbObj) => {
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM creds').run();
    db.prepare('DELETE FROM subs').run();
    db.prepare('DELETE FROM invites').run();
    for (const u of dbObj.users || []) {
      insUser.run({
        id: u.id, name: u.name, email: u.email ?? null, created: u.created || null,
        last_login: u.lastLogin || null, last_active_at: u.lastActiveAt ?? null,
        admin: u.admin ? 1 : 0, disabled: u.disabled ? 1 : 0,
        invited_by: u.invitedBy || null, sv: u.sv ?? 0, last_reminder: u.lastReminder || null
      });
    }
    for (const c of dbObj.creds || []) {
      insCred.run({
        id: c.id, user_id: c.userId || c.user_id || null,
        public_key: c.publicKey || null, counter: c.counter ?? 0,
        transports: JSON.stringify(c.transports || [])
      });
    }
    for (const s of dbObj.subs || []) {
      insSub.run({ endpoint: s.endpoint, user_id: s.userId, keys: JSON.stringify(s.keys || {}), created: s.created || null });
    }
    for (const i of dbObj.invites || []) {
      insInvite.run({
        code: i.code, note: i.note || '', created_by: i.createdBy || null,
        created: i.created || null, max_uses: i.maxUses ?? null,
        revoked: i.revoked ? 1 : 0, uses: JSON.stringify(i.uses || [])
      });
    }
  });

  const getState = db.prepare('SELECT json FROM user_state WHERE uid = ?');
  const putState = db.prepare('INSERT OR REPLACE INTO user_state (uid,json) VALUES (?,?)');

  return {
    loadDb() {
      return {
        users: db.prepare('SELECT * FROM users').all().map(rowToUser),
        creds: db.prepare('SELECT * FROM creds').all().map(rowToCred),
        subs: db.prepare('SELECT * FROM subs').all().map(rowToSub),
        invites: db.prepare('SELECT * FROM invites').all().map(rowToInvite)
      };
    },
    saveDb(dbObj) { persist(dbObj); },
    getState(uid) {
      const r = getState.get(uid);
      if (!r) return null;
      try { return JSON.parse(r.json); } catch { return null; }
    },
    putState(uid, obj) { putState.run(uid, typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  };
}
