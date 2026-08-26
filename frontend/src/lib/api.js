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

// 手机输入法（中文状态）常输出全角字符（＠、。、．）或误带空格，统一清洗后再校验/发送。
// normalize('NFKC') 把全角转半角：＠→@、．→.、全角空格→半角空格。
export const normalizeEmail = s => String(s || '')
  .normalize('NFKC')
  .replace(/[。．]/g, '.')          // 兜底：中文句号/全角点 → 半角点
  .replace(/\s*@\s*/g, '@')        // 去掉 @ 两侧误输入的空白（如 "abc @ qq.com"）
  .trim()
  .toLowerCase()                    // 与后端一致，统一小写存储
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isValidEmail = s => EMAIL_RE.test(normalizeEmail(s))

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
