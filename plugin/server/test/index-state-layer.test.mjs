// index.js 接线集成测试（真实 index.js + mock ctx；不启 DSH、不挂载、不碰 pipe 实际通信）
// 断言：①默认关 → 只有原生 onEvent 订阅、v2 stateLayer=null ②显式开 → 多一个订阅、事件→v2 stateLayer ③dispose 不抛
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const mod = await import(
  new URL('file://' + path.join(repo, 'plugin', 'server', 'lib', 'index.js').replace(/\\/g, '/')).href
)
const { createMockCtx, createMockServices, mockSession, mockEvent } = await import(
  new URL('file://' + path.join(repo, 'scripts', 'harness', 'mock-ctx.mjs').replace(/\\/g, '/')).href
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const run = async (name, fn) => {
  try {
    await fn()
    pass++
  } catch (err) {
    fail++
    console.error(`FAIL ${name}: ${err.stack || err.message}`)
  }
}

function baseConfig(dir, extra = {}) {
  return {
    enabled: true,
    logLevel: 'error',
    logFile: path.join(dir, 'bridge.log'),
    stateFile: path.join(dir, 'state.json'),
    stateFileV2: path.join(dir, 'bridge-state-v2.json'),
    historyFile: path.join(dir, 'history.json'),
    companionFile: path.join(dir, 'companion.json'),
    eventsFile: path.join(dir, 'events.json'),
    uiActionFile: path.join(dir, 'ui-action.json'),
    stateWriteMs: 1,
    companionSaveMs: 1,
    eventsSaveMs: 1,
    attribution: { enabled: false, onlyActive: false, stateFile: '' },
    lifecycle: {
      autoStart: false,
      startScript: '',
      bootstrapScript: '',
      releaseZipUrl: '',
      bootstrapStateFile: ''
    },
    llm: { enabled: false },
    actions: { enabled: false },
    whaleActs: { enabled: false },
    statusChannel: { enabled: true, heartbeatMs: 50, petPush: false },
    ...extra
  }
}

function readV2(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'bridge-state-v2.json'), 'utf8'))
}

await run('disabled: only native session/event handler; v2 stateLayer=null; dispose safe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-slw-off-'))
  const ctx = createMockCtx(createMockServices())
  try {
    mod.apply(ctx, baseConfig(dir))
    assert.equal(ctx._count('session/event'), 1, 'default config must not subscribe wiring')
    ctx._emit('session/event', mockSession('s1'), mockEvent('turn/start', { turn: 1 }))
    await sleep(30)
    ctx._emit('session/event', mockSession('s1'), mockEvent('tool/call', { name: 'read', callId: 'c1' }))
    await sleep(200)
    const v2 = readV2(dir)
    assert.equal(v2.stateLayer, null)
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('enabled: extra subscription; event → v2.stateLayer (state/subkind/counters/emotion)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-slw-on-'))
  const ctx = createMockCtx(createMockServices())
  try {
    mod.apply(ctx, baseConfig(dir, { stateLayer: { enabled: true, affect: true, motivation: false, scripts: false } }))
    assert.equal(ctx._count('session/event'), 2, 'enabled should add exactly one wiring handler')
    ctx._emit('session/event', mockSession('s1'), mockEvent('turn/start', { turn: 1 }))
    await sleep(20)
    ctx._emit('session/event', mockSession('s1'), mockEvent('tool/call', { name: 'read', callId: 'c1' }))
    await sleep(80)
    const v2 = readV2(dir)
    assert.ok(v2.stateLayer, 'v2.stateLayer should be populated')
    assert.equal(v2.stateLayer.state, 'tool')
    assert.equal(v2.stateLayer.subkind, 'read')
    assert.equal(v2.stateLayer.counters.turn, 1)
    assert.equal(v2.stateLayer.counters.toolCalls, 1)
    assert.equal(typeof v2.stateLayer.emotion.valence, 'number')
    assert.equal(typeof v2.stateLayer.words.valence, 'string')
    assert.equal(v2.stateLayer.script, null, 'scripts off → no script')
    assert.equal(JSON.stringify(v2.stateLayer).includes('act:'), false)
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('disabled after enabled config removed: still no wiring handler (fresh ctx)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-slw-off2-'))
  const ctx = createMockCtx(createMockServices())
  try {
    mod.apply(ctx, baseConfig(dir, { stateLayer: { enabled: false } }))
    assert.equal(ctx._count('session/event'), 1)
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`index state-layer wiring tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
process.exit(0)
