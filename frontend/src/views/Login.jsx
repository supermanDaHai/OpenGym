import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { sendCode, register, login, EMAIL_RE } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// 验证码按钮：发送后进入 60 秒倒计时，防止刷屏。
function useCountdown() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!left) return
    const iv = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000)
    return () => clearInterval(iv)
  }, [left])
  const start = useCallback(() => setLeft(60), [])
  return [left, start]
}

// 邮箱 + 验证码输入行（登录/注册共用）
function EmailCodeRow({ email, setEmail, code, setCode, purpose, toast, locked }) {
  const [left, start] = useCountdown()
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!EMAIL_RE.test(email)) { toast('请输入正确的邮箱地址'); return }
    setSending(true)
    try { await sendCode(email, purpose); toast(purpose === 'register' ? '验证码已发送，请查收邮箱' : '验证码已发送，请查收邮箱'); start() }
    catch (e) { toast(e.message || '发送失败，请稍后再试') }
    setSending(false)
  }
  return (
    <>
      <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
        <input className="field grow" type="email" inputMode="email" placeholder="邮箱地址" autoComplete="email"
          value={email} disabled={locked} onChange={e => setEmail(e.target.value.trim())}
          style={{ flex: 1, minWidth: 0 }} />
        <Button variant="plain" size="sm" style={{ whiteSpace: 'nowrap', padding: '0 14px' }} disabled={left > 0 || sending} onClick={send}>
          {left > 0 ? `${left}s 后重发` : sending ? '发送中…' : '获取验证码'}
        </Button>
      </div>
      <div style={{ height: 10 }} />
      <input className="field" type="text" inputMode="numeric" maxLength={6} placeholder="6 位验证码" autoComplete="one-time-code"
        value={code} disabled={locked} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        style={{ letterSpacing: '.3em', textAlign: 'center', fontWeight: 600 }} />
    </>
  )
}

// 完整的登录 / 注册表单 —— Login 页和设置里的"登录账号"弹层共用。
export function AuthCard({ onDone }) {
  const { setUser, pushState, pullState } = useStore()
  const toast = useUI(s => s.toast)
  const [mode, setMode] = useState('login')          // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const emailRef = useRef(null)
  useEffect(() => { setTimeout(() => emailRef.current?.focus(), 250) }, [])

  const finish = async u => {
    setUser(u)
    if (onDone) onDone()
    if (hasData(useStore.getState().S)) { await pushState(); toast(t('Welcome back, {0}', u.name)) }
    else { await pullState(); toast(t('Welcome, {0}', u.name)) }
  }

  const doLogin = async () => {
    if (!EMAIL_RE.test(email)) { toast('请输入正确的邮箱地址'); return }
    if (code.length !== 6) { toast('请输入 6 位验证码'); return }
    setBusy(true)
    try { await finish(await login({ email, code })) }
    catch (e) { toast(e.message || '登录失败，请重试') }
    setBusy(false)
  }

  const doRegister = async () => {
    if (!name.trim()) { toast('请填写昵称'); return }
    if (!EMAIL_RE.test(email)) { toast('请输入正确的邮箱地址'); return }
    if (code.length !== 6) { toast('请输入 6 位验证码'); return }
    if (!inviteCode.trim()) { toast('请输入邀请码'); return }
    setBusy(true)
    try { await finish(await register({ email, code, inviteCode: inviteCode.trim(), name: name.trim() })) }
    catch (e) { toast(e.message || '注册失败，请重试') }
    setBusy(false)
  }

  const go = () => (mode === 'login' ? doLogin() : doRegister())

  return (
    <>
      <div className="seg" style={{ '--n': 2, '--i': mode === 'login' ? 0 : 1, marginBottom: 18 }}>
        <span className="seg-sel" aria-hidden="true" />
        <button className={mode === 'login' ? 'on' : ''} aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
          <span>登录</span>
        </button>
        <button className={mode === 'register' ? 'on' : ''} aria-pressed={mode === 'register'} onClick={() => setMode('register')}>
          <span>注册</span>
        </button>
      </div>

      {mode === 'register' && <>
        <input ref={emailRef} className="field" placeholder="填写你的昵称即可" maxLength={40}
          value={name} onChange={e => setName(e.target.value)} />
        <div style={{ height: 10 }} />
      </>}

      <EmailCodeRow email={email} setEmail={setEmail} code={code} setCode={setCode}
        purpose={mode === 'register' ? 'register' : 'login'} toast={toast} locked={busy} />

      {mode === 'register' && <>
        <div style={{ height: 10 }} />
        <input className="field" placeholder="邀请码（找管理员获取）" maxLength={32}
          value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
          style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
        <div className="dim small" style={{ marginTop: 6, lineHeight: 1.5 }}>
          本项目采用邀请制，需要管理员发放的邀请码才能注册。
        </div>
      </>}

      {mode === 'login' && <div className="dim small" style={{ marginTop: 6, lineHeight: 1.5 }}>
        首次使用？请先切换到「注册」，用邀请码创建账号。
      </div>}

      <div style={{ height: 14 }} />
      <Button variant="primary" className="block" disabled={busy} onClick={go} style={{ width: '100%' }}>
        {mode === 'login' ? (busy ? '登录中…' : '登 录') : (busy ? '注册中…' : '注 册')}
      </Button>
    </>
  )
}

export default function Login() {
  const { setGuest } = useStore()
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center', paddingTop: 12 }

  // Demo 构建没有后端：只有本地游客档案一条路。
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      <Brand />
      <div className="muted" style={{ marginBottom: 30 }}>在线演示——所有数据只保存在当前浏览器。</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>开始体验</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        演示版完全在浏览器本地运行，基于示例数据，不会上传任何内容。邮箱登录、邀请码和多设备同步由自托管的 openGym 服务端提供。
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">一分钟自托管 →</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      <Brand />
      <div className="muted" style={{ marginBottom: 30, lineHeight: 1.7 }}>
        你的训练 · 你的数据 · 你说了算
      </div>
      <AuthCard />
      <Button variant="ghost" className="dim" style={{ marginTop: 18 }} onClick={() => setGuest(true)}>
        先随便看看，暂不登录（数据仅存本机）
      </Button>
      <div className="dim small" style={{ marginTop: 24, lineHeight: 1.7 }}>
        登录后数据自动同步到云端，换设备也能接着练。<br />
        每个账号拥有独立的训练计划、记录与体重数据。
      </div>
    </div>
  )
}

function Brand() {
  return <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
    <div style={{ height: 14 }} />
  </>
}
