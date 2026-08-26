import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import './index.css'

// HashRouter 入口兼容：直接输入 /admin（不带 #）时，
// 自动改写为 /#/admin。否则裸路径会被当作根路径 "/"，
// 命中通配路由重定向到 /#/home（显示主项目），进不了后台登录页。
if (typeof window !== 'undefined') {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/admin' && !window.location.hash) {
    window.location.replace('/#/admin')
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
