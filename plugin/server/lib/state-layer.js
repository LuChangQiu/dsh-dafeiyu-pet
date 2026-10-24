// task-104 切片6：state-layer 接线适配器（纯逻辑；无 IO）
// 事件 → state-machine → appraisal → affect → motivation → perf-script（组装+校验）
// 约束：事件层不直接产生 act；无事件不装忙；schedule 不表演；state 变更不自动触发 script
import { createStateMachine } from './state-machine.js'
import { appraise } from './appraisal.js'
import {
  INITIAL_AFFECT,
  sanitizeAffect,
  tickAffect,
  quantizeWords,
  toLegacy,
  relationshipStage,
  stageLabel
} from './affect.js'
import { selectIntent, shouldInterrupt, updateRejection, intentById } from './motivation.js'
import { assembleScript, buildVocabulary, canEmit, markEmitted } from './perf-script.js'

export const DEFAULT_STATE_LAYER_CONFIG = Object.freeze({
  enabled: false,
  affect: true,
  motivation: false, // P0 默认只出 state/affect；motivation/script 需显式开启
  scripts: false,
  scriptsAllowDuring: ['active', 'focus'],
  textEnabled: false
})

const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d)

export function createStateLayer(opts = {}) {
  const {
    stateMap,
    now = () => Date.now(),
    mode = () => 'normal',
    sessionRole = null,
    currentSessionId = null,
    config = {},
    state: initialState = 'idle',
    counters = null,
    emotion = {},
    stage = 'R0',
    evidence = {},
    rejection = {},
    budget = {},
    currentIntentId = null
  } = opts
  const cfg = { ...DEFAULT_STATE_LAYER_CONFIG, ...config }
  let enabled = cfg.enabled === true
  const vocabulary = buildVocabulary(stateMap)
  const machine = createStateMachine({
    stateMap,
    now,
    mode,
    initialState,
    initialCounters: counters,
    sessionRole,
    currentSessionId
  })

  let affect = sanitizeAffect({ ...INITIAL_AFFECT, ...emotion })
  let relationship = relationshipStage(evidence, stage)
  let rejectionState = { streak: 0, pauseUntil: null, lastAt: null, ...rejection }
  let budgetState = {
    proactiveUsed: num(budget.proactiveUsed),
    proactiveMax: num(budget.proactiveMax, 3),
    surpriseUsed: num(budget.surpriseUsed),
    surpriseMax: num(budget.surpriseMax, 3),
    rareUsedThisWeek: num(budget.rareUsedThisWeek),
    rareMaxPerWeek: num(budget.rareMaxPerWeek, 1)
  }
  let repeats = {}
  let currentIntent = currentIntentId ? intentById(currentIntentId) : null
  const registry = new Map()
  let lastIntent = null
  let lastScript = null
  let lastAppraisal = null
  let seq = 0

  function snapshot() {
    const st = machine.snapshot()
    const words = quantizeWords(affect)
    return {
      state: st.state,
      subkind: st.subkind,
      stateClass: st.stateClass,
      perform: st.perform,
      presentation: st.presentation,
      counters: st.counters,
      emotion: { ...affect },
      words,
      relationship: { stage: relationship, label: stageLabel(relationship) },
      legacy: toLegacy(affect, relationship),
      intent: lastIntent
        ? { id: lastIntent.id, cls: lastIntent.cls, utility: lastIntent.utility, at: lastIntent.at }
        : null,
      script: lastScript,
      since: st.since
    }
  }

  function handle(event, ctx = {}) {
    if (!enabled) return snapshot()
    if (!event || !event.t) return snapshot()
    const st = machine.handle(event, ctx)
    lastAppraisal = appraise(event, {
      countThisSession: (repeats[event.t] || 0) + 1,
      retryStreak: st.counters && st.counters.retry ? st.counters.retry : 0
    })
    repeats[event.t] = (repeats[event.t] || 0) + 1
    // affect 增量 + 注意力目标（approval/question 拉满）
    const target = /approval\/asked|user-questions\/request/.test(event.t) ? 1.0 : null
    const dtSec = ctx.attentionDtSec || 0
    affect = tickAffect(affect, {
      elapsedSec: ctx.elapsedSec || 0,
      busySec: ctx.busySec || 0,
      idleSec: ctx.idleSec || 0,
      sleepSec: ctx.sleepSec || 0,
      attentionTarget: target,
      attentionDtSec: target !== null ? Math.max(dtSec, 1) : 0,
      delta: cfg.affect === false ? null : lastAppraisal.scaledDelta
    })
    relationship = relationshipStage(ctx.evidence || {}, relationship)

    // 用户互动 / 忽略信号 → 拒绝记忆
    const rejectionSignal = ctx.rejectionSignal || null
    if (rejectionSignal)
      rejectionState = updateRejection({
        rejection: rejectionState,
        signal: rejectionSignal,
        nowIso: ctx.nowIso || null
      })

    // motivation/script：默认关（P0 只输出 state/affect）
    if (cfg.motivation !== true) return snapshot()
    const intentCtx = {
      eventKey: lastAppraisal.key,
      state: st.state,
      subkind: st.subkind,
      emotion: affect,
      attention: affect.attention,
      stage: relationship,
      budget: budgetState,
      rejection: rejectionState,
      mode: String(ctx.mode || mode()),
      minutesOfDay: ctx.minutesOfDay,
      nowIso: ctx.nowIso || null,
      nowMs: ctx.nowMs || 0,
      facts: ctx.facts || {},
      repeats,
      currentIntentId: currentIntent ? currentIntent.id : null
    }
    const selection = selectIntent(intentCtx)
    if (!selection.intent) {
      currentIntent = null
      return snapshot()
    }
    const picked = intentById(selection.intent)
    currentIntent = picked
    lastIntent = {
      id: picked.id,
      cls: picked.cls,
      utility: selection.utility,
      at: ctx.nowIso || new Date(now()).toISOString()
    }
    if (selection.cls === 'proactive') budgetState.proactiveUsed += 1
    if (selection.cls === 'surprise') budgetState.surpriseUsed += 1
    if (selection.cls === 'rare') budgetState.rareUsedThisWeek += 1

    if (cfg.scripts !== true) return snapshot()
    const source = `intent:${picked.id}`
    const emit = canEmit({ registry, source, nowMs: num(ctx.nowMs, now()), cooldownMs: 6000 })
    if (!emit.emit) return snapshot()
    const assembled = assembleScript({
      stateMap,
      intentId: picked.id,
      at: ctx.nowIso || null,
      emotion: affect,
      mode: String(ctx.mode || mode())
    })
    if (assembled.rejected) {
      lastScript = { rejected: true, errors: assembled.errors, script: assembled.script }
      return snapshot()
    }
    lastScript = assembled.script
    markEmitted({ registry, source, nowMs: num(ctx.nowMs, now()) })
    seq += 1
    return snapshot()
  }

  function tick({
    elapsedSec = 0,
    busySec = 0,
    idleSec = 0,
    sleepSec = 0,
    attentionTarget = null,
    attentionDtSec = 0
  } = {}) {
    if (!enabled) return snapshot()
    affect = tickAffect(affect, { elapsedSec, busySec, idleSec, sleepSec, attentionTarget, attentionDtSec })
    return snapshot()
  }

  function setEnabled(value) {
    enabled = value === true
    if (!enabled) {
      currentIntent = null
      lastIntent = null
      lastScript = null
    }
    return snapshot()
  }

  function interrupt({ eventKey = '', state = '', userAction = false } = {}) {
    if (!enabled) return { interrupt: false, reason: 'disabled' }
    const r = shouldInterrupt({ currentIntent, eventKey, state, userAction })
    if (r.interrupt) currentIntent = null
    return r
  }

  return {
    handle,
    tick,
    snapshot,
    interrupt,
    setEnabled,
    get enabled() {
      return enabled
    },
    vocabulary,
    _debug: {
      machine,
      getAffect: () => ({ ...affect }),
      getBudget: () => ({ ...budgetState }),
      getRejection: () => ({ ...rejectionState }),
      getIntent: () => currentIntent
    }
  }
}

export const stateLayerVersions = () => ({ layerVersion: 1, doc: 'STATE-SEMANTICS v1.1 / PERFORMANCE-CONTRACT v1.1' })
