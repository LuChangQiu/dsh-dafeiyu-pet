/**
 * v47 控制模式：active / focus（专注）/ silent（静一静）/ off（下班）。
 *
 * 语义：
 *   active  正常联动
 *   focus   钉住不散步、锁位置、动作最小、不冒泡；只保留 S0（审批 / 等你选）；LLM 只服务 S0
 *   silent  不动作不说话（联络统计照常，v2 面板可见）
 *   off     停止联动（桌宠进程保留、不做任何演出），到点自动恢复
 *
 * 纯函数、无依赖：`lib/index.js` 与 `scripts/test-mode.mjs` 共用。
 */

export const MODE_KINDS = ['active', 'focus', 'silent', 'off']

/** 文案/历史值别名（easy：UI 按钮"静一静" → silent；旧 pet.mode='still' → focus）。 */
export const MODE_ALIASES = {
  quiet: 'silent',
  still: 'focus',
  rest: 'off',
  sleep: 'off',
  normal: 'active',
  on: 'active'
}

export const MODE_LABELS = { active: '正常', focus: '专注', silent: '静一静', off: '下班' }

export const DEFAULT_MODE_DEFAULTS = {
  focusMs: 50 * 60 * 1000, // 专注 50 分钟（ui-config.mode.focusMinutes 默认 50）
  silentMs: 30 * 60 * 1000, // 静一静 30 分钟
  offUntilHour: 8 // 下班默认到明早 8:00（可被 ui-config.mode.offUntil / mode-off.until 覆盖）
}

/** 归一到合法 kind；未知/空 → active。 */
export function normalizeKind(kind) {
  const k = String(kind == null ? '' : kind)
    .trim()
    .toLowerCase()
  if (!k) return 'active'
  if (MODE_KINDS.includes(k)) return k
  return MODE_ALIASES[k] || 'active'
}

/** 展示标签。 */
export function modeLabel(kind) {
  return MODE_LABELS[normalizeKind(kind)] || MODE_LABELS.active
}

/**
 * kind + 时长 → 恢复时间戳。
 * @param {string} kind
 * @param {object} defaults {focusMs,silentMs,offUntilHour}
 * @param {number} durationMs 显式时长（0/未给 = 按 kind 默认）
 * @param {Date|number} now
 * @returns {number} 恢复到 active 的 epoch ms；active 本身为 0
 */
export function resolveResumeAt(kind, defaults = DEFAULT_MODE_DEFAULTS, durationMs = 0, now = new Date()) {
  const k = normalizeKind(kind)
  if (k === 'active') return 0
  const d = { ...DEFAULT_MODE_DEFAULTS, ...(defaults || {}) }
  const ms = Number(durationMs)
  if (Number.isFinite(ms) && ms > 0) return Number(now) + Math.floor(ms)
  if (k === 'focus') return Number(now) + Math.max(1000, Number(d.focusMs) || DEFAULT_MODE_DEFAULTS.focusMs)
  if (k === 'silent') return Number(now) + Math.max(1000, Number(d.silentMs) || DEFAULT_MODE_DEFAULTS.silentMs)
  // off：到下一个 offUntilHour 整点
  const hour = Math.max(0, Math.min(23, Number(d.offUntilHour ?? 8)))
  const at = new Date(Number(now))
  at.setHours(hour, 0, 0, 0)
  if (at.getTime() <= Number(now)) at.setDate(at.getDate() + 1)
  return at.getTime()
}

/** 对外视图（v2 `mode` 字段 / 面板倒计时）。 */
export function modeView(state, nowMs = Date.now()) {
  const kind = normalizeKind(state && state.kind)
  const resumeAt = Number((state && state.resumeAt) || 0)
  const active = kind !== 'active'
  return {
    active,
    kind,
    label: modeLabel(kind),
    remainMs: active && resumeAt > 0 ? Math.max(0, resumeAt - Number(nowMs)) : 0,
    resumeAt: active && resumeAt > 0 ? new Date(resumeAt).toISOString() : null,
    since: (state && state.since) || null
  }
}

/**
 * "到明早 8:00"/ISO/HH:MM → 距现在多少 ms。
 * @param {string|number} until 'HH:MM' / ISO 时间 / null
 * @param {Date|number} now
 * @returns {number} >0 的毫秒数；无法解析返回 0
 */
export function untilToDuration(until, now = new Date()) {
  const s = String(until == null ? '' : until).trim()
  if (!s) return 0
  const nowMs = Number(now)
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (hm) {
    const at = new Date(nowMs)
    at.setHours(Math.max(0, Math.min(23, Number(hm[1]))), Math.max(0, Math.min(59, Number(hm[2]))), 0, 0)
    if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1)
    return at.getTime() - nowMs
  }
  const t = Date.parse(s)
  return Number.isFinite(t) && t > nowMs ? t - nowMs : 0
}

/**
 * 解析控制请求（ui-action；tech-scout 定稿命令名）。
 * 支持：mode-silent{minutes} / mode-focus{minutes} / mode-off{until?} / mode-resume
 *       兼容旧名：mode-set{kind,durationMs} / mode-clear
 * @param {object} j 请求负载
 * @param {object} uiDefaults {silentMinutes,focusMinutes,offUntil}
 * @returns {{kind:string,durationMs:number,clear:boolean}|null}
 */
export function normalizeRequest(j, uiDefaults = {}) {
  const src = j || {}
  const ui = uiDefaults || {}
  const d = { ...DEFAULT_MODE_DEFAULTS, ...ui }
  // ui-config 用分钟命名（silentMinutes/focusMinutes），这里统一折算成 ms
  if (Number(ui.silentMinutes) > 0) d.silentMs = Number(ui.silentMinutes) * 60000
  if (Number(ui.focusMinutes) > 0) d.focusMs = Number(ui.focusMinutes) * 60000
  if (ui.offUntil != null) d.offUntil = ui.offUntil
  const name = String(src.name || '').toLowerCase()
  const minutes = (v, fallbackMs) => {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return Math.floor(n * 60000)
    return Math.max(1000, Number(fallbackMs) || 0)
  }
  if (name === 'mode-resume' || name === 'mode-clear' || name === 'mode-reset') {
    return { kind: 'active', durationMs: 0, clear: true }
  }
  if (name === 'mode-silent' || name === 'mode-quiet') {
    return { kind: 'silent', durationMs: minutes(src.minutes ?? src.durationMinutes, d.silentMs), clear: false }
  }
  if (name === 'mode-focus' || name === 'mode-deep') {
    return { kind: 'focus', durationMs: minutes(src.minutes ?? src.durationMinutes, d.focusMs), clear: false }
  }
  if (name === 'mode-off' || name === 'mode-rest') {
    const untilMs = untilToDuration(src.until != null ? src.until : d.offUntil)
    if (untilMs > 0) return { kind: 'off', durationMs: untilMs, clear: false }
    return { kind: 'off', durationMs: 0, clear: false } // 交给 resolveResumeAt 用 offUntilHour
  }
  if (name === 'mode-set' || name === 'mode') {
    const kind = normalizeKind(src.kind != null ? src.kind : src.mode)
    const ms = Number(src.durationMs ?? src.duration ?? 0)
    return { kind, durationMs: Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0, clear: false }
  }
  if (name === 'mode-cycle') return { kind: cycleKind(src.current), durationMs: 0, clear: false }
  return null
}

/** 快捷键循环：active → focus → silent → off → active。 */
export function cycleKind(kind) {
  const k = normalizeKind(kind)
  const i = MODE_KINDS.indexOf(k)
  return MODE_KINDS[(i + 1) % MODE_KINDS.length]
}

// ---------- 行为门控（纯函数，供单测） ----------
/** 气泡门控：focus/silent 只留 S0（审批 / 等你选 / urgent）；off 全禁（手动互动除外）。 */
export function modeAllowsBubble(kind, bubbleKind, urgent = false) {
  const k = normalizeKind(kind)
  if (k === 'active') return true
  if (k === 'focus' || k === 'silent') return urgent || bubbleKind === 'approval' || bubbleKind === 'waitingInput'
  return false
}

/** LLM 门控：focus/silent 只为 S0 生成；off 不生成。 */
export function modeAllowsLlm(kind, llmKind) {
  const k = normalizeKind(kind)
  if (k === 'active') return true
  if (k === 'focus' || k === 'silent') return llmKind === 'approval' || llmKind === 'waitingInput'
  return false
}

/** focus 允许的"最小幅度"动作；walk/spin/jump/特效一律禁止。 */
const FOCUS_ACTS = new Set(['sway', 'peek', 'nod', 'stretch', 'blink'])

/** 动作门控：active 全开；focus 仅最小幅度；silent/off 不动。 */
export function modeAllowsAct(kind, actName) {
  const k = normalizeKind(kind)
  if (k === 'active') return true
  if (k === 'focus') return FOCUS_ACTS.has(String(actName || '').toLowerCase())
  return false
}

/** 走动/位移门控：只有 active 允许。 */
export function modeAllowsAction(kind) {
  return normalizeKind(kind) === 'active'
}

/** state: 状态推给桌宠：active/focus 允许（focus 只推姿态）；silent/off 不推。 */
export function modeAllowsStatusPush(kind) {
  const k = normalizeKind(kind)
  return k === 'active' || k === 'focus'
}

/** 定时仪式（早问候/睡前）、小剧场、余额推送：只有 active。 */
export function modeAllowsAmbient(kind) {
  return normalizeKind(kind) === 'active'
}
