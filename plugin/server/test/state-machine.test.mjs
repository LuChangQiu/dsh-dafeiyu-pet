import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStateMachine } from '../lib/state-machine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..', '..')
const stateMapPath = join(root, 'config', 'state-map.json')
const fixturesPath =
  process.env.STATE_FIXTURES || 'C:/Users/xiqi/.dsh/im/deliverables/pet-integration/docs/state-fixtures.draft.jsonl'
const map = JSON.parse(readFileSync(stateMapPath, 'utf8'))
const vocab = {
  clips: new Set(map.clips || []),
  composites: new Set(map.compositesPlayable || []),
  expressions: new Set(map.expressions || []),
  fx: new Set(map.fx || [])
}
let pass = 0,
  fail = 0
const failures = []
const lines = existsSync(fixturesPath) ? readFileSync(fixturesPath, 'utf8').split(/\r?\n/).filter(Boolean) : []
for (const line of lines) {
  let fx
  try {
    fx = JSON.parse(line)
  } catch {
    continue
  }
  const mode = (fx.given && fx.given.preconditions && fx.given.preconditions.mode) || 'normal'
  const m = createStateMachine({ stateMap: map, now: () => 0, mode: () => mode })
  let snap = m.snapshot()
  for (const ev of (fx.given && fx.given.events) || []) snap = m.handle(ev, { mode })
  const exp = fx.expect || {}
  const okState = !exp.state || snap.state === exp.state
  const okSub = exp.subkind === undefined || snap.subkind === exp.subkind
  const pres = exp.presentation || {}
  const okClip = !pres.clip || vocab.clips.has(pres.clip)
  const okComp = !pres.composite || vocab.composites.has(pres.composite)
  const okExpr = !pres.expression || vocab.expressions.has(pres.expression)
  const okFx = !pres.fx || vocab.fx.has(pres.fx)
  const okCounters = !exp.counters || Object.entries(exp.counters).every(([k, v]) => snap.counters[k] === v)
  if (okState && okSub && okClip && okComp && okExpr && okFx && okCounters) pass++
  else {
    fail++
    failures.push({
      id: fx.id,
      got: { state: snap.state, subkind: snap.subkind },
      want: { state: exp.state, subkind: exp.subkind },
      flags: { okState, okSub, okClip, okComp, okExpr, okFx, okCounters }
    })
  }
}
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 8), null, 1))
}
console.log(`state-machine fixtures: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
