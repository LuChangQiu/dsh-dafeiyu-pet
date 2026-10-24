/**
 * test/serve-home-harness.mjs — 大肥鱼主页本地预览/截图服务（仅测试用）
 *
 * 用途：真实 DSH 页面的 `/pet-bridge-ui/home` 需要浏览器 cookie（无 cookie 401），
 * 该脚本在本机 127.0.0.1 起一个临时 http 服务模拟同源宿主：
 *   GET  /pet-bridge-ui/home        → renderHomeHtml()（与生产同一份 HTML）
 *   POST /pet-bridge-ui/state.get   → 真实 handler（只读 state/status/sessions/events/companion）
 *   POST /pet-bridge-ui/pet.action / interaction / events.ack → mock（不触达生产 sidecar）
 *
 * 用法：node test/serve-home-harness.mjs [port]
 * 然后浏览器打开 http://127.0.0.1:<port>/pet-bridge-ui/home
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')
const index = await import(pathToFileURL(path.join(libDir, 'index.js')).href)
const { buildHandler, DEFAULTS, renderHomeHtml } = index.__test

const port = Number(process.argv[2]) || 3909
/**
 * 可选：模拟生产 host fallback 状态（harness 本身无 DSH ctx，默认 teamFeatures=unsupported）。
 * HARNESS_HOST_STATUS=empty|ok|degraded|unsupported（可配 HARNESS_HOST_REASON）。
 */
let hostBridge = null
if (process.env.HARNESS_HOST_STATUS) {
  const status = String(process.env.HARNESS_HOST_STATUS)
  const reason = process.env.HARNESS_HOST_REASON || (status === 'empty' ? 'no-session' : null)
  hostBridge = {
    teamInfo: async () => ({ status, reason })
  }
}
const handler = buildHandler({ ...DEFAULTS }, { info() {}, warn() {} }, hostBridge)
const homeHtml = renderHomeHtml()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/pet-bridge-ui/home') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(homeHtml)
    return
  }
  if (req.method === 'POST' && url.pathname.startsWith('/pet-bridge-ui/')) {
    const endpoint = url.pathname.slice('/pet-bridge-ui/'.length)
    let payload = null
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      payload = {}
    }
    let result
    try {
      if (endpoint === 'state.get') {
        result = await handler('state.get')
        // 可选：注入合成 teamFeatures（截图/降级演练）；HARNESS_TEAM 为 JSON
        if (result?.ok && process.env.HARNESS_TEAM) {
          try {
            result = { ok: true, data: { ...result.data, teamFeatures: JSON.parse(process.env.HARNESS_TEAM) } }
          } catch {
            /* ignore bad env */
          }
        }
        // 可选：注入合成控制模式（截图 task-67）；HARNESS_MODE 为 JSON：{mode,modeSettings,modeCaps}
        if (result?.ok && process.env.HARNESS_MODE) {
          try {
            const injected = JSON.parse(process.env.HARNESS_MODE)
            const data = { ...result.data }
            if (injected.mode) data.mode = injected.mode
            if (injected.modeSettings) data.modeSettings = injected.modeSettings
            if (injected.modeCaps) data.capabilities = { ...(data.capabilities || {}), mode: injected.modeCaps }
            result = { ok: true, data }
          } catch {
            /* ignore bad env */
          }
        }
      } else if (['pet.action', 'interaction', 'events.ack', 'mode.request'].includes(endpoint)) {
        // mock：不写生产 ui-action / 不驱动真实桌宠（截图/联调用）
        result = { ok: true, data: { queued: true, mock: true, note: 'harness mock: 未触达生产' } }
      } else {
        result = { ok: false, error: { code: 'not-found', message: 'harness 未实现：' + endpoint } }
      }
    } catch (error) {
      result = { ok: false, error: { code: 'harness-error', message: String(error && error.message) } }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ type: 'server-response', rpcId: payload?.rpcId || 'harness', result }))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log('home harness listening: http://127.0.0.1:' + port + '/pet-bridge-ui/home')
  console.log(
    'state file source:',
    fs.existsSync(DEFAULTS.stateV2File) ? 'bridge-state-v2.json' : 'state.json (fallback)'
  )
})
