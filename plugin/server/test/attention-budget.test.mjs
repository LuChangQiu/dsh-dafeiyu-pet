// attention-budget 单元测试（纯逻辑；注入 clock/dayKey；无 DSH/pipe/IO 热路径）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ATTENTION_DEFAULTS,
  createAttentionBudget,
  deserializeBudgetState,
  serializeBudgetState,
  writeBudgetStateAtomic,
  readBudgetState,
  localDayKey,
  localMinutesOfDay,
  isNightMinutes
} from '../lib/attention-budget.js'

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
const localMs = (h, m = 0, d = 24) => new Date(2026, 9, d, h, m, 0, 0).getTime()
const baseMs = localMs(12, 0)
let dayKey = '2026-10-24'
const mk = (over = {}) =>
  createAttentionBudget({
    now: () => baseMs,
    dayKeyFn: () => dayKey,
    ...over
  })

run('defaults: 3/day, hard cap 4, reactions not counted', () => {
  const b = mk()
  assert.equal(b.config.proactivePerDay, 3)
  assert.equal(b.config.proactiveHardCap, 4)
  assert.equal(b.canSpeak({ nowMs: baseMs }).allowed, true)
  assert.equal(b.recordProactive({ nowMs: baseMs }).ok, true)
  assert.equal(b.recordProactive({ nowMs: baseMs }).ok, true)
  assert.equal(b.recordProactive({ nowMs: baseMs }).ok, true)
  const fourth = b.canSpeak({ nowMs: baseMs })
  assert.equal(fourth.allowed, false)
  assert.equal(fourth.reason, 'budget')
  // 事件反应不计入、不受预算限制
  const reaction = b.canSpeak({ nowMs: baseMs, isReaction: true })
  assert.equal(reaction.allowed, true)
  assert.equal(reaction.reason, 'reaction')
  b.recordReaction()
  assert.equal(b.view(baseMs).proactiveUsed, 3)
})

run('config perDay > hard cap is clamped to 4', () => {
  const b = mk({ config: { proactivePerDay: 99 } })
  assert.equal(b.config.proactivePerDay, 4)
  for (let i = 0; i < 4; i++) assert.equal(b.recordProactive({ nowMs: baseMs }).ok, true)
  assert.equal(b.canSpeak({ nowMs: baseMs }).allowed, false)
  assert.equal(b.getState().proactiveUsed, 4)
})

run('perDay=0 gates all proactive', () => {
  const b = mk({ config: { proactivePerDay: 0 } })
  const r = b.canSpeak({ nowMs: baseMs })
  assert.equal(r.allowed, false)
  assert.equal(r.reason, 'budget')
})

run('day rollover resets budget but keeps rejection pause', () => {
  const b = mk()
  for (let i = 0; i < 3; i++) b.recordProactive({ nowMs: baseMs })
  b.recordIgnored({ nowMs: baseMs })
  b.recordIgnored({ nowMs: baseMs })
  const before = b.view(baseMs)
  assert.equal(before.proactiveUsed, 3)
  assert.equal(before.paused, true)
  dayKey = '2026-10-25'
  const nextMs = localMs(9, 0, 25)
  const r = b.canSpeak({ nowMs: nextMs })
  assert.equal(r.dayKey, '2026-10-25')
  assert.equal(r.proactiveUsed, 0)
  assert.equal(r.paused, true, 'rejection pause survives day rollover')
  assert.equal(r.reason, 'rejection-pause')
})

run('suppression gates: night / dnd / fullscreen / typing / quiet modes', () => {
  assert.equal(isNightMinutes(23 * 60 + 40), true)
  assert.equal(isNightMinutes(7 * 60 + 59), true)
  assert.equal(isNightMinutes(8 * 60), false)
  assert.equal(isNightMinutes(14 * 60), false)
  const cases = [
    [{ nowMs: localMs(23, 40) }, 'night'],
    [{ nowMs: localMs(7, 30) }, 'night'],
    [{ nowMs: baseMs, dnd: true }, 'dnd'],
    [{ nowMs: baseMs, fullscreen: true }, 'fullscreen'],
    [{ nowMs: baseMs, typing: true }, 'typing'],
    [{ nowMs: baseMs, mode: 'silent' }, 'mode-quiet'],
    [{ nowMs: baseMs, mode: 'focus' }, 'mode-quiet'],
    [{ nowMs: baseMs, mode: 'off' }, 'mode-quiet']
  ]
  for (const [ctx, reason] of cases) {
    const b = mk()
    const r = b.canSpeak({ ...ctx, isReaction: false })
    assert.equal(r.allowed, false, JSON.stringify(ctx))
    assert.equal(r.reason, reason, JSON.stringify(ctx))
    assert.equal(r.suppressed, true)
  }
  const ok = mk().canSpeak({ nowMs: baseMs, mode: 'active' })
  assert.equal(ok.allowed, true)
})

run('rejection: 2 ignored → 24h pause + frequency 0.5; next day allowed', () => {
  const b = mk()
  const first = b.recordIgnored({ nowMs: baseMs })
  assert.equal(first.rejection.count, 1)
  assert.equal(first.paused, false, 'first ignored should not pause')
  assert.equal(b.canSpeak({ nowMs: baseMs }).allowed, true)
  const secondAt = baseMs + 60_000
  b.recordIgnored({ nowMs: secondAt })
  const paused = b.view(secondAt)
  assert.equal(paused.paused, true)
  assert.equal(paused.rejection.kind, 'ignored')
  assert.equal(paused.frequencyFactor, 0.5)
  assert.equal(b.canSpeak({ nowMs: secondAt }).reason, 'rejection-pause')
  assert.equal(b.recordProactive({ nowMs: secondAt }).ok, false)
  const after24h = secondAt + ATTENTION_DEFAULTS.rejection.pauseHours * 3600 * 1000 + 1
  const resumed = b.canSpeak({ nowMs: after24h })
  assert.equal(resumed.allowed, true)
  assert.equal(resumed.frequencyFactor, 1)
})

run('explicit quiet → immediate 24h pause kind=quiet', () => {
  const b = mk()
  b.recordQuiet({ nowMs: baseMs })
  const v = b.view(baseMs)
  assert.equal(v.paused, true)
  assert.equal(v.rejection.kind, 'quiet')
  assert.equal(v.frequencyFactor, 0.5)
  const after = baseMs + 24 * 3600 * 1000 + 1
  assert.equal(b.canSpeak({ nowMs: after }).allowed, true)
})

run('user interaction clears rejection/topic avoid immediately', () => {
  const b = mk()
  b.recordQuiet({ topic: 'work', nowMs: baseMs })
  assert.equal(b.canSpeak({ nowMs: baseMs, topic: 'work' }).reason, 'rejection-pause')
  b.recordUserInteraction({ nowMs: baseMs + 1000 })
  const v = b.view(baseMs + 1000)
  assert.equal(v.paused, false)
  assert.equal(v.rejection.count, 0)
  assert.equal(b.canSpeak({ nowMs: baseMs + 1000, topic: 'work' }).allowed, true)
})

run('topic avoid: 7 days after rejection, then allowed', () => {
  const b = mk()
  b.recordIgnored({ topic: 'deploy', nowMs: baseMs }) // count=1, no pause yet
  const blocked = b.canSpeak({ nowMs: baseMs + 1000, topic: 'deploy' })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.reason, 'topic-avoid')
  const other = b.canSpeak({ nowMs: baseMs + 1000, topic: 'life' })
  assert.equal(other.allowed, true)
  const after7d = baseMs + 7 * 86400 * 1000 + 1000
  assert.equal(b.canSpeak({ nowMs: after7d, topic: 'deploy' }).allowed, true)
})

run('state serialize/deserialize roundtrip + clamp + corrupt fallback', () => {
  const b = mk()
  b.recordProactive({ nowMs: baseMs })
  b.recordIgnored({ topic: 'x', nowMs: baseMs })
  const raw = serializeBudgetState(b.getState())
  const restored = deserializeBudgetState(raw, { nowMs: baseMs })
  assert.equal(restored.proactiveUsed, 1)
  assert.equal(restored.rejection.count, 1)
  assert.equal(restored.rejection.topic, 'x')
  assert.ok(restored.topicAvoid.x > baseMs)
  const clamped = deserializeBudgetState('{"proactiveMax":99,"proactiveUsed":-5}', { nowMs: baseMs })
  assert.equal(clamped.proactiveMax, 4)
  assert.equal(clamped.proactiveUsed, 0)
  const corrupt = deserializeBudgetState('{oops', { nowMs: baseMs })
  assert.equal(corrupt.proactiveUsed, 0)
  assert.equal(corrupt.dayKey, localDayKey(baseMs))
})

run('atomic persistence: write/read roundtrip, no tmp leftovers, corrupt file safe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attention-budget-'))
  try {
    const file = path.join(dir, 'sub', 'attention-budget.json')
    const b = mk()
    b.recordProactive({ nowMs: baseMs })
    assert.equal(writeBudgetStateAtomic(file, b.getState()), true)
    assert.ok(fs.existsSync(file))
    const leftovers = fs.readdirSync(path.dirname(file)).filter((n) => n.includes('.tmp-'))
    assert.equal(leftovers.length, 0)
    const restored = deserializeBudgetState(readBudgetState(file), { nowMs: baseMs })
    assert.equal(restored.proactiveUsed, 1)
    fs.writeFileSync(file, '{not json', 'utf8')
    const broken = deserializeBudgetState(readBudgetState(file), { nowMs: baseMs })
    assert.equal(broken.proactiveUsed, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

run('logView exposes counts/enums only (no free text)', () => {
  const b = mk()
  b.recordIgnored({ topic: 'secret-topic', nowMs: baseMs })
  const log = b.logView(baseMs)
  assert.deepEqual(Object.keys(log).sort(), [
    'dayKey',
    'frequencyFactor',
    'hardCap',
    'max',
    'paused',
    'rejectionCount',
    'rejectionKind',
    'topicAvoidCount',
    'used'
  ])
  assert.equal(log.rejectionCount, 1)
  assert.equal(log.topicAvoidCount, 1)
  assert.equal(JSON.stringify(log).includes('secret-topic'), false)
})

run('local helpers: day key and minutes', () => {
  const ms = localMs(23, 40)
  assert.equal(localMinutesOfDay(ms), 23 * 60 + 40)
  assert.equal(localDayKey(ms), '2026-10-24')
})

console.log(`attention-budget tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
