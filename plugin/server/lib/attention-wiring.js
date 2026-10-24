// task: attention-wiring —— 把 attention-budget 接入主动开口路径（CF1 whale-acts 决策层）
// 默认关：cfg.attentionBudget.enabled=false → 零调用/零读盘/零写盘，gate 恒 allowed（行为同现状）。
// enabled 时才创建预算实例、读取/节流写盘 `attention-budget.json`。
// 主动开口判定：canSpeak(isReaction:false) → allowed 才发 + recordProactive；抑制只记 reason 不记账。
// S0（approval/waiting_input）由调用方直通：gate({isS0:true}) → allowed，不占预算。
// 无视近似：主动发出后 ignoreAfterSec 内无任何用户交互 → 记一次 ignored（仅一次；用户互动清除 pending）。
import { createAttentionBudget, readBudgetState, writeBudgetStateAtomic } from './attention-budget.js'

export const DEFAULT_ATTENTION_WIRING_CONFIG = Object.freeze({
  enabled: false, // 默认关：零副作用
  stateFile: '', // 建议 pet-work/attention-budget.json；空 = 不落盘（仅内存）
  proactivePerDay: 3,
  ignoreAfterSec: 60, // 主动发出后 N 秒无用户交互 → 记一次 ignored（近似口径）
  persistMs: 30000, // 状态变化后落盘节流
  topic: '', // 内部枚举/ID（会被 hash）；空 = 不记录 topic
  suppress: Object.freeze({ dnd: false, fullscreen: false, typing: false })
})

const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d)

const stub = (reason = 'disabled') => ({
  enabled: false,
  reason,
  gate: () => ({ allowed: true, reason: 'disabled', reasons: [], suppressed: false }),
  recordProactive: () => ({ ok: true, counted: false }),
  noteProactiveSent: () => {},
  noteInteraction: () => {},
  noteQuiet: () => {},
  tick: () => {},
  getState: () => null,
  dispose: () => {},
  logView: () => null
})

export function createAttentionWiring(opts = {}) {
  const {
    config = {},
    now = () => Date.now(),
    mode = () => 'active',
    readState = readBudgetState,
    writeState = writeBudgetStateAtomic
  } = opts
  const cfg = {
    ...DEFAULT_ATTENTION_WIRING_CONFIG,
    ...(config.attentionBudget || {}),
    suppress: { ...DEFAULT_ATTENTION_WIRING_CONFIG.suppress, ...((config.attentionBudget || {}).suppress || {}) }
  }
  if (cfg.enabled !== true) return stub('disabled-by-config')

  const stateFile = String(cfg.stateFile || '')
  let rawState = null
  if (stateFile) {
    try {
      rawState = readState(stateFile)
    } catch {
      rawState = null
    }
  }
  const budget = createAttentionBudget({
    state: rawState,
    config: { proactivePerDay: cfg.proactivePerDay },
    now
  })

  let pending = null // {kind, atMs} 最近一次主动开口（用于"无视"近似判定）
  let lastUserInteractionAt = 0
  let lastPersistAt = 0
  let dirty = false
  let disposed = false

  const persist = (nowMs, force = false) => {
    if (!stateFile || disposed) return false
    if (!force && nowMs - lastPersistAt < num(cfg.persistMs, 30000)) return false
    const ok = writeState(stateFile, budget.getState())
    lastPersistAt = nowMs
    dirty = false
    return ok
  }

  const contextOf = (ctx = {}) => ({
    nowMs: num(ctx.nowMs, now()),
    mode: String(ctx.mode || mode()),
    dnd: ctx.dnd !== undefined ? ctx.dnd === true : cfg.suppress.dnd === true,
    fullscreen: ctx.fullscreen !== undefined ? ctx.fullscreen === true : cfg.suppress.fullscreen === true,
    typing: ctx.typing !== undefined ? ctx.typing === true : cfg.suppress.typing === true
  })

  const gate = (ctx = {}) => {
    if (disposed) return stub('disposed').gate()
    const base = contextOf(ctx)
    const res = budget.canSpeak({
      ...base,
      isS0: ctx.isS0 === true,
      isReaction: ctx.isReaction === true,
      topic: ctx.topic !== undefined ? ctx.topic : cfg.topic
    })
    return res
  }

  const recordProactive = (ctx = {}) => {
    if (disposed) return { ok: false, reason: 'disposed' }
    const nowMs = num(ctx.nowMs, now())
    const r = budget.recordProactive({ nowMs })
    if (r && r.ok) {
      pending = { kind: String(ctx.kind || ''), atMs: nowMs }
      dirty = true
      persist(nowMs)
    }
    return r
  }

  const noteProactiveSent = (ctx = {}) => {
    if (disposed) return
    pending = { kind: String(ctx.kind || ''), atMs: num(ctx.nowMs, now()) }
  }

  const noteInteraction = (ctx = {}) => {
    if (disposed) return
    const nowMs = num(ctx.nowMs, now())
    lastUserInteractionAt = nowMs
    pending = null
    budget.recordUserInteraction({ nowMs })
    dirty = true
    persist(nowMs)
  }

  const noteQuiet = (ctx = {}) => {
    if (disposed) return
    const nowMs = num(ctx.nowMs, now())
    pending = null
    budget.recordQuiet({ nowMs, topic: ctx.topic !== undefined ? ctx.topic : cfg.topic })
    dirty = true
    persist(nowMs)
  }

  // 每 tick：无视近似判定 + 节流落盘
  const tick = (ctx = {}) => {
    if (disposed) return null
    const nowMs = num(ctx.nowMs, now())
    if (pending) {
      const waited = nowMs - pending.atMs
      const userAfterSend = lastUserInteractionAt > pending.atMs
      if (!userAfterSend && waited >= num(cfg.ignoreAfterSec, 60) * 1000) {
        budget.recordIgnored({ nowMs, topic: cfg.topic })
        pending = null
        dirty = true
      }
    }
    if (dirty) persist(nowMs)
    return budget.view(nowMs)
  }

  const getState = () => budget.getState()
  const logView = () => {
    const v = budget.logView(now())
    return { ...v, enabled: true }
  }
  const dispose = (ctx = {}) => {
    if (disposed) return
    const nowMs = num(ctx.nowMs, now())
    persist(nowMs, true)
    disposed = true
  }

  return {
    enabled: true,
    reason: 'enabled',
    gate,
    recordProactive,
    noteProactiveSent,
    noteInteraction,
    noteQuiet,
    tick,
    getState,
    logView,
    dispose,
    _budget: budget
  }
}
