import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStateMachine } from '../lib/state-machine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..', '..')
const stateMapPath = join(root, 'config', 'state-map.json')
const fixturesPath =
  process.env.STATE_FIXTURES || join(root, 'plugin', 'server', 'test', 'fixtures', 'state-fixtures.v1.3.jsonl')
const map = JSON.parse(readFileSync(stateMapPath, 'utf8'))
const vocab = {
  clips: new Set(map.clips || []),
  composites: new Set(map.compositesPlayable || []),
  expressions: new Set(map.expressions || []),
  fx: new Set(map.fx || [])
}
const EXPECTED_FIXTURES = 54
if (!existsSync(fixturesPath)) {
  console.error(`fixtures missing: ${fixturesPath}`)
  process.exit(1)
}
const lines = readFileSync(fixturesPath, 'utf8').split(/\r?\n/).filter(Boolean)
if (lines.length !== EXPECTED_FIXTURES) {
  console.error(`fixtures count mismatch: got ${lines.length}, want ${EXPECTED_FIXTURES}`)
  process.exit(1)
}
let pass = 0,
  fail = 0
const failures = []
for (const line of lines) {
  let fx
  try {
    fx = JSON.parse(line)
  } catch (err) {
    fail++
    failures.push({ id: '?', error: 'invalid json: ' + err.message })
    continue
  }
  const pre = (fx.given && fx.given.preconditions) || {}
  const mode = pre.mode || 'normal'
  if (!pre.state) {
    fail++
    failures.push({ id: fx.id, error: 'missing preconditions.state' })
    continue
  }
  const m = createStateMachine({
    stateMap: map,
    now: () => 0,
    mode: () => mode,
    initialState: pre.state,
    initialCounters: pre.counters || null,
    preconditions: pre,
    sessionRole: pre.sessionRole || null,
    currentSessionId: pre.currentSessionId || null
  })
  let snap = m.snapshot()
  for (const ev of (fx.given && fx.given.events) || []) snap = m.handle(ev, { mode })
  const exp = fx.expect || {}
  const okState = !exp.state || snap.state === exp.state
  const okSub = exp.subkind === undefined || snap.subkind === exp.subkind
  const pres = exp.presentation || {}
  const okClip = !pres.clip || vocab.clips.has(pres.clip)
  const okComp = !pres.composite || vocab.composites.has(pres.composite)
  const okExpr = !pres.expression || vocab.expressions.has(pres.expression)
  const okFx = !pres.fx || (Array.isArray(pres.fx) ? pres.fx.every((x) => vocab.fx.has(x)) : vocab.fx.has(pres.fx))
  const PERF_COUNTERS = ['costLedgerUpdated']
  const own = Object.keys(exp.counters || {}).filter((k) => PERF_COUNTERS.includes(k))
  if (own.length) {
    fail++
    failures.push({ id: fx.id, error: 'counter ownership: ' + own.join(',') })
    continue
  }
  const okCounters =
    !exp.counters ||
    Object.entries(exp.counters).every(([k, v]) => {
      if (k.startsWith('jobs.')) {
        const sub = k.slice(5)
        return (snap.counters.jobs || {})[sub] === v
      }
      return snap.counters[k] === v
    })
  const okPres =
    !exp.presentation ||
    Object.entries(exp.presentation).every(([k, v]) => {
      const kk = k === 'level' ? 'bubbleLevel' : k
      return JSON.stringify((snap.presentation || {})[kk]) === JSON.stringify(v)
    })
  if (okState && okSub && okClip && okComp && okExpr && okFx && okCounters && okPres) pass++
  else {
    fail++
    failures.push({
      id: fx.id,
      got: { state: snap.state, subkind: snap.subkind },
      want: { state: exp.state, subkind: exp.subkind },
      flags: { okState, okSub, okClip, okComp, okExpr, okFx, okCounters, okPres },
      snapPresentation: snap.presentation
    })
  }
}
if (failures.length) {
  for (const f of failures)
    console.error(
      'FAIL',
      f.id,
      JSON.stringify(f.flags || f.error),
      'got',
      JSON.stringify(f.got || null),
      'want',
      JSON.stringify(f.want || null)
    )
}
console.log(`state-machine fixtures: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
