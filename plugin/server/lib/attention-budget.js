// task: attention-budget —— 主动开口预算 + 抑制门 + 拒绝记忆（纯逻辑；无 IO/timer/随机）
// 契约：docs/ATTENTION-BUDGET.md；默认 3/天，硬上限 4；事件反应不计入；不卖惨/不报复/不操纵。
// 说明：本模块只返回「是否允许/原因/频率系数/日志计数」，不直接说话、不碰 pipe、不读 DSH 内容。
import fs from 'node:fs'
import path from 'node:path'

export const ATTENTION_DEFAULTS = Object.freeze({
  proactivePerDay: 3,
  proactiveHardCap: 4,
  nightStartMin: 23 * 60 + 30, // 23:30
  nightEndMin: 8 * 60, // 08:00
  rejection: Object.freeze({
    ignoredThreshold: 2, // 连续无视 2 次 → 暂停主动 24h
    pauseHours: 24,
    frequencyFactor: 0.5, // 24h 内频率 ×0.5
    topicAvoidDays: 7 // 7 天内不碰同 topic
  })
})

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d)

export const localDayKey = (nowMs) => {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const localMinutesOfDay = (nowMs) => {
  const d = new Date(nowMs)
  return d.getHours() * 60 + d.getMinutes()
}

export const isNightMinutes = (minutes, config = {}) => {
  const start = num(config.nightStartMin, ATTENTION_DEFAULTS.nightStartMin)
  const end = num(config.nightEndMin, ATTENTION_DEFAULTS.nightEndMin)
  return minutes >= start || minutes < end
}

const emptyState = (dayKey, config = {}) => ({
  version: 1,
  dayKey,
  proactiveUsed: 0,
  proactiveMax: clamp(num(config.proactivePerDay, ATTENTION_DEFAULTS.proactivePerDay), 0, 4),
  hardCap: ATTENTION_DEFAULTS.proactiveHardCap,
  lastProactiveAt: null,
  rejection: { lastAt: null, count: 0, kind: null, pauseUntilMs: null, topic: null },
  topicAvoid: {},
  updatedAt: null
})

// 状态反序列化（容错；非法/缺失 → 当天空状态；不崩溃）
export const deserializeBudgetState = (json, { nowMs = Date.now(), config = {} } = {}) => {
  const dayKey = localDayKey(nowMs)
  const base = emptyState(dayKey, config)
  if (!json) return base
  let raw = json
  if (typeof json === 'string') {
    try {
      raw = JSON.parse(json)
    } catch {
      return base
    }
  }
  if (!raw || typeof raw !== 'object') return base
  const rej = raw.rejection && typeof raw.rejection === 'object' ? raw.rejection : {}
  const topics = raw.topicAvoid && typeof raw.topicAvoid === 'object' ? { ...raw.topicAvoid } : {}
  return {
    version: 1,
    dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : dayKey,
    proactiveUsed: Math.max(0, num(raw.proactiveUsed)),
    proactiveMax: clamp(num(raw.proactiveMax, base.proactiveMax), 0, ATTENTION_DEFAULTS.proactiveHardCap),
    hardCap: ATTENTION_DEFAULTS.proactiveHardCap,
    lastProactiveAt: raw.lastProactiveAt || null,
    rejection: {
      lastAt: rej.lastAt || null,
      count: Math.max(0, num(rej.count)),
      kind: rej.kind === 'quiet' || rej.kind === 'ignored' ? rej.kind : null,
      pauseUntilMs: Number.isFinite(Number(rej.pauseUntilMs)) ? Number(rej.pauseUntilMs) : null,
      topic: typeof rej.topic === 'string' ? rej.topic.slice(0, 40) : null
    },
    topicAvoid: topics,
    updatedAt: raw.updatedAt || null
  }
}

export const serializeBudgetState = (state) => JSON.stringify(state)

// 落盘（非热路径；原子写：tmp + rename）。仅在状态变化时调用，由接线层负责节流。
export const readBudgetState = (file) => {
  if (!file) return null
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export const writeBudgetStateAtomic = (file, state) => {
  if (!file) return false
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  try {
    const dir = path.dirname(file)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, serializeBudgetState(state), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {}
    return false
  }
}

export const createAttentionBudget = (opts = {}) => {
  const { now = () => Date.now(), dayKeyFn = (ms) => localDayKey(ms), config = {}, state = null } = opts
  const cfg = {
    proactivePerDay: clamp(
      num(config.proactivePerDay, ATTENTION_DEFAULTS.proactivePerDay),
      0,
      ATTENTION_DEFAULTS.proactiveHardCap
    ),
    proactiveHardCap: ATTENTION_DEFAULTS.proactiveHardCap,
    nightStartMin: num(config.nightStartMin, ATTENTION_DEFAULTS.nightStartMin),
    nightEndMin: num(config.nightEndMin, ATTENTION_DEFAULTS.nightEndMin),
    rejection: {
      ignoredThreshold: Math.max(
        1,
        num(config.rejection?.ignoredThreshold, ATTENTION_DEFAULTS.rejection.ignoredThreshold)
      ),
      pauseHours: Math.max(0, num(config.rejection?.pauseHours, ATTENTION_DEFAULTS.rejection.pauseHours)),
      frequencyFactor: clamp(
        num(config.rejection?.frequencyFactor, ATTENTION_DEFAULTS.rejection.frequencyFactor),
        0,
        1
      ),
      topicAvoidDays: Math.max(0, num(config.rejection?.topicAvoidDays, ATTENTION_DEFAULTS.rejection.topicAvoidDays))
    }
  }
  let st = deserializeBudgetState(state, { nowMs: now(), config: cfg })

  const rollover = (nowMs) => {
    const key = dayKeyFn(nowMs)
    if (!key || key === st.dayKey) return false
    st = {
      ...st,
      dayKey: key,
      proactiveUsed: 0,
      lastProactiveAt: null,
      topicAvoid: pruneTopics(st.topicAvoid, nowMs)
    }
    return true
  }

  const pruneTopics = (map, nowMs) => {
    const out = {}
    for (const [topic, until] of Object.entries(map || {})) {
      if (Number(until) > nowMs) out[topic] = Number(until)
    }
    return out
  }

  const rejectionPauseActive = (nowMs) =>
    Number.isFinite(Number(st.rejection.pauseUntilMs)) && nowMs < Number(st.rejection.pauseUntilMs)

  // 抑制门：深夜 / 免打扰/静音 / 全屏 / 打字中 → 即使预算内也归零
  const suppression = (ctx = {}, nowMs = now()) => {
    const reasons = []
    const mode = String(ctx.mode || 'active')
    if (isNightMinutes(localMinutesOfDay(nowMs), cfg)) reasons.push('night')
    if (mode === 'silent' || mode === 'off' || mode === 'focus') reasons.push('mode-quiet')
    if (ctx.dnd === true) reasons.push('dnd')
    if (ctx.fullscreen === true) reasons.push('fullscreen')
    if (ctx.typing === true) reasons.push('typing')
    return { suppressed: reasons.length > 0, reasons }
  }

  const topicAvoided = (topic, nowMs) => {
    if (!topic) return false
    const until = Number(st.topicAvoid[topic] || 0)
    return until > nowMs
  }

  // 频率系数：拒绝暂停期 0.5；其余 1
  const frequencyFactor = (nowMs = now()) => (rejectionPauseActive(nowMs) ? cfg.rejection.frequencyFactor : 1)

  // 是否允许主动开口；事件反应（isReaction）不计预算、不受预算/拒绝限制（仍受抑制门约束？反应类沿用调用方 mode 门控，这里只给 isReaction 放行预算）
  const canSpeak = (ctx = {}) => {
    const nowMs = Number.isFinite(Number(ctx.nowMs)) ? Number(ctx.nowMs) : now()
    rollover(nowMs)
    const suppressed = suppression(ctx, nowMs)
    if (suppressed.suppressed) {
      return {
        allowed: false,
        reason: suppressed.reasons[0],
        reasons: suppressed.reasons,
        suppressed: true,
        ...view(nowMs)
      }
    }
    if (ctx.isReaction === true) {
      return { allowed: true, reason: 'reaction', reasons: [], suppressed: false, counted: false, ...view(nowMs) }
    }
    if (rejectionPauseActive(nowMs)) {
      return {
        allowed: false,
        reason: 'rejection-pause',
        reasons: ['rejection-pause'],
        suppressed: false,
        frequencyFactor: frequencyFactor(nowMs),
        ...view(nowMs)
      }
    }
    if (topicAvoided(ctx.topic, nowMs)) {
      return { allowed: false, reason: 'topic-avoid', reasons: ['topic-avoid'], suppressed: false, ...view(nowMs) }
    }
    if (st.proactiveUsed >= cfg.proactivePerDay) {
      return { allowed: false, reason: 'budget', reasons: ['budget'], suppressed: false, ...view(nowMs) }
    }
    return {
      allowed: true,
      reason: 'ok',
      reasons: [],
      suppressed: false,
      frequencyFactor: frequencyFactor(nowMs),
      ...view(nowMs)
    }
  }

  const view = (nowMs = now()) => ({
    dayKey: st.dayKey,
    proactiveUsed: st.proactiveUsed,
    proactiveMax: cfg.proactivePerDay,
    hardCap: cfg.proactiveHardCap,
    remaining: Math.max(0, cfg.proactivePerDay - st.proactiveUsed),
    rejection: { ...st.rejection },
    paused: rejectionPauseActive(nowMs),
    frequencyFactor: frequencyFactor(nowMs)
  })

  // 记录一次成功的主动开口（调用方在真正说完后调用；事件反应不要调用）
  const recordProactive = (ctx = {}) => {
    const nowMs = Number.isFinite(Number(ctx.nowMs)) ? Number(ctx.nowMs) : now()
    rollover(nowMs)
    const gate = canSpeak({ ...ctx, nowMs })
    if (!gate.allowed) return { ok: false, ...gate }
    st.proactiveUsed = Math.min(cfg.proactiveHardCap, st.proactiveUsed + 1)
    st.lastProactiveAt = new Date(nowMs).toISOString()
    st.updatedAt = st.lastProactiveAt
    return { ok: true, ...view(nowMs) }
  }

  const recordReaction = () => ({ ok: true, counted: false, ...view(now()) })

  // 用户无视一次（连续 2 次 → 暂停 24h；7 天内不碰同 topic）
  const recordIgnored = ({ topic = null, nowMs = null } = {}) => {
    const ts = Number.isFinite(Number(nowMs)) ? Number(nowMs) : now()
    rollover(ts)
    const prev = st.rejection
    const kind = prev.kind === 'quiet' ? 'quiet' : 'ignored'
    const count = (prev.count || 0) + 1
    const atIso = new Date(ts).toISOString()
    let pauseUntilMs = Number(prev.pauseUntilMs) || null
    if (count >= cfg.rejection.ignoredThreshold) {
      pauseUntilMs = ts + cfg.rejection.pauseHours * 3600 * 1000
    }
    st.rejection = { lastAt: atIso, count, kind, pauseUntilMs, topic: topic ? String(topic).slice(0, 40) : prev.topic }
    if (topic) st.topicAvoid[String(topic).slice(0, 40)] = ts + cfg.rejection.topicAvoidDays * 86400 * 1000
    st.updatedAt = atIso
    return { ok: true, ...view(ts) }
  }

  // 用户显式「安静/静一静」→ 立即暂停主动 24h，kind=quiet
  const recordQuiet = ({ topic = null, nowMs = null } = {}) => {
    const ts = Number.isFinite(Number(nowMs)) ? Number(nowMs) : now()
    rollover(ts)
    const atIso = new Date(ts).toISOString()
    st.rejection = {
      lastAt: atIso,
      count: 0,
      kind: 'quiet',
      pauseUntilMs: ts + cfg.rejection.pauseHours * 3600 * 1000,
      topic: topic ? String(topic).slice(0, 40) : st.rejection.topic
    }
    if (topic) st.topicAvoid[String(topic).slice(0, 40)] = ts + cfg.rejection.topicAvoidDays * 86400 * 1000
    st.updatedAt = atIso
    return { ok: true, ...view(ts) }
  }

  // 用户主动互动一次 → 清零 streak/pause/topicAvoid（立刻恢复）
  const recordUserInteraction = ({ nowMs = null } = {}) => {
    const ts = Number.isFinite(Number(nowMs)) ? Number(nowMs) : now()
    rollover(ts)
    st.rejection = { lastAt: null, count: 0, kind: null, pauseUntilMs: null, topic: null }
    st.topicAvoid = {}
    st.updatedAt = new Date(ts).toISOString()
    return { ok: true, cleared: true, ...view(ts) }
  }

  // 日志只输出计数/枚举，不含文本
  const logView = (nowMs = now()) => {
    const v = view(nowMs)
    return {
      dayKey: v.dayKey,
      used: v.proactiveUsed,
      max: v.proactiveMax,
      hardCap: v.hardCap,
      paused: v.paused,
      rejectionCount: v.rejection.count,
      rejectionKind: v.rejection.kind,
      frequencyFactor: v.frequencyFactor,
      topicAvoidCount: Object.keys(st.topicAvoid).length
    }
  }

  const getState = () => ({
    ...st,
    rejection: { ...st.rejection },
    topicAvoid: { ...st.topicAvoid },
    proactiveMax: cfg.proactivePerDay
  })

  return {
    canSpeak,
    recordProactive,
    recordReaction,
    recordIgnored,
    recordQuiet,
    recordUserInteraction,
    suppression,
    frequencyFactor,
    topicAvoided,
    view,
    logView,
    getState,
    rollover,
    config: cfg
  }
}
