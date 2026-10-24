/**
 * test-only 同源聊天 mock（B2 联调/单测用；不写盘、不调真 LLM、不装 profile）。
 *
 * 用法（手动联调）：
 *   node test/serve-chat-harness.mjs --port 3942 [--enabled] [--send-error BUDGET_EXCEEDED|LLM_FAILED]
 *   然后打开 http://127.0.0.1:3942/pet-bridge-ui/chat
 *
 * 契约：docs/CHAT-CONTRACT.md v1.1（RPC `POST /pet-bridge-ui/chat/rpc`）。
 * 边界：状态全部在内存（退出即清）；`writes` 恒为 0（任何写入都不落盘）。
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled] 初始 enabled（默认 false）
 * @param {Array} [opts.history] 初始历史（role user|her）
 * @param {Array} [opts.memories] 初始记忆
 * @param {string|null} [opts.sendError] chat.send 注入错误码
 * @param {number} [opts.port] 监听端口（0 = 随机）
 */
export async function createMockChatServer(opts = {}) {
  const { renderChatHtml } = await import(pathToFileURL(path.join(libDir, 'chat-page.js')).href)
  const html = renderChatHtml()
  let seq = 0
  const state = {
    enabled: opts.enabled === true,
    consent: opts.enabled === true ? { version: 'v1', at: '2026-01-01T00:00:00.000Z' } : null,
    quietMode: false,
    frequencyPerDay: 4,
    memoryEnabled: true,
    historyRetentionDays: 90,
    history: Array.isArray(opts.history) ? opts.history.slice() : [],
    memories: Array.isArray(opts.memories) ? opts.memories.slice() : [],
    sendError: opts.sendError || null,
    writes: 0,
    calls: []
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
            memoryCount: state.memories.length,
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
        const items = state.memories.slice(offset, offset + limit).map(normalizeMemory)
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
        return json(res, 200, {
          rpcId,
          ok: true,
          result: {
            enabled: state.enabled,
            consent: state.consent,
            quietMode: state.quietMode,
            frequencyPerDay: state.frequencyPerDay,
            memoryEnabled: state.memoryEnabled,
            historyRetentionDays: state.historyRetentionDays
          }
        })
      case 'chat.settings.set': {
        if (payload.enabled === true && !(payload.consent && payload.consent.version)) {
          return rpcError(res, rpcId, 'INVALID_INPUT', 'consent required')
        }
        if (payload.enabled === true) {
          state.enabled = true
          state.consent = { version: payload.consent.version, at: payload.consent.at || new Date().toISOString() }
        }
        if (payload.enabled === false) state.enabled = false
        if (typeof payload.quietMode === 'boolean') state.quietMode = payload.quietMode
        if (payload.frequencyPerDay != null)
          state.frequencyPerDay = Number(payload.frequencyPerDay) || state.frequencyPerDay
        if (typeof payload.memoryEnabled === 'boolean') state.memoryEnabled = payload.memoryEnabled
        return json(res, 200, { rpcId, ok: true, result: { ok: true } })
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
  const h = await createMockChatServer({ enabled, sendError, port })
  const { url } = await h.listen()
  console.log('[chat-harness] ' + url + '/pet-bridge-ui/chat (enabled=' + enabled + ', sendError=' + sendError + ')')
  process.on('SIGINT', async () => {
    await h.close()
    process.exit(0)
  })
}
