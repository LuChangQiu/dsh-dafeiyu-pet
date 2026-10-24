// performance-fixtures（v1.1，32 条）契约绑定测试：P01–P08 与实现口径对齐
// 其余 fixtures（P09+）由后续 motivation/perf 完整接线窗口覆盖；本测试保证 vendored fixtures 被真实消费。
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appraise } from '../lib/appraisal.js'
import { decayAffect, updateEnergy, approachAttention } from '../lib/affect.js'
import { selectIntent, updateRejection, REJECTION_PAUSE_MS } from '../lib/motivation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesPath = join(__dirname, 'fixtures', 'performance-fixtures.v1.1.jsonl')
if (!existsSync(fixturesPath)) {
  console.error(`fixtures missing: ${fixturesPath}`)
  process.exit(1)
}
const lines = readFileSync(fixturesPath, 'utf8').split(/\r?\n/).filter(Boolean)
if (lines.length !== 32) {
  console.error(`fixtures count mismatch: got ${lines.length}, want 32`)
  process.exit(1)
}
const fixtures = new Map()
for (const line of lines) {
  try {
    const f = JSON.parse(line)
    fixtures.set(f.id, f)
  } catch (err) {
    console.error(`invalid json: ${err.message}`)
    process.exit(1)
  }
}
for (const id of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']) {
  if (!fixtures.has(id)) {
    console.error(`fixtures missing id: ${id}`)
    process.exit(1)
  }
}

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
const approx = (actual, expected, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}±${eps}, got ${actual}`)
const baseAffectCtx = (over = {}) => ({
  eventKey: 'turn/end:completed',
  state: 'done',
  emotion: { valence: 0.1, arousal: 0.3, energy: 0.6, attention: 0.7 },
  stage: 'R1',
  attention: 0.7,
  budget: { proactiveUsed: 0, proactiveMax: 3, surpriseUsed: 0, surpriseMax: 3, rareUsedThisWeek: 0 },
  rejection: { streak: 0, pauseUntil: null },
  mode: 'active',
  minutesOfDay: 14 * 60,
  nowMs: Date.parse('2026-10-24T14:00:00+08:00'),
  facts: {},
  repeats: {},
  ...over
})

run('P01 turn/end completed appraisal delta', () => {
  const f = fixtures.get('P01')
  const event = f.given.events[0]
  const r = appraise(event, { countThisSession: 1 })
  approx(r.scaledDelta.valence, f.expect.delta.valence, 0.01)
  approx(r.scaledDelta.arousal, f.expect.delta.arousal, 0.01)
  assert.ok(f.expect.intentCandidates.includes('celebrate_done'))
})

run('P02 same-session repeat decay 0.85^2', () => {
  const f = fixtures.get('P02')
  const event = f.given.events[0]
  const r = appraise(event, { countThisSession: f.given.events[0].countThisSession })
  approx(r.scaledDelta.valence, 0.12 * 0.85 * 0.85, 0.002)
  approx(r.scaledDelta.arousal, 0.05 * 0.85 * 0.85, 0.002)
})

run('P03 valence half-life 30min', () => {
  const f = fixtures.get('P03')
  const d = decayAffect(f.given.emotion, f.given.elapsedSec)
  approx(d.valence, f.expect.valence, 0.01)
})

run('P04 busy energy -0.9/30min clamp', () => {
  const f = fixtures.get('P04')
  const e = updateEnergy({ energy: f.given.emotion.energy }, { busySec: f.given.busySec })
  approx(e.energy, f.expect.result, 0.01)
})

run('P05 attention target + wait_approval S0', () => {
  const f = fixtures.get('P05')
  const a = approachAttention(f.given.emotion.attention, f.expect.attentionTarget, 2)
  assert.ok(a >= 0.9, `attention=${a}`)
  const sel = selectIntent(
    baseAffectCtx({ eventKey: 'approval/asked', state: 'approval', attention: f.expect.attentionTarget })
  )
  assert.equal(sel.intent, f.expect.intent)
})

run('P06 error + low mood → comfort_error (not celebrate)', () => {
  const f = fixtures.get('P06')
  const sel = selectIntent(
    baseAffectCtx({
      eventKey: 'agent/request-error:error',
      state: 'error',
      emotion: f.given.emotion,
      attention: f.given.emotion.attention
    })
  )
  assert.equal(sel.intent, f.expect.intent)
  assert.ok(!sel.ranked.some((x) => x.id === f.expect.not))
})

run('P07 proactive hard cap gates proactive intents', () => {
  const f = fixtures.get('P07')
  const sel = selectIntent(
    baseAffectCtx({
      eventKey: 'default',
      state: 'idle',
      attention: f.given.emotion.attention,
      facts: { idleSkit: true, longSilence: true, morning: true },
      budget: { ...f.given.budget, surpriseUsed: 0, surpriseMax: 3, rareUsedThisWeek: 0 }
    })
  )
  assert.ok(!sel.ranked.some((x) => ['proactive', 'surprise'].includes(x.cls)))
  assert.equal(f.expect.hardCap, 4)
})

run('P08 rejection streak 2 → pause 24h + proactive gated', () => {
  const f = fixtures.get('P08')
  const nowIso = f.given.now
  const rej = updateRejection({ rejection: { streak: f.given.rejection.streak }, signal: 'ignored', nowIso })
  assert.equal(Date.parse(rej.pauseUntil) - Date.parse(nowIso), REJECTION_PAUSE_MS)
  assert.equal(Date.parse(rej.pauseUntil), Date.parse(f.expect.rejection.pauseUntil))
  const sel = selectIntent(
    baseAffectCtx({
      eventKey: 'default',
      state: 'idle',
      facts: { idleSkit: true, longSilence: true },
      rejection: rej
    })
  )
  assert.ok(!sel.ranked.some((x) => ['proactive', 'surprise'].includes(x.cls)))
})

console.log(`performance-fixtures contract tests: ${pass}/${pass + fail} pass (32 fixtures vendored)`)
if (fail) process.exit(1)
