// state-layer-wiring 单元测试：config 门控 / 订阅最小化 / kill switch / 缺 state-map 降级
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStateLayerWiring } from '../lib/state-layer-wiring.js'
import { createMockCtx } from '../../../scripts/harness/mock-ctx.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..', '..')
const stateMap = JSON.parse(readFileSync(join(root, 'config', 'state-map.json'), 'utf8'))
const mockSession = (id = 's1') => ({ id, header: { cwd: 'C:/harness/ws' }, title: 't' })
const mockEvent = (type, data = {}) => ({ type, data })

let pass = 0
let fail = 0
const run = async (name, fn) => {
  try {
    await fn()
    pass++
  } catch (err) {
    fail++
    console.error(`FAIL ${name}: ${err.message}`)
  }
}

await run('disabled by default: no load, no subscribe, no emit', async () => {
  const ctx = createMockCtx({})
  let loaded = 0
  const emitted = []
  const w = createStateLayerWiring({
    ctx,
    config: {},
    loadStateMap: () => {
      loaded++
      return stateMap
    },
    emitState: (s) => emitted.push(s)
  })
  assert.equal(w.enabled, false)
  assert.equal(w.reason, 'disabled-by-config')
  assert.equal(loaded, 0)
  assert.equal(ctx._count('session/event'), 0)
  assert.equal(w.onEvent(mockSession(), mockEvent('turn/start', { turn: 1 })), null)
  assert.equal(emitted.length, 0)
})

await run('explicit enabled: one subscription, state emitted on event', async () => {
  const ctx = createMockCtx({})
  let loaded = 0
  const emitted = []
  const w = createStateLayerWiring({
    ctx,
    config: { stateLayer: { enabled: true } },
    loadStateMap: () => {
      loaded++
      return stateMap
    },
    emitState: (s) => emitted.push(s),
    now: () => 1000,
    mode: () => 'active'
  })
  assert.equal(w.enabled, true)
  assert.equal(w.subscribed, true)
  assert.equal(loaded, 1)
  assert.equal(ctx._count('session/event'), 1)
  ctx._emit('session/event', mockSession(), mockEvent('turn/start', { turn: 1 }))
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].state, 'thinking')
  assert.equal(emitted[0].subkind, 'turn')
  assert.equal(emitted[0].counters.turn, 1)
  // skeleton: 默认不产 script
  assert.equal(emitted[0].script, null)
  const payload = JSON.stringify(emitted[0])
  assert.equal(payload.includes('act:'), false)
})

await run('missing state-map: stays disabled, no subscription, warn logged', async () => {
  const ctx = createMockCtx({})
  const logs = []
  const w = createStateLayerWiring({
    ctx,
    config: { stateLayer: { enabled: true } },
    loadStateMap: () => null,
    log: (level, msg) => logs.push([level, msg])
  })
  assert.equal(w.enabled, false)
  assert.equal(w.reason, 'state-map-missing')
  assert.equal(ctx._count('session/event'), 0)
  assert.ok(logs.some(([lvl, msg]) => lvl === 'warn' && /state-map missing/.test(msg)))
})

await run('kill switch: stops emissions and freezes snapshot; re-enable resumes', async () => {
  const ctx = createMockCtx({})
  const emitted = []
  const w = createStateLayerWiring({
    ctx,
    config: { stateLayer: { enabled: true } },
    loadStateMap: () => stateMap,
    emitState: (s) => emitted.push(s),
    now: () => 1000,
    mode: () => 'active'
  })
  ctx._emit('session/event', mockSession(), mockEvent('turn/start', { turn: 1 }))
  assert.equal(emitted.length, 1)
  const off = w.setEnabled(false)
  assert.equal(off.enabled, false)
  ctx._emit('session/event', mockSession(), mockEvent('turn/end', { reason: { kind: 'completed' } }))
  assert.equal(emitted.length, 1, 'no emit while disabled')
  assert.equal(w.getSnapshot().state, 'thinking')
  w.setEnabled(true)
  ctx._emit('session/event', mockSession(), mockEvent('approval/asked', { id: 'a1', toolName: 'pwsh' }))
  assert.equal(emitted.length, 2)
  assert.equal(emitted[1].state, 'approval')
})

await run('perf script: not enabled by default; enabled+motivation emits to perf only', async () => {
  const ctx = createMockCtx({})
  const emitted = []
  const perf = []
  const w = createStateLayerWiring({
    ctx,
    config: { stateLayer: { enabled: true, motivation: true, scripts: true } },
    loadStateMap: () => stateMap,
    emitState: (s) => emitted.push(s),
    emitPerf: (s) => perf.push(s),
    now: () => 1000,
    mode: () => 'active'
  })
  ctx._emit('session/event', mockSession(), mockEvent('approval/asked', { id: 'a2', toolName: 'bash' }))
  assert.equal(emitted.length, 1)
  assert.equal(perf.length, 1)
  assert.equal(perf[0].source, 'intent:wait_approval')
  assert.equal(perf[0].scriptVersion, 2)
})

await run('dispose: unsubscribes handler; further events no-op', async () => {
  const ctx = createMockCtx({})
  const emitted = []
  const w = createStateLayerWiring({
    ctx,
    config: { stateLayer: { enabled: true } },
    loadStateMap: () => stateMap,
    emitState: (s) => emitted.push(s),
    now: () => 1000,
    mode: () => 'active'
  })
  assert.equal(ctx._count('session/event'), 1)
  w.dispose()
  assert.equal(ctx._count('session/event'), 0)
  ctx._emit('session/event', mockSession(), mockEvent('turn/start', { turn: 2 }))
  assert.equal(emitted.length, 0)
})

await run('event.type form is accepted (real index onEvent shape)', async () => {
  const ctx = createMockCtx({})
  const emitted = []
  const w = createStateLayerWiring({
    ctx,
    config: { stateLayer: { enabled: true } },
    loadStateMap: () => stateMap,
    emitState: (s) => emitted.push(s),
    now: () => 1000,
    mode: () => 'active'
  })
  // mockEvent 用 type 字段；wiring 需要兼容 event.t / event.type
  assert.equal(emitted.length, 0)
  const ev = { type: 'turn/start', data: { turn: 1 } }
  const snap = w.onEvent(mockSession(), ev)
  assert.equal(snap && snap.state, 'thinking')
  assert.equal(emitted.length, 1)
})

console.log(`state-layer-wiring tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
