/**
 * dsh-pet-bridge-ui — Host 半边
 *
 * 职责：给「大肥鱼 × DSH 联动」做一个只读为主的状态聚合 + 最小写入的 HTTP 通道，
 * 供 Web 设置面板（lib/client.js）调用。**不订阅 DSH 会话事件、不改 pet-bridge 逻辑**。
 *
 * 数据来源（按优先级）：
 *   1. 桌宠联动插件（tech-scout 的 dsh-pet-bridge-v7）可选产出的 state.json 快照；
 *   2. pet-bridge-main.log 尾部：`say {...}` 行 → 最近 say + 今日 calls/cost；
 *      `loaded v7 {...}` 行 → 生效中的 activity/quietHours/budget/model；
 *   3. activity.txt → 当前活跃度（插件每 20s 轮询，写它即热切）；
 *   4. 命名管道 connect 探测 + tasklist（pythonw.exe）→ 桌宠/管道在线；
 *   5. ui-config.json → 面板保存的期望配置（sidecar；由 pet-bridge 插件 watcher 应用）。
 *
 * 端点（POST `<channel>/<endpoint>`，官方 /api wire 协议同构，见 lib/web-route.js）：
 *   ping / state.get / config.set / test.say / test.jump / test.screenshot
 *
 * 生产安全：不重启 host；不覆盖无关文件；不写 key/对话原文；日志只记行为不记内容；
 * 所有写入都是 pet-work 下的 sidecar 文件（ui-config.json / activity.txt）或截图 PNG。
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mountWebRoute } from './web-route.js'

const runFile = promisify(execFile)
const STARTED_AT = Date.now()
const PLUGIN_VERSION = '0.2.0'

export const name = 'dsh-pet-bridge-ui'

const PET_ROOT = 'E:\\project\\AI提效\\tool\\pet-integration-src\\pet-work'

/** task-36：快捷查看按钮 → 桌宠协议命令（余额待桌宠补丁支持）。 */
const PET_ACTION_CMDS = {
  balance: 'cmd:balance',
  weather: 'cmd:weather',
  music: 'cmd:music',
  summary: 'cmd:summary',
  show: 'cmd:show',
  hide: 'cmd:hide',
  snapInto: 'cmd:snap_into_screen',
  recover: 'cmd:recover',
  quietStart: 'cmd:quiet', // 需要分钟数：实际下发 cmd:quiet:<minutes>
  quietEnd: 'cmd:quiet:off',
  quit: 'cmd:quit' // 待桌宠补丁支持
}

/** 协议就绪度（false = 面板显示「待服务端」禁用；可由插件 config.petActionReadiness 覆盖）。 */
const DEFAULT_PET_ACTION_READINESS = {
  balance: false,
  weather: true,
  music: true,
  summary: true,
  show: true,
  hide: true,
  snapInto: true,
  recover: true,
  quietStart: true,
  quietEnd: true,
  quit: false,
  doubleClick: false,
  autoStart: false
}

const DEFAULTS = {
  channel: '/pet-bridge-ui',
  pipe: '\\\\.\\pipe\\dafeiyu-pet-whale-single-instance',
  logFile: path.join(PET_ROOT, 'evidence', 'pet-bridge-main.log'),
  activityFile: path.join(PET_ROOT, 'activity.txt'),
  stateFile: path.join(PET_ROOT, 'state.json'),
  uiConfigFile: path.join(PET_ROOT, 'ui-config.json'),
  petConfigFile: path.join(PET_ROOT, 'pet', 'config.json'),
  actionFile: path.join(PET_ROOT, 'ui-action.json'),
  evidenceDir: path.join(PET_ROOT, 'evidence'),
  heartbeatFile: path.join(PET_ROOT, 'evidence', 'ui-route-mounted.json'),
  defaultBudgetPerDayYuan: 1.0,
  defaultModel: 'deepseek-flash',
  defaultProvider: 'deepseek-official',
  recentSayLimit: 10,
  logPreviewLines: 80,
  logTailBytes: 262144,
  processProbeTtlMs: 15000,
  stateFileTtlMs: 60000,
  pipeProbeTimeoutMs: 700,
  /** task-44：状态通道心跳超时阈值（ms），超过即面板显示「失联」。 */
  runtimeStaleMs: 30000,
  /** 快捷动作协议就绪度（可由 patch config 覆盖；balance 等 tech-scout 加 cmd:balance 后设 true）。 */
  petActionReadiness: DEFAULT_PET_ACTION_READINESS,
  /** 「恢复默认配置」时写回的桌宠设置默认值（来源：task-32 映射表 §D；size 按 v15 用户偏好 0.36）。 */
  petDefaults: {
    size: 0.36,
    opacity: 1.0,
    mode: 'wander',
    lineFreq: '正常',
    passthrough: false,
    locked: false,
    topmost: true,
    snap: true,
    layer: 'top',
    bubbleStyle: 'auto',
    skin: '大肥鱼',
    soundOn: true,
    volume: 0.9,
    musicLink: true,
    city: '汕头',
    quietMinutes: 30,
    bubbleMs: 5000,
    doubleClick: 'balance',
    autoStart: false
  }
}

const ACTIVITY_LEVELS = ['quiet', 'normal', 'lively']
const QUIET_RANGE_RE = /^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$/
const MODE_LEVELS = ['wander', 'follow', 'still']
const LINE_FREQ_LEVELS = ['安静', '正常', '话多', '话痨']
const LAYER_LEVELS = ['top', 'bottom', 'normal']
const BUBBLE_STYLE_LEVELS = ['auto', 'light', 'dark']
const DOUBLE_CLICK_LEVELS = ['balance', 'weather', 'music', 'lines']

/**
 * task-44 状态通道：DSH 运行状态枚举（tech-scout `state:<json>` 协议）。
 * @type {Record<string, { label: string, tone: 'ok'|'busy'|'warn'|'err'|'dim' }>}
 */
const RUNTIME_STATE_META = {
  idle: { label: '空闲', tone: 'dim' },
  thinking: { label: '思考中', tone: 'busy' },
  tool: { label: '调工具', tone: 'busy' },
  waiting_approval: { label: '等确认', tone: 'warn' },
  waiting_input: { label: '等输入', tone: 'warn' },
  background: { label: '后台运行', tone: 'dim' },
  error: { label: '出错', tone: 'err' },
  done: { label: '完成', tone: 'ok' },
  disconnected: { label: '失联', tone: 'err' }
}

/** 状态别名归一（协议前后兼容：approval→waiting_approval、tool-call→tool 等）。 */
const RUNTIME_STATE_ALIASES = {
  approval: 'waiting_approval',
  waiting: 'waiting_approval',
  waitingapproval: 'waiting_approval',
  toolcall: 'tool',
  tools: 'tool',
  running: 'background',
  busy: 'thinking',
  ok: 'done',
  complete: 'done',
  completed: 'done',
  fail: 'error',
  failed: 'error',
  offline: 'disconnected',
  lost: 'disconnected'
}
/** cmd:config 批量下发的 pet 字段白名单（task-32 映射表 §C + task-36 doubleClick）。 */
const PET_CONFIG_FIELDS = [
  'size',
  'opacity',
  'mode',
  'lineFreq',
  'bubbleStyle',
  'passthrough',
  'locked',
  'topmost',
  'snap',
  'layer',
  'skin',
  'soundOn',
  'volume',
  'musicLink',
  'city',
  'quietMinutes',
  'doubleClick'
]

// ────────────────────────────── 小工具 ──────────────────────────────

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function merge(base, patch) {
  const out = { ...base }
  if (!isObject(patch)) return out
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v) && isObject(base[k])) out[k] = merge(base[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写：先写 .tmp 再 rename，避免 watcher/读取方看到半截文件。 */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function readTail(file, maxBytes) {
  try {
    const st = fs.statSync(file)
    const size = Math.min(st.size, maxBytes)
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size)
      fs.readSync(fd, buf, 0, size, st.size - size)
      return buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

const pad2 = (n) => String(n).padStart(2, '0')
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const hhmm = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

function parseClock(s) {
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function parseQuietRanges(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? '').trim()
    if (!QUIET_RANGE_RE.test(s)) continue
    const [a, b] = s.split('-')
    out.push({ text: s, start: parseClock(a), end: parseClock(b) })
  }
  return out
}

function isInQuietHours(ranges, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes()
  return ranges.some(({ start, end }) => (start <= end ? cur >= start && cur < end : cur >= start || cur < end))
}

function clip(s, n) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n)
}

/**
 * task-44：把 `state.json` 里的状态通道快照归一成面板可直接渲染的运行时状态。
 *
 * 容错读取顺序：`status` → `runtime.status` → `runtime`（tech-scout 协议落地前后都能工作）；
 * 心跳取 `heartbeatAt` / `lastHeartbeatAt` / `lastEventAt` / `state.json.updatedAt`。
 * 超过 `staleMs`（默认 30s）无心跳 → `disconnected`（失联）。
 *
 * @param {object|null} stateFile 联动插件写出的 state.json
 * @param {{ now?: number, staleMs?: number }} [opts]
 * @returns {{
 *   supported: boolean, state: string, label: string, tone: 'ok'|'busy'|'warn'|'err'|'dim',
 *   tool: string|null, step: number|null, turn: number|null, since: string|null,
 *   elapsedMs: number|null, heartbeatAt: string|null, heartbeatAgeMs: number|null,
 *   staleAfterMs: number, disconnected: boolean, source: string|null, message: string|null,
 *   lastEventAt: string|null
 * }}
 */
export function normalizeRuntimeStatus(stateFile, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const staleMs = Number.isFinite(opts.staleMs) ? opts.staleMs : 30000
  const raw = isObject(stateFile?.status)
    ? stateFile.status
    : isObject(stateFile?.runtime)
      ? isObject(stateFile.runtime.status)
        ? stateFile.runtime.status
        : stateFile.runtime
      : null

  const firstString = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
  const asNumber = (value) => (Number.isFinite(value) ? value : null)

  const heartbeatAt = firstString(raw?.heartbeatAt, raw?.lastHeartbeatAt, raw?.lastEventAt, stateFile?.updatedAt)
  const heartbeatMs = heartbeatAt ? new Date(heartbeatAt).getTime() : NaN
  const heartbeatAgeMs = Number.isFinite(heartbeatMs) ? Math.max(0, now - heartbeatMs) : null
  const stale = heartbeatAgeMs === null || heartbeatAgeMs > staleMs

  let state = String(raw?.state ?? raw?.status ?? '')
    .trim()
    .toLowerCase()
  state = RUNTIME_STATE_ALIASES[state.replace(/[^a-z_]/g, '')] ?? state
  if (!RUNTIME_STATE_META[state]) state = stale ? 'disconnected' : 'idle'
  if (stale) state = 'disconnected'

  const since = firstString(raw?.since, raw?.startedAt)
  const sinceMs = since ? new Date(since).getTime() : NaN
  const elapsedMs = Number.isFinite(sinceMs) ? Math.max(0, now - sinceMs) : null
  const meta = RUNTIME_STATE_META[state] ?? RUNTIME_STATE_META.idle

  return {
    supported: raw !== null,
    state,
    label: meta.label,
    tone: meta.tone,
    tool: firstString(raw?.tool, raw?.toolName),
    step: asNumber(raw?.step),
    turn: asNumber(raw?.turn),
    since,
    elapsedMs,
    heartbeatAt,
    heartbeatAgeMs,
    staleAfterMs: staleMs,
    disconnected: state === 'disconnected',
    source: firstString(raw?.source),
    message: firstString(raw?.message, raw?.detail),
    lastEventAt: firstString(raw?.lastEventAt)
  }
}

// ────────────────────────────── 日志解析 ──────────────────────────────

/**
 * 解析 log 尾部。
 * 行格式：`[ISO] [level] <msg> [JSON]`
 * 关心：`say {...}`（含 callsToday/costToday）、`loaded v7 {...}`（生效配置快照）。
 */
export function parseBridgeLog(tail, limit = 10) {
  const out = {
    recentSay: [],
    lastSayAt: null,
    lastLineAt: null,
    todayCalls: null,
    todayCost: null,
    loaded: null,
    logDay: null
  }
  if (!tail) return out

  const lines = tail.split(/\r?\n/)
  const todayKey = dateKey()
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    const m = line.match(/^\[([^\]]+)\]\s+\[(\w+)\]\s+(.*)$/)
    if (!m) continue
    const at = m[1]
    const level = m[2]
    const rest = m[3]

    const atDate = new Date(at)
    if (!Number.isNaN(atDate.getTime())) {
      if (out.lastLineAt === null) out.lastLineAt = at
      if (out.logDay === null) out.logDay = dateKey(atDate)
    }

    // say 行：`say {json}`
    if (/^say\s+\{/.test(rest)) {
      let obj = null
      const jsonStart = rest.indexOf('{')
      try {
        obj = JSON.parse(rest.slice(jsonStart))
      } catch {
        obj = null
      }
      if (obj) {
        const isToday = !Number.isNaN(atDate.getTime()) && dateKey(atDate) === todayKey
        out.recentSay.push({
          at,
          kind: String(obj.kind ?? ''),
          source: String(obj.source ?? ''),
          style: obj.style ? String(obj.style) : '',
          line: clip(obj.line, 120),
          callsToday: Number.isFinite(obj.callsToday) ? obj.callsToday : null,
          costToday: Number.isFinite(obj.costToday) ? obj.costToday : null
        })
        if (out.lastSayAt === null) out.lastSayAt = at
        if (isToday) {
          if (out.todayCalls === null && Number.isFinite(obj.callsToday)) out.todayCalls = obj.callsToday
          if (out.todayCost === null && Number.isFinite(obj.costToday)) out.todayCost = obj.costToday
        }
      }
      if (out.recentSay.length >= limit) {
        // 继续向前找 loaded / 计数（若还没拿到），这里只在两者都齐时提前结束
        if (out.loaded !== null && out.todayCalls !== null) break
      }
      continue
    }

    // loaded 行：`loaded v7 {json}` —— 取最近一次生效配置快照
    if (out.loaded === null && /^loaded\s+v\d+\s+\{/.test(rest)) {
      try {
        out.loaded = JSON.parse(rest.slice(rest.indexOf('{')))
      } catch {
        out.loaded = null
      }
    }

    if (out.loaded !== null && out.recentSay.length >= limit && out.todayCalls !== null) break
  }

  // 只保留最近 limit 条（由旧到新）
  out.recentSay = out.recentSay.slice(0, limit).reverse()
  return out
}

// ────────────────────────────── 桌宠设置（cmd 协议 / config 只读） ──────────────────────────────

/** 读桌宠原生 config.json（只读；用于显示当前持久化值）。 */
function readPetConfig(file) {
  const raw = readJson(file, null)
  if (!isObject(raw)) return null
  return {
    mode: MODE_LEVELS.includes(raw.mode) ? raw.mode : null,
    size: Number.isFinite(raw.size) ? raw.size : null,
    opacity: Number.isFinite(raw.opacity) ? raw.opacity : null,
    lineFreq: LINE_FREQ_LEVELS.includes(raw.line_freq) ? raw.line_freq : null,
    layer: LAYER_LEVELS.includes(raw.layer) ? raw.layer : null,
    bubbleStyle: BUBBLE_STYLE_LEVELS.includes(raw.bubble_style) ? raw.bubble_style : null,
    skin: typeof raw.skin === 'string' ? raw.skin : null,
    volume: Number.isFinite(raw.volume) ? raw.volume : null,
    quietMinutes: Number.isFinite(raw.quiet_minutes) ? raw.quiet_minutes : null,
    city: typeof raw.city === 'string' ? raw.city : null,
    musicLink: typeof raw.music_link === 'boolean' ? raw.music_link : null,
    soundOn: typeof raw.sound_on === 'boolean' ? raw.sound_on : null,
    passthrough: typeof raw.passthrough === 'boolean' ? raw.passthrough : null,
    locked: typeof raw.locked === 'boolean' ? raw.locked : null,
    topmost: typeof raw.topmost === 'boolean' ? raw.topmost : null,
    snap: typeof raw.snap_on === 'boolean' ? raw.snap_on : null,
    doubleClick: DOUBLE_CLICK_LEVELS.includes(raw.double_click) ? raw.double_click : null,
    autoStart: typeof raw.autostart === 'boolean' ? raw.autostart : null
  }
}

/** 读桌宠形象库（config.json → skin_library）：返回可用形象名列表（内置 + 库）。 */
function readSkinOptions(file) {
  const builtin = ['大肥鱼', '小鲸鱼挂件']
  const raw = readJson(file, null)
  const out = [...builtin]
  if (isObject(raw) && isObject(raw.skin_library)) {
    for (const kind of ['pet', 'widget']) {
      const list = Array.isArray(raw.skin_library[kind]) ? raw.skin_library[kind] : []
      for (const item of list) {
        const name = item && typeof item.name === 'string' ? item.name.trim() : ''
        if (name && !out.includes(name)) out.push(name)
      }
    }
  }
  return out
}

/**
 * 把桌宠设置翻译成协议 v2 的批量下发行（`cmd:config:<json>`，task-32 映射表 §C）。
 * 只带白名单字段；无有效字段时返回空数组。
 */
export function petSettingsToCmds(pet) {
  if (!isObject(pet)) return []
  const payload = {}
  for (const key of PET_CONFIG_FIELDS) {
    const value = pet[key]
    if (value === undefined || value === null) continue
    payload[key] = value
  }
  if (Object.keys(payload).length === 0) return []
  return ['cmd:config:' + JSON.stringify(payload)]
}

/** 校验并规范化 UI 提交的 pet 设置子集；返回 { value } 或 { error }。 */
export function normalizePetSettings(input, base = {}) {
  const out = { ...base }
  if (!isObject(input)) return { error: 'pet 必须是对象' }

  if (input.size !== undefined) {
    const n = Number(input.size)
    if (!Number.isFinite(n) || n < 0.18 || n > 1.0) return { error: '大小应在 0.18~1.0 倍率之间' }
    out.size = Math.round(n * 100) / 100
  }
  if (input.opacity !== undefined) {
    const n = Number(input.opacity)
    if (!Number.isFinite(n) || n < 0.2 || n > 1.0) return { error: '透明度应在 0.2~1.0 之间' }
    out.opacity = Math.round(n * 100) / 100
  }
  if (input.volume !== undefined) {
    const n = Number(input.volume)
    if (!Number.isFinite(n) || n < 0 || n > 1) return { error: '音量应在 0~1 之间' }
    out.volume = Math.round(n * 100) / 100
  }
  if (input.mode !== undefined) {
    if (!MODE_LEVELS.includes(input.mode)) return { error: `模式只能是 ${MODE_LEVELS.join(' / ')}` }
    out.mode = input.mode
  }
  if (input.lineFreq !== undefined) {
    if (!LINE_FREQ_LEVELS.includes(input.lineFreq)) return { error: `语录频率只能是 ${LINE_FREQ_LEVELS.join(' / ')}` }
    out.lineFreq = input.lineFreq
  }
  if (input.layer !== undefined) {
    if (!LAYER_LEVELS.includes(input.layer)) return { error: `层级只能是 ${LAYER_LEVELS.join(' / ')}` }
    out.layer = input.layer
  }
  if (input.bubbleStyle !== undefined) {
    if (!BUBBLE_STYLE_LEVELS.includes(input.bubbleStyle))
      return { error: `气泡风格只能是 ${BUBBLE_STYLE_LEVELS.join(' / ')}` }
    out.bubbleStyle = input.bubbleStyle
  }
  if (input.skin !== undefined) {
    const s = String(input.skin ?? '').trim()
    if (!s || s.length > 32) return { error: '皮肤名应为 1~32 个字符' }
    out.skin = s
  }
  if (input.quietMinutes !== undefined) {
    const n = Number(input.quietMinutes)
    if (!Number.isFinite(n) || n < 0 || n > 240) return { error: '静音时长应在 0~240 分钟之间' }
    out.quietMinutes = Math.round(n)
  }
  if (input.bubbleMs !== undefined) {
    const n = Number(input.bubbleMs)
    if (!Number.isFinite(n) || n < 1000 || n > 30000) return { error: '气泡停留时长应在 1000~30000ms 之间' }
    out.bubbleMs = Math.round(n)
  }
  if (input.city !== undefined) {
    const s = String(input.city ?? '').trim()
    if (s.length > 20) return { error: '城市名过长（≤20 字）' }
    out.city = s
  }
  if (input.doubleClick !== undefined) {
    if (!DOUBLE_CLICK_LEVELS.includes(input.doubleClick)) {
      return { error: `双击行为只能是 ${DOUBLE_CLICK_LEVELS.join(' / ')}` }
    }
    out.doubleClick = input.doubleClick
  }
  for (const key of ['musicLink', 'soundOn', 'passthrough', 'locked', 'topmost', 'snap', 'autoStart']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') return { error: `${key} 必须是布尔值` }
      out[key] = input[key]
    }
  }
  return { value: out }
}

/** 桌宠设置的生效值：state.json（已应用）> UI 保存值 > 桌宠 config.json > 配置默认。 */
function resolvePetSettings({ stateFile, savedPet, petConfig, defaults }) {
  const pick = (k, fallback) => {
    const fromState = isObject(stateFile?.petSettings) ? stateFile.petSettings[k] : undefined
    if (fromState !== undefined && fromState !== null) return fromState
    const fromSaved = isObject(savedPet) ? savedPet[k] : undefined
    if (fromSaved !== undefined && fromSaved !== null) return fromSaved
    const fromPet = petConfig ? petConfig[k] : undefined
    if (fromPet !== undefined && fromPet !== null) return fromPet
    return fallback
  }
  return {
    size: pick('size', defaults.size),
    opacity: pick('opacity', defaults.opacity),
    mode: pick('mode', defaults.mode),
    lineFreq: pick('lineFreq', defaults.lineFreq),
    passthrough: pick('passthrough', defaults.passthrough),
    locked: pick('locked', defaults.locked),
    topmost: pick('topmost', defaults.topmost),
    snap: pick('snap', defaults.snap),
    layer: pick('layer', defaults.layer),
    bubbleStyle: pick('bubbleStyle', defaults.bubbleStyle),
    skin: pick('skin', defaults.skin),
    soundOn: pick('soundOn', defaults.soundOn),
    volume: pick('volume', defaults.volume),
    musicLink: pick('musicLink', defaults.musicLink),
    city: pick('city', defaults.city),
    quietMinutes: pick('quietMinutes', defaults.quietMinutes),
    doubleClick: pick('doubleClick', defaults.doubleClick),
    autoStart: pick('autoStart', defaults.autoStart),
    bubbleMs: pick('bubbleMs', defaults.bubbleMs)
  }
}

/** 面板「气泡停留时长」总控 → 插件侧气泡节奏（tech-scout v11 约定：顶层 bubble 段）。 */
function buildBubbleConfig(bubbleMs) {
  const normalMs = Math.max(1000, Math.min(30000, Number(bubbleMs) || 5000))
  return {
    normalMs,
    innerMs: Math.max(3000, Math.round(normalMs * 0.6)),
    reportMs: 10000,
    approvalMs: 8000,
    nightMs: 6000
  }
}

/**
 * 各 pet 设置项的通道：cmd:config 批量下发即时生效（task-32 §C）；
 * bubbleMs 属插件侧气泡参数（say3/normalMs）；doubleClick 待桌宠补丁把
 * `doubleClick` 加进 cmd:config 白名单（task-36 已与 tech-scout 约定）。
 */
const PET_FIELD_CHANNEL = Object.fromEntries(
  PET_CONFIG_FIELDS.map((key) => [key, 'immediate']).concat([
    ['bubbleMs', 'pending-plugin'],
    ['doubleClick', 'pending-plugin'],
    ['autoStart', 'pending-plugin']
  ])
)

// ────────────────────────────── 在线探测 ──────────────────────────────

function probePipe(pipe, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const finish = (online, error) => {
      if (settled) return
      settled = true
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve({ online, latencyMs: Date.now() - started, error: error ?? null })
    }
    const sock = net.connect(pipe)
    sock.setTimeout(timeoutMs, () => finish(false, 'timeout'))
    sock.on('connect', () => finish(true))
    sock.on('error', (err) => finish(false, err?.code ?? String(err)))
  })
}

/** 桌宠进程探测（tasklist，低成本，带 TTL 缓存）。 */
function makeProcessProbe(ttlMs) {
  let cache = { at: 0, count: 0, ok: false }
  return async function probe() {
    if (Date.now() - cache.at < ttlMs) return cache
    try {
      const { stdout } = await runFile('tasklist', ['/FI', 'IMAGENAME eq pythonw.exe', '/FO', 'CSV', '/NH'], {
        timeout: 4000,
        windowsHide: true
      })
      const count = stdout.split(/\r?\n/).filter((l) => /pythonw\.exe/i.test(l)).length
      cache = { at: Date.now(), count, ok: true }
    } catch {
      cache = { at: Date.now(), count: 0, ok: false }
    }
    return cache
  }
}

/** 往命名管道写一行（协议 v2：say:/act:/walk:/...），短连接、静默失败。 */
/**
 * 往命名管道写一行（协议 v2：say:/act:/cmd:…），不等待回执，短连接静默失败。
 * @param {string} pipe 管道名
 * @param {string} line 协议行（自动补换行）
 * @param {number} [timeoutMs] 写超时
 * @returns {Promise<{ok: boolean, error: string|null}>}
 */
export function sendPipeLine(pipe, line, timeoutMs = 900) {
  return new Promise((resolve) => {
    const payload = `${line}\n`
    let wrote = false
    let settled = false
    const finish = (ok, error) => {
      if (settled) return
      settled = true
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve({ ok, error: error ?? null })
    }
    const sock = net.connect(pipe)
    sock.setTimeout(timeoutMs, () => finish(false, 'timeout'))
    sock.on('connect', () => {
      sock.write(payload, () => {
        wrote = true
        sock.end()
        finish(true)
      })
    })
    sock.on('error', (err) => finish(false, wrote ? null : (err?.code ?? String(err))))
  })
}

/**
 * 往命名管道发一条命令并读回执（桌宠会回 `cmd:<name>` / `unknowncmd:<name>` / `-fail`）。
 * 用于 task-36 的快捷查看按钮：既能执行，也能据回执判断协议是否就绪。
 */
export function sendPipeCommand(pipe, line, timeoutMs = 1800) {
  return new Promise((resolve) => {
    const payload = `${line}\n`
    const chunks = []
    let settled = false
    let wrote = false
    let connected = false
    const finish = (error) => {
      if (settled) return
      settled = true
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      // 桌宠对部分 cmd 可能不回包就关连接（EPIPE/无 data）——只要连上且写成功就视为已执行，
      // 回执仅用于识别 unknowncmd / -fail（见 petAction）。
      resolve({
        ok: connected && wrote,
        reply: chunks.join('').replace(/\s+/g, ' ').trim(),
        error: error ?? null
      })
    }
    const sock = net.connect(pipe)
    sock.setTimeout(timeoutMs, () => finish('timeout'))
    sock.on('data', (b) => chunks.push(String(b)))
    sock.on('connect', () => {
      connected = true
      sock.write(payload, (err) => {
        if (err) {
          finish(err?.code ?? String(err))
          return
        }
        wrote = true
        // 写完半关闭：桌宠回包后连接会自然结束；无回包的实现也能尽早 settle
        setTimeout(() => finish(null), 260)
      })
    })
    sock.on('end', () => finish(null))
    sock.on('close', () => finish(null))
    sock.on('error', (err) => finish(err?.code ?? String(err)))
  })
}

// ────────────────────────────── 截图（仅点击时） ──────────────────────────────

async function takeScreenshot(evidenceDir) {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile = path.join(evidenceDir, `ui-shot-${stamp}.jpg`)
  const scriptFile = path.join(os.tmpdir(), `dsh-pet-ui-shot-${process.pid}.ps1`)
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $enc = New-Object System.Drawing.Imaging.EncoderParameters 1
  $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]72)
  $bmp.Save('${outFile.replace(/'/g, "''")}', $codec, $enc)
} finally {
  $g.Dispose()
  $bmp.Dispose()
}
Write-Output 'ok'
`
  try {
    fs.writeFileSync(scriptFile, ps, 'utf8')
    await runFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      {
        timeout: 20000,
        windowsHide: true
      }
    )
    const buf = fs.readFileSync(outFile)
    return {
      ok: true,
      file: outFile,
      bytes: buf.length,
      at: new Date().toISOString(),
      dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`
    }
  } catch (error) {
    return {
      ok: false,
      error: 'screenshot-failed',
      message: clip(error?.stderr || error?.message || String(error), 300)
    }
  } finally {
    try {
      fs.unlinkSync(scriptFile)
    } catch {
      /* ignore */
    }
  }
}

// ────────────────────────────── 状态聚合 ──────────────────────────────

function buildHandler(cfg, log) {
  const probeProcess = makeProcessProbe(cfg.processProbeTtlMs)
  const stateCache = { at: 0, value: null }

  function loadStateFile() {
    if (Date.now() - stateCache.at < 2000) return stateCache.value
    const raw = readJson(cfg.stateFile, null)
    let value = null
    if (isObject(raw)) {
      const at = raw.updatedAt ? new Date(raw.updatedAt) : null
      const ageMs = at && !Number.isNaN(at.getTime()) ? Date.now() - at.getTime() : null
      value = { ...raw, _ageMs: ageMs, _fresh: ageMs !== null && ageMs < cfg.stateFileTtlMs }
    }
    stateCache.at = Date.now()
    stateCache.value = value
    return value
  }

  function loadUiConfig() {
    const raw = readJson(cfg.uiConfigFile, null)
    return isObject(raw) ? raw : null
  }

  function effectiveConfig(stateFile, logParsed, activityRaw) {
    const loaded = logParsed.loaded ?? {}
    const fromLog = {
      activity: typeof loaded.activity === 'string' ? loaded.activity : null,
      quietHours: Array.isArray(loaded.quietHours) ? loaded.quietHours : null,
      budgetPerDayYuan: Number.isFinite(loaded?.llmLimits?.budgetPerDayYuan) ? loaded.llmLimits.budgetPerDayYuan : null,
      llmEnabled: typeof loaded.llm === 'string' ? true : null,
      model: null,
      provider: null
    }
    if (typeof loaded.llm === 'string' && loaded.llm.includes('/')) {
      const [provider, model] = loaded.llm.split('/')
      fromLog.provider = provider
      fromLog.model = model
    }

    const fromState = stateFile
      ? {
          enabled: typeof stateFile.enabled === 'boolean' ? stateFile.enabled : null,
          activity: typeof stateFile.activity === 'string' ? stateFile.activity : null,
          quietHours: Array.isArray(stateFile.quietHours) ? stateFile.quietHours : null,
          budgetPerDayYuan: Number.isFinite(stateFile.budgetPerDayYuan) ? stateFile.budgetPerDayYuan : null,
          llmEnabled: typeof stateFile.llmEnabled === 'boolean' ? stateFile.llmEnabled : null,
          model: typeof stateFile.model === 'string' ? stateFile.model : null,
          provider: typeof stateFile.provider === 'string' ? stateFile.provider : null
        }
      : {}

    const activityFromFile = ACTIVITY_LEVELS.includes(
      String(activityRaw ?? '')
        .trim()
        .toLowerCase()
    )
      ? String(activityRaw).trim().toLowerCase()
      : null

    const pick = (k, fallback) => fromState[k] ?? (k === 'activity' ? activityFromFile : null) ?? fromLog[k] ?? fallback

    return {
      enabled: pick('enabled', true),
      activity: ACTIVITY_LEVELS.includes(pick('activity', 'normal')) ? pick('activity', 'normal') : 'normal',
      quietHours: Array.isArray(pick('quietHours', ['23:30-08:00'])) ? pick('quietHours', ['23:30-08:00']) : [],
      budgetPerDayYuan: pick('budgetPerDayYuan', cfg.defaultBudgetPerDayYuan),
      llmEnabled: pick('llmEnabled', true),
      provider: pick('provider', cfg.defaultProvider),
      model: pick('model', cfg.defaultModel),
      sources: {
        stateFile: Boolean(stateFile?._fresh),
        logLoaded: Boolean(logParsed.loaded),
        activityFile: Boolean(activityFromFile)
      }
    }
  }

  /** 协议就绪度：默认值 + patch 覆盖 + 联动插件 state.json.capabilities（最新）。 */
  function effectiveReadiness() {
    const readiness = {
      ...DEFAULT_PET_ACTION_READINESS,
      ...(isObject(cfg.petActionReadiness) ? cfg.petActionReadiness : {})
    }
    const stateFile = loadStateFile()
    if (isObject(stateFile?.capabilities)) {
      const caps = stateFile.capabilities
      if (Array.isArray(caps.petActions)) {
        for (const key of Object.keys(readiness)) {
          if (caps.petActions.includes(key)) readiness[key] = true
        }
      }
      for (const key of ['doubleClick', 'autoStart', 'quit']) {
        if (typeof caps[key] === 'boolean') readiness[key] = caps[key]
      }
    }
    return readiness
  }

  /**
   * 聚合面板所需全部状态（只读）：host/pet/pipe、最近 say、state.json、运行时状态、capabilities、petOptions。
   * @returns {Promise<{ok: true, data: object}>}
   */
  async function collectState() {
    const [pipeProbe, processInfo] = await Promise.all([probePipe(cfg.pipe, cfg.pipeProbeTimeoutMs), probeProcess()])
    const logParsed = parseBridgeLog(readTail(cfg.logFile, cfg.logTailBytes), cfg.recentSayLimit)
    const stateFile = loadStateFile()
    const activityRaw = readText(cfg.activityFile).trim()
    const effective = effectiveConfig(stateFile, logParsed, activityRaw)
    const quietRanges = parseQuietRanges(effective.quietHours)
    const inQuiet = isInQuietHours(quietRanges)

    // 今日 calls/cost：优先 state.json（新鲜时），否则日志尾（仅当天 say 行）
    const todayCalls = Number.isFinite(stateFile?.todayCalls) ? stateFile.todayCalls : (logParsed.todayCalls ?? 0)
    const todayCost = Number.isFinite(stateFile?.todayCost) ? stateFile.todayCost : (logParsed.todayCost ?? 0)

    const recentSay =
      Array.isArray(stateFile?.recentSay) && stateFile.recentSay.length
        ? stateFile.recentSay.slice(-cfg.recentSayLimit).map((x) => ({
            at: x?.at ?? null,
            kind: String(x?.kind ?? ''),
            source: String(x?.source ?? ''),
            style: x?.style ? String(x.style) : '',
            line: clip(x?.line, 120)
          }))
        : logParsed.recentSay

    const ui = loadUiConfig()
    const saved = ui
      ? {
          enabled: typeof ui.enabled === 'boolean' ? ui.enabled : null,
          activity: ACTIVITY_LEVELS.includes(ui.activity) ? ui.activity : null,
          quietHours: Array.isArray(ui.quietHours) ? ui.quietHours : null,
          budgetPerDayYuan: Number.isFinite(ui?.llm?.budgetPerDayYuan) ? ui.llm.budgetPerDayYuan : null,
          pet: isObject(ui.pet) ? ui.pet : null,
          updatedAt: ui.updatedAt ?? null
        }
      : null

    const petConfig = readPetConfig(cfg.petConfigFile)
    const petSettings = resolvePetSettings({
      stateFile,
      savedPet: saved?.pet,
      petConfig,
      defaults: cfg.petDefaults
    })
    const appliedPet = isObject(stateFile?.petSettings) ? stateFile.petSettings : null

    const pending = []
    if (saved) {
      if (saved.enabled !== null && saved.enabled !== effective.enabled) pending.push('enabled')
      if (saved.activity !== null && saved.activity !== effective.activity) pending.push('activity')
      if (saved.quietHours !== null && JSON.stringify(saved.quietHours) !== JSON.stringify(effective.quietHours))
        pending.push('quietHours')
      if (saved.budgetPerDayYuan !== null && saved.budgetPerDayYuan !== effective.budgetPerDayYuan)
        pending.push('budgetPerDayYuan')
      // 桌宠设置：有 cmd 通道的（size/opacity/mode/lineFreq/passthrough/locked）保存即已下发；
      // 其余（bubbleMs/city/musicLink/soundOn）等联动插件应用 → 用 state.json.petSettings 判断。
      if (saved.pet) {
        const ref = appliedPet ?? petConfig ?? {}
        for (const [k, channel] of Object.entries(PET_FIELD_CHANNEL)) {
          if (channel !== 'pending-plugin') continue
          const want = saved.pet[k]
          if (want === undefined || want === null) continue
          if (ref[k] !== want) pending.push(`pet.${k}`)
        }
      }
    }

    const petOnline = pipeProbe.online || processInfo.count > 0
    const lastSayAt = recentSay.length ? recentSay[recentSay.length - 1].at : logParsed.lastSayAt
    // 气泡节奏：优先联动插件 state.json.bubble 回显，否则用 ui 保存值派生
    const bubble = isObject(stateFile?.bubble)
      ? stateFile.bubble
      : buildBubbleConfig(saved?.pet?.bubbleMs ?? cfg.petDefaults.bubbleMs)
    const petActionReadiness = effectiveReadiness()
    const skins =
      Array.isArray(stateFile?.skins?.available) && stateFile.skins.available.length
        ? stateFile.skins.available.map(String)
        : readSkinOptions(cfg.petConfigFile)
    // task-44：实时状态（思考/调工具/等确认/后台/出错/完成/空闲/失联），30s 无心跳判失联
    const runtime = normalizeRuntimeStatus(stateFile, { staleMs: cfg.runtimeStaleMs })

    return {
      ok: true,
      data: {
        now: new Date().toISOString(),
        version: PLUGIN_VERSION,
        host: {
          online: true,
          pid: process.pid,
          uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
          platform: process.platform
        },
        pet: {
          online: petOnline,
          processes: processInfo.count,
          probeOk: processInfo.ok
        },
        pipe: {
          online: pipeProbe.online,
          name: cfg.pipe,
          latencyMs: pipeProbe.latencyMs,
          error: pipeProbe.error
        },
        config: effective,
        saved,
        pending,
        petSettings,
        petSettingsApplied: appliedPet,
        petSettingsNative: petConfig,
        petSettingsChannels: PET_FIELD_CHANNEL,
        bubble,
        attribution: isObject(stateFile?.attribution) ? stateFile.attribution : null,
        runtime,
        capabilities: {
          petActions: Object.keys(PET_ACTION_CMDS).filter((k) => petActionReadiness[k] !== false),
          petActionReadiness,
          doubleClick: petActionReadiness.doubleClick !== false,
          autoStart: petActionReadiness.autoStart !== false,
          quit: petActionReadiness.quit !== false
        },
        petOptions: {
          skins,
          doubleClick: petSettings.doubleClick,
          doubleClickOptions: DOUBLE_CLICK_LEVELS,
          autoStart: petSettings.autoStart
        },
        versions: {
          uiPlugin: PLUGIN_VERSION,
          bridgePlugin: typeof stateFile?.version === 'string' ? stateFile.version : null,
          pet: typeof stateFile?.petVersion === 'string' ? stateFile.petVersion : null
        },
        lastAction: isObject(stateFile?.lastAction) ? stateFile.lastAction : null,
        today: {
          calls: todayCalls,
          cost: todayCost,
          budgetPerDayYuan: effective.budgetPerDayYuan,
          ratio: effective.budgetPerDayYuan > 0 ? Math.min(1, todayCost / effective.budgetPerDayYuan) : 0
        },
        quiet: {
          inQuiet,
          ranges: quietRanges.map((r) => r.text),
          now: hhmm()
        },
        recentSay,
        lastSayAt,
        lastLogAt: logParsed.lastLineAt,
        files: {
          logFile: cfg.logFile,
          stateFile: cfg.stateFile,
          uiConfigFile: cfg.uiConfigFile,
          activityFile: cfg.activityFile,
          petConfigFile: cfg.petConfigFile,
          actionFile: cfg.actionFile,
          stateFileFresh: Boolean(stateFile?._fresh)
        }
      }
    }
  }

  /**
   * 保存面板配置到 sidecar `ui-config.json`（白名单校验）；可即时项同时经管道下发。
   * @param {object} payload `{enabled?, activity?, quietHours?, budgetPerDayYuan?, pet?}`
   * @returns {Promise<{ok: boolean, data?: object, error?: object}>}
   */
  async function applyConfig(payload) {
    const ui = loadUiConfig() ?? { version: 1 }
    const next = { ...ui, version: 1, updatedBy: 'dsh-pet-bridge-ui' }
    const applied = {}

    if (payload?.enabled !== undefined) {
      if (typeof payload.enabled !== 'boolean') {
        return { ok: false, error: { code: 'invalid-argument', message: 'enabled 必须是布尔值' } }
      }
      next.enabled = payload.enabled
    }

    if (payload?.activity !== undefined) {
      const level = String(payload.activity ?? '').toLowerCase()
      if (!ACTIVITY_LEVELS.includes(level)) {
        return {
          ok: false,
          error: { code: 'invalid-argument', message: `activity 只能是 ${ACTIVITY_LEVELS.join(' / ')}` }
        }
      }
      next.activity = level
      // activity.txt 是 pet-bridge 现有热切通道（每 20s 轮询），直接写即生效
      try {
        fs.mkdirSync(path.dirname(cfg.activityFile), { recursive: true })
        fs.writeFileSync(cfg.activityFile, level, 'utf8')
        applied.activity = 'immediate'
      } catch (error) {
        applied.activity = `failed: ${clip(error?.message, 120)}`
      }
    }

    if (payload?.quietHours !== undefined) {
      if (!Array.isArray(payload.quietHours)) {
        return {
          ok: false,
          error: { code: 'invalid-argument', message: 'quietHours 必须是字符串数组，如 ["23:30-08:00"]' }
        }
      }
      const bad = payload.quietHours.find((r) => !QUIET_RANGE_RE.test(String(r ?? '').trim()))
      if (bad !== undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid-argument',
            message: `时段格式应为 HH:MM-HH:MM（收到 ${JSON.stringify(String(bad))}）`
          }
        }
      }
      next.quietHours = payload.quietHours.map((r) => String(r).trim())
    }

    if (payload?.budgetPerDayYuan !== undefined) {
      const n = Number(payload.budgetPerDayYuan)
      if (!Number.isFinite(n) || n < 0 || n > 10000) {
        return { ok: false, error: { code: 'invalid-argument', message: '每日上限应是 0~10000 之间的数字（元）' } }
      }
      next.llm = { ...(isObject(next.llm) ? next.llm : {}), budgetPerDayYuan: n }
    }

    if (payload?.pet !== undefined) {
      const currentPet = isObject(next.pet) ? next.pet : {}
      const norm = normalizePetSettings(payload.pet, currentPet)
      if (norm.error) {
        return { ok: false, error: { code: 'invalid-argument', message: norm.error } }
      }
      next.pet = norm.value
      // 协议支持即时生效的项：cmd:config 批量下发（桌宠 v10 补丁已支持）
      const cmds = petSettingsToCmds(payload.pet)
      if (cmds.length > 0) {
        const results = []
        for (const line of cmds) {
          const r = await sendPipeLine(cfg.pipe, line)
          results.push({ cmd: line.slice(0, 80) + (line.length > 80 ? '…' : ''), ok: r.ok })
        }
        applied.pet = results
      }
      // 气泡停留时长 → 插件侧 bubble 节奏（tech-scout v11 读取）
      if (payload.pet.bubbleMs !== undefined) {
        next.bubble = buildBubbleConfig(payload.pet.bubbleMs)
      }
      const pendingPet = Object.keys(PET_FIELD_CHANNEL).filter(
        (k) => PET_FIELD_CHANNEL[k] === 'pending-plugin' && payload.pet[k] !== undefined
      )
      if (pendingPet.length > 0) applied.petPendingFields = pendingPet
    }

    next.version = 2
    next.updatedBy = 'dsh-pet-bridge-ui'
    if (Object.keys(applied).length === 0 && next.activity !== undefined) {
      // activity 未变更时不重复写文件
      applied.activity = 'unchanged'
    }

    next.updatedAt = new Date().toISOString()
    try {
      writeJsonAtomic(cfg.uiConfigFile, next)
    } catch (error) {
      return { ok: false, error: { code: 'write-failed', message: clip(error?.message, 200) } }
    }
    log.info(`[pet-bridge-ui] config saved fields=${Object.keys(payload ?? {}).join(',')}`)
    return {
      ok: true,
      data: {
        saved: true,
        applied,
        note: 'activity 写 activity.txt 即时生效；大小/透明度/模式/语录频率/穿透/锁定 已管道即时下发；enabled/quietHours/预算/城市/音乐/音效/气泡时长 由联动插件 watcher 应用',
        state: await collectState()
      }
    }
  }

  /** 「恢复默认配置」：重置 ui-config 全量 + activity + 管道下发可即时项（不动桌宠原生 config.json）。 */
  async function resetDefaults() {
    const native = readPetConfig(cfg.petConfigFile)
    const pet = { ...cfg.petDefaults }
    if (!pet.city && native?.city) pet.city = native.city
    const next = {
      version: 2,
      updatedBy: 'dsh-pet-bridge-ui',
      updatedAt: new Date().toISOString(),
      enabled: true,
      activity: 'normal',
      quietHours: ['23:30-08:00'],
      llm: { budgetPerDayYuan: cfg.defaultBudgetPerDayYuan },
      pet,
      bubble: buildBubbleConfig(pet.bubbleMs)
    }
    try {
      writeJsonAtomic(cfg.uiConfigFile, next)
      fs.mkdirSync(path.dirname(cfg.activityFile), { recursive: true })
      fs.writeFileSync(cfg.activityFile, 'normal', 'utf8')
    } catch (error) {
      return { ok: false, error: { code: 'write-failed', message: clip(error?.message, 200) } }
    }
    const cmds = petSettingsToCmds(pet)
    const results = []
    for (const line of cmds) {
      const r = await sendPipeLine(cfg.pipe, line)
      results.push({ cmd: line, ok: r.ok })
    }
    log.info(`[pet-bridge-ui] config reset to defaults fields=${Object.keys(pet).length}`)
    return {
      ok: true,
      data: {
        reset: true,
        pet,
        applied: { activity: 'immediate', pet: results },
        note: '已恢复面板默认值并即时下发可管道项；城市/音乐/音效/气泡时长待联动插件应用',
        state: await collectState()
      }
    }
  }

  /** 最近 N 条日志（面板「查看日志」；只读，单行截断 400 字符）。 */
  function readLogs(lines) {
    const want = Math.max(1, Math.min(400, Number(lines) || cfg.logPreviewLines))
    const tail = readTail(cfg.logFile, cfg.logTailBytes)
    const all = tail.split(/\r?\n/).filter((l) => l.trim() !== '')
    return {
      ok: true,
      data: {
        file: cfg.logFile,
        totalRead: all.length,
        lines: all.slice(-want).map((l) => clip(l, 400)),
        now: new Date().toISOString()
      }
    }
  }

  /** 应急动作请求：写 ui-action.json，由联动插件 watcher 消费（结果写 state.json.lastAction）。 */
  function requestAction(payload) {
    const SUPPORTED = [
      'restart-pet',
      'start-pet',
      'stop-pet',
      // task-40：自启/退出语义（tech-scout v20 消费）
      'enable-autostart',
      'disable-autostart',
      'quit-pet'
    ]
    const name = String(payload?.name ?? '')
    if (!SUPPORTED.includes(name)) {
      return {
        ok: false,
        error: { code: 'invalid-argument', message: `不支持的动作：${name}（支持 ${SUPPORTED.join(' / ')}）` }
      }
    }
    const existing = readJson(cfg.actionFile, null)
    if (isObject(existing) && existing.id && !existing.handledAt) {
      return {
        ok: false,
        error: { code: 'busy', message: `上一条动作尚未执行完成（${existing.name ?? '?'}），请稍后再试` }
      }
    }
    const request = {
      id: 'act-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name,
      requestedAt: new Date().toISOString(),
      requestedBy: 'dsh-pet-bridge-ui'
    }
    try {
      writeJsonAtomic(cfg.actionFile, request)
    } catch (error) {
      return { ok: false, error: { code: 'write-failed', message: clip(error?.message, 200) } }
    }
    log.info(`[pet-bridge-ui] action queued name=${name}`)
    return {
      ok: true,
      data: {
        queued: true,
        request,
        note: '联动插件 ≤20s 轮询消费；结果写入 state.json.lastAction（面板会显示）'
      }
    }
  }

  /**
   * task-36 快捷查看：把协议命令发到桌宠并读回执。
   * 回执 `cmd:<name>` = 成功；`unknowncmd:<name>` = 桌宠协议未支持（待服务端）；
   * `<...>-fail` = 桌宠侧执行失败（如余额未配 Key）。
   */
  async function petAction(payload) {
    const name = String(payload?.name ?? '').trim()
    const minutes = Math.max(1, Math.min(240, Number(payload?.minutes) || 30))
    // quietStart 需要分钟数；quit/autoStart 等由 readiness 控制
    const line = name === 'quietStart' ? `cmd:quiet:${minutes}` : PET_ACTION_CMDS[name]
    if (!line) {
      return {
        ok: false,
        error: {
          code: 'invalid-argument',
          message: `未知动作：${name}（支持 ${Object.keys(PET_ACTION_CMDS).join(' / ')}）`
        }
      }
    }
    const readiness = effectiveReadiness()
    if (readiness[name] === false) {
      return { ok: false, error: { code: 'not-supported', message: `桌宠协议尚未支持「${name}」（待服务端）` } }
    }
    const r = await sendPipeCommand(cfg.pipe, line)
    const reply = String(r.reply ?? '')
    if (!r.ok) {
      return { ok: false, error: { code: 'pipe-unavailable', message: `管道不可写（${r.error ?? '未知原因'}）` } }
    }
    if (/^unknowncmd:/.test(reply)) {
      log.info(`[pet-bridge-ui] pet.action ${name} not-supported reply=${clip(reply, 80)}`)
      return {
        ok: false,
        error: { code: 'not-supported', message: `桌宠暂不支持该命令（${clip(reply, 80)}），待服务端升级` }
      }
    }
    if (/-fail$/.test(reply)) {
      log.info(`[pet-bridge-ui] pet.action ${name} failed reply=${clip(reply, 80)}`)
      return { ok: false, error: { code: 'pet-error', message: `桌宠执行失败：${clip(reply, 120)}` } }
    }
    log.info(`[pet-bridge-ui] pet.action ${name} ok reply=${clip(reply, 80)}`)
    return { ok: true, data: { name, cmd: line, reply } }
  }

  async function runTest(kind, payload) {
    if (kind === 'say') {
      const text = clip(payload?.text ?? '测试一下：我在这儿呢。', 60)
      if (!text) return { ok: false, error: { code: 'invalid-argument', message: '台词不能为空' } }
      const r = await sendPipeLine(cfg.pipe, `say:${text}`)
      log.info(`[pet-bridge-ui] test say sent=${r.ok} chars=${text.length}`)
      return r.ok
        ? { ok: true, data: { sent: true, line: text } }
        : { ok: false, error: { code: 'pipe-unavailable', message: `管道不可写（${r.error ?? '未知原因'}）` } }
    }
    if (kind === 'jump') {
      const r = await sendPipeLine(cfg.pipe, 'act:jump')
      log.info(`[pet-bridge-ui] test jump sent=${r.ok}`)
      return r.ok
        ? { ok: true, data: { sent: true, action: 'jump' } }
        : { ok: false, error: { code: 'pipe-unavailable', message: `管道不可写（${r.error ?? '未知原因'}）` } }
    }
    if (kind === 'screenshot') {
      const shot = await takeScreenshot(cfg.evidenceDir)
      log.info(`[pet-bridge-ui] test screenshot ok=${shot.ok}${shot.ok ? ` bytes=${shot.bytes}` : ''}`)
      return shot.ok ? { ok: true, data: shot } : { ok: false, error: { code: shot.error, message: shot.message } }
    }
    return { ok: false, error: { code: 'unknown-endpoint', message: `未知测试动作：${kind}` } }
  }

  /**
   * Host 半边统一端点分发（wire 信封内由 web-route 调用）。
   * @param {string} endpoint 端点名（ping/state.get/config.set/config.reset/logs.get/action.request/pet.action/pet.nativeui/test.*）
   * @param {any} [payload] 业务负载
   * @returns {Promise<{ok: true, data: any} | {ok: false, error: {code: string, message: string}}>} 统一结果信封
   */
  return async function handler(endpoint, payload) {
    switch (endpoint) {
      case 'ping':
        return { ok: true, data: { pong: true, version: PLUGIN_VERSION, now: new Date().toISOString() } }
      case 'state.get':
        return collectState()
      case 'config.set':
        return applyConfig(payload)
      case 'config.reset':
        return resetDefaults()
      case 'logs.get':
        return readLogs(payload?.lines)
      case 'action.request':
        return requestAction(payload)
      case 'pet.action':
        return petAction(payload)
      case 'pet.nativeui': {
        // 应急：临时显示/隐藏桌宠原生菜单（v10 默认隐藏；task-32 §B 的应急通道）
        const on = payload?.on !== false
        const r = await sendPipeLine(cfg.pipe, `cmd:nativeui:${on ? 'on' : 'off'}`)
        log.info(`[pet-bridge-ui] nativeui ${on ? 'on' : 'off'} sent=${r.ok}`)
        return r.ok
          ? { ok: true, data: { on, note: on ? '原生菜单已临时显示；用完建议关掉' : '原生菜单已隐藏' } }
          : { ok: false, error: { code: 'pipe-unavailable', message: `管道不可写（${r.error ?? '未知原因'}）` } }
      }
      case 'test.say':
        return runTest('say', payload)
      case 'test.jump':
        return runTest('jump', payload)
      case 'test.screenshot':
        return runTest('screenshot', payload)
      default:
        return { ok: false, error: { code: 'unknown-endpoint', message: `未知端点：${endpoint}` } }
    }
  }
}

// ────────────────────────────── 插件入口 ──────────────────────────────

/**
 * Cordis 插件入口：合并配置、挂载 `/pet-bridge-ui` host 路由并写激活心跳。
 * @param {any} ctx Cordis 上下文（需 connection/webServer 服务）
 * @param {object} [rawConfig] profile patch 中的插件 config
 */
export function apply(ctx, rawConfig) {
  const cfg = merge(DEFAULTS, rawConfig)
  const log = {
    info: (msg) => {
      try {
        ctx?.logger?.info?.(msg)
      } catch {
        /* ignore */
      }
      try {
        console.log(msg)
      } catch {
        /* ignore */
      }
    },
    warn: (msg) => {
      try {
        ctx?.logger?.warn?.(msg)
      } catch {
        /* ignore */
      }
      try {
        console.warn(msg)
      } catch {
        /* ignore */
      }
    }
  }

  const handler = buildHandler(cfg, log)

  ctx.inject(['connection', 'webServer'], (scope) => {
    const webServer = scope.get('webServer')
    const connection = scope.get('connection')
    const dispose = mountWebRoute({
      webServer,
      connection,
      channel: cfg.channel,
      handler,
      log
    })
    if (dispose === null) {
      log.warn('[pet-bridge-ui] webServer.register 不可用，设置面板将无法取数')
      return
    }
    // 挂载心跳：给安装/验证脚本一个不依赖浏览器鉴权的激活证据（只含 pid/通道/时间）
    try {
      writeJsonAtomic(cfg.heartbeatFile, {
        mountedAt: new Date().toISOString(),
        pid: process.pid,
        channel: cfg.channel,
        version: PLUGIN_VERSION,
        plugin: name
      })
    } catch {
      /* 心跳失败不影响路由 */
    }
    const disposeAll = () => {
      try {
        dispose()
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(cfg.heartbeatFile)
      } catch {
        /* ignore */
      }
    }
    log.info(`[pet-bridge-ui] route mounted ${cfg.channel}（host pid ${process.pid}）`)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => disposeAll, 'pet-bridge-ui.web-route')
    } else if (typeof ctx.on === 'function') {
      ctx.on('dispose', disposeAll)
    }
  })
}

/** 测试用内部导出（不参与运行时契约）。 */
export const __test = {
  merge,
  parseBridgeLog,
  parseQuietRanges,
  isInQuietHours,
  sendPipeLine,
  takeScreenshot,
  buildHandler,
  readPetConfig,
  readSkinOptions,
  normalizeRuntimeStatus,
  RUNTIME_STATE_META,
  petSettingsToCmds,
  normalizePetSettings,
  resolvePetSettings,
  buildBubbleConfig,
  sendPipeCommand,
  PET_ACTION_CMDS,
  DEFAULT_PET_ACTION_READINESS,
  PET_FIELD_CHANNEL,
  PET_CONFIG_FIELDS,
  DEFAULTS,
  ACTIVITY_LEVELS,
  MODE_LEVELS,
  LINE_FREQ_LEVELS,
  LAYER_LEVELS,
  BUBBLE_STYLE_LEVELS,
  DOUBLE_CLICK_LEVELS
}
