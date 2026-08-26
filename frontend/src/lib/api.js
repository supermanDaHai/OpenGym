// Backend helpers — e-mail + verification-code auth.
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

// Request a 6-digit code by e-mail. purpose: 'register' | 'login'
export const sendCode = (email, purpose = 'login') =>
  api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ email, purpose }) })

// Register with e-mail + code + invite code (invite required unless the address is an admin).
export async function register({ email, code, inviteCode, name }) {
  const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, code, inviteCode: inviteCode || '', name }) })
  return res.user
}

// Sign in with e-mail + code.
export async function login({ email, code }) {
  const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, code }) })
  return res.user
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ---------- admin console (separate session) ----------
 * The /admin console keeps its own bearer token in localStorage, fully independent
 * from the app's cookie login. On 401 the token is dropped and an event is fired so
 * the admin gate can flip back to the login screen. */
export const ADMIN_TOKEN_KEY = 'gym_admin_token'
export const ADMIN_UNAUTH_EVENT = 'gym-admin-unauth'
export const adminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY)
export const setAdminToken = tok => tok ? localStorage.setItem(ADMIN_TOKEN_KEY, tok) : localStorage.removeItem(ADMIN_TOKEN_KEY)

export async function apiAdmin(path, opts) {
  const tok = adminToken()
  const r = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json', ...(tok ? { 'x-admin-token': tok } : {}) }
  }, opts))
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) { setAdminToken(null); window.dispatchEvent(new Event(ADMIN_UNAUTH_EVENT)) }
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

// Sign into the admin console with ADMIN_EMAILS + ADMIN_PASSWORD.
export async function adminLogin(email, password) {
  return apiAdmin('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}
