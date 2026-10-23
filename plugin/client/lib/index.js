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
import { renderHomeHtml } from './home.js'

const runFile = promisify(execFile)
const STARTED_AT = Date.now()
const PLUGIN_VERSION = '0.3.0'

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
  walkNearby: 'walk:nearby',
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

/** task-51（ux 19 / v37）：活跃度护栏默认值（ui-config.guards）。 */
const GUARD_DEFAULTS = { maxActionsPerHour: 60, noActionOnSameState: true }

const DEFAULTS = {
  channel: '/pet-bridge-ui',
  pipe: '\\\\.\\pipe\\dafeiyu-pet-whale-single-instance',
  logFile: path.join(PET_ROOT, 'evidence', 'pet-bridge-main.log'),
  activityFile: path.join(PET_ROOT, 'activity.txt'),
  stateFile: path.join(PET_ROOT, 'state.json'),
  /** v33+ 实时状态真源（旧 state.json 有泄漏定时器持续覆盖，仅作兜底；可由 patch config 覆盖）。 */
  stateV2File: path.join(PET_ROOT, 'bridge-state-v2.json'),
  /** Phase-1：事件环形缓冲（task-46/F3，500 条/最近；不存在时面板显示空态）。 */
  eventsFile: path.join(PET_ROOT, 'events.json'),
  /** Phase-1：情绪持久化（情绪/精力/好感；v2.companion 优先，文件仅兜底）。 */
  companionFile: path.join(PET_ROOT, 'companion.json'),
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
    toolType: firstString(raw?.toolType, raw?.tool_type),
    phase: firstString(raw?.phase),
    stateClass: firstString(raw?.stateClass, raw?.state_class),
    message: firstString(raw?.message, raw?.detail),
    lastEventAt: firstString(raw?.lastEventAt)
  }
}

/** 会话角色归一：团队/子代理/后台统一标「后台」，主会话标「主会话」。 */
const SESSION_BACKGROUND_ROLES = new Set(['team', 'teammate', 'subagent', 'child', 'background', 'agent'])
const SESSION_IDLE_STATES = new Set(['idle', 'done', 'disconnected'])

/**
 * task-46：把 `state.json.sessions[]` 归一成按工作区分组的「运行中的对话」视图。
 *
 * 字段（tech-scout 协议，容错读取）：`sessionId` / `workspace`（或 `cwd`）/ `title` /
 * `state` / `tool` / `lastUserMessageAt` / `lastSeenAt` / `role`；顶层另有
 * `currentSessionId`、`activeSessionCount`。无 `sessions` 时退回单会话视图（supported=false）。
 *
 * @param {object|null} stateFile 联动插件写出的 state.json
 * @param {ReturnType<typeof normalizeRuntimeStatus>} runtime 当前归一后的运行时状态
 * @param {{ now?: number }} [opts]
 * @returns {{
 *   supported: boolean, currentSessionId: string|null, activeSessionCount: number,
 *   total: number, othersCount: number,
 *   groups: Array<{ workspace: string, isCurrentGroup: boolean, sessions: Array<object> }>
 * }}
 */
export function normalizeSessions(stateFile, runtime, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const raw = Array.isArray(stateFile?.sessions) ? stateFile.sessions : []
  const currentSessionId = typeof stateFile?.currentSessionId === 'string' ? stateFile.currentSessionId : null
  const activeSessionCount = Number.isFinite(stateFile?.activeSessionCount)
    ? Math.max(0, stateFile.activeSessionCount)
    : null

  const firstString = (...values) => {
    for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim()
    return null
  }
  const timeMs = (value) => {
    const t = value ? new Date(value).getTime() : NaN
    return Number.isFinite(t) ? t : null
  }

  if (raw.length === 0) {
    // 兼容：无多会话协议时退回单会话（用 status 通道信息填充）
    const state = runtime?.state ?? 'idle'
    const single = {
      sessionId: currentSessionId || runtime?.source || null,
      workspace: firstString(stateFile?.workspace) || '当前工作区',
      title: firstString(stateFile?.title) || '(当前会话)',
      state,
      tool: runtime?.tool ?? null,
      role: 'main',
      step: runtime?.step ?? null,
      lastUserMessageAt: null,
      lastUserMessageAgeMs: null,
      lastSeenAt: runtime?.heartbeatAt ?? stateFile?.updatedAt ?? null,
      lastSeenAgeMs: runtime?.heartbeatAgeMs ?? null,
      isCurrent: true,
      isBackground: false,
      label: runtime?.label ?? '空闲',
      tone: runtime?.tone ?? 'dim'
    }
    return {
      supported: false,
      currentSessionId: single.sessionId,
      activeSessionCount: activeSessionCount ?? 1,
      userActiveCount: 1,
      backgroundCount: 0,
      total: 1,
      othersCount: 0,
      groups: [
        {
          workspace: single.workspace,
          isCurrentGroup: true,
          sessions: [single]
        }
      ]
    }
  }

  const sessions = raw
    .map((item) => {
      if (!isObject(item)) return null
      const sid = firstString(item.sessionId, item.id, item.key)
      const workspace = firstString(item.workspace, item.cwd, item.workdir) || '(未知工作区)'
      const rawState = String(item.state ?? '')
        .trim()
        .toLowerCase()
      const state = RUNTIME_STATE_ALIASES[rawState.replace(/[^a-z_]/g, '')] ?? rawState
      const meta = RUNTIME_STATE_META[state] || RUNTIME_STATE_META.idle
      const role = String(item.role ?? 'main').toLowerCase()
      const lastSeenAt = firstString(item.lastSeenAt, item.lastEventAt, item.updatedAt)
      const lastSeenMs = timeMs(lastSeenAt)
      const lastUserMessageAt = firstString(item.lastUserMessageAt, item.lastUserMessage)
      const lastUserMessageMs = timeMs(lastUserMessageAt)
      return {
        sessionId: sid,
        workspace,
        title: firstString(item.title, item.name) || (sid ? sid.slice(0, 18) : '(未命名会话)'),
        state: RUNTIME_STATE_META[state] ? state : 'idle',
        tool: firstString(item.tool, item.toolName),
        role,
        step: Number.isFinite(item.step) ? item.step : null,
        lastUserMessageAt,
        lastUserMessageAgeMs: lastUserMessageMs === null ? null : Math.max(0, now - lastUserMessageMs),
        lastSeenAt,
        lastSeenAgeMs: lastSeenMs === null ? null : Math.max(0, now - lastSeenMs),
        isCurrent: Boolean(item.current) || Boolean(sid && currentSessionId && sid === currentSessionId),
        isBackground: SESSION_BACKGROUND_ROLES.has(role) || state === 'background',
        label: meta.label,
        tone: meta.tone
      }
    })
    .filter(Boolean)

  // 同一工作区聚合；组内：当前会话优先 → 最近活动倒序
  const groupMap = new Map()
  for (const session of sessions) {
    const key = session.workspace
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(session)
  }
  const groups = [...groupMap.entries()].map(([workspace, list]) => {
    const sorted = list.slice().sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return (b.lastSeenAgeMs ?? Number.MAX_SAFE_INTEGER) < (a.lastSeenAgeMs ?? Number.MAX_SAFE_INTEGER) ? -1 : 1
    })
    return {
      workspace,
      isCurrentGroup: sorted.some((s) => s.isCurrent),
      sessions: sorted
    }
  })
  groups.sort((a, b) => {
    if (a.isCurrentGroup !== b.isCurrentGroup) return a.isCurrentGroup ? -1 : 1
    const aMax = Math.max(...a.sessions.map((s) => s.lastSeenAgeMs ?? Number.MAX_SAFE_INTEGER))
    const bMax = Math.max(...b.sessions.map((s) => s.lastSeenAgeMs ?? Number.MAX_SAFE_INTEGER))
    return aMax - bMax
  })

  const userRaw = Number.isFinite(stateFile?.userActiveCount) ? Math.max(0, stateFile.userActiveCount) : null
  const backgroundRaw = Number.isFinite(stateFile?.backgroundCount) ? Math.max(0, stateFile.backgroundCount) : null
  const userSessions = sessions.filter((s) => !s.isBackground)
  const backgroundSessions = sessions.filter((s) => s.isBackground)
  const userActiveCount = userRaw ?? userSessions.length
  const backgroundCount = backgroundRaw ?? backgroundSessions.length
  const currentIsUser = sessions.some((s) => s.isCurrent && !s.isBackground)
  const total = sessions.length
  return {
    supported: true,
    currentSessionId,
    activeSessionCount: activeSessionCount ?? total,
    userActiveCount,
    backgroundCount,
    total,
    // 「另有 N 个对话在跑」只算真人会话（不含团队/子代理后台）
    othersCount: Math.max(0, userActiveCount - (currentIsUser ? 1 : 0)),
    groups
  }
}

// ────────────────────────────── 日志解析 ──────────────────────────────

/**
 * Phase-1：读事件环形缓冲 `events.json`（tech-scout DATA-CONTRACT §3）。
 * 只读取标量摘要（无对话原文/路径）；返回**最新在前**的 items。
 * @param {string} file events.json 路径
 * @param {number} [limit] 最多返回条数（默认 50）
 * @returns {{supported:boolean,file:string,total:number,unread:number,items:Array<object>}}
 */
export function readEvents(file, limit = 50) {
  const raw = readJson(file, null)
  const list = Array.isArray(raw?.events) ? raw.events : []
  const items = list
    .slice(-Math.max(1, Math.min(500, limit)))
    .reverse()
    .map((item) => ({
      at: typeof item?.at === 'string' ? item.at : null,
      kind: typeof item?.kind === 'string' ? item.kind : 'event',
      level: typeof item?.level === 'string' ? item.level : null,
      payload: clip(item?.payload, 120),
      said: Boolean(item?.said),
      unread: Boolean(item?.unread)
    }))
  return {
    supported: list.length > 0,
    file,
    total: list.length,
    unread: list.filter((item) => item?.unread).length,
    // P0（task-58/M3）：S0 未读（等你选/审批类）供主页「她现在需要你」卡片与 overlay 红点
    s0Unread: list.filter((item) => item?.unread && String(item?.level || '').toUpperCase() === 'S0').length,
    items
  }
}

/**
 * Phase-1：情绪状态（v2.companion 优先含 words；companionFile 兜底无 words）。
 * @param {object|null} stateFile v2 快照
 * @param {string} file companion.json 路径
 * @returns {{supported:boolean,words:{mood:string,energy:string,affinity:string}|null,level:string|null,streakDays:number|null,totals:object|null,lastSeenAt:string|null,updatedAt:string|null}}
 */
export function readCompanion(stateFile, file) {
  const fromV2 = isObject(stateFile?.companion) ? stateFile.companion : null
  const raw = fromV2 ?? readJson(file, null)
  if (!isObject(raw)) {
    return {
      supported: false,
      words: null,
      level: null,
      streakDays: null,
      totals: null,
      lastSeenAt: null,
      updatedAt: null
    }
  }
  const words = isObject(raw.words)
    ? {
        mood: String(raw.words.mood ?? '—'),
        energy: String(raw.words.energy ?? '—'),
        affinity: String(raw.words.affinity ?? '—')
      }
    : null
  return {
    supported: true,
    words,
    level: typeof raw.level === 'string' ? raw.level : null,
    streakDays: Number.isFinite(raw.streakDays) ? raw.streakDays : null,
    totals: isObject(raw.totals) ? raw.totals : null,
    lastSeenAt: typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
  }
}
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
      resolve({
        online,
        latencyMs: Date.now() - started,
        error: error ?? null
      })
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

/**
 * task-58/62：团队/目标/计划/等你选数据归一。
 *
 * 数据源优先级：**v2 字段（tech-scout task-57）→ host 只读投影 fallback → 未启用**。
 * 返回结构对两种来源同构，面板只按 `status` 三级降级展示（ok/empty/degraded/unsupported）。
 *
 * @param {object|null} stateFile v2 快照（stateFile.team/goal/plan/userQuestions）
 * @param {object|null} hostSnapshot host fallback（createHostBridge().teamInfo() 结果；已归一同构）
 * @returns {{source:'v2'|'host'|null,status:string,reason:string|null,enabled:boolean,
 *   team:{status:string,members:{total:number,active:number,failed:number},
 *         tasks:{total:number,pending:number,in_progress:number,completed:number,blocked:number,ready:number,progress:number|null},
 *         updatedAt:string|null},
 *   goal:{active:boolean,status:string|null,roundsStarted:number|null},
 *   plan:{active:boolean,pending:number},
 *   userQuestions:{active:number,sentCount:number}}}
 */
export function normalizeTeamFeatures(stateFile, hostSnapshot) {
  const emptyTaskCounts = () => ({
    total: 0,
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    ready: 0,
    progress: null
  })
  const emptyMembers = () => ({ total: 0, active: 0, failed: 0 })
  const asCount = (value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)
  const base = {
    source: null,
    status: 'unsupported',
    reason: 'no-team-data',
    enabled: false,
    team: { status: 'unsupported', members: emptyMembers(), tasks: emptyTaskCounts(), updatedAt: null },
    goal: { active: false, status: null, roundsStarted: null },
    plan: { active: false, pending: 0 },
    userQuestions: { active: 0, sentCount: 0 }
  }

  // ① v2 优先（tech-scout task-57 形状：team:{enabled,status,members,tasks} goal/plan/userQuestions）
  if (isObject(stateFile?.team)) {
    const t = stateFile.team
    const members = isObject(t.members) ? t.members : {}
    const tasks = isObject(t.tasks) ? t.tasks : {}
    const status = ['ok', 'empty', 'degraded', 'unsupported'].includes(t.status) ? t.status : 'ok'
    const goalIn = isObject(stateFile?.goal) ? stateFile.goal : {}
    const planIn = isObject(stateFile?.plan) ? stateFile.plan : {}
    const qIn = isObject(stateFile?.userQuestions) ? stateFile.userQuestions : {}
    const progress = Number.isFinite(tasks.progress) ? tasks.progress : null
    return {
      source: 'v2',
      status,
      reason:
        status === 'degraded'
          ? Array.isArray(stateFile?.degraded)
            ? clip(stateFile.degraded.join(','), 160)
            : 'degraded'
          : null,
      enabled: t.enabled !== false,
      team: {
        status,
        members: { total: asCount(members.total), active: asCount(members.active), failed: asCount(members.failed) },
        tasks: {
          total: asCount(tasks.total),
          pending: asCount(tasks.pending),
          in_progress: asCount(tasks.in_progress),
          completed: asCount(tasks.completed),
          blocked: asCount(tasks.blocked),
          ready: asCount(tasks.ready),
          progress
        },
        updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : null
      },
      goal: {
        active: Boolean(goalIn.active),
        status: typeof goalIn.status === 'string' ? goalIn.status : null,
        roundsStarted: Number.isFinite(goalIn.roundsStarted) ? goalIn.roundsStarted : null
      },
      plan: { active: Boolean(planIn.active), pending: asCount(planIn.pending) },
      userQuestions: { active: asCount(qIn.active), sentCount: asCount(qIn.sentCount) }
    }
  }

  // ② host 只读 fallback（createHostBridge 已归一为同构；不可用 → 未启用/降级）
  if (isObject(hostSnapshot)) {
    const status = ['ok', 'empty', 'degraded', 'unsupported'].includes(hostSnapshot.status)
      ? hostSnapshot.status
      : 'degraded'
    const hostTeam = isObject(hostSnapshot.team) ? hostSnapshot.team : {}
    const hostGoal = isObject(hostSnapshot.goal) ? hostSnapshot.goal : {}
    const hostPlan = isObject(hostSnapshot.plan) ? hostSnapshot.plan : {}
    const hostQuestions = isObject(hostSnapshot.userQuestions) ? hostSnapshot.userQuestions : {}
    return {
      source: 'host',
      status,
      reason: typeof hostSnapshot.reason === 'string' ? hostSnapshot.reason : null,
      enabled: status === 'ok' || status === 'empty',
      team: {
        status: typeof hostTeam.status === 'string' ? hostTeam.status : status,
        members: {
          total: asCount(hostTeam.members?.total),
          active: asCount(hostTeam.members?.active),
          failed: asCount(hostTeam.members?.failed)
        },
        tasks: {
          total: asCount(hostTeam.tasks?.total),
          pending: asCount(hostTeam.tasks?.pending),
          in_progress: asCount(hostTeam.tasks?.in_progress),
          completed: asCount(hostTeam.tasks?.completed),
          blocked: asCount(hostTeam.tasks?.blocked),
          ready: asCount(hostTeam.tasks?.ready),
          progress: Number.isFinite(hostTeam.tasks?.progress) ? hostTeam.tasks.progress : null
        },
        updatedAt: typeof hostTeam.updatedAt === 'string' ? hostTeam.updatedAt : null
      },
      goal: {
        active: Boolean(hostGoal.active),
        status: typeof hostGoal.status === 'string' ? hostGoal.status : null,
        roundsStarted: Number.isFinite(hostGoal.roundsStarted) ? hostGoal.roundsStarted : null
      },
      plan: { active: Boolean(hostPlan.active), pending: asCount(hostPlan.pending) },
      userQuestions: { active: asCount(hostQuestions.active), sentCount: asCount(hostQuestions.sentCount) }
    }
  }

  return base
}

/**
 * 给可能挂起的宿主调用加超时（task-58：投影/会话服务在未就绪时不许阻塞面板）。
 * @template T
 * @param {Promise<T>|T} value promise 或同步值
 * @param {number} ms 超时毫秒
 * @param {T} fallback 超时/异常时的回退值
 * @returns {Promise<T>}
 */
async function withTimeout(value, ms, fallback) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve(value).catch(() => fallback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * host 侧只读团队数据桥（task-58）：`ctx.sessionProjections.snapshot()` + `sessionController.list()`。
 * 服务通过 `ctx.inject(['sessionController','sessionProjections'], scope => bridge.setScope(scope))` 注入；
 * **10s 缓存、低频只读、不写盘**；服务缺失/异常一律返回 status=unsupported/degraded，绝不抛错。
 * @param {any} log logger
 * @returns {{setScope: (scope:any)=>void, teamInfo: (opts?: {currentSessionId?: string|null}) => Promise<object>}}
 */
function createHostBridge(log, evidenceDir) {
  const cache = { at: 0, key: null, value: null }
  const TTL = 10000
  let scopeRef = null
  const memberActive = (status) =>
    ['in_progress', 'active', 'working', 'running'].includes(String(status || '').toLowerCase())
  /** 调试证据：桥失败时写下服务形状（仅属性名，不含数据/隐私），供 verifier 定位。 */
  const shape = (obj) => {
    try {
      const names = new Set()
      let current = obj
      let depth = 0
      while (current && depth < 2) {
        Object.getOwnPropertyNames(current).forEach((name) => names.add(name))
        current = Object.getPrototypeOf(current)
        depth += 1
      }
      return [...names].slice(0, 80)
    } catch {
      return []
    }
  }
  const writeDebug = (info) => {
    if (!evidenceDir) return
    try {
      writeJsonAtomic(path.join(evidenceDir, 'ui-team-debug.json'), {
        at: new Date().toISOString(),
        ...info
      })
    } catch {
      /* ignore */
    }
  }

  return {
    setScope(scope) {
      scopeRef = scope
      cache.at = 0 // 服务就绪后立即失效缓存，下一次 state.get 走真实数据
    },
    async teamInfo(opts = {}) {
      const key = String(opts.currentSessionId || '')
      if (Date.now() - cache.at < TTL && cache.key === key) return cache.value
      let value
      try {
        // 服务必须经 ctx.inject 注入后从 scope 取（直接 ctx.xxx 会报 without inject）
        const controller =
          (scopeRef && scopeRef.sessionController) ||
          (typeof scopeRef?.get === 'function' ? scopeRef.get('sessionController') : null)
        const projections =
          (scopeRef && scopeRef.sessionProjections) ||
          (typeof scopeRef?.get === 'function' ? scopeRef.get('sessionProjections') : null)
        if (
          !controller ||
          !projections ||
          typeof controller.list !== 'function' ||
          typeof projections.snapshot !== 'function'
        ) {
          value = { status: 'unsupported', reason: 'projection-service-not-injected' }
        } else {
          // 优先同步读 listState 快照（client 同款 store：getSnapshot() → {byId,...}）；
          // remote list() 在部分宿主态会挂起，仅作兜底（3s 超时）。
          let list = null
          let listSource = 'none'
          try {
            const store = controller.listState
            const snap =
              typeof store?.getSnapshot === 'function' ? store.getSnapshot() : (store?.state ?? store?.value ?? store)
            if (snap && typeof snap === 'object') {
              if (snap.byId && typeof snap.byId === 'object') list = Object.values(snap.byId)
              else if (Array.isArray(snap)) list = snap
              else if (Array.isArray(snap.sessions)) list = snap.sessions
              else if (Array.isArray(snap.list)) list = snap.list
              if (Array.isArray(list)) listSource = 'listState'
            }
          } catch {
            list = null
          }
          let listMs = 0
          if (!list) {
            const listStarted = Date.now()
            let rawList = null
            let listFailure = null
            try {
              rawList = await withTimeout(controller.list(), 1200, null)
            } catch (error) {
              listFailure = clip(error?.message ?? String(error), 120)
            }
            listMs = Date.now() - listStarted
            list = Array.isArray(rawList) ? rawList : Array.isArray(rawList?.sessions) ? rawList.sessions : []
            if (listFailure !== null) {
              writeDebug({
                stage: 'list-error',
                ms: listMs,
                error: listFailure,
                listStateKeys: shape(controller.listState),
                controllerKeys: shape(controller)
              })
            } else if (!rawList) {
              writeDebug({
                stage: 'list-timeout',
                ms: listMs,
                listStateKeys: shape(controller.listState),
                controllerKeys: shape(controller)
              })
            }
          }
          const session =
            list.find((item) => item && String(item.sessionId) === key) ||
            list.find((item) => item && item.running) ||
            list[0]
          if (!list || list.length === 0) {
            value = { status: 'empty', reason: 'no-session' }
            writeDebug({ stage: 'no-session', listSource, listMs, listStateKeys: shape(controller.listState) })
          } else if (!session) {
            value = { status: 'empty', reason: 'no-session' }
            writeDebug({ stage: 'no-session', listSource, listLength: list.length })
          } else {
            const rawSnap = projections.snapshot(session, ['agentTeam', 'goal', 'plan', 'userQuestions'])
            const snap = rawSnap && typeof rawSnap.then === 'function' ? await rawSnap : rawSnap
            const values = snap?.values ?? snap ?? {}
            const team = values.agentTeam
            if (!isObject(team)) {
              value = { status: 'unsupported', reason: 'agent-team-projection-missing' }
            } else if (team.failure) {
              value = { status: 'degraded', reason: clip(String(team.failure), 160) }
            } else {
              const members = Array.isArray(team.members) ? team.members : []
              const tasks = Array.isArray(team.tasks) ? team.tasks : []
              const byStatus = (name) => tasks.filter((task) => task && task.status === name).length
              const completed = byStatus('completed')
              const cumulative = {
                total: tasks.length,
                pending: byStatus('pending'),
                in_progress: byStatus('in_progress'),
                completed,
                blocked: byStatus('blocked')
              }
              const ready = tasks.filter(
                (task) =>
                  task &&
                  task.status === 'pending' &&
                  Array.isArray(task.blockedBy) &&
                  task.blockedBy.every(
                    (id) => tasks.find((candidate) => candidate && candidate.id === id)?.status === 'completed'
                  )
              ).length
              const goalRaw = values.goal
              const goalState = isObject(goalRaw?.goal) ? goalRaw.goal : goalRaw
              const planRaw = isObject(values.plan) ? values.plan : {}
              const questionsRaw = isObject(values.userQuestions) ? values.userQuestions : {}
              value = {
                status: tasks.length === 0 && members.length <= 1 ? 'empty' : 'ok',
                reason: null,
                team: {
                  status: tasks.length === 0 && members.length <= 1 ? 'empty' : 'ok',
                  members: {
                    total: members.length,
                    active: members.filter((member) => memberActive(member?.status)).length,
                    failed: members.filter((member) => String(member?.status || '').toLowerCase() === 'failed').length
                  },
                  tasks: { ...cumulative, ready, progress: tasks.length > 0 ? completed / tasks.length : null },
                  updatedAt: null
                },
                goal: {
                  active: Boolean(goalState && goalState.phase),
                  status: typeof goalState?.phase === 'string' ? goalState.phase : null,
                  roundsStarted: Number.isFinite(goalState?.roundsStarted) ? goalState.roundsStarted : null
                },
                plan: {
                  active: Boolean(planRaw.active),
                  pending: Array.isArray(planRaw.pending)
                    ? planRaw.pending.length
                    : Number.isFinite(planRaw.pending)
                      ? planRaw.pending
                      : 0
                },
                userQuestions: {
                  active: Array.isArray(questionsRaw.active) ? questionsRaw.active.length : 0,
                  sentCount: Array.isArray(questionsRaw.settled) ? questionsRaw.settled.length : 0
                }
              }
            }
          }
        }
      } catch (error) {
        log?.warn?.(`[pet-bridge-ui] team fallback 读取失败: ${error?.message ?? error}`)
        value = { status: 'degraded', reason: clip(error?.message ?? String(error), 160) }
      }
      cache.at = Date.now()
      cache.key = key
      cache.value = value
      return value
    }
  }
}

function buildHandler(cfg, log, hostBridge = null) {
  const probeProcess = makeProcessProbe(cfg.processProbeTtlMs)
  const stateCache = { at: 0, value: null }

  /**
   * 读联动插件状态快照：**`bridge-state-v2.json`（v33+ 真源）优先 → `state.json` 兜底**。
   * 旧 state.json 曾在 v26~v31 泄漏定时器持续覆盖，故仅在 v2 缺失时回退。
   * @returns {object|null} 归一后的状态对象（附 `_source`/`_file`/`_fresh`/`_ageMs`）
   */
  function loadStateFile() {
    if (Date.now() - stateCache.at < 2000) return stateCache.value
    let value = null
    const candidates = [
      ['v2', cfg.stateV2File],
      ['legacy', cfg.stateFile]
    ]
    for (const [source, file] of candidates) {
      const raw = readJson(file, null)
      if (!isObject(raw)) continue
      const at = raw.updatedAt ? new Date(raw.updatedAt) : null
      const ageMs = at && !Number.isNaN(at.getTime()) ? Date.now() - at.getTime() : null
      value = {
        ...raw,
        _ageMs: ageMs,
        _fresh: ageMs !== null && ageMs < cfg.stateFileTtlMs,
        _source: source,
        _file: file
      }
      break
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
          guards: isObject(ui.guards) ? ui.guards : null,
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
    const runtime = normalizeRuntimeStatus(stateFile, {
      staleMs: cfg.runtimeStaleMs
    })
    // task-46：多会话视图（按工作区分组；无 sessions 时退回单会话）
    const sessionList = normalizeSessions(stateFile, runtime)
    // Phase-1：今日统计（v2.today，跨天自动重置）、事件时间线、情绪状态
    const todayV2 = isObject(stateFile?.today) ? stateFile.today : null
    const todayStats = {
      date: typeof todayV2?.date === 'string' ? todayV2.date : dateKey(),
      turns: Number.isFinite(todayV2?.turns) ? todayV2.turns : null,
      toolCalls: Number.isFinite(todayV2?.toolCalls) ? todayV2.toolCalls : null,
      longestTurnMs: Number.isFinite(todayV2?.longestTurnMs) ? todayV2.longestTurnMs : null,
      calls: Number.isFinite(todayV2?.calls) ? todayV2.calls : todayCalls,
      costYuan: Number.isFinite(todayV2?.costYuan) ? todayV2.costYuan : todayCost,
      budgetYuan: Number.isFinite(todayV2?.budgetYuan) ? todayV2.budgetYuan : effective.budgetPerDayYuan,
      // task-51/白饭报账（v37）：token、白饭碗数（1 碗 = 10 万 token）、峰谷时段
      tokens: Number.isFinite(todayV2?.tokens) ? todayV2.tokens : null,
      riceBowls: Number.isFinite(todayV2?.riceBowls)
        ? todayV2.riceBowls
        : Number.isFinite(todayV2?.tokens)
          ? Math.round((todayV2.tokens / 100000) * 10) / 10
          : null,
      period: typeof todayV2?.period === 'string' ? todayV2.period : null,
      // 两本账分开：桌宠说话花费（1 元预算环） vs 用户 token 估算（自定价）
      petLlmCostYuan: Number.isFinite(todayV2?.petLlmCostYuan)
        ? todayV2.petLlmCostYuan
        : Number.isFinite(todayV2?.costYuan)
          ? todayV2.costYuan
          : todayCost,
      estimateCostYuan: Number.isFinite(todayV2?.costYuan) ? todayV2.costYuan : todayCost,
      // v46 三本账 + token 拆分（你的 / 团队的 / 她说话）
      tokensUser: Number.isFinite(todayV2?.tokensUser) ? todayV2.tokensUser : null,
      tokensAgent: Number.isFinite(todayV2?.tokensAgent) ? todayV2.tokensAgent : null,
      costUserYuan: Number.isFinite(todayV2?.costUserYuan) ? todayV2.costUserYuan : null,
      costAgentYuan: Number.isFinite(todayV2?.costAgentYuan) ? todayV2.costAgentYuan : null,
      agentCalls: Number.isFinite(todayV2?.agentCalls) ? todayV2.agentCalls : null,
      ratio: 0,
      source: todayV2 ? 'v2' : 'legacy'
    }
    todayStats.ratio =
      todayStats.budgetYuan > 0 ? Math.min(1, (todayStats.petLlmCostYuan || 0) / todayStats.budgetYuan) : 0
    const events = readEvents(cfg.eventsFile)
    if (Number.isFinite(stateFile?.eventsUnread)) events.unread = stateFile.eventsUnread
    const companion = readCompanion(stateFile, cfg.companionFile)
    const interactions = isObject(stateFile?.capabilities?.interactions)
      ? {
          head: stateFile.capabilities.interactions.head === true,
          feed: stateFile.capabilities.interactions.feed === true,
          come: stateFile.capabilities.interactions.come === true
        }
      : { head: false, feed: false, come: false }
    // task-51：活跃度护栏（ui-config.guards；缺省用默认值，热更新由联动插件 watcher 应用）
    const guards = {
      ...GUARD_DEFAULTS,
      ...(isObject(ui?.guards) ? ui.guards : {})
    }
    // task-58：团队/目标/计划/等你选（v2 字段优先 → host 只读投影 fallback → 未启用；三级降级）
    let hostTeamSnapshot = null
    if (hostBridge && typeof hostBridge.teamInfo === 'function') {
      try {
        hostTeamSnapshot = await withTimeout(
          hostBridge.teamInfo({ currentSessionId: stateFile?.currentSessionId ?? null }),
          3000,
          { status: 'degraded', reason: 'team-bridge-timeout' }
        )
      } catch {
        hostTeamSnapshot = { status: 'degraded', reason: 'team-bridge-error' }
      }
    }
    const teamFeatures = normalizeTeamFeatures(stateFile, hostTeamSnapshot)
    // 验证用证据（M2）：host fallback 是否生效（30s 节流；只含计数/状态，无隐私字段）
    if (hostBridge && Date.now() - (stateCache.teamEvidenceAt || 0) > 30000) {
      stateCache.teamEvidenceAt = Date.now()
      try {
        writeJsonAtomic(path.join(cfg.evidenceDir, 'ui-team-preview.json'), {
          at: new Date().toISOString(),
          source: teamFeatures.source,
          status: teamFeatures.status,
          reason: teamFeatures.reason,
          team: teamFeatures.team,
          goal: teamFeatures.goal,
          plan: teamFeatures.plan,
          userQuestions: teamFeatures.userQuestions
        })
      } catch {
        /* 证据写失败不影响面板 */
      }
    }

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
        sessionList,
        capabilities: {
          petActions: Object.keys(PET_ACTION_CMDS).filter((k) => petActionReadiness[k] !== false),
          petActionReadiness,
          doubleClick: petActionReadiness.doubleClick !== false,
          autoStart: petActionReadiness.autoStart !== false,
          quit: petActionReadiness.quit !== false,
          interactions
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
        todayStats,
        events,
        companion,
        guards,
        teamFeatures,
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
          stateV2File: cfg.stateV2File,
          eventsFile: cfg.eventsFile,
          companionFile: cfg.companionFile,
          stateSource: stateFile?._source ?? null,
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
        return {
          ok: false,
          error: { code: 'invalid-argument', message: 'enabled 必须是布尔值' }
        }
      }
      next.enabled = payload.enabled
    }

    if (payload?.activity !== undefined) {
      const level = String(payload.activity ?? '').toLowerCase()
      if (!ACTIVITY_LEVELS.includes(level)) {
        return {
          ok: false,
          error: {
            code: 'invalid-argument',
            message: `activity 只能是 ${ACTIVITY_LEVELS.join(' / ')}`
          }
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
          error: {
            code: 'invalid-argument',
            message: 'quietHours 必须是字符串数组，如 ["23:30-08:00"]'
          }
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
        return {
          ok: false,
          error: {
            code: 'invalid-argument',
            message: '每日上限应是 0~10000 之间的数字（元）'
          }
        }
      }
      next.llm = {
        ...(isObject(next.llm) ? next.llm : {}),
        budgetPerDayYuan: n
      }
    }

    if (payload?.guards !== undefined) {
      if (!isObject(payload.guards)) {
        return { ok: false, error: { code: 'invalid-argument', message: 'guards 必须是对象' } }
      }
      const current = isObject(next.guards) ? next.guards : { ...GUARD_DEFAULTS }
      const nextGuards = { ...current }
      if (payload.guards.maxActionsPerHour !== undefined) {
        const n = Number(payload.guards.maxActionsPerHour)
        if (!Number.isFinite(n) || n < 1 || n > 600) {
          return {
            ok: false,
            error: { code: 'invalid-argument', message: '每小时动作上限应在 1~600 之间' }
          }
        }
        nextGuards.maxActionsPerHour = Math.round(n)
      }
      if (payload.guards.noActionOnSameState !== undefined) {
        if (typeof payload.guards.noActionOnSameState !== 'boolean') {
          return {
            ok: false,
            error: { code: 'invalid-argument', message: 'noActionOnSameState 必须是布尔值' }
          }
        }
        nextGuards.noActionOnSameState = payload.guards.noActionOnSameState
      }
      next.guards = nextGuards
    }

    if (payload?.pet !== undefined) {
      const currentPet = isObject(next.pet) ? next.pet : {}
      const norm = normalizePetSettings(payload.pet, currentPet)
      if (norm.error) {
        return {
          ok: false,
          error: { code: 'invalid-argument', message: norm.error }
        }
      }
      next.pet = norm.value
      // 协议支持即时生效的项：cmd:config 批量下发（桌宠 v10 补丁已支持）
      const cmds = petSettingsToCmds(payload.pet)
      if (cmds.length > 0) {
        const results = []
        for (const line of cmds) {
          const r = await sendPipeLine(cfg.pipe, line)
          results.push({
            cmd: line.slice(0, 80) + (line.length > 80 ? '…' : ''),
            ok: r.ok
          })
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
      return {
        ok: false,
        error: { code: 'write-failed', message: clip(error?.message, 200) }
      }
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
      return {
        ok: false,
        error: { code: 'write-failed', message: clip(error?.message, 200) }
      }
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
      'quit-pet',
      // Phase-1：互动（DATA-CONTRACT §4）与事件未读确认
      'interact-head',
      'interact-feed',
      'interact-come',
      'events-ack'
    ]
    const name = String(payload?.name ?? '')
    if (!SUPPORTED.includes(name)) {
      return {
        ok: false,
        error: {
          code: 'invalid-argument',
          message: `不支持的动作：${name}（支持 ${SUPPORTED.join(' / ')}）`
        }
      }
    }
    const existing = readJson(cfg.actionFile, null)
    if (isObject(existing) && existing.id && !existing.handledAt) {
      return {
        ok: false,
        error: {
          code: 'busy',
          message: `上一条动作尚未执行完成（${existing.name ?? '?'}），请稍后再试`
        }
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
      return {
        ok: false,
        error: { code: 'write-failed', message: clip(error?.message, 200) }
      }
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
   * Phase-1 互动（DATA-CONTRACT §4）：头/喂/叫她 → 统一走 `ui-action.json`
   * （`interact-head` / `interact-feed` / `interact-come`，由联动插件做节流与冷却）。
   * @param {object} payload `{name: 'head'|'feed'|'come'}`
   * @returns {{ok:true,data:{queued:boolean,request:object,note:string}}|{ok:false,error:object}}
   */
  function interaction(payload) {
    const name = String(payload?.name ?? '')
    const map = { head: 'interact-head', feed: 'interact-feed', come: 'interact-come' }
    const action = map[name]
    if (!action) {
      return {
        ok: false,
        error: { code: 'invalid-argument', message: `未知互动：${name}（支持 head / feed / come）` }
      }
    }
    const stateFile = loadStateFile()
    const caps = isObject(stateFile?.capabilities?.interactions) ? stateFile.capabilities.interactions : null
    if (!caps || caps[name] !== true) {
      return {
        ok: false,
        error: {
          code: 'not-supported',
          message: `互动「${name}」尚未就绪（待联动插件 v35+ capabilities.interactions）`
        }
      }
    }
    return requestAction({ name: action })
  }

  /** Phase-1：事件未读确认（`ui-action: events-ack` → unread 全置 false）。 */
  function ackEvents() {
    return requestAction({ name: 'events-ack' })
  }
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
      return {
        ok: false,
        error: {
          code: 'not-supported',
          message: `桌宠协议尚未支持「${name}」（待服务端）`
        }
      }
    }
    const r = await sendPipeCommand(cfg.pipe, line)
    const reply = String(r.reply ?? '')
    if (!r.ok) {
      return {
        ok: false,
        error: {
          code: 'pipe-unavailable',
          message: `管道不可写（${r.error ?? '未知原因'}）`
        }
      }
    }
    if (/^unknowncmd:/.test(reply)) {
      log.info(`[pet-bridge-ui] pet.action ${name} not-supported reply=${clip(reply, 80)}`)
      return {
        ok: false,
        error: {
          code: 'not-supported',
          message: `桌宠暂不支持该命令（${clip(reply, 80)}），待服务端升级`
        }
      }
    }
    if (/-fail$/.test(reply)) {
      log.info(`[pet-bridge-ui] pet.action ${name} failed reply=${clip(reply, 80)}`)
      return {
        ok: false,
        error: {
          code: 'pet-error',
          message: `桌宠执行失败：${clip(reply, 120)}`
        }
      }
    }
    log.info(`[pet-bridge-ui] pet.action ${name} ok reply=${clip(reply, 80)}`)
    return { ok: true, data: { name, cmd: line, reply } }
  }

  async function runTest(kind, payload) {
    if (kind === 'say') {
      const text = clip(payload?.text ?? '测试一下：我在这儿呢。', 60)
      if (!text)
        return {
          ok: false,
          error: { code: 'invalid-argument', message: '台词不能为空' }
        }
      const r = await sendPipeLine(cfg.pipe, `say:${text}`)
      log.info(`[pet-bridge-ui] test say sent=${r.ok} chars=${text.length}`)
      return r.ok
        ? { ok: true, data: { sent: true, line: text } }
        : {
            ok: false,
            error: {
              code: 'pipe-unavailable',
              message: `管道不可写（${r.error ?? '未知原因'}）`
            }
          }
    }
    if (kind === 'jump') {
      const r = await sendPipeLine(cfg.pipe, 'act:jump')
      log.info(`[pet-bridge-ui] test jump sent=${r.ok}`)
      return r.ok
        ? { ok: true, data: { sent: true, action: 'jump' } }
        : {
            ok: false,
            error: {
              code: 'pipe-unavailable',
              message: `管道不可写（${r.error ?? '未知原因'}）`
            }
          }
    }
    if (kind === 'screenshot') {
      const shot = await takeScreenshot(cfg.evidenceDir)
      log.info(`[pet-bridge-ui] test screenshot ok=${shot.ok}${shot.ok ? ` bytes=${shot.bytes}` : ''}`)
      return shot.ok ? { ok: true, data: shot } : { ok: false, error: { code: shot.error, message: shot.message } }
    }
    return {
      ok: false,
      error: { code: 'unknown-endpoint', message: `未知测试动作：${kind}` }
    }
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
        return {
          ok: true,
          data: {
            pong: true,
            version: PLUGIN_VERSION,
            now: new Date().toISOString()
          }
        }
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
      case 'interaction':
        return interaction(payload)
      case 'events.ack':
        return ackEvents()
      case 'pet.nativeui': {
        // 应急：临时显示/隐藏桌宠原生菜单（v10 默认隐藏；task-32 §B 的应急通道）
        const on = payload?.on !== false
        const r = await sendPipeLine(cfg.pipe, `cmd:nativeui:${on ? 'on' : 'off'}`)
        log.info(`[pet-bridge-ui] nativeui ${on ? 'on' : 'off'} sent=${r.ok}`)
        return r.ok
          ? {
              ok: true,
              data: {
                on,
                note: on ? '原生菜单已临时显示；用完建议关掉' : '原生菜单已隐藏'
              }
            }
          : {
              ok: false,
              error: {
                code: 'pipe-unavailable',
                message: `管道不可写（${r.error ?? '未知原因'}）`
              }
            }
      }
      case 'test.say':
        return runTest('say', payload)
      case 'test.jump':
        return runTest('jump', payload)
      case 'test.screenshot':
        return runTest('screenshot', payload)
      default:
        return {
          ok: false,
          error: { code: 'unknown-endpoint', message: `未知端点：${endpoint}` }
        }
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

  // task-58：团队/计划数据桥（服务经 ctx.inject 注入；缺失时面板降级为「未启用」，不影响路由）
  const hostBridge = createHostBridge(log, cfg.evidenceDir)
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['sessionController', 'sessionProjections'], (scope) => {
        hostBridge.setScope(scope)
        log.info('[pet-bridge-ui] team bridge ready（sessionController + sessionProjections 只读投影）')
      })
    } catch (error) {
      log.warn(`[pet-bridge-ui] team bridge inject 失败（降级为未启用）: ${error?.message ?? error}`)
    }
  }
  const handler = buildHandler(cfg, log, hostBridge)

  ctx.inject(['connection', 'webServer'], (scope) => {
    const server = scope.get('webServer')
    const connection = scope.get('connection')
    /**
     * task-51：大肥鱼主页（自包含 HTML，同源鉴权沿用 GET 路由栅栏）。
     * @param {any} req
     * @param {any} res
     */
    const serveHome = (req, res) => {
      const html = renderHomeHtml()
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      res.end(html)
    }
    const dispose = mountWebRoute({
      webServer: server,
      connection,
      channel: cfg.channel,
      handler,
      log,
      getRoutes: {
        [cfg.channel + '/home']: serveHome
      }
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
    // task-58 自检：加载后触发一次只读 state.get，验证 host 投影桥并写入 evidence/ui-team-preview.json
    setTimeout(() => {
      handler('state.get').catch(() => {})
    }, 1500)
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
  readEvents,
  readCompanion,
  renderHomeHtml,
  normalizeRuntimeStatus,
  normalizeSessions,
  normalizeTeamFeatures,
  createHostBridge,
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
