/**
 * test-only 同源聊天 mock（B2/B3 联调/单测用；不写盘、不调真 LLM、不装 profile）。
 *
 * 用法（手动联调）：
 *   node test/serve-chat-harness.mjs --port 3942 [--enabled] [--send-error BUDGET_EXCEEDED|LLM_FAILED]
 *   然后打开 http://127.0.0.1:3942/pet-bridge-ui/chat
 *
 * 契约：docs/CHAT-CONTRACT.md v1.2（RPC `POST /pet-bridge-ui/chat/rpc`）。
 * 边界：状态全部在内存（退出即清）；`writes` 恒为 0（任何写入都不落盘）。
 * B3：chat.settings.get|set（首次 enabled=true 必须 consent {version:'v1',at:ISO}）、
 *     memory.list 过滤 sensitivity=high（契约：high 不返回 UI）。
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PORTRAIT_ROUTE_SUFFIX, readPortrait } from '../lib/portrait.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')
const CONSENT_VERSION = 'v1'
const SETTINGS_KEYS = ['enabled', 'quietMode', 'frequencyPerDay', 'memoryEnabled', 'consent']
const isIsoDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled] 初始 enabled（默认 false）
 * @param {Array} [opts.history] 初始历史（role user|her）
 * @param {Array} [opts.memories] 初始记忆（可含 sensitivity:'high'，list 时过滤）
 * @param {boolean} [opts.quietMode] 初始静音
 * @param {string|null} [opts.sendError] chat.send 注入错误码
 * @param {number} [opts.port] 监听端口（0 = 随机）
 * @param {boolean} [opts.portrait] 是否提供本地镜像头像路由（默认 true；false = 模拟未装资产 → 404 降级）
 */
export async function createMockChatServer(opts = {}) {
  const { renderChatHtml } = await import(pathToFileURL(path.join(libDir, 'chat-page.js')).href)
  const html = renderChatHtml()
  let seq = 0
  const state = {
    enabled: opts.enabled === true,
    consent: opts.enabled === true ? { version: CONSENT_VERSION, at: '2026-01-01T00:00:00.000Z' } : null,
    quietMode: opts.quietMode === true,
    frequencyPerDay: 4,
    memoryEnabled: true,
    historyRetentionDays: 90,
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: Array.isArray(opts.history) ? opts.history.slice() : [],
    memories: Array.isArray(opts.memories) ? opts.memories.slice() : [],
    sendError: opts.sendError || null,
    writes: 0,
    calls: []
  }
  function visibleMemories() {
    // 契约：sensitivity=high 不落 memory 原文、不返回 UI、不可查/导出
    return state.memories.filter((m) => m.sensitivity !== 'high')
  }
  function snapshotSettings() {
    return {
      enabled: state.enabled,
      consent: state.consent,
      quietMode: state.quietMode,
      frequencyPerDay: state.frequencyPerDay,
      memoryEnabled: state.memoryEnabled,
      historyRetentionDays: state.historyRetentionDays,
      updatedAt: state.updatedAt
    }
  }
  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  function rpcError(res, rpcId, code, message, retryable = false) {
    json(res, 200, { rpcId, ok: false, error: { code, message: message || code, retryable } })
  }
  function normalizeMemory(m) {
    return {
      id: m.id,
      at: m.at || '2026-01-01T00:00:00.000Z',
      kind: m.kind || 'event',
      text: m.text,
      importance: m.importance || 3,
      source: m.source || 'event'
    }
  }
  async function handleRpc(req, res) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      body = {}
    }
    const rpcId = body.rpcId || ''
    const method = String(body.method || '')
    const payload = body.payload || {}
    state.calls.push({ method, payload })
    if (!state.enabled && method !== 'chat.settings.get' && method !== 'chat.settings.set') {
      return rpcError(res, rpcId, 'CHAT_DISABLED', 'chat disabled')
    }
    switch (method) {
      case 'chat.state.get':
        return json(res, 200, {
          rpcId,
          ok: true,
          result: {
            enabled: state.enabled,
            quietMode: state.quietMode,
            frequencyPerDay: state.frequencyPerDay,
            memoryEnabled: state.memoryEnabled,
            stage: 'R1',
            stageLabel: '熟悉',
            memoryCount: visibleMemories().length,
            todayChats: 0,
            busy: false,
            lastAt: state.history.length ? state.history[state.history.length - 1].at : null
          }
        })
      case 'chat.history.get': {
        const limit = Math.max(1, Math.min(100, Number(payload.limit) || 100))
        const items = state.history.slice(-limit)
        return json(res, 200, { rpcId, ok: true, result: { items } })
      }
      case 'chat.send': {
        if (state.sendError) {
          const retryable = state.sendError === 'LLM_FAILED' || state.sendError === 'NETWORK'
          return rpcError(res, rpcId, state.sendError, 'mock error', retryable)
        }
        const text = String(payload.text || '')
        if (!text || text.length > 500) return rpcError(res, rpcId, 'TEXT_TOO_LONG', 'too long')
        const id = 'msg-' + (seq += 1)
        const at = new Date().toISOString()
        state.history.push({ id: 'u-' + id, at, role: 'user', text, kind: 'chat' })
        const reply = { text: '我在这儿呢，慢慢来。', parts: [] }
        state.history.push({ id, at, role: 'her', text: reply.text, kind: 'chat' })
        return json(res, 200, {
          rpcId,
          ok: true,
          result: {
            id,
            reply,
            act: null,
            fx: null,
            moodWord: '平静',
            latencyMs: 1,
            firstSentence: true,
            fallback: false
          }
        })
      }
      case 'chat.history.clear': {
        if (!payload.confirm) return rpcError(res, rpcId, 'INVALID_INPUT', 'confirm required')
        const cleared = state.history.length
        state.history = []
        return json(res, 200, { rpcId, ok: true, result: { ok: true, cleared } })
      }
      case 'memory.list': {
        const limit = Math.max(1, Math.min(50, Number(payload.limit) || 50))
        const offset = Math.max(0, Number(payload.offset) || 0)
        const items = visibleMemories()
          .slice(offset, offset + limit)
          .map(normalizeMemory)
        return json(res, 200, { rpcId, ok: true, result: { items } })
      }
      case 'memory.delete': {
        const before = state.memories.length
        state.memories = state.memories.filter((m) => m.id !== payload.id)
        return json(res, 200, { rpcId, ok: true, result: { ok: true, deleted: before - state.memories.length } })
      }
      case 'memory.forget': {
        const q = String(payload.query || '')
        const before = state.memories.length
        state.memories = state.memories.filter((m) => !(q && String(m.text || '').includes(q)))
        return json(res, 200, { rpcId, ok: true, result: { ok: true, deleted: before - state.memories.length } })
      }
      case 'memory.clear': {
        if (!payload.confirm) return rpcError(res, rpcId, 'INVALID_INPUT', 'confirm required')
        const cleared = state.memories.length
        state.memories = []
        return json(res, 200, { rpcId, ok: true, result: { ok: true, cleared } })
      }
      case 'chat.settings.get':
        return json(res, 200, { rpcId, ok: true, result: snapshotSettings() })
      case 'chat.settings.set': {
        const unknown = Object.keys(payload).filter((k) => !SETTINGS_KEYS.includes(k))
        if (unknown.length) return rpcError(res, rpcId, 'INVALID_INPUT', 'unknown field: ' + unknown.join(','))
        if (payload.enabled === true && !state.consent) {
          const c = payload.consent
          if (!c || c.version !== CONSENT_VERSION || !isIsoDate(c.at)) {
            return rpcError(res, rpcId, 'INVALID_INPUT', 'consent {version:"v1",at:ISO} required')
          }
        }
        let freq = state.frequencyPerDay
        if (payload.frequencyPerDay != null) {
          freq = Number(payload.frequencyPerDay)
          // 30 §4.4：主动开口 ≤4 次/天（UI 只提供 1/2/4）
          if (!Number.isFinite(freq) || freq < 1 || freq > 4)
            return rpcError(res, rpcId, 'INVALID_INPUT', 'frequencyPerDay')
        }
        if (payload.enabled === true) {
          if (!state.consent) state.consent = { version: CONSENT_VERSION, at: payload.consent.at }
          state.enabled = true
        }
        if (payload.enabled === false) state.enabled = false
        if (typeof payload.quietMode === 'boolean') state.quietMode = payload.quietMode
        if (payload.frequencyPerDay != null) state.frequencyPerDay = freq
        if (typeof payload.memoryEnabled === 'boolean') state.memoryEnabled = payload.memoryEnabled
        state.updatedAt = new Date().toISOString()
        return json(res, 200, { rpcId, ok: true, result: { ok: true, settings: snapshotSettings() } })
      }
      default:
        return rpcError(res, rpcId, 'INVALID_INPUT', 'unknown method')
    }
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/pet-bridge-ui/chat') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
      return
    }
    // task-107 B4：头像本地镜像（opts.portrait=false 模拟未装资产 → 404，页面 onerror 降级 29 色板）
    if (req.method === 'GET' && url.pathname === '/pet-bridge-ui' + PORTRAIT_ROUTE_SUFFIX) {
      const data = opts.portrait === false ? null : readPortrait()
      if (!data) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end('portrait not found')
        return
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': data.length,
        'cache-control': 'no-store'
      })
      res.end(data)
      return
    }
    if (req.method === 'POST' && url.pathname === '/pet-bridge-ui/chat/rpc') {
      try {
        await handleRpc(req, res)
      } catch (err) {
        if (!res.headersSent) json(res, 500, { ok: false, error: { code: 'MEMORY_IO', message: 'mock failure' } })
      }
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })
  const listen = () =>
    new Promise((resolve) => {
      server.listen(opts.port || 0, '127.0.0.1', () => {
        const addr = server.address()
        resolve({ port: addr.port, url: 'http://127.0.0.1:' + addr.port })
      })
    })
  const close = () =>
    new Promise((resolve) => {
      server.close(() => resolve())
    })
  return { server, state, listen, close }
}

// 直接运行时启动（手动联调）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf('--' + name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const port = Number(opt('port') || process.env.MOCK_PORT || 3942)
  const enabled = args.includes('--enabled') || process.env.MOCK_ENABLED === '1'
  const sendError = opt('send-error') || process.env.MOCK_SEND_ERROR || null
  const portrait = !args.includes('--no-portrait') && process.env.MOCK_NO_PORTRAIT !== '1'
  const h = await createMockChatServer({ enabled, sendError, portrait, port })
  const { url } = await h.listen()
  console.log(
    '[chat-harness] ' +
      url +
      '/pet-bridge-ui/chat (enabled=' +
      enabled +
      ', sendError=' +
      sendError +
      ', portrait=' +
      portrait +
      ')'
  )
  process.on('SIGINT', async () => {
    await h.close()
    process.exit(0)
  })
}
