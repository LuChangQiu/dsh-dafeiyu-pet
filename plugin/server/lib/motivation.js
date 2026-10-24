// task-104 切片4：motivation 动机/意图（纯函数；无 IO / 无 timer / 无随机）
// 契约：PERFORMANCE-CONTRACT §6（18 intent、utility 确定性、预算/拒绝记忆/打断/深夜）
import { noveltyFactor } from './appraisal.js'

export const INTENT_CLASSES = Object.freeze({
  reactive: 'reactive',
  proactive: 'proactive',
  surprise: 'surprise',
  environment: 'environment',
  rare: 'rare'
})

export const PROACTIVE_POLICY = Object.freeze({
  minPerDay: 2,
  defaultPerDay: 3,
  maxPerDay: 4,
  minGapMin: 90,
  surpriseMaxPerDay: 3,
  rareMaxPerWeek: 1,
  quietPauseHours: 24,
  ignoredStreakToPause: 2,
  nightStartMin: 23 * 60 + 30,
  nightEndMin: 8 * 60
})

export const REJECTION_PAUSE_MS = PROACTIVE_POLICY.quietPauseHours * 3600 * 1000

// §6.1 intent 目录（18 项）
export const INTENTS = Object.freeze([
  { id: 'react_ack', cls: 'reactive', base: 0.45, triggers: ['*'] },
  { id: 'comment_work', cls: 'reactive', base: 0.5, states: ['tool', 'thinking'], triggers: ['*'], cooldownMs: 180000 },
  {
    id: 'comfort_error',
    cls: 'reactive',
    base: 0.78,
    triggers: ['agent/request-error:error', 'turn/end:error'],
    cooldownMs: 600000
  },
  { id: 'celebrate_done', cls: 'reactive', base: 0.7, triggers: ['turn/end:completed'], cooldownMs: 6000 },
  {
    id: 'celebrate_goal',
    cls: 'reactive',
    base: 0.85,
    triggers: ['goal/change:complete', 'team/task:completed'],
    oneShot: true
  },
  {
    id: 'comfort_block',
    cls: 'reactive',
    base: 0.72,
    triggers: ['goal/change:block', 'team/task:blocked'],
    cooldownMs: 600000
  },
  {
    id: 'wait_approval',
    cls: 'reactive',
    base: 0.95,
    states: ['approval'],
    triggers: ['approval/asked'],
    s0: true,
    cooldownMs: 15000
  },
  {
    id: 'wait_input',
    cls: 'reactive',
    base: 0.95,
    states: ['waiting_input'],
    triggers: ['user-questions/request'],
    s0: true
  },
  {
    id: 'announce_job',
    cls: 'reactive',
    base: 0.5,
    triggers: ['job/settled:completed', 'job/settled:failed'],
    cooldownMs: 180000
  },
  {
    id: 'note_switch',
    cls: 'reactive',
    base: 0.5,
    triggers: ['model/selection', 'session_focus'],
    cooldownMs: 60000
  },
  { id: 'observe_stuck', cls: 'reactive', base: 0.62, facts: ['stuck'], cooldownMs: 300000 },
  { id: 'report_cost', cls: 'reactive', base: 0.55, facts: ['costAlert'], s0: true, disabledByDefault: true },
  { id: 'idle_skit', cls: 'proactive', base: 0.6, facts: ['idleSkit'], attentionMax: 0.4, budget: 'proactive' },
  { id: 'greet', cls: 'proactive', base: 0.7, facts: ['morning', 'reunion'], budget: 'proactive' },
  { id: 'ask_attention', cls: 'proactive', base: 0.58, facts: ['longSilence'], budget: 'proactive' },
  { id: 'prank', cls: 'surprise', base: 0.65, facts: ['prankEligible'], budget: 'surprise' },
  { id: 'rare_ritual', cls: 'rare', base: 0.8, facts: ['rareEligible'], budget: 'rare' },
  { id: 'rest_onset', cls: 'environment', base: 0.75, facts: ['night', 'lowEnergy'], budget: 'none' }
])

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const STAGE_FACTOR = { R0: 0.8, R1: 0.95, R2: 1.1, R3: 1.2 }

export const moodFactor = (emotion = {}) => {
  const v = Number(emotion.valence) || 0
  const a = Number(emotion.arousal) || 0.3
  const e = Number(emotion.energy) || 0.7
  return clamp(1 + 0.2 * v + 0.1 * (a - 0.3) + 0.1 * (e - 0.5), 0.7, 1.3)
}

export const attentionGate = (attention = 0.3) => clamp(0.3 + 0.7 * (Number(attention) || 0), 0.3, 1.0)

export const relationshipFactor = (stage = 'R0') => STAGE_FACTOR[stage] || STAGE_FACTOR.R0

export const satiety = (used = 0, max = 1) => (max > 0 ? clamp((Number(used) || 0) / max, 0, 1) : 0)

export const isNightMinutes = (minutesOfDay = 12 * 60) =>
  minutesOfDay >= PROACTIVE_POLICY.nightStartMin || minutesOfDay < PROACTIVE_POLICY.nightEndMin

const budgetUsedMax = (cls, budget = {}) => {
  if (cls === 'proactive')
    return { used: budget.proactiveUsed || 0, max: budget.proactiveMax ?? PROACTIVE_POLICY.defaultPerDay }
  if (cls === 'surprise')
    return { used: budget.surpriseUsed || 0, max: budget.surpriseMax ?? PROACTIVE_POLICY.surpriseMaxPerDay }
  if (cls === 'rare')
    return { used: budget.rareUsedThisWeek || 0, max: budget.rareMaxPerWeek ?? PROACTIVE_POLICY.rareMaxPerWeek }
  return { used: 0, max: 1 }
}

export const budgetGate = (cls, budget = {}) => {
  if (!['proactive', 'surprise', 'rare'].includes(cls)) return 1
  const { used, max } = budgetUsedMax(cls, budget)
  return used < max ? 1 : 0
}

const isPauseActive = (rejection = {}, nowMs = 0) => {
  if (!rejection.pauseUntil) return false
  const t = Date.parse(rejection.pauseUntil)
  return Number.isFinite(t) ? t > nowMs : false
}

const minNightFact = (ctx) => {
  if (typeof ctx.minutesOfDay === 'number') return ctx.minutesOfDay
  if (ctx.nowIso) {
    const m = String(ctx.nowIso).match(/T(\d{2}):(\d{2})/)
    if (m) return Number(m[1]) * 60 + Number(m[2])
  }
  return 12 * 60
}

const applies = (intent, ctx) => {
  const key = ctx.eventKey || 'default'
  const triggers = intent.triggers || []
  const stateMatch = Array.isArray(intent.states) && intent.states.includes(ctx.state)
  const factMatch = Array.isArray(intent.facts) && intent.facts.some((f) => ctx.facts && ctx.facts[f] === true)
  const star = triggers.includes('*') && key !== 'default'
  const direct = triggers.includes(key)
  if (!star && !direct && !stateMatch && !factMatch) return false
  if (intent.attentionMax !== undefined && (Number(ctx.attention) || 0) >= intent.attentionMax) return false
  return true
}

export const intentById = (id) => INTENTS.find((i) => i.id === id) || null

export function utilityOf(intent, ctx = {}) {
  const gated = []
  const emotion = ctx.emotion || {}
  const cls = intent.cls
  const nowMs = ctx.nowMs || 0
  const budget = ctx.budget || {}
  const rejection = ctx.rejection || {}
  const mode = String(ctx.mode || 'normal')
  const night = isNightMinutes(minNightFact(ctx))
  if (intent.disabledByDefault && !(ctx.facts && ctx.facts.costAlertEnabled === true)) gated.push('disabled')
  if (!applies(intent, ctx)) gated.push('trigger')
  if (intent.s0 !== true && (mode === 'silent' || mode === 'focus' || mode === 'off')) gated.push('mode')
  if (intent.s0 !== true && night && cls !== 'environment') gated.push('night')
  if (
    ['proactive', 'surprise', 'rare'].includes(cls) &&
    (Number(ctx.attention) || 0) < 0.4 &&
    intent.attentionMax === undefined
  )
    gated.push('attention')
  const budgetState = budgetUsedMax(cls, budget)
  if (budgetGate(cls, budget) === 0) gated.push('budget')
  if (isPauseActive(rejection, nowMs)) gated.push('rejection')
  if (budgetState.used >= budgetState.max && ['proactive', 'surprise', 'rare'].includes(cls)) gated.push('budget')
  if (gated.length) return { utility: 0, gated }
  const repeat = Number((ctx.repeats && ctx.repeats[intent.id]) || 0) + 1
  const novelty = noveltyFactor(repeat)
  const mom = moodFactor(emotion)
  const att = attentionGate(ctx.attention)
  const rel = relationshipFactor(ctx.stage)
  const sat = ['proactive', 'surprise', 'rare'].includes(cls) ? satiety(budgetState.used, budgetState.max) : 0
  const costMs = Number(ctx.costMs) || 0
  let u = intent.base * mom * att * rel * novelty * (1 - sat) * budgetGate(cls, budget) - costMs / 10000
  if (intent.s0 === true) u = intent.base + 0.05 * attentionGate(ctx.attention)
  return {
    utility: Number(Math.max(0, u).toFixed(6)),
    gated,
    novelty,
    factors: { mood: mom, attention: att, relationship: rel, satiety: sat }
  }
}

export function selectIntent(ctx = {}) {
  const ranked = []
  const gated = []
  for (const intent of INTENTS) {
    const r = utilityOf(intent, ctx)
    if (r.utility > 0)
      ranked.push({ id: intent.id, cls: intent.cls, utility: r.utility, factors: r.factors, novelty: r.novelty })
    else gated.push({ id: intent.id, reasons: r.gated })
  }
  ranked.sort((a, b) => (b.utility !== a.utility ? b.utility - a.utility : a.id < b.id ? -1 : 1))
  const best = ranked[0] || null
  if (!best || best.utility < 0.35) return { intent: null, utility: 0, ranked, gated, reason: 'below-threshold' }
  const current = ctx.currentIntentId ? ranked.find((r) => r.id === ctx.currentIntentId) : null
  if (current && best.utility - current.utility <= 0.1) {
    return { intent: current.id, cls: current.cls, utility: current.utility, ranked, gated, hysteresis: true }
  }
  return { intent: best.id, cls: best.cls, utility: best.utility, ranked, gated, hysteresis: false }
}

// 打断规则 §6.3
export function shouldInterrupt({ currentIntent = null, eventKey = '', state = '', userAction = false } = {}) {
  if (userAction) return { interrupt: true, reason: 'user-priority' }
  if (state === 'approval' || state === 'waiting_input' || /approval\/asked|user-questions\/request/.test(eventKey))
    return { interrupt: true, reason: 's0' }
  if (!currentIntent || currentIntent.cls === 'reactive') return { interrupt: false, reason: 'none' }
  if (state === 'tool' || state === 'thinking') return { interrupt: false, reason: 'e1-coexist' }
  const next = selectIntent({ eventKey, state })
  if (next.intent && next.cls === 'proactive' && currentIntent.cls === 'proactive') {
    return { interrupt: false, reason: 'abandon-lower-u' }
  }
  return { interrupt: false, reason: 'keep' }
}

// 拒绝记忆 §6.4：streak 2 次 ignored 或用户显式安静 → 暂停主动 24h
export function updateRejection({ rejection = {}, signal = '', nowIso = null } = {}) {
  const next = {
    streak: Number(rejection.streak) || 0,
    pauseUntil: rejection.pauseUntil || null,
    lastAt: rejection.lastAt || null
  }
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now()
  const nowIsoStr = new Date(nowMs).toISOString()
  if (signal === 'ignored') {
    next.streak += 1
    next.lastAt = nowIsoStr
    if (next.streak >= PROACTIVE_POLICY.ignoredStreakToPause) {
      next.pauseUntil = new Date(nowMs + REJECTION_PAUSE_MS).toISOString()
      next.streak = 0
    }
  } else if (signal === 'quiet') {
    next.streak = 0
    next.pauseUntil = new Date(nowMs + REJECTION_PAUSE_MS).toISOString()
    next.lastAt = nowIsoStr
  } else if (signal === 'userInteraction') {
    next.streak = 0
  }
  return next
}

export const motivationVersions = () => ({
  modelVersion: 1,
  doc: 'PERFORMANCE-CONTRACT §6',
  intentCount: INTENTS.length,
  policy: { ...PROACTIVE_POLICY }
})
