// state-layer 接线测试（state → appraisal → affect → motivation → perf-script）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStateLayer } from '../lib/state-layer.js'
import { buildVocabulary, validateScript } from '../lib/perf-script.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..', '..')
const stateMap = JSON.parse(readFileSync(join(root, 'config', 'state-map.json'), 'utf8'))
const vocab = buildVocabulary(stateMap)

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
const make = (over = {}) =>
  createStateLayer({
    stateMap,
    now: () => 0,
    ...over,
    mode: () => over.mode || 'active',
    config: { enabled: true, motivation: true, scripts: true, ...(over.config || {}) }
  })
const ctx = (over = {}) => ({ mode: 'active', nowMs: 1000, minutesOfDay: 14 * 60, attentionDtSec: 2, ...over })

run('default P0: state + affect only, no intent/script', () => {
  const layer = make({ config: { motivation: false, scripts: false } })
  const snap = layer.handle({ t: 'turn/start', data: { turn: 1 } }, ctx())
  assert.equal(snap.state, 'thinking')
  assert.equal(snap.intent, null)
  assert.equal(snap.script, null)
  for (const k of ['valence', 'arousal', 'energy', 'attention', 'trust']) assert.equal(typeof snap.emotion[k], 'number')
  for (const k of ['valence', 'arousal', 'energy', 'attention']) assert.equal(typeof snap.words[k], 'string')
  assert.ok(snap.relationship.stage.startsWith('R'))
  assert.equal(typeof snap.legacy.mood, 'number')
  assert.equal(snap.legacy.level, snap.relationship.stage)
})

run('no event → no fabricated busy state', () => {
  const layer = make()
  const snap = layer.snapshot()
  assert.equal(snap.state, 'idle')
  assert.equal(snap.intent, null)
  assert.equal(snap.script, null)
})

run('approval/asked → approval state + attention up + wait_approval S0 script', () => {
  const layer = make()
  const snap = layer.handle({ t: 'approval/asked', data: { id: 'a1', toolName: 'pwsh' } }, ctx())
  assert.equal(snap.state, 'approval')
  assert.equal(snap.intent.id, 'wait_approval')
  assert.ok(snap.emotion.attention >= 0.9, `attention=${snap.emotion.attention}`)
  assert.ok(snap.script)
  const r = validateScript(snap.script, vocab)
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const bubble = snap.script.layers.find((l) => l.track === 'bubble')
  assert.equal(bubble.level, 'S0')
  assert.equal(bubble.kind, 'remind')
})

run('turn/end completed → celebrate_done script (valid, cheer)', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  const snap = layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  assert.equal(snap.state, 'done')
  assert.equal(snap.intent.id, 'celebrate_done')
  assert.ok(snap.script)
  assert.equal(validateScript(snap.script, vocab).ok, true)
  assert.ok(snap.script.layers.some((l) => l.track === 'action' && l.composite === 'cheer'))
})

run('agent error → comfort_error script, not celebrate', () => {
  const layer = make({ emotion: { valence: -0.4, arousal: 0.6 } })
  const snap = layer.handle({ t: 'agent/request-error', data: { failure: { code: 'RATE_LIMIT' } } }, ctx())
  assert.equal(snap.state, 'error')
  assert.equal(snap.intent.id, 'comfort_error')
  assert.equal(validateScript(snap.script, vocab).ok, true)
})

run('background session → state unchanged + counters, no script', () => {
  const layer = make({ sessionRole: 'subagent', currentSessionId: 's1' })
  const snap = layer.handle({ t: 'tool/call', data: { name: 'read', callId: 'c1' } }, ctx())
  assert.equal(snap.state, 'idle')
  assert.equal(snap.counters.backgroundCount, 1)
  assert.equal(snap.script, null)
  assert.equal(snap.intent, null)
})

run('quiet mode blocks proactive but not reactive', () => {
  const layer = make({ mode: 'silent' })
  const snap = layer.handle({ t: 'assistant/message', data: { usage: { totalTokens: 1 } } }, ctx({ mode: 'silent' }))
  assert.equal(snap.intent, null)
  const s0 = make({ mode: 'silent' })
  const s0snap = s0.handle({ t: 'approval/asked', data: { id: 'a2', toolName: 'bash' } }, ctx({ mode: 'silent' }))
  assert.equal(s0snap.intent.id, 'wait_approval')
})

run('rejection: two ignored → pause + proactive gated', () => {
  const layer = make({ config: { motivation: true, scripts: false } })
  layer.handle(
    { t: 'assistant/message', data: {} },
    ctx({ rejectionSignal: 'ignored', nowIso: '2026-10-24T14:00:00+08:00' })
  )
  layer.handle(
    { t: 'assistant/message', data: {} },
    ctx({ rejectionSignal: 'ignored', nowIso: '2026-10-24T14:01:00+08:00' })
  )
  const rej = layer._debug.getRejection()
  assert.ok(rej.pauseUntil, JSON.stringify(rej))
  const snap = layer.handle({ t: 'assistant/message', data: {} }, ctx({ facts: { idleSkit: true, longSilence: true } }))
  assert.notEqual(snap.intent && snap.intent.cls, 'proactive')
})

run('tick decays valence half-life 30min', () => {
  const layer = make({ emotion: { valence: 0.5, arousal: 0.3 } })
  const before = layer.snapshot().emotion.valence
  // 用 handle 的 elapsedSec 触发衰减
  layer.handle({ t: 'assistant/message', data: {} }, ctx({ elapsedSec: 1800, attentionDtSec: 0 }))
  const after = layer.snapshot().emotion.valence
  assert.ok(Math.abs(before - 0.5) < 1e-9)
  assert.ok(after <= 0.27, `after=${after}`)
})

run('user interrupt clears current intent', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  assert.ok(layer._debug.getIntent())
  const r = layer.interrupt({ userAction: true })
  assert.equal(r.interrupt, true)
  assert.equal(layer._debug.getIntent(), null)
})

run('s0 approval interrupts proactive intent', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  const r = layer.interrupt({ state: 'approval', eventKey: 'approval/asked' })
  assert.equal(r.interrupt, true)
  assert.equal(r.reason, 's0')
})

run('schedule/panel-only event never produces script', () => {
  const layer = make()
  const snap = layer.handle({ t: 'schedule/change', data: {} }, ctx())
  assert.equal(snap.script, null)
  assert.notEqual(snap.intent && snap.intent.id, 'rare_ritual')
})

run('emotion words map thresholds (panel vocabulary)', () => {
  const layer = make({ emotion: { valence: 0.7, arousal: 0.6, energy: 0.8, attention: 0.7 } })
  const snap = layer.snapshot()
  assert.equal(snap.words.valence, '特别开心')
  assert.equal(snap.words.energy, '有精神')
  assert.equal(snap.words.attention, '很专注你')
})

run('budget accounting increments on proactive intent', () => {
  const layer = make({ config: { motivation: true, scripts: false }, emotion: { attention: 0.7 } })
  layer.handle(
    { t: 'assistant/message', data: {} },
    ctx({ facts: { idleSkit: true, longSilence: true, morning: true } })
  )
  const b = layer._debug.getBudget()
  assert.ok(b.proactiveUsed >= 1, JSON.stringify(b))
})

run('script rejection falls back to baseline and is still valid', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  const snap = layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  assert.ok(snap.script)
  assert.equal(validateScript(snap.script, vocab).ok, true)
  assert.equal(snap.script.rejected, undefined)
})

run('default config disabled → baseline only (no state/affect/intent/script updates)', () => {
  const layer = createStateLayer({ stateMap, now: () => 0, mode: () => 'active' })
  assert.equal(layer.enabled, false)
  const snap = layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  assert.equal(snap.state, 'idle')
  assert.equal(snap.intent, null)
  assert.equal(snap.script, null)
  assert.equal(snap.counters.dispatchCount, 0)
  assert.equal(snap.emotion.attention, 0.3)
  assert.equal(layer.tick({ elapsedSec: 1800 }).emotion.valence, 0.1)
})

run('explicit enabled:true produces state/affect/intent/script', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  assert.equal(layer.enabled, true)
  const snap = layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  assert.equal(snap.state, 'done')
  assert.ok(snap.intent)
  assert.ok(snap.script)
})

run('kill switch: setEnabled(false) freezes output + clears intent/script, re-enable works', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  const first = layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  assert.equal(first.state, 'done')
  assert.ok(first.script)
  const off = layer.setEnabled(false)
  assert.equal(off.script, null)
  assert.equal(off.intent, null)
  assert.equal(layer.handle({ t: 'approval/asked', data: { id: 'a9', toolName: 'bash' } }, ctx()).state, 'done')
  assert.equal(layer.tick({ elapsedSec: 1800 }).emotion.valence, off.emotion.valence)
  const on = layer.setEnabled(true)
  assert.equal(on.script, null)
  const resumed = layer.handle({ t: 'approval/asked', data: { id: 'a9', toolName: 'bash' } }, ctx())
  assert.equal(resumed.state, 'approval')
  assert.equal(resumed.intent.id, 'wait_approval')
})

run('kill switch disables interrupt handling', () => {
  const layer = make({ emotion: { attention: 0.7 } })
  layer.handle({ t: 'turn/end', data: { reason: { kind: 'completed' } } }, ctx())
  layer.setEnabled(false)
  const r = layer.interrupt({ userAction: true })
  assert.equal(r.interrupt, false)
  assert.equal(r.reason, 'disabled')
})

console.log(`state-layer tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
