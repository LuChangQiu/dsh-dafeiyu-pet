// affect 单元测试（普通脚本；node <file> 退出码=结果）
import assert from 'node:assert/strict'
import {
  INITIAL_AFFECT,
  HALF_LIVES_SEC,
  ATTENTION_TARGETS,
  decayAffect,
  updateEnergy,
  approachAttention,
  applyDeltas,
  tickAffect,
  quantizeWords,
  stageForEvidence,
  relationshipStage,
  stageLabel,
  toLegacy,
  fromLegacy,
  sanitizeAffect
} from '../lib/affect.js'

let pass = 0
let fail = 0
const run = (name, fn) => {
  try {
    fn()
    pass++
  } catch (err) {
    fail++
    console.error(`FAIL ${name}: ${err.message}`)
  }
}
const approx = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`)

run('initial affect matches contract', () => {
  assert.deepEqual(INITIAL_AFFECT, { valence: 0.1, arousal: 0.3, energy: 0.7, attention: 0.3, trust: 0.05 })
  assert.equal(HALF_LIVES_SEC.valence, 1800)
  assert.equal(HALF_LIVES_SEC.arousal, 300)
  assert.equal(HALF_LIVES_SEC.trust, 30 * 86400)
})

run('P03 valence half-life 30min', () => {
  const d = decayAffect({ valence: 0.5, arousal: 0.4 }, 1800)
  approx(d.valence, 0.25)
  approx(d.arousal, 0.4 * Math.pow(2, -6))
})

run('P04 busy energy -0.9 over 30min (clamped)', () => {
  const e = updateEnergy({ energy: 0.8 }, { busySec: 1800 })
  approx(e.energy, 0)
})

run('energy idle/sleep gains and clamp', () => {
  approx(updateEnergy({ energy: 0.5 }, { idleSec: 1800 }).energy, 0.86)
  approx(updateEnergy({ energy: 0.1 }, { sleepSec: 3600 }).energy, 1)
  approx(updateEnergy({ energy: 0.95 }, { sleepSec: 600 }).energy, 1)
})

run('P05 attention approaches 1.0 within 2s (>=0.9)', () => {
  const a = approachAttention(0.3, ATTENTION_TARGETS.userAction, 2)
  assert.ok(a >= 0.9, `attention after 2s should be >=0.9, got ${a}`)
  assert.ok(a <= 1)
})

run('attention floor 0.15 and clamps', () => {
  assert.ok(approachAttention(0.05, 0.15, 10) >= 0.15)
  assert.equal(approachAttention(2, 1, 2), 1)
  assert.equal(approachAttention(-1, 0, 2), 0.15)
})

run('event deltas clamp ranges', () => {
  const e = applyDeltas(
    { valence: 0.95, arousal: 0.95, attention: 0.95, trust: 0.99 },
    { valence: 0.2, arousal: 0.2, attention: 0.2, trust: 0.2 }
  )
  assert.equal(e.valence, 1)
  assert.equal(e.arousal, 1)
  assert.equal(e.attention, 1)
  assert.equal(e.trust, 1)
  const low = applyDeltas({ valence: -0.95 }, { valence: -0.2 })
  assert.equal(low.valence, -1)
})

run('sanitizeAffect defaults + clamps', () => {
  const e = sanitizeAffect({ valence: 9, arousal: -3, energy: 2, attention: 0.5, trust: -1 })
  assert.deepEqual(e, { valence: 1, arousal: 0, energy: 1, attention: 0.5, trust: 0 })
})

run('quantize words thresholds', () => {
  const w = quantizeWords({ valence: -0.5, arousal: 0.1, energy: 0.2, attention: 0.1 })
  assert.deepEqual(w, { valence: '难过', arousal: '懒懒的', energy: '有点累', attention: '没太注意' })
  const w2 = quantizeWords({ valence: 0.7, arousal: 0.6, energy: 0.8, attention: 0.7 })
  assert.deepEqual(w2, { valence: '特别开心', arousal: '有点兴奋', energy: '有精神', attention: '很专注你' })
  const w3 = quantizeWords({ valence: 0, arousal: 0.4, energy: 0.5, attention: 0.4 })
  assert.deepEqual(w3, { valence: '平静', arousal: '正常', energy: '正常', attention: '在看你' })
})

run('relationship stages R0-R3 with evidence', () => {
  assert.equal(stageForEvidence({}), 'R0')
  assert.equal(stageForEvidence({ days: 3, interactions: 20 }), 'R1')
  assert.equal(stageForEvidence({ days: 3, interactions: 19 }), 'R0')
  assert.equal(stageForEvidence({ days: 14, interactions: 30, deepTalks: 3, sharedMemories: 5 }), 'R2')
  assert.equal(stageForEvidence({ days: 60, interactions: 100, deepTalks: 10, sharedMemories: 20 }), 'R3')
  assert.equal(stageLabel('R2'), '朋友')
})

run('relationship stage never downgrades', () => {
  assert.equal(relationshipStage({ days: 0, interactions: 0 }, 'R2'), 'R2')
  assert.equal(relationshipStage({ days: 60, interactions: 100, deepTalks: 10, sharedMemories: 20 }, 'R1'), 'R3')
})

run('legacy mapping (+fromLegacy roundtrip)', () => {
  const legacy = toLegacy({ valence: 0.32, energy: 0.55, trust: 0.18 }, 'R1')
  assert.deepEqual(legacy, { mood: 32, energy: 55, affinity: 18, level: 'R1', levelLabel: '熟悉' })
  const back = fromLegacy({ mood: 32, energy: 55, affinity: 18 }, 'R1')
  approx(back.valence, 0.32, 1e-9)
  approx(back.energy, 0.55, 1e-9)
  approx(back.trust, 0.18, 1e-9)
})

run('tickAffect combines decay/energy/attention/delta', () => {
  const e = tickAffect(
    { valence: 0.5, arousal: 0.4, energy: 0.8, attention: 0.3, trust: 0.1 },
    { elapsedSec: 1800, busySec: 1800, attentionTarget: 1.0, attentionDtSec: 2, delta: { valence: 0.12, trust: 0.001 } }
  )
  approx(e.valence, 0.25 + 0.12, 1e-9)
  assert.equal(e.energy, 0)
  assert.ok(e.attention >= 0.9)
  approx(e.trust, 0.1 * Math.pow(2, -1800 / HALF_LIVES_SEC.trust) + 0.001, 1e-9)
})

console.log(`affect tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
