/**
 * dsh-pet-bridge-ui — Host 侧 HTTP 路由挂载（官方 /api wire 协议同构）
 *
 * 为什么不用 `ctx.connection.rpc.handle`：
 *   DSH 0.2.x 的 client-connection 自身 inject 收缩为 ['credentials']，其 rpc.handle
 *   内部访问 `owner.webServer` 会抛 "cannot get property \"webServer\" without inject"。
 *   插件侧 `ctx.inject(['connection','webServer'], …)` 的作用域闭包救不了它（抛错的是
 *   connection 自己的 ctx）。故采用「插件自己 inject webServer + register 一条 prefix
 *   路由」的路径，与已装第三方插件 dsh-subagent-model-config 的实测结论一致。
 *
 * wire 协议（与官方 rpcFetchHandler 对齐）：
 *   请求   POST `<channel>/<endpoint>`   content-type: application/json
 *          body `{ rpcId: string, method: string, payload?: any }`
 *   响应   200 `{ type: 'server-response', rpcId, result }`
 *   异常   404 非 POST 或无 endpoint ／ 415 content-type 不对 ／ 400 body 非 JSON
 *          413 body 超限 ／ 500 handler 抛错
 *
 * 鉴权：优先 `connection.requestRejection(req)`（**必须以方法形式调用**，它内部读
 *   `this.trustedHosts` / `this.browserAuth`；抽成裸函数会丢 this → TypeError → 403）；
 *   旧版 / 无该方法时退化为「仅放行 loopback 同源」的本地栅栏。
 *
 * 返回：webServer.register 的返回值有三态（disposer / Promise<disposer> / undefined），
 *   统一规整成幂等清理函数，交给 ctx.effect 管理生命周期。
 */
import { Buffer } from 'node:buffer'

/** endpoint 段允许字符（与 dsh-client-connection 的 ENDPOINT_SEGMENT_PATTERN 对齐）。 */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/
/** 信封非法时的兜底 rpcId（与 dsh 内部的 INVALID_REQUEST_RPC_ID 对齐）。 */
const INVALID_REQUEST_RPC_ID = 'invalid-request'
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024

/** 从 `<channel>/<endpoint>` 提取 endpoint；路径或段非法返回 undefined。 */
export function endpointFromPath(channel, pathname) {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (
    endpoint.split('/').some(
      (seg) => seg === '' || seg === '.' || seg === '..' || !ENDPOINT_SEGMENT_PATTERN.test(seg),
    )
  ) {
    return undefined
  }
  return endpoint
}

/** 构造 server-response JSON（字段与官方 fullResponse 对齐）。 */
export function serverResponseJson(rpcId, result) {
  return JSON.stringify({ type: 'server-response', rpcId, result })
}

/** 无 connection.requestRejection 时的最小信任栅栏：只放行 loopback 同源请求。 */
function isTrustedLoopbackRequest(req) {
  const host = req.headers?.host
  if (host === undefined) return false
  const hostName = host.split(':')[0]
  if (!LOOPBACK_HOSTNAMES.has(hostName)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readBody(req, maxBytes) {
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > maxBytes) return null
  const chunks = []
  let received = 0
  for await (const chunk of req) {
    received += chunk.length
    if (received > maxBytes) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

/**
 * 把一条 prefix 路由挂到插件注入的 webServer 上。
 * @param {object} options
 * @param {object} options.webServer 已就绪的 webServer 服务（必须带 register）
 * @param {object} [options.connection] 已就绪的 connection 服务（用于官方鉴权栅栏）
 * @param {string} options.channel 通道前缀，如 `/pet-bridge-ui`
 * @param {(endpoint: string, payload: any, signal?: AbortSignal) => any} options.handler 业务 handler
 * @param {object} [options.log] 日志器（至少 info/warn）
 * @param {number} [options.maxBodyBytes] 请求体上限
 * @returns {(() => void) | null} 幂等清理函数；webServer 不可用时返回 null
 */
export function mountWebRoute({
  webServer,
  connection,
  channel,
  handler,
  log = console,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
}) {
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
    return null
  }

  const route = {
    kind: 'prefix',
    path: channel,
    handler: async (req, res) => {
      // ① 鉴权栅栏（以方法形式调用，避免丢 this）
      let rejection
      if (typeof connection?.requestRejection === 'function') {
        try {
          rejection = connection.requestRejection(req)
        } catch {
          rejection = 403
        }
      } else if (!isTrustedLoopbackRequest(req)) {
        rejection = 403
      }
      if (rejection !== undefined) {
        sendText(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }

      // ② 方法与路径
      if (req.method !== 'POST') {
        sendText(res, 405, 'method not allowed')
        return
      }
      const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`).pathname
      const endpoint = endpointFromPath(channel, pathname)
      if (endpoint === undefined) {
        sendText(res, 404, 'not found')
        return
      }

      // ③ content-type / 请求体
      const contentType = String(req.headers['content-type'] ?? '')
      if (!contentType.toLowerCase().includes('application/json')) {
        sendText(res, 415, 'unsupported media type')
        return
      }
      let raw
      try {
        raw = await readBody(req, maxBodyBytes)
      } catch (error) {
        log?.warn?.(`[pet-bridge-ui] 读取请求体失败: ${error?.message ?? error}`)
        sendText(res, 400, 'body read failed')
        return
      }
      if (raw === null) {
        sendText(res, 413, 'payload too large')
        return
      }

      // ④ 信封校验
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        sendText(res, 400, 'body is not JSON')
        return
      }
      const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : INVALID_REQUEST_RPC_ID
      const method = typeof body?.method === 'string' ? body.method : null
      if (rpcId === INVALID_REQUEST_RPC_ID || method === null) {
        sendJson(res, 200, serverResponseJson(INVALID_REQUEST_RPC_ID, {
          ok: false,
          error: { code: 'bad-request', message: 'invalid client-request message' },
        }))
        return
      }
      if (method !== endpoint) {
        sendJson(res, 200, serverResponseJson(rpcId, {
          ok: false,
          error: {
            code: 'bad-request',
            message: `method ${JSON.stringify(method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          },
        }))
        return
      }

      // ⑤ 业务（桌面 Electron 转发下 req.signal 可能进入即 aborted，只当尽力而为的取消合作）
      const handlerSignal = req.signal?.aborted === true ? undefined : req.signal
      try {
        const result = await handler(endpoint, body.payload, handlerSignal)
        sendJson(res, 200, serverResponseJson(rpcId, result))
      } catch (error) {
        log?.warn?.(`[pet-bridge-ui] rpc ${endpoint} 失败: ${error?.stack ?? error}`)
        sendText(res, 500, `handler failure: ${String(error)}`)
      }
    },
  }

  const registered = webServer.register(route)
  if (typeof registered === 'function') {
    return () => {
      try {
        registered()
      } catch {
        /* 已清理 */
      }
    }
  }
  if (registered !== null && typeof registered?.then === 'function') {
    return async () => {
      try {
        const disposer = await registered
        if (typeof disposer === 'function') disposer()
      } catch {
        /* 已清理 */
      }
    }
  }
  return () => {}
}
