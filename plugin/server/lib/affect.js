// task-104 切片3：affect 情绪/注意/关系状态（纯函数；无 IO / 无 timer / 无随机）
// 契约：PERFORMANCE-CONTRACT §4（变量/半衰期/量化词/R0–R3/兼容映射）

export const INITIAL_AFFECT = Object.freeze({
  valence: 0.1,
  arousal: 0.3,
  energy: 0.7,
  attention: 0.3,
  trust: 0.05
})

export const HALF_LIVES_SEC = Object.freeze({
  valence: 1800, // 30min
  arousal: 300, // 5min
  trust: 30 * 86400 // 30 days
})

export const ATTENTION_TARGETS = Object.freeze({
  userAction: 1.0,
  activeSession: 0.7,
  background: 0.3,
  idle: 0.15
})

export const ATTENTION_FLOOR = 0.15

export const STAGES = Object.freeze(['R0', 'R1', 'R2', 'R3'])
export const STAGE_LABELS = Object.freeze({ R0: '陌生', R1: '熟悉', R2: '朋友', R3: '老朋友' })
export const STAGE_TERMS = Object.freeze({ R0: '你', R1: '你', R2: '你', R3: '你' })

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
export const clamp01 = (x) => clamp(Number(x) || 0, 0, 1)
export const clampValence = (x) => clamp(Number(x) || 0, -1, 1)

export const sanitizeAffect = (emotion = {}) => ({
  valence: clampValence(emotion.valence ?? INITIAL_AFFECT.valence),
  arousal: clamp01(emotion.arousal ?? INITIAL_AFFECT.arousal),
  energy: clamp01(emotion.energy ?? INITIAL_AFFECT.energy),
  attention: clamp01(emotion.attention ?? INITIAL_AFFECT.attention),
  trust: clamp01(emotion.trust ?? INITIAL_AFFECT.trust)
})

const halfLifeFactor = (elapsedSec, halfLifeSec) => Math.pow(2, -Math.max(0, elapsedSec) / halfLifeSec)

// 情绪自然衰减（attention 不由衰减驱动，由目标逼近驱动；energy 由活动驱动）
export const decayAffect = (emotion, elapsedSec) => {
  const e = sanitizeAffect(emotion)
  const dt = Math.max(0, Number(elapsedSec) || 0)
  return {
    ...e,
    valence: clampValence(e.valence * halfLifeFactor(dt, HALF_LIVES_SEC.valence)),
    arousal: clamp01(e.arousal * halfLifeFactor(dt, HALF_LIVES_SEC.arousal)),
    trust: clamp01(e.trust * halfLifeFactor(dt, HALF_LIVES_SEC.trust))
  }
}

// energy：忙碌 -0.0005/s、空闲 +0.0002/s、睡眠 +0.002/s
export const updateEnergy = (emotion, { busySec = 0, idleSec = 0, sleepSec = 0 } = {}) => {
  const e = sanitizeAffect(emotion)
  const delta = -0.0005 * Math.max(0, busySec) + 0.0002 * Math.max(0, idleSec) + 0.002 * Math.max(0, sleepSec)
  return { ...e, energy: clamp01(e.energy + delta) }
}

// attention：目标驱动；2s 内达到 90%（契约 §4.1 的"时间常数 2s"按 fixture P05 口径实现）
export const approachAttention = (attention, target, dtSec) => {
  const a = clamp01(attention)
  const t = clamp01(target)
  const dt = Math.max(0, Number(dtSec) || 0)
  const factor = 1 - Math.pow(0.1, dt / 2)
  return clamp01(Math.max(ATTENTION_FLOOR, a + (t - a) * factor))
}

// 事件增量（appraisal 输出）叠加
export const applyDeltas = (emotion, delta = {}) => {
  const e = sanitizeAffect(emotion)
  return {
    valence: clampValence(e.valence + (Number(delta.valence) || 0)),
    arousal: clamp01(e.arousal + (Number(delta.arousal) || 0)),
    attention: clamp01(e.attention + (Number(delta.attention) || 0)),
    trust: clamp01(e.trust + (Number(delta.trust) || 0)),
    energy: clamp01(e.energy + (Number(delta.energy) || 0))
  }
}

// 组合 tick：先衰减，再活动/目标，再增量
export const tickAffect = (
  emotion,
  {
    elapsedSec = 0,
    busySec = 0,
    idleSec = 0,
    sleepSec = 0,
    attentionTarget = null,
    attentionDtSec = 0,
    delta = null
  } = {}
) => {
  let e = decayAffect(emotion, elapsedSec)
  e = updateEnergy(e, { busySec, idleSec, sleepSec })
  if (attentionTarget !== null && attentionDtSec > 0)
    e.attention = approachAttention(e.attention, attentionTarget, attentionDtSec)
  if (delta) e = applyDeltas(e, delta)
  return e
}

// 量化词（面板/LLM 只用词，数字不展示）
export const quantizeWords = (emotion) => {
  const e = sanitizeAffect(emotion)
  const v = e.valence
  const valence = v < -0.4 ? '难过' : v < -0.1 ? '有点低落' : v <= 0.25 ? '平静' : v <= 0.6 ? '开心' : '特别开心'
  const a = e.arousal
  const arousal = a < 0.25 ? '懒懒的' : a <= 0.55 ? '正常' : '有点兴奋'
  const en = e.energy
  const energy = en < 0.3 ? '有点累' : en <= 0.7 ? '正常' : '有精神'
  const at = e.attention
  const attention = at < 0.3 ? '没太注意' : at <= 0.65 ? '在看你' : '很专注你'
  return { valence, arousal, energy, attention }
}

// 关系阶段：满足即升，不降（调用方传 current 保留已达成阶段）
export const stageForEvidence = ({ days = 0, interactions = 0, deepTalks = 0, sharedMemories = 0 } = {}) => {
  const d = Number(days) || 0
  const i = Number(interactions) || 0
  const t = Number(deepTalks) || 0
  const m = Number(sharedMemories) || 0
  if (d >= 60 && t >= 10 && m >= 20) return 'R3'
  if (d >= 14 && t >= 3 && m >= 5) return 'R2'
  if (d >= 3 && i >= 20) return 'R1'
  return 'R0'
}

export const relationshipStage = (evidence, current = 'R0') => {
  const rank = (s) => STAGES.indexOf(s)
  const computed = stageForEvidence(evidence)
  return rank(computed) > rank(current) ? computed : current
}

export const stageLabel = (stage) => STAGE_LABELS[stage] || STAGE_LABELS.R0
export const stageTerm = (stage) => STAGE_TERMS[stage] || STAGE_TERMS.R0

// 兼容映射：旧 companion.json（mood/energy/affinity/level 派生一版）
export const toLegacy = (emotion, stage = 'R0') => {
  const e = sanitizeAffect(emotion)
  return {
    mood: Math.round(e.valence * 100),
    energy: Math.round(e.energy * 100),
    affinity: Math.round(e.trust * 100),
    level: stage,
    levelLabel: stageLabel(stage)
  }
}

export const fromLegacy = ({ mood = 10, energy = 70, affinity = 5 } = {}, stage = 'R0') => ({
  valence: clampValence(mood / 100),
  arousal: INITIAL_AFFECT.arousal,
  energy: clamp01(energy / 100),
  attention: INITIAL_AFFECT.attention,
  trust: clamp01(affinity / 100),
  stage
})

export const affectVersions = () => ({
  modelVersion: 1,
  doc: 'PERFORMANCE-CONTRACT §4',
  halfLivesSec: { ...HALF_LIVES_SEC },
  attention: 'target-driven, 2s→90%'
})
