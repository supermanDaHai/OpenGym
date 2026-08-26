import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiAdmin, adminLogin, setAdminToken } from '../lib/api.js'
import Icon from '../components/Icon.jsx'

/* ---------- 后台管理系统独立登录页 ----------
 * 与主站邮箱验证码登录完全隔离：管理员用 ADMIN_EMAILS + ADMIN_PASSWORD 登录，
 * 换取独立 bearer token（localStorage: gym_admin_token），token 有效期间直接进大屏。 */
export default function AdminLogin({ onOk }) {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (!email.trim() || !password) { setErr('请输入管理员邮箱和密码'); return }
    setBusy(true); setErr('')
    try {
      const res = await adminLogin(email.trim(), password)
      setAdminToken(res.token)
      onOk && onOk(res.admin)
    } catch (e2) {
      setErr(e2.message || '登录失败，请稍后重试')
    } finally { setBusy(false) }
  }

  return (
    <div className="adm-login">
      <style>{`
        .adm-login{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:radial-gradient(1100px 600px at 20% -10%,#12203a 0%,transparent 60%),radial-gradient(800px 500px at 100% 0%,#0f2b2a 0%,transparent 55%),#070b14;color:#e5edf8;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:20px}
        .adm-card{width:100%;max-width:380px;background:rgba(148,163,184,.06);border:1px solid rgba(148,163,184,.16);border-radius:18px;padding:34px 30px 28px;box-shadow:0 24px 64px rgba(0,0,0,.45)}
        .adm-brand{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:6px}
        .adm-brand .adm-logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#22d3ee,#34d399);display:flex;align-items:center;justify-content:center;color:#06221f;font-size:20px;font-weight:800}
        .adm-brand h1{margin:0;font-size:20px;font-weight:700;letter-spacing:.02em;background:linear-gradient(90deg,#7dd3fc,#34d399);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
        .adm-sub{text-align:center;color:#7b8ba5;font-size:12.5px;margin:0 0 24px}
        .adm-f{margin-bottom:14px}
        .adm-f label{display:block;font-size:12px;color:#94a3b8;margin-bottom:6px}
        .adm-in{position:relative}
        .adm-in input{width:100%;box-sizing:border-box;background:rgba(15,23,42,.55);border:1px solid rgba(148,163,184,.22);border-radius:10px;color:#e5edf8;font-size:14px;padding:11px 38px 11px 12px;outline:none;transition:border-color .15s}
        .adm-in input:focus{border-color:#22d3ee}
        .adm-in input::placeholder{color:#475569}
        .adm-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;padding:8px;font-size:15px;display:flex}
        .adm-eye:hover{color:#94a3b8}
        .adm-err{display:flex;align-items:center;gap:6px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.28);color:#fca5a5;font-size:12.5px;border-radius:9px;padding:8px 11px;margin-bottom:14px}
        .adm-btn{width:100%;border:none;border-radius:10px;background:linear-gradient(90deg,#22d3ee,#34d399);color:#06221f;font-size:15px;font-weight:700;padding:12px;cursor:pointer;letter-spacing:.04em;transition:filter .15s;display:flex;align-items:center;justify-content:center;gap:8px}
        .adm-btn:hover{filter:brightness(1.1)}
        .adm-btn:disabled{opacity:.55;cursor:default}
        .adm-foot{display:flex;justify-content:space-between;align-items:center;margin-top:18px;font-size:12px;color:#5b6b82}
        .adm-foot a{color:#7dd3fc;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
        .adm-foot a:hover{text-decoration:underline}
        .adm-hint{font-size:11px;color:#475569;text-align:center;margin-top:14px}
      `}</style>

      <form className="adm-card" onSubmit={submit}>
        <div className="adm-brand">
          <div className="adm-logo">G</div>
          <h1>openGym 运营管理系统</h1>
        </div>
        <p className="adm-sub">管理员专属后台 · 数据看板 / 用户 / 邀请码</p>

        {err && <div className="adm-err"><Icon name="alert" />{err}</div>}

        <div className="adm-f">
          <label>管理员邮箱</label>
          <div className="adm-in">
            <input type="email" autoComplete="username" placeholder="admin@example.com"
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>

        <div className="adm-f">
          <label>登录密码</label>
          <div className="adm-in">
            <input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="请输入后台密码"
              value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" className="adm-eye" onClick={() => setShow(!show)} aria-label={show ? '隐藏密码' : '显示密码'}>
              <Icon name={show ? 'eyeOff' : 'eye'} />
            </button>
          </div>
        </div>

        <button className="adm-btn" disabled={busy} type="submit">
          {busy ? '登录中…' : '登 录'}
        </button>

        <div className="adm-foot">
          <a onClick={() => nav('/home')}><Icon name="chevronLeft" />返回主站</a>
          <span>独立后台会话</span>
        </div>
        <div className="adm-hint">密码在服务端 .env 的 ADMIN_PASSWORD 中配置</div>
      </form>
    </div>
  )
}
