// attention index 集成测试（真实 index.js + mock ctx）：默认关零副作用 / 显式开才创建 wiring
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
const { createMockCtx, createMockServices } = await import(
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
const baseConfig = (dir, extra = {}) => ({
  enabled: true,
  logLevel: 'info',
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
  lifecycle: { autoStart: false, startScript: '', bootstrapScript: '', releaseZipUrl: '', bootstrapStateFile: '' },
  llm: { enabled: false },
  actions: { enabled: false },
  whaleActs: { enabled: true, replaceClassicActs: true },
  statusChannel: { enabled: true, heartbeatMs: 5000, petPush: false },
  ...extra
})
const readLog = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

await run('disabled default: no attention state file, no wiring log, dispose safe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-att-off-'))
  const ctx = createMockCtx(createMockServices())
  const abFile = path.join(dir, 'attention-budget.json')
  try {
    mod.apply(ctx, baseConfig(dir, { attentionBudget: { enabled: false, stateFile: abFile } }))
    await sleep(60)
    assert.equal(fs.existsSync(abFile), false, 'disabled must not create/read/create state file')
    assert.equal(readLog(path.join(dir, 'bridge.log')).includes('attention budget wiring'), false)
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('enabled: wiring created + logged; state file only after proactive (not on boot)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-att-on-'))
  const ctx = createMockCtx(createMockServices())
  const abFile = path.join(dir, 'attention-budget.json')
  try {
    mod.apply(ctx, baseConfig(dir, { attentionBudget: { enabled: true, stateFile: abFile, persistMs: 0 } }))
    await sleep(60)
    assert.ok(readLog(path.join(dir, 'bridge.log')).includes('attention budget wiring'))
    assert.equal(fs.existsSync(abFile), false, 'no proactive yet → no write')
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`attention index wiring tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
process.exit(0)
