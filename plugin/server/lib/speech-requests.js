// task-133：pet → plugin 台词请求队列（文件上行通道）纯逻辑
// pet 侧追加写 `speech-requests.json`（原子：tmp+rename），插件轮询取新请求 → LLM → say:<text> 推回。
// 契约：数组 [{id, kind, context?, at?}]；id 由 pet 生成唯一串；context 只允许枚举/数值/布尔（禁用户文本）。
export const SPEECH_KIND_MAP = Object.freeze({
  click: 'clickLine',
  doubleClick: 'doubleClickLine',
  praise: 'praise',
  pat: 'interactHead',
  head: 'interactHead',
  feed: 'interactFeed',
  come: 'interactCome',
  sneakCaught: 'sneakLine',
  stealCaught: 'sneakLine',
  report: 'report',
  approvalWait: 'approval',
  waitingInput: 'waitingInput',
  greet: 'morning',
  morning: 'morning',
  sleep: 'sleep',
  inner: 'inner',
  selfTalk: 'selfTalk',
  celebrate: 'turnEnd'
})

export const CONTEXT_KEYS = Object.freeze([
  'phase',
  'subkind',
  'toolType',
  'mood',
  'energy',
  'relation',
  'mode',
  'count',
  'hourBucket',
  'night',
  's0'
])

const SAFE_STRING_RE = /^[a-z0-9._:-]{1,24}$/i
const MAX_CONTEXT_KEYS = 12

/** context 只保留白名单键 + 枚举/数值/布尔；其它（含用户文本/路径）丢弃。 */
export const sanitizeContext = (ctx) => {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return {}
  const out = {}
  let n = 0
  for (const [k, v] of Object.entries(ctx)) {
    if (n >= MAX_CONTEXT_KEYS) break
    if (!CONTEXT_KEYS.includes(k)) continue
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) {
      out[k] = v
      n += 1
    } else if (typeof v === 'boolean') {
      out[k] = v
      n += 1
    } else if (typeof v === 'string' && SAFE_STRING_RE.test(v)) {
      out[k] = v
      n += 1
    }
  }
  return out
}

/** 解析队列文件（容错）：只接受数组；超过 maxItems 截取最新的；非法条目丢弃。 */
export const parseSpeechRequests = (raw, { maxItems = 50 } = {}) => {
  let arr = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      return { requests: [], invalid: true }
    }
  }
  if (!Array.isArray(arr)) return { requests: [], invalid: true }
  const requests = []
  for (const item of arr.slice(-maxItems)) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id || '').trim()
    const kind = String(item.kind || '').trim()
    if (!id || !kind || id.length > 80 || kind.length > 40) continue
    requests.push({
      id,
      kind,
      context: sanitizeContext(item.context),
      at: typeof item.at === 'string' ? item.at.slice(0, 40) : null
    })
  }
  return { requests, invalid: false }
}

/** 与已处理 id 集去重；返回新请求 + 待记录 id。 */
export const selectNewRequests = (requests, processedSet, { maxPerTick = 4 } = {}) => {
  const fresh = []
  const ids = []
  for (const r of requests) {
    if (processedSet.has(r.id)) continue
    fresh.push(r)
    ids.push(r.id)
    if (fresh.length >= maxPerTick) break
  }
  return { fresh, ids }
}

/** pet kind → 插件 LLM kind（未知 → null，由调用方记录 skip）。 */
export const kindToLlmKind = (kind) => SPEECH_KIND_MAP[String(kind || '')] || null

/** 生成本次 LLM 需要的短上下文文本（只有安全枚举/数值）。 */
export const contextPrompt = (context) => {
  const safe = sanitizeContext(context)
  const keys = Object.keys(safe).sort((a, b) => CONTEXT_KEYS.indexOf(a) - CONTEXT_KEYS.indexOf(b))
  if (!keys.length) return ''
  return keys.map((k) => `${k}=${String(safe[k])}`).join(' ')
}

export const buildSayLine = (text) =>
  'say:' +
  String(text || '')
    .replace(/\r?\n/g, ' ')
    .trim()
