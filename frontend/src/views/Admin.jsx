import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { apiAdmin, setAdminToken, ADMIN_UNAUTH_EVENT } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import Icon from '../components/Icon.jsx'

// ============================================================
// 管理后台 —— 侧边栏菜单式布局（数据面板 / 用户管理 / 邀请码管理）
// 浅色明亮主题，自包含样式（不依赖主站深色主题）。
// 弹窗统一为「居中对话框」（Web 后台场景，替代移动端底部抽屉）。
// 所有数据流与功能与原实现保持一致。
// ============================================================

const rel = ts => {
  if (!ts) return '—'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' 天前'
  return fmtDate(new Date(ts).toISOString().slice(0, 10))
}

/* ---------- 居中弹窗容器（Web 后台专用） ---------- */
function Modal({ title, sub, onClose, children, size }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dsh-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'dsh-dialog' + (size === 'sm' ? ' sm' : '')}>
        {(title || sub) && (
          <div className="dsh-d-head">
            <div>
              {title && <div className="dsh-dt">{title}</div>}
              {sub && <div className="dsh-ds">{sub}</div>}
            </div>
            <button className="dsh-d-close" onClick={onClose} aria-label="关闭">✕</button>
          </div>
        )}
        <div className="dsh-d-body">{children}</div>
      </div>
    </div>
  )
}

/* ---------- 危险操作确认框 ---------- */
function ConfirmDialog({ title, message, confirmText, danger, onConfirm, close }) {
  return (
    <Modal onClose={close} size="sm">
      <div className="dsh-confirm">
        <div className={'dsh-confirm-ic' + (danger ? ' danger' : '')}>!</div>
        <div className="dsh-confirm-t">{title}</div>
        <div className="dsh-confirm-m">{message}</div>
        <div className="dsh-confirm-acts">
          <button className="dsh-btn dsh-btn-ghost" onClick={close}>取消</button>
          <button
            className={'dsh-btn ' + (danger ? 'dsh-btn-danger' : 'dsh-btn-primary')}
            onClick={() => { onConfirm && onConfirm(); close() }}
          >{confirmText || '确定'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- KPI 卡片 ---------- */
function Kpi({ label, value, color = '#10b981', sub }) {
  return (
    <div className="dsh-kpi" style={{ '--k': color }}>
      <div className="dsh-kpi-l">{label}</div>
      <div className="dsh-kpi-v">{value}</div>
      {sub && <div className="dsh-kpi-s">{sub}</div>}
    </div>
  )
}

/* ---------- SVG 折线图（注册/活跃趋势） ---------- */
function LineChart({ title, data, color = '#6366f1', height = 180, sub }) {
  const W = 600, H = height, PL = 34, PR = 12, PT = 16, PB = 24
  const max = Math.max(1, ...data.map(d => d.n))
  const iw = W - PL - PR, ih = H - PT - PB
  const pts = data.map((d, i) => [
    PL + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw),
    PT + ih - (d.n / max) * ih
  ])
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  const area = `${PL},${PT + ih} ${line} ${PL + iw},${PT + ih}`
  const gid = useMemo(() => 'lg' + Math.random().toString(36).slice(2, 8), [])
  const labelEvery = Math.max(1, Math.ceil(data.length / 6))
  return (
    <div className="dsh-card">
      <div className="dsh-card-h"><span className="t">{title}</span>{sub && <span className="dsh-card-sub">{sub}</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".16" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PL} y1={PT} x2={PL + iw} y2={PT} stroke="#eef1f6" />
        <line x1={PL} y1={PT + ih / 2} x2={PL + iw} y2={PT + ih / 2} stroke="#eef1f6" />
        <line x1={PL} y1={PT + ih} x2={PL + iw} y2={PT + ih} stroke="#dbe0e8" />
        <text x={PL - 6} y={PT + 3} fill="#94a3b8" fontSize="9" textAnchor="end">{max}</text>
        <text x={PL - 6} y={PT + ih + 3} fill="#94a3b8" fontSize="9" textAnchor="end">0</text>
        <polygon points={area} fill={`url(#${gid})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="2.6" fill={color}>
              <title>{data[i].d}：{data[i].n}</title>
            </circle>
            {(i % labelEvery === 0 || i === data.length - 1) && (
              <text x={x} y={H - 5} fill="#94a3b8" fontSize="9" textAnchor="middle">{data[i].d.slice(5)}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

/* ---------- SVG 柱状图（每日训练量） ---------- */
function BarChart({ title, data, color = '#10b981', height = 180, sub }) {
  const W = 600, H = height, PL = 34, PR = 12, PT = 16, PB = 24
  const max = Math.max(1, ...data.map(d => d.n))
  const iw = W - PL - PR, ih = H - PT - PB
  const bw = iw / data.length
  const labelEvery = Math.max(1, Math.ceil(data.length / 6))
  return (
    <div className="dsh-card">
      <div className="dsh-card-h"><span className="t">{title}</span>{sub && <span className="dsh-card-sub">{sub}</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1={PL} y1={PT + ih} x2={PL + iw} y2={PT + ih} stroke="#dbe0e8" />
        <text x={PL - 6} y={PT + ih + 3} fill="#94a3b8" fontSize="9" textAnchor="end">0</text>
        {data.map((d, i) => {
          const h = (d.n / max) * ih
          const x = PL + i * bw
          const y = PT + ih - h
          return (
            <g key={i}>
              <rect x={x + bw * 0.24} y={y} width={bw * 0.52} height={Math.max(2, h)} rx="3" fill={color} fillOpacity=".85">
                <title>{d.d}：{d.n} 次训练</title>
              </rect>
              {(i % labelEvery === 0 || i === data.length - 1) && (
                <text x={x + bw / 2} y={H - 5} fill="#94a3b8" fontSize="9" textAnchor="middle">{d.d.slice(5)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ---------- 横向条形（高频动作 Top） ---------- */
function HBarList({ title, data, color = '#0ea5e9' }) {
  const max = Math.max(1, ...data.map(d => d.count))
  return (
    <div className="dsh-card">
      <div className="dsh-card-h"><span className="t">{title}</span><span className="dsh-card-sub">全部用户的训练记录</span></div>
      <div className="dsh-hbars">
        {data.map(d => (
          <div key={d.name} className="dsh-hbar">
            <span className="dsh-hbar-n">{d.name}</span>
            <span className="dsh-hbar-track">
              <span className="dsh-hbar-fill" style={{ width: (d.count / max) * 100 + '%', background: color }} />
            </span>
            <span className="dsh-hbar-v">{fmtNum(d.count)}</span>
          </div>
        ))}
        {!data.length && <div className="dsh-empty">暂无训练记录</div>}
      </div>
    </div>
  )
}

/* ---------- 创建邀请码（居中弹窗） ---------- */
function NewInvite({ reload, close }) {
  const toast = useUI(s => s.toast)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const { invite } = await apiAdmin('/api/admin/invites/new', {
        method: 'POST', body: JSON.stringify({
          code: code.trim() || undefined,
          note: note.trim(),
          maxUses: maxUses ? +maxUses : undefined
        })
      })
      navigator.clipboard?.writeText(invite.code).catch(() => {})
      toast(`邀请码 ${invite.code} 已生成并复制到剪贴板`)
      reload(); close()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  return (
    <Modal title="创建邀请码" sub="邀请码发给用户后，他们凭码 + 邮箱验证码即可注册。每个邀请码邀请到的人都会记录在后台。" onClose={close} size="sm">
      <input className="dsh-input" placeholder="自定义邀请码（留空自动生成，4-32 位字母数字）" maxLength={32} value={code}
        onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} style={{ letterSpacing: '.1em', fontWeight: 600 }} />
      <input className="dsh-input" placeholder="备注（如：发给张三 / 健身群推广）" maxLength={60} value={note} onChange={e => setNote(e.target.value)} />
      <input className="dsh-input" type="number" min="1" max="1000" placeholder="最多可用次数（留空 = 不限次数）" value={maxUses}
        onChange={e => setMaxUses(e.target.value.replace(/\D/g, ''))} />
      <button className="dsh-btn dsh-btn-primary dsh-block" disabled={busy} onClick={create} style={{ marginTop: 16 }}>
        {busy ? '创建中…' : '生成邀请码'}
      </button>
    </Modal>
  )
}

/* ---------- 邀请码管理（列表 + 操作） ---------- */
function InvitesCard({ invites, reload, confirm, openNew }) {
  const toast = useUI(s => s.toast)
  const open = (invites || []).filter(i => !i.revoked)
  const revoked = (invites || []).filter(i => i.revoked)
  const copy = code => { navigator.clipboard?.writeText(code).catch(() => {}); toast(`已复制 ${code}`) }
  const revoke = inv => confirm({
    title: '吊销邀请码 ' + inv.code + '？',
    message: '吊销后该码无法再注册新用户，但已邀请到的用户不受影响。',
    confirmText: '吊销', danger: true,
    onConfirm: () => apiAdmin('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code: inv.code }) })
      .then(() => { toast('已吊销'); reload() }).catch(e => toast(e.message))
  })
  return (
    <div className="dsh-card">
      <div className="dsh-card-h">
        <span className="t">邀请码管理</span>
        <span className="dsh-card-sub">{open.length} 个可用 · {invites ? invites.reduce((s, i) => s + i.usedCount, 0) : 0} 人受邀注册</span>
        <span style={{ flex: 1 }} />
        <button className="dsh-btn dsh-btn-primary dsh-btn-sm" onClick={openNew}>＋ 创建</button>
      </div>
      <div className="dsh-inv">
        {open.map(inv => (
          <div key={inv.code} className="dsh-inv-row">
            <div className="dsh-inv-head">
              <code className="dsh-inv-code" onClick={() => copy(inv.code)}>{inv.code}</code>
              <span className="dsh-inv-meta">
                {inv.note ? inv.note + ' · ' : ''}{inv.usedCount}{inv.maxUses ? '/' + inv.maxUses : ''} 次使用
                {inv.createdByName ? ' · ' + inv.createdByName + ' 创建' : ''}
              </span>
              <span style={{ flex: 1 }} />
              <button className="dsh-mini ok" onClick={() => copy(inv.code)}>复制</button>
              {inv.usedCount === 0 && <button className="dsh-mini danger" onClick={() => revoke(inv)}>吊销</button>}
            </div>
            {inv.uses?.length > 0 && (
              <div className="dsh-inv-users">
                {inv.uses.map((u, i) => (
                  <span key={u.uid || i} className="dsh-chip">
                    {u.name}{u.email ? ' · ' + u.email : ''}
                    <em>{u.at ? fmtDate(u.at.slice(0, 10)) : ''}</em>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {!open.length && <div className="dsh-empty">还没有邀请码 —— 点右上角「创建」生成一个发给用户。</div>}
        {revoked.length > 0 && <div className="dsh-revoked">已吊销：{revoked.map(i => i.code).join('、')}</div>}
      </div>
    </div>
  )
}

/* ---------- 用户详情（居中弹窗） ---------- */
function UserDetail({ id, onChanged, confirm, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { apiAdmin('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <Modal title="用户详情" onClose={close}><div className="dsh-muted">加载中…</div></Modal>
  const u = d.user
  const setDisabled = disabled => {
    apiAdmin('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? '已禁用该账号' : '已启用该账号'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const toggle = () => {
    if (u.disabled) { setDisabled(false); return }
    confirm({
      title: '禁用 ' + u.name + '？',
      message: '该账号将被立即登出，无法再登录和同步，直到你重新启用。',
      confirmText: '禁用', danger: true,
      onConfirm: () => setDisabled(true)
    })
  }
  return (
    <Modal title={u.name} sub={u.email || '—'} onClose={close}>
      <div className="dsh-row" style={{ gap: 6, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        {u.admin && <span className="dsh-tag acc">管理员</span>}
        {u.disabled && <span className="dsh-tag bad">已禁用</span>}
        {u.invitedBy && <span className="dsh-tag">邀请码 {u.invitedBy}</span>}
        <span className="dsh-tag">注册于 {u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
      </div>
      <div className="dsh-tiles">
        <div className="dsh-tile"><div className="l">训练次数</div><div className="v">{d.workouts.length}</div></div>
        <div className="dsh-tile"><div className="l">体重记录</div><div className="v">{d.bodyweight.length}</div></div>
        <div className="dsh-tile"><div className="l">训练计划</div><div className="v">{d.routines.length}</div></div>
        <div className="dsh-tile"><div className="l">最后同步</div><div className="v" style={{ fontSize: 15 }}>{rel(d.lastSync)}</div></div>
      </div>
      {!u.admin && (
        <button className={'dsh-btn dsh-block ' + (u.disabled ? 'dsh-btn-primary' : 'dsh-btn-danger')} style={{ margin: '6px 0 2px' }} onClick={toggle}>
          {u.disabled ? '启用账号' : '禁用账号'}
        </button>
      )}
      <div className="dsh-sec">训练历史</div>
      {d.workouts.length ? <div className="dsh-list">
        {d.workouts.slice(0, 60).map(w => <div key={w.id} className="dsh-row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--dsh-border)' }}>
          <div>
            <div className="dsh-list-n">{w.name}</div>
            <div className="dsh-dim" style={{ fontSize: 12 }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} 组{w.prs?.length ? ' · ' + w.prs.length + ' 个PR' : ''}</div>
          </div>
          <span className="dsh-muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
        </div>)}
      </div> : <div className="dsh-empty small">暂无训练记录。</div>}
    </Modal>
  )
}

/* ---------- 用户管理（表格 + 操作按钮） ---------- */
function UsersTable({ users, onChanged, openUser, confirm }) {
  const toast = useUI(s => s.toast)
  const live = (users || []).filter(u => u.live)
  const sorted = [...(users || [])].sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
  const setDisabled = (u, disabled) => {
    apiAdmin('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? `已禁用 ${u.name}` : `已启用 ${u.name}`); onChanged() })
      .catch(e => toast(e.message))
  }
  const toggle = u => {
    if (u.disabled) { setDisabled(u, false); return }
    confirm({
      title: '禁用 ' + u.name + '？',
      message: '该账号将被立即登出，无法再登录和同步，直到你重新启用。',
      confirmText: '禁用', danger: true,
      onConfirm: () => setDisabled(u, true)
    })
  }
  return (
    <div className="dsh-card">
      <div className="dsh-card-h">
        <span className="t">用户列表</span>
        <span className="dsh-card-sub">{users ? users.length : 0} 人 · 按最后活跃排序</span>
      </div>
      {live.length > 0 && (
        <div className="dsh-live">
          <span className="dsh-live-dot" /> 正在训练：{live.map(u => u.name).join('、')}
          {live.map(u => `（${u.live.name} ${u.live.setsDone}/${u.live.setsTotal} 组）`).join(' ')}
        </div>
      )}
      <div className="dsh-tbl">
        <div className="dsh-tr dsh-th">
          <span>用户</span><span>邀请码</span><span>注册时间</span><span>最后活跃</span><span>训练</span><span>体重</span><span>状态</span><span>操作</span>
        </div>
        {sorted.map(u => (
          <div key={u.id} className={'dsh-tr' + (u.disabled ? ' off' : '')} onClick={() => openUser(u.id)}>
            <span className="dsh-u">
              {u.live && <i className="dsh-live-dot" />}
              <b>{u.name}</b>
              {u.admin && <em className="dsh-tag acc">管理员</em>}
              {u.disabled && <em className="dsh-tag bad">禁用</em>}
              <small>{u.email || '—'}</small>
            </span>
            <span><code className="dsh-code">{u.invitedBy || '—'}</code></span>
            <span className="dim">{u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
            <span className="dim">{rel(u.lastActiveAt || u.lastSync || u.lastLogin)}</span>
            <span>{u.workouts}{u.lastWorkout ? <small className="dim">（{u.lastWorkout.slice(5)}）</small> : ''}</span>
            <span>{u.weighIns}</span>
            <span>{u.hasPush ? '推送已开' : '—'}</span>
            <span className="dsh-ops">
              <button className="dsh-mini ghost" onClick={e => { e.stopPropagation(); openUser(u.id) }}>详情</button>
              {!u.admin && (
                <button className={'dsh-mini ' + (u.disabled ? 'ok' : 'danger')} onClick={e => { e.stopPropagation(); toggle(u) }}>
                  {u.disabled ? '启用' : '禁用'}
                </button>
              )}
            </span>
          </div>
        ))}
        {users && !users.length && <div className="dsh-empty">暂无用户数据</div>}
      </div>
    </div>
  )
}

/* ---------- 后台主体：侧边栏 + 内容区 ---------- */
export default function Admin({ admin, onExit }) {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [view, setView] = useState('dash')   // dash | users | invites
  const [q, setQ] = useState('')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [now, setNow] = useState(new Date())
  const [modal, setModal] = useState(null)   // {kind:'user'|'invite'|'confirm', ...}

  const loadStats = () => apiAdmin('/api/admin/stats').then(setStats).catch(() => {})
  const loadUsers = () => apiAdmin('/api/admin/users').then(d => setUsers(d.users)).catch(() => {})
  const loadInvites = () => apiAdmin('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const reload = () => { loadStats(); loadUsers(); loadInvites() }

  const signOut = async () => {
    try { await apiAdmin('/api/admin/logout', { method: 'POST' }) } catch { /* token may already be dead */ }
    setAdminToken(null)
    window.dispatchEvent(new Event(ADMIN_UNAUTH_EVENT))
    onExit && onExit()
  }

  useEffect(() => {
    reload()
    const iv = setInterval(reload, 30000)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv) }, [])

  const openUser = id => setModal({ kind: 'user', id })
  const openNewInvite = () => setModal({ kind: 'invite' })
  const confirm = opts => setModal({ kind: 'confirm', ...opts })
  const closeModal = () => setModal(null)

  const t = stats?.totals
  const timeStr = now.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ql = q.trim().toLowerCase()
  const usersFiltered = ql
    ? (users || []).filter(u => (u.name || '').toLowerCase().includes(ql) || (u.email || '').toLowerCase().includes(ql))
    : users
  const openInvites = (invites || []).filter(i => !i.revoked)
  const totalUsed = invites ? invites.reduce((s, i) => s + i.usedCount, 0) : 0
  const liveCount = users ? users.filter(u => u.live).length : 0
  const TITLES = { dash: '数据面板', users: '用户管理', invites: '邀请码管理' }
  const SUBS = {
    dash: '实例运行总览 · 实时数据每 30 秒刷新',
    users: '管理注册用户 · 可查看详情与禁用账号',
    invites: '生成与管理邀请码 · 控制注册入口'
  }

  return (
    <div className="dsh">
      <style>{`
        .dsh{position:fixed;inset:0;z-index:60;display:flex;overflow:hidden;
          background:#f4f6f9;color:#0f172a;
          --dsh-bg:#f4f6f9;--dsh-surface:#ffffff;--dsh-surface-2:#f8fafc;
          --dsh-border:#e8ebf1;--dsh-border-strong:#dbe0e8;
          --dsh-t1:#0f172a;--dsh-t2:#475569;--dsh-t3:#94a3b8;
          --dsh-acc:#10b981;--dsh-acc-ink:#047857;--dsh-acc-soft:#e7f8f1;
          --dsh-danger:#ef4444;--dsh-danger-soft:#fdecec;--dsh-danger-ink:#b91c1c;
          --dsh-shadow:0 1px 2px rgba(16,24,40,.04),0 1px 3px rgba(16,24,40,.06);
          --dsh-shadow-lg:0 24px 60px -12px rgba(16,24,40,.22);
          font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
        .dsh .dim{color:var(--dsh-t3)}
        .dsh .small{font-size:12px}
        .dsh .muted{color:var(--dsh-t3)}
        .dsh .row{display:flex;align-items:center;gap:12px}
        .dsh .between{justify-content:space-between}
        /* ---- 左侧菜单 ---- */
        .dsh-side{width:248px;flex:none;display:flex;flex-direction:column;background:#fff;
          border-right:1px solid var(--dsh-border);padding:20px 14px 16px;min-height:0}
        .dsh-logo{display:flex;align-items:center;gap:11px;padding:6px 10px 18px;border-bottom:1px solid var(--dsh-border);cursor:pointer}
        .dsh-logo .dsh-logo-ic{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#10b981,#0ea5e9);
          display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;flex:none;box-shadow:0 4px 12px -2px rgba(16,185,129,.4)}
        .dsh-logo b{display:block;font-size:15px;font-weight:700;letter-spacing:.2px;color:var(--dsh-t1)}
        .dsh-logo small{display:block;color:var(--dsh-t3);font-size:11.5px;margin-top:1px}
        .dsh-nav{display:flex;flex-direction:column;gap:3px;margin-top:14px}
        .dsh-nav button{display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;border:none;border-radius:10px;
          background:transparent;color:var(--dsh-t2);font-size:14px;cursor:pointer;text-align:left;font-family:inherit;transition:background .15s,color .15s}
        .dsh-nav button:hover{background:var(--dsh-surface-2);color:var(--dsh-t1)}
        .dsh-nav button.on{background:var(--dsh-acc-soft);color:var(--dsh-acc-ink);font-weight:600}
        .dsh-nav button .ic{width:18px;height:18px;flex:none;opacity:.85}
        .dsh-nav button .badge{margin-left:auto;background:#eef2ff;color:#4f46e5;font-size:11px;border-radius:99px;padding:1px 9px;font-weight:600}
        .dsh-side-foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--dsh-border);display:flex;flex-direction:column;gap:9px}
        .dsh-admin{display:inline-flex;align-items:center;gap:8px;background:var(--dsh-surface-2);border:1px solid var(--dsh-border);
          color:var(--dsh-t2);font-size:12.5px;border-radius:99px;padding:6px 12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dsh-admin::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--dsh-acc);flex:none}
        .dsh-side-foot .dsh-ft{display:flex;gap:8px}
        .dsh-out{flex:1;background:var(--dsh-danger-soft);color:var(--dsh-danger-ink);border:1px solid #f6d4d4;border-radius:10px;font-size:12.5px;padding:9px 0;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit}
        .dsh-out:hover{filter:brightness(.98)}
        .dsh-home{flex:1;background:var(--dsh-surface);color:var(--dsh-t2);border:1px solid var(--dsh-border);border-radius:10px;font-size:12.5px;padding:9px 0;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit}
        .dsh-home:hover{background:var(--dsh-surface-2)}
        /* ---- 右侧内容区 ---- */
        .dsh-main{flex:1;min-width:0;overflow-y:auto;padding:28px 32px 56px}
        .dsh-wrap{max-width:1320px;margin:0 auto}
        .dsh-top{display:flex;align-items:center;gap:14px;margin-bottom:24px;flex-wrap:wrap}
        .dsh-top h2{font-size:23px;font-weight:700;margin:0;letter-spacing:-.02em}
        .dsh-top-sub{color:var(--dsh-t3);font-size:13px;margin-top:2px}
        .dsh-time{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--dsh-border);
          border-radius:10px;padding:8px 13px;color:var(--dsh-t2);font-size:12.5px;font-variant-numeric:tabular-nums}
        .dsh-time::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--dsh-acc);flex:none}
        .dsh-refresh-btn{background:#fff;color:var(--dsh-t2);border:1px solid var(--dsh-border);border-radius:10px;font-size:12.5px;padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;transition:.15s}
        .dsh-refresh-btn:hover{background:var(--dsh-surface-2)}
        .dsh-tools{display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap}
        .dsh-search{background:#fff;border:1px solid var(--dsh-border);border-radius:10px;padding:9px 13px;color:var(--dsh-t1);font-size:13.5px;outline:none;min-width:240px;font-family:inherit}
        .dsh-search::placeholder{color:var(--dsh-t3)}
        .dsh-search:focus{border-color:var(--dsh-acc);box-shadow:0 0 0 3px var(--dsh-acc-soft)}
        .dsh-tool-stat{color:var(--dsh-t3);font-size:12.5px;font-variant-numeric:tabular-nums}
        /* ---- 数据面板 ---- */
        .dsh-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px;margin-bottom:18px}
        .dsh-kpi{background:#fff;border:1px solid var(--dsh-border);border-radius:14px;padding:18px 20px;position:relative;overflow:hidden;box-shadow:var(--dsh-shadow)}
        .dsh-kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--k);border-radius:0 3px 3px 0;opacity:.9}
        .dsh-kpi-v{font-size:30px;font-weight:750;letter-spacing:-.02em;color:var(--k);line-height:1.05;margin-top:6px;font-variant-numeric:tabular-nums}
        .dsh-kpi-l{font-size:12.5px;color:var(--dsh-t3);font-weight:500}
        .dsh-kpi-s{font-size:12px;color:var(--dsh-t3);margin-top:4px}
        .dsh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:18px;margin-bottom:18px}
        .dsh-card{background:#fff;border:1px solid var(--dsh-border);border-radius:18px;padding:20px 22px;min-width:0;box-shadow:var(--dsh-shadow)}
        .dsh-card-h{display:flex;align-items:baseline;gap:10px;font-size:14.5px;font-weight:600;color:var(--dsh-t1);margin-bottom:14px;flex-wrap:wrap}
        .dsh-card-h .t{font-weight:600}
        .dsh-card-sub{font-size:12px;color:var(--dsh-t3);font-weight:400}
        .dsh-empty{color:var(--dsh-t3);font-size:12.5px;padding:18px 0;text-align:center}
        .dsh-hbars{display:flex;flex-direction:column;gap:9px;margin-top:2px}
        .dsh-hbar{display:flex;align-items:center;gap:10px;font-size:12.5px}
        .dsh-hbar-n{flex:0 0 104px;color:var(--dsh-t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
        .dsh-hbar-track{flex:1;height:8px;background:var(--dsh-surface-2);border-radius:99px;overflow:hidden}
        .dsh-hbar-fill{display:block;height:100%;border-radius:99px;min-width:2px}
        .dsh-hbar-v{flex:0 0 34px;color:var(--dsh-t2);font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
        /* ---- 邀请码 ---- */
        .dsh-inv{display:flex;flex-direction:column;gap:12px}
        .dsh-inv-row{background:var(--dsh-surface-2);border:1px solid var(--dsh-border);border-radius:12px;padding:13px 16px}
        .dsh-inv-head{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
        .dsh-inv-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:700;letter-spacing:.06em;color:#4f46e5;cursor:pointer;user-select:all}
        .dsh-inv-meta{font-size:11.5px;color:var(--dsh-t3)}
        .dsh-inv-users{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
        .dsh-chip{display:inline-flex;align-items:center;gap:6px;background:var(--dsh-acc-soft);border:1px solid #c7eedd;color:var(--dsh-acc-ink);font-size:11px;border-radius:99px;padding:3px 11px}
        .dsh-chip em{font-style:normal;opacity:.7}
        .dsh-revoked{font-size:11.5px;color:var(--dsh-t3);margin-top:8px}
        /* ---- 通用小按钮 ---- */
        .dsh-mini{background:var(--dsh-surface);color:var(--dsh-t2);border:1px solid var(--dsh-border);border-radius:8px;font-size:12px;padding:5px 11px;cursor:pointer;font-family:inherit;transition:.15s}
        .dsh-mini:hover{background:var(--dsh-surface-2)}
        .dsh-mini.ok{background:var(--dsh-acc-soft);color:var(--dsh-acc-ink);border-color:#bfe9d4}
        .dsh-mini.danger{background:var(--dsh-danger-soft);color:var(--dsh-danger-ink);border-color:#f6d4d4}
        /* ---- 用户表格 ---- */
        .dsh-live{display:flex;align-items:center;gap:8px;background:var(--dsh-acc-soft);border:1px solid #c7eedd;color:var(--dsh-acc-ink);font-size:13px;border-radius:14px;padding:11px 16px;margin-bottom:14px;flex-wrap:wrap}
        .dsh-live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dsh-acc);box-shadow:0 0 0 0 rgba(16,185,129,.5);flex:none;animation:dshp 1.6s infinite}
        @keyframes dshp{70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
        .dsh-tbl{display:flex;flex-direction:column;min-width:0}
        .dsh-tr{display:grid;grid-template-columns:1.9fr 1fr 1fr 1fr .7fr .6fr .8fr 1.3fr;gap:8px;align-items:center;padding:12px 12px;border-bottom:1px solid var(--dsh-border);font-size:13px;min-width:0}
        .dsh-tr:not(.dsh-th){cursor:pointer;border-radius:8px}
        .dsh-tr:not(.dsh-th):hover{background:var(--dsh-surface-2)}
        .dsh-tr.off{opacity:.5}
        .dsh-th{color:var(--dsh-t3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:var(--dsh-surface-2);border-bottom:1px solid var(--dsh-border)}
        .dsh-u{display:flex;flex-direction:column;gap:2px;min-width:0}
        .dsh-u b{font-size:13.5px;color:var(--dsh-t1);display:flex;align-items:center;gap:6px}
        .dsh-u small{color:var(--dsh-t3);font-size:11.5px;overflow:hidden;text-overflow:ellipsis}
        .dsh-u .dsh-live-dot{margin-right:2px}
        .dsh-tag{display:inline-flex;align-items:center;font-style:normal;font-size:11px;font-weight:600;border-radius:99px;padding:3px 10px;background:var(--dsh-surface-2);color:var(--dsh-t2)}
        .dsh-tag.acc{background:var(--dsh-acc-soft);color:var(--dsh-acc-ink)}
        .dsh-tag.bad{background:var(--dsh-danger-soft);color:var(--dsh-danger-ink)}
        .dsh-code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#4f46e5;font-weight:600;letter-spacing:.02em}
        .dsh-ops{display:flex;gap:6px;align-items:center;justify-content:flex-end}
        /* ---- 通用按钮 ---- */
        .dsh-btn{font-family:inherit;border:none;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:600;padding:9px 15px;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:.15s}
        .dsh-btn:active{transform:translateY(1px)}
        .dsh-btn:disabled{opacity:.5;pointer-events:none}
        .dsh-btn-primary{background:var(--dsh-acc);color:#fff;box-shadow:0 4px 12px -3px rgba(16,185,129,.45)}
        .dsh-btn-primary:hover{background:#0da271}
        .dsh-btn-danger{background:var(--dsh-danger);color:#fff}
        .dsh-btn-danger:hover{background:#dc2626}
        .dsh-btn-ghost{background:var(--dsh-surface);border:1px solid var(--dsh-border);color:var(--dsh-t2)}
        .dsh-btn-ghost:hover{background:var(--dsh-surface-2)}
        .dsh-btn-sm{padding:7px 12px;font-size:12.5px}
        .dsh-block{width:100%}
        /* ---- 居中弹窗 ---- */
        .dsh-backdrop{position:fixed;inset:0;z-index:90;background:rgba(15,23,42,.46);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
          display:flex;align-items:center;justify-content:center;padding:24px;animation:dshfade .2s ease}
        @keyframes dshfade{from{opacity:0}to{opacity:1}}
        .dsh-dialog{background:#fff;border-radius:18px;box-shadow:var(--dsh-shadow-lg);width:min(92vw,560px);max-height:88vh;
          display:flex;flex-direction:column;overflow:hidden;animation:dshpop .26s cubic-bezier(.2,.8,.3,1)}
        .dsh-dialog.sm{width:min(92vw,440px)}
        @keyframes dshpop{from{transform:scale(.95) translateY(8px);opacity:0}to{transform:none;opacity:1}}
        .dsh-d-head{display:flex;align-items:center;gap:12px;padding:20px 24px 16px;border-bottom:1px solid var(--dsh-border)}
        .dsh-dt{font-size:17px;font-weight:700;letter-spacing:-.01em;color:var(--dsh-t1)}
        .dsh-ds{font-size:12.5px;color:var(--dsh-t3);margin-top:3px}
        .dsh-d-close{margin-left:auto;width:32px;height:32px;border-radius:9px;border:1px solid var(--dsh-border);background:#fff;
          color:var(--dsh-t3);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;flex:none;font-family:inherit}
        .dsh-d-close:hover{background:var(--dsh-surface-2);color:var(--dsh-t1)}
        .dsh-d-body{padding:20px 24px;overflow-y:auto}
        /* ---- 弹窗内容元素 ---- */
        .dsh-input{width:100%;border:1px solid var(--dsh-border);border-radius:10px;padding:11px 13px;font-size:13.5px;font-family:inherit;
          color:var(--dsh-t1);outline:none;background:#fff;transition:.15s;margin-top:12px}
        .dsh-input:first-of-type{margin-top:0}
        .dsh-input:focus{border-color:var(--dsh-acc);box-shadow:0 0 0 3px var(--dsh-acc-soft)}
        .dsh-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:4px 0 18px}
        .dsh-tile{background:var(--dsh-surface-2);border:1px solid var(--dsh-border);border-radius:12px;padding:13px 12px;text-align:center}
        .dsh-tile .l{font-size:11.5px;color:var(--dsh-t3)}
        .dsh-tile .v{font-size:21px;font-weight:700;margin-top:4px;letter-spacing:-.02em;color:var(--dsh-t1);font-variant-numeric:tabular-nums}
        .dsh-sec{font-size:12px;font-weight:700;color:var(--dsh-t2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px}
        .dsh-list{display:flex;flex-direction:column}
        .dsh-list-n{font-weight:600;font-size:13.5px;color:var(--dsh-t1)}
        .dsh-confirm{text-align:center;padding:8px 2px 2px}
        .dsh-confirm-ic{width:46px;height:46px;border-radius:50%;background:var(--dsh-surface-2);color:var(--dsh-t2);display:flex;
          align-items:center;justify-content:center;font-size:22px;font-weight:700;margin:0 auto 14px}
        .dsh-confirm-ic.danger{background:var(--dsh-danger-soft);color:var(--dsh-danger)}
        .dsh-confirm-t{font-size:16px;font-weight:700;color:var(--dsh-t1);margin-bottom:6px}
        .dsh-confirm-m{font-size:13px;color:var(--dsh-t2);line-height:1.6;margin-bottom:22px}
        .dsh-confirm-acts{display:flex;gap:10px;justify-content:center}
        /* 窄窗口（桌面缩放，非移动端适配） */
        @media (max-width:1100px){
          .dsh-kpis{grid-template-columns:repeat(2,1fr)}
          .dsh-grid{grid-template-columns:1fr}
        }
      `}</style>

      {/* ---------- 左侧菜单 ---------- */}
      <aside className="dsh-side">
        <div className="dsh-logo" onClick={() => nav('/home')} title="返回主站">
          <span className="dsh-logo-ic"><Icon name="dumbbell" /></span>
          <div><b>openGym 后台</b><small>管理控制台</small></div>
        </div>
        <nav className="dsh-nav">
          <button className={view === 'dash' ? 'on' : ''} onClick={() => setView('dash')}>
            <Icon name="chart" className="ic" />数据面板
          </button>
          <button className={view === 'users' ? 'on' : ''} onClick={() => setView('users')}>
            <Icon name="personCircle" className="ic" />用户管理{users && <span className="badge">{users.length}</span>}
          </button>
          <button className={view === 'invites' ? 'on' : ''} onClick={() => setView('invites')}>
            <Icon name="key" className="ic" />邀请码管理{invites && <span className="badge">{openInvites.length}</span>}
          </button>
        </nav>
        <div className="dsh-side-foot">
          {admin && <span className="dsh-admin">{admin.name || admin.email}</span>}
          <div className="dsh-ft">
            <button className="dsh-home" onClick={() => nav('/home')}><Icon name="house" />返回主站</button>
            <button className="dsh-out" onClick={signOut}><Icon name="signOut" />退出</button>
          </div>
        </div>
      </aside>

      {/* ---------- 右侧内容区 ---------- */}
      <main className="dsh-main">
        <div className="dsh-wrap">
          <div className="dsh-top">
            <div>
              <h2>{TITLES[view]}</h2>
              <div className="dsh-top-sub">{SUBS[view]}</div>
            </div>
            <span className="dsh-time">{timeStr}</span>
            <span style={{ flex: 1 }} />
            <button className="dsh-refresh-btn" onClick={reload} aria-label="刷新">↻ 刷新</button>
          </div>

          {/* ---- 数据面板 ---- */}
          {view === 'dash' && <>
            <div className="dsh-kpis">
              <Kpi label="注册用户" value={t ? t.users : '—'} color="#6366f1" sub="累计注册人数" />
              <Kpi label="今日活跃" value={t ? t.activeToday : '—'} color="#10b981" sub="今天有操作的用户" />
              <Kpi label="本周活跃" value={t ? t.active7d : '—'} color="#0ea5e9" sub="近 7 天" />
              <Kpi label="30 天活跃" value={t ? t.active30d : '—'} color="#f59e0b" sub="近 30 天" />
              <Kpi label="累计训练" value={t ? fmtNum(t.workouts) : '—'} color="#8b5cf6" sub={`今日 ${t ? t.workoutsToday : 0} 次`} />
              <Kpi label="体重记录" value={t ? fmtNum(t.weighIns) : '—'} color="#f43f5e" sub="累计称重次数" />
              <Kpi label="正在训练" value={liveCount || '—'} color="#14b8a6" sub="实时在线训练" />
            </div>
            <div className="dsh-grid">
              <LineChart title="注册趋势" sub="近 30 天新增用户" data={stats?.registrations || []} color="#6366f1" />
              <BarChart title="每日训练量" sub="近 30 天训练次数" data={stats?.workoutTrend || []} color="#10b981" />
              <LineChart title="活跃趋势" sub="近 30 天每日活跃用户" data={stats?.activeTrend || []} color="#f59e0b" />
              <HBarList title="高频动作 TOP10" data={stats?.topExercises || []} />
            </div>
          </>}

          {/* ---- 用户管理 ---- */}
          {view === 'users' && <>
            <div className="dsh-tools">
              <input className="dsh-search" placeholder="搜索昵称 / 邮箱…" value={q} onChange={e => setQ(e.target.value)} />
              <span className="dsh-tool-stat">{usersFiltered ? usersFiltered.length : '—'} / {users ? users.length : '—'} 个用户</span>
              <span style={{ flex: 1 }} />
              <button className="dsh-btn dsh-btn-primary dsh-btn-sm" onClick={openNewInvite}>＋ 创建邀请码</button>
            </div>
            <UsersTable users={usersFiltered} onChanged={loadUsers} openUser={openUser} confirm={confirm} />
          </>}

          {/* ---- 邀请码管理 ---- */}
          {view === 'invites' && <>
            <div className="dsh-tools">
              <span className="dsh-tool-stat">{openInvites.length} 个可用 · 共 {totalUsed} 人受邀注册</span>
              <span style={{ flex: 1 }} />
              <button className="dsh-btn dsh-btn-primary dsh-btn-sm" onClick={openNewInvite}>＋ 创建邀请码</button>
            </div>
            <InvitesCard invites={invites} reload={loadInvites} confirm={confirm} openNew={openNewInvite} />
          </>}
        </div>
      </main>

      {/* ---------- 居中弹窗（替代移动端底部抽屉） ---------- */}
      {modal?.kind === 'user' && <UserDetail id={modal.id} onChanged={loadUsers} confirm={confirm} close={closeModal} />}
      {modal?.kind === 'invite' && <NewInvite reload={loadInvites} close={closeModal} />}
      {modal?.kind === 'confirm' && <ConfirmDialog {...modal} close={closeModal} />}
    </div>
  )
}
