// task-133 LLM-lines 测试：纯逻辑 helpers + index.js 接线静态契约
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KIND_POOL,
  S0_KINDS,
  INTERACTIVE_KINDS,
  isNightTime,
  fallbackReasonFor,
  createLlmStats
} from '../lib/llm-lines.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..', '..', '..')
const src = fs.readFileSync(path.join(root, 'plugin', 'server', 'lib', 'index.js'), 'utf8')

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

run('KIND_POOL covers all target kinds', () => {
  for (const kind of [
    'turnStart',
    'turnEnd',
    'turnEndBad',
    'report',
    'spike',
    'reunion',
    'approval',
    'waitingInput',
    'selfTalk',
    'inner',
    'morning',
    'sleep',
    'interactHead',
    'interactFeed',
    'interactCome',
    'praise',
    'sneakLine'
  ])
    assert.ok(KIND_POOL[kind], `missing pool for ${kind}`)
})

run('S0/interactive sets', () => {
  assert.ok(S0_KINDS.has('approval') && S0_KINDS.has('waitingInput'))
  for (const k of ['interactHead', 'interactFeed', 'interactCome', 'praise']) assert.ok(INTERACTIVE_KINDS.has(k))
})

run('isNightTime boundaries', () => {
  const at = (h, m) => new Date(2026, 9, 24, h, m, 0, 0)
  assert.equal(isNightTime(at(23, 30)), true)
  assert.equal(isNightTime(at(23, 29)), false)
  assert.equal(isNightTime(at(7, 59)), true)
  assert.equal(isNightTime(at(8, 0)), false)
  assert.equal(isNightTime(at(14, 0)), false)
})

run('fallbackReasonFor priority', () => {
  assert.equal(fallbackReasonFor({ modeBlocked: true }), 'mode')
  assert.equal(fallbackReasonFor({ nightBlocked: true }), 'night')
  assert.equal(fallbackReasonFor({ budgetExceeded: true }), 'budget')
  assert.equal(fallbackReasonFor({ kindCap: true }), 'kind-cap')
  assert.equal(fallbackReasonFor({ empty: true }), 'empty')
  assert.equal(fallbackReasonFor({ invalid: true }), 'invalid')
  assert.equal(fallbackReasonFor({ duplicate: true }), 'duplicate')
  assert.equal(fallbackReasonFor({}), null)
})

run('createLlmStats: success share/byKind/fallback reasons/latency', () => {
  const st = createLlmStats()
  st.record({ kind: 'turnStart', source: 'llm', latencyMs: 800, tokens: 370 })
  st.record({ kind: 'turnStart', source: 'llm', latencyMs: 1000, tokens: 380 })
  st.record({ kind: 'inner', source: 'pool', fallbackReason: 'budget' })
  st.record({ kind: 'approval', source: 'pool', fallbackReason: 'night' })
  const snap = st.snapshot()
  assert.equal(snap.attempts, 4)
  assert.equal(snap.ok, 2)
  assert.equal(snap.fallback, 2)
  assert.equal(snap.successRate, 0.5)
  assert.deepEqual(snap.sourceShare, { llm: 2, pool: 2 })
  assert.equal(snap.tokens, 750)
  assert.equal(snap.latencyMs.avg, 900)
  assert.ok(snap.latencyMs.p50 >= 800 && snap.latencyMs.p95 <= 1000)
  assert.deepEqual(snap.byKind.turnStart, { attempts: 2, llm: 2, pool: 0 })
  assert.deepEqual(snap.fallbackReasons, { budget: 1, night: 1 })
})

run('index imports llm-lines and uses stats/night/interactive gates', () => {
  assert.match(src, /from '\.\/llm-lines\.js'/)
  assert.match(src, /const llmStats = createLlmStats\(\)/)
  assert.match(src, /isNightTime\(new Date\(\), linesCfg\)/)
  assert.match(src, /fallback\('night'\)/)
  assert.match(src, /INTERACTIVE_KINDS\.has\(kind\)/)
  assert.match(src, /log\('info', 'llm fallback', \{ kind, fallbackReason: reason, source: 'pool' \}\)/)
})

run('proactive user-visible kinds wired to LLM', () => {
  assert.match(src, /generate\('inner', \{ tools: 0 \}, \{ innerKind: kind \}\)/)
  assert.match(src, /generate\('morning', \{ tools: 0 \}\)/)
  assert.match(src, /generate\('sleep', \{ tools: 0 \}\)/)
  assert.match(
    src,
    /const speechKind = \{ head: 'interactHead', feed: 'interactFeed', come: 'interactCome', praise: 'praise' \}\[name\]/
  )
  assert.match(src, /generate\(speechKind, \{ tools: 0 \}, \{ interactive: true \}\)/)
  assert.match(src, /j\.name === 'praise'\) interact\('praise'\)/)
  assert.match(src, /generate\('sneakLine', \{ tools: 0 \}\)/)
})

run('approval dead config removed + stats exposed in v2', () => {
  assert.doesNotMatch(src, /approvalUseLlm:\s*(true|false)/)
  assert.match(src, /llmStats: llmStats\.snapshot\(\)/)
})

run('prompt covers new kinds and constraints', () => {
  for (const kind of ['inner:', 'interactHead:', 'interactFeed:', 'interactCome:', 'praise:', 'sneakLine:'])
    assert.ok(src.includes(kind), `missing KIND_DESC ${kind}`)
  assert.match(src, /心声体：可以用（）/)
  assert.match(src, /偷吃被发现的低声一句/)
})

console.log(`llm-lines tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
