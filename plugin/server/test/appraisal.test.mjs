// appraisal 单元测试（普通脚本；node <file> 退出码=结果）
import assert from 'node:assert/strict'
import { appraise, classifyAppraisalEvent, noveltyFactor, APPRAISAL_TABLE } from '../lib/appraisal.js'

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

run('P01 turn/end completed delta', () => {
  const r = appraise({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, { countThisSession: 1 })
  assert.equal(r.key, 'turn/end:completed')
  approx(r.scaledDelta.valence, 0.12)
  approx(r.scaledDelta.arousal, 0.05)
  approx(r.scaledDelta.attention, 0)
  approx(r.scaledDelta.trust, 0.001)
  assert.equal(r.novelty, 1)
})

run('P02 same-session repeat novelty decay 0.85^2', () => {
  const r = appraise({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, { countThisSession: 3 })
  approx(r.scaledDelta.valence, 0.12 * 0.85 * 0.85, 1e-12)
  approx(r.scaledDelta.arousal, 0.05 * 0.85 * 0.85, 1e-12)
  approx(r.novelty, 0.7225, 1e-12)
})

run('novelty floor 0.3', () => {
  approx(noveltyFactor(50), 0.3)
  approx(noveltyFactor(1), 1)
})

run('aborted / error deltas', () => {
  const ab = appraise({ t: 'turn/end', data: { reason: { kind: 'aborted' } } })
  approx(ab.scaledDelta.valence, -0.03)
  approx(ab.scaledDelta.attention, 0.1)
  const err = appraise({ t: 'turn/end', data: { reason: { kind: 'error' } } })
  approx(err.scaledDelta.valence, -0.12)
  approx(err.scaledDelta.arousal, 0.1)
})

run('agent error code category rate_limit', () => {
  const r = appraise({ t: 'agent/request-error', data: { failure: { code: 'RATE_LIMIT' } } })
  assert.equal(r.category, 'rate_limit')
  approx(r.scaledDelta.valence, -0.1)
})

run('llm retry single vs escalate', () => {
  const single = classifyAppraisalEvent({ t: 'llm/retry', data: {} }, { retryStreak: 2 })
  const esc = classifyAppraisalEvent({ t: 'llm/retry', data: {} }, { retryStreak: 3 })
  assert.equal(single, 'llm/retry:single')
  assert.equal(esc, 'llm/retry:escalate')
  approx(appraise({ t: 'llm/retry', data: {} }, { retryStreak: 3 }).scaledDelta.valence, -0.08)
})

run('approval asked / decided', () => {
  const asked = appraise({ t: 'approval/asked', data: { toolName: 'pwsh' } })
  approx(asked.scaledDelta.attention, 0.4)
  approx(asked.scaledDelta.arousal, 0.1)
  assert.equal(asked.dimensions.agency, 'user')
  const allowed = appraise({ t: 'approval/decided', data: { outcome: 'allowed' } })
  approx(allowed.scaledDelta.valence, 0.05)
  approx(allowed.scaledDelta.trust, 0.002)
  const rejected = appraise({ t: 'approval/decided', data: { outcome: 'rejected' } })
  approx(rejected.scaledDelta.valence, -0.08)
  approx(rejected.scaledDelta.arousal, 0.05)
})

run('neutral event produces no emotion delta (attention only)', () => {
  const r = appraise({ t: 'assistant/message', data: { usage: { totalTokens: 10 } } })
  assert.equal(r.key, 'default')
  approx(r.scaledDelta.valence, 0)
  approx(r.scaledDelta.arousal, 0)
  approx(r.scaledDelta.attention, 0)
})

run('six appraisal dimensions present and bounded', () => {
  for (const key of Object.keys(APPRAISAL_TABLE)) {
    const d = APPRAISAL_TABLE[key].dims
    for (const k of ['goalCongruence', 'certainty', 'novelty', 'control']) {
      assert.ok(typeof d[k] === 'number' && d[k] >= -1 && d[k] <= 1, `${key}.${k} out of range`)
    }
    assert.ok(typeof d.agency === 'string' && typeof d.social === 'number')
  }
})

run('goal complete celebration deltas', () => {
  const r = appraise({ t: 'goal/change', data: { status: 'complete' } })
  approx(r.scaledDelta.valence, 0.2)
  approx(r.scaledDelta.arousal, 0.15)
  approx(r.scaledDelta.trust, 0.003)
})

console.log(`appraisal tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
