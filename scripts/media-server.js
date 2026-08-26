// Dev media server — serves the exercise images/GIFs that the Vite dev proxy
// forwards /img and /gif to (see frontend/vite.config.js, MEDIA_TARGET default
// http://127.0.0.1:8888). Zero dependencies.
//
// Usage:  node scripts/media-server.js [port]
// Media root is resolved relative to this file: <repo>/media/{img,gif}
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'

const PORT = Number(process.argv[2] || process.env.MEDIA_PORT || 8888)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'media')

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const p = decodeURIComponent(url.pathname)           // e.g. /img/0001-x.jpg
    const m = p.match(/^\/(img|gif)\/([^/]+)$/)
    if (!m) { res.writeHead(404); res.end('not found'); return }
    const sub = m[1], file = m[2]
    // Guard against path traversal — only allow a plain filename.
    if (file.includes('..') || file.includes('\\') || file.includes('/')) {
      res.writeHead(400); res.end('bad request'); return
    }
    const abs = normalize(join(ROOT, sub, file))
    if (!abs.startsWith(normalize(join(ROOT, sub)) + '\\') && !abs.startsWith(normalize(join(ROOT, sub)) + '/')) {
      res.writeHead(400); res.end('bad request'); return
    }
    const data = await readFile(abs)
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=2592000, immutable'
    })
    res.end(data)
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); res.end('not found'); return }
    res.writeHead(500); res.end('server error')
  }
})

server.listen(PORT, () => console.log(`[media] serving ${ROOT} on :${PORT}`))
