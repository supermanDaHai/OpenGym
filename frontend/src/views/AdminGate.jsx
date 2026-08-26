import { useEffect, useState } from 'react'
import { apiAdmin, adminToken, ADMIN_UNAUTH_EVENT } from '../lib/api.js'
import Admin from './Admin.jsx'
import AdminLogin from './AdminLogin.jsx'

/* ---------- /admin 门禁 ----------
 * 访问 /admin 一律先过这里：有有效 admin token → 直接进大屏；
 * 没有 / 已失效 → 显示独立登录页。与主站登录态完全隔离。 */
export default function AdminGate() {
  const [phase, setPhase] = useState('checking')   // checking | in | out
  const [info, setInfo] = useState(null)

  useEffect(() => {
    const toOut = () => setPhase('out')
    window.addEventListener(ADMIN_UNAUTH_EVENT, toOut)
    if (!adminToken()) { setPhase('out'); return () => window.removeEventListener(ADMIN_UNAUTH_EVENT, toOut) }
    apiAdmin('/api/admin/me')
      .then(d => { setInfo(d.admin); setPhase('in') })
      .catch(() => { setPhase('out') })   // apiAdmin already cleared the token on 401
    return () => window.removeEventListener(ADMIN_UNAUTH_EVENT, toOut)
  }, [])

  if (phase === 'in') return <Admin admin={info} onExit={() => setPhase('out')} />
  if (phase === 'out') return <AdminLogin onOk={a => { setInfo(a); setPhase('in') }} />
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: '#070b14', color: '#7b8ba5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontFamily: 'system-ui,sans-serif' }}>
      正在验证后台会话…
    </div>
  )
}
