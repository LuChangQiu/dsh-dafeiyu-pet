// motivation 单元测试（普通脚本；node <file> 退出码=结果）
import assert from 'node:assert/strict'
import {
  INTENTS,
  PROACTIVE_POLICY,
  REJECTION_PAUSE_MS,
  moodFactor,
  attentionGate,
  relationshipFactor,
  satiety,
  budgetGate,
  utilityOf,
  selectIntent,
  shouldInterrupt,
  updateRejection,
  intentById,
  isNightMinutes
} from '../lib/motivation.js'

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
const baseCtx = (over = {}) => ({
  eventKey: 'turn/end:completed',
  state: 'done',
  emotion: { valence: 0.2, arousal: 0.4, energy: 0.6, attention: 0.6 },
  stage: 'R1',
  attention: 0.6,
  budget: { proactiveUsed: 0, proactiveMax: 3, surpriseUsed: 0, surpriseMax: 3, rareUsedThisWeek: 0 },
  rejection: { streak: 0, pauseUntil: null },
  mode: 'normal',
  minutesOfDay: 14 * 60,
  nowMs: Date.parse('2026-10-24T14:00:00+08:00'),
  facts: {},
  repeats: {},
  ...over
})

run('18 intents catalog', () => {
  assert.equal(INTENTS.length, 18)
  for (const id of [
    'react_ack',
    'comment_work',
    'comfort_error',
    'celebrate_done',
    'celebrate_goal',
    'comfort_block',
    'wait_approval',
    'wait_input',
    'announce_job',
    'note_switch',
    'observe_stuck',
    'report_cost',
    'idle_skit',
    'greet',
    'ask_attention',
    'prank',
    'rare_ritual',
    'rest_onset'
  ])
    assert.ok(intentById(id), `missing intent ${id}`)
})

run('P06 error + low mood → comfort_error, not celebrate', () => {
  const r = selectIntent(
    baseCtx({
      eventKey: 'agent/request-error:error',
      state: 'error',
      emotion: { valence: -0.4, arousal: 0.6, energy: 0.5, attention: 0.7 }
    })
  )
  assert.equal(r.intent, 'comfort_error')
  assert.ok(!r.ranked.some((x) => x.id === 'celebrate_done'))
  assert.ok(r.utility >= 0.35)
})

run('P07 proactive budget hard cap gates all proactive intents', () => {
  const r = selectIntent(
    baseCtx({
      eventKey: 'default',
      state: 'idle',
      attention: 0.6,
      facts: { idleSkit: true, longSilence: true, morning: true },
      budget: { proactiveUsed: 4, proactiveMax: 4, surpriseUsed: 0, surpriseMax: 3, rareUsedThisWeek: 0 }
    })
  )
  const proactiveIds = ['idle_skit', 'greet', 'ask_attention', 'prank']
  assert.ok(!r.ranked.some((x) => proactiveIds.includes(x.id)))
  const gatedBudget = r.gated.filter((g) => g.reasons.includes('budget')).map((g) => g.id)
  for (const id of ['idle_skit', 'greet', 'ask_attention'])
    assert.ok(gatedBudget.includes(id), `${id} should be budget-gated`)
})

run('P08 rejection streak 2 → pause 24h and proactive gated', () => {
  const nowIso = '2026-10-24T14:00:00+08:00'
  const rej = updateRejection({ rejection: { streak: 1, pauseUntil: null }, signal: 'ignored', nowIso })
  assert.equal(rej.streak, 0)
  assert.ok(rej.pauseUntil)
  const diff = Date.parse(rej.pauseUntil) - Date.parse(nowIso)
  assert.equal(diff, REJECTION_PAUSE_MS)
  const r = selectIntent(
    baseCtx({
      eventKey: 'default',
      state: 'idle',
      facts: { idleSkit: true, longSilence: true },
      rejection: rej
    })
  )
  assert.ok(!r.ranked.some((x) => x.cls === 'proactive' || x.cls === 'surprise'))
  const rejGated = r.gated.filter((g) => g.reasons.includes('rejection')).map((g) => g.id)
  assert.ok(rejGated.includes('idle_skit'))
})

run('quiet signal pauses proactive 24h; userInteraction clears streak', () => {
  const nowIso = '2026-10-24T14:00:00+08:00'
  const q = updateRejection({ rejection: { streak: 1 }, signal: 'quiet', nowIso })
  assert.equal(q.streak, 0)
  assert.equal(Date.parse(q.pauseUntil) - Date.parse(nowIso), REJECTION_PAUSE_MS)
  const u = updateRejection({ rejection: { streak: 2, pauseUntil: q.pauseUntil }, signal: 'userInteraction', nowIso })
  assert.equal(u.streak, 0)
})

run('rare ritual gated when weekly used', () => {
  const r = selectIntent(
    baseCtx({
      eventKey: 'default',
      state: 'idle',
      facts: { rareEligible: true },
      budget: { proactiveUsed: 0, proactiveMax: 3, surpriseUsed: 0, surpriseMax: 3, rareUsedThisWeek: 1 }
    })
  )
  assert.ok(!r.ranked.some((x) => x.id === 'rare_ritual'))
})

run('surprise budget gated at max', () => {
  const r = selectIntent(
    baseCtx({
      eventKey: 'default',
      state: 'idle',
      facts: { prankEligible: true },
      budget: { proactiveUsed: 0, proactiveMax: 3, surpriseUsed: 3, surpriseMax: 3, rareUsedThisWeek: 0 }
    })
  )
  assert.ok(!r.ranked.some((x) => x.id === 'prank'))
})

run('night gate blocks proactive (23:30–08:00)', () => {
  assert.equal(isNightMinutes(23 * 60 + 40), true)
  assert.equal(isNightMinutes(7 * 60 + 30), true)
  assert.equal(isNightMinutes(14 * 60), false)
  const r = selectIntent(
    baseCtx({
      eventKey: 'default',
      state: 'idle',
      minutesOfDay: 23 * 60 + 40,
      facts: { idleSkit: true, longSilence: true }
    })
  )
  assert.ok(!r.ranked.some((x) => x.cls === 'proactive' || x.cls === 'surprise'))
})

run('mode gate blocks proactive (silent/focus/off), S0 unaffected', () => {
  for (const mode of ['silent', 'focus', 'off']) {
    const r = selectIntent(
      baseCtx({
        eventKey: 'default',
        state: 'idle',
        mode,
        facts: { idleSkit: true, morning: true }
      })
    )
    assert.ok(!r.ranked.some((x) => x.cls === 'proactive' || x.cls === 'surprise'), `mode ${mode}`)
  }
  const s0 = selectIntent(baseCtx({ eventKey: 'approval/asked', state: 'approval', mode: 'silent' }))
  assert.equal(s0.intent, 'wait_approval')
})

run('novelty decay reduces repeated utility', () => {
  const ctx = baseCtx({ eventKey: 'turn/end:completed', state: 'done', repeats: {} })
  const u1 = utilityOf(intentById('celebrate_done'), ctx).utility
  const u3 = utilityOf(intentById('celebrate_done'), { ...ctx, repeats: { celebrate_done: 2 } }).utility
  assert.ok(u3 < u1, `expected decay, u1=${u1} u3=${u3}`)
})

run('hysteresis keeps current intent within 0.1', () => {
  const ctx = baseCtx({ eventKey: 'turn/end:completed', state: 'done' })
  const first = selectIntent(ctx)
  assert.ok(first.intent)
  const again = selectIntent({ ...ctx, currentIntentId: first.intent })
  assert.equal(again.intent, first.intent)
  assert.equal(again.hysteresis, true)
})

run('interrupt rules: user priority, S0, E1 coexist', () => {
  assert.equal(shouldInterrupt({ currentIntent: { cls: 'proactive' }, userAction: true }).interrupt, true)
  assert.equal(shouldInterrupt({ currentIntent: { cls: 'proactive' }, state: 'approval' }).interrupt, true)
  assert.equal(shouldInterrupt({ currentIntent: { cls: 'proactive' }, state: 'tool' }).interrupt, false)
  assert.equal(shouldInterrupt({ currentIntent: { cls: 'reactive' }, state: 'tool' }).interrupt, false)
})

run('utility factor helpers bounded', () => {
  assert.ok(moodFactor({ valence: -1, arousal: 0, energy: 0 }) >= 0.7)
  assert.ok(moodFactor({ valence: 1, arousal: 1, energy: 1 }) <= 1.3)
  assert.ok(attentionGate(0) >= 0.3 && attentionGate(1) <= 1)
  assert.equal(relationshipFactor('R3'), 1.2)
  assert.equal(satiety(2, 4), 0.5)
  assert.equal(budgetGate('proactive', { proactiveUsed: 3, proactiveMax: 3 }), 0)
  assert.equal(budgetGate('reactive', {}), 1)
})

run('S0 intent wins when approval pending', () => {
  const r = selectIntent(
    baseCtx({
      eventKey: 'approval/asked',
      state: 'approval',
      emotion: { valence: 0.1, arousal: 0.3, energy: 0.6, attention: 0.8 }
    })
  )
  assert.equal(r.intent, 'wait_approval')
})

run('policy constants match contract', () => {
  assert.deepEqual(
    {
      proactiveMax: PROACTIVE_POLICY.maxPerDay,
      surpriseMax: PROACTIVE_POLICY.surpriseMaxPerDay,
      rareMax: PROACTIVE_POLICY.rareMaxPerWeek,
      quietPauseHours: PROACTIVE_POLICY.quietPauseHours,
      streak: PROACTIVE_POLICY.ignoredStreakToPause
    },
    { proactiveMax: 4, surpriseMax: 3, rareMax: 1, quietPauseHours: 24, streak: 2 }
  )
})

console.log(`motivation tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
