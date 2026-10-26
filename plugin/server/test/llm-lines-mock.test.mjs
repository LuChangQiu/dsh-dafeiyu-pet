// task-133 mock 集成：真实 index.js + mock ctx.llm（成功/失败回退/互动点击/被夸）
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
const waitFor = async (fn, timeoutMs = 4000, stepMs = 50) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (fn()) return true
    await sleep(stepMs)
  }
  return fn()
}
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
const LINES = ['湖面很安静', '尾巴轻轻摆', '今天的光不错', '白饭真好吃', '我趴一会儿']
const makeLlm = (mode = 'ok') => {
  let i = 0
  return {
    async *stream() {
      if (mode === 'error') throw new Error('mock llm down')
      if (mode === 'hang') {
        await new Promise((r) => setTimeout(r, 800))
        throw Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })
      }
      yield { type: 'text-delta', text: LINES[i++ % LINES.length] }
      yield { type: 'finish' }
    }
  }
}
const baseConfig = (dir, llmMode = 'ok', extra = {}) => ({
  enabled: true,
  logLevel: 'info',
  logFile: path.join(dir, 'bridge.log'),
  stateFile: path.join(dir, 'state.json'),
  stateFileV2: path.join(dir, 'bridge-state-v2.json'),
  historyFile: path.join(dir, 'history.json'),
  companionFile: path.join(dir, 'companion.json'),
  eventsFile: path.join(dir, 'events.json'),
  uiActionFile: path.join(dir, 'ui-action.json'),
  testHookFile: path.join(dir, 'test-hook.json'),
  stateWriteMs: 1,
  companionSaveMs: 1,
  eventsSaveMs: 1,
  attribution: { enabled: false, onlyActive: false, stateFile: '' },
  lifecycle: { autoStart: false, startScript: '', bootstrapScript: '', releaseZipUrl: '', bootstrapStateFile: '' },
  llm: {
    enabled: true,
    pregen: false,
    timeoutMs: 600,
    maxCallsPerDay: 300,
    budgetPerDayYuan: 1,
    lines: { enabled: true, perKindPerHour: 20, reportPerHour: 20, spikePerHour: 20, statsLogEvery: 100 },
    ...(extra.llm || {})
  },
  actions: { enabled: false },
  whaleActs: { enabled: false },
  statusChannel: { enabled: true, heartbeatMs: 50, petPush: false },
  morning: { enabled: false, hour: 8, minute: 0 },
  sleep: { enabled: false, hour: 23, minute: 30 },
  spike: { enabled: false },
  idleSkit: { enabled: false, eventGapMs: 180000 },
  ...extra
})
const readLog = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
const readStats = (dir) => {
  try {
    const v2 = JSON.parse(fs.readFileSync(path.join(dir, 'bridge-state-v2.json'), 'utf8'))
    return v2.llmStats || null
  } catch {
    return null
  }
}

// 加速插件内部轮询（ritual/ui-action），保留 setTimeout 语义
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ms, ...args) => realSetInterval(fn, Math.min(Number(ms) || 50, 50), ...args)

await run('mock llm success: determine report line + llmStats ok', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-llm-ok-'))
  const ctx = createMockCtx(createMockServices({ llm: makeLlm('ok') }))
  const hookFile = path.join(dir, 'test-hook.json')
  try {
    mod.apply(ctx, baseConfig(dir))
    fs.writeFileSync(hookFile, JSON.stringify({ type: 'report' }), 'utf8')
    const ok = await waitFor(() => {
      const st = readStats(dir)
      return !!(st && st.ok >= 1 && st.byKind && st.byKind.report && st.byKind.report.llm >= 1)
    }, 5000)
    const stats = readStats(dir)
    assert.ok(ok, 'expected v2 llmStats report llm>=1; stats=' + JSON.stringify(stats))
    assert.ok(stats.attempts >= 1 && stats.ok >= 1, JSON.stringify(stats))
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('mock llm failure: fallback with fallbackReason', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-llm-fb-'))
  const ctx = createMockCtx(createMockServices({ llm: makeLlm('error') }))
  const hookFile = path.join(dir, 'test-hook.json')
  try {
    mod.apply(ctx, baseConfig(dir, 'error'))
    fs.writeFileSync(hookFile, JSON.stringify({ type: 'report' }), 'utf8')
    const ok = await waitFor(() => {
      const st = readStats(dir)
      if (!st || !st.fallbackReasons) return false
      return ['empty', 'llm-unavailable', 'timeout', 'invalid', 'kind-cap'].some((r) => st.fallbackReasons[r] >= 1)
    }, 5000)
    assert.ok(ok, 'expected v2 fallbackReasons; stats=' + JSON.stringify(readStats(dir)))
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('mock llm: click interact-head + praise → LLM speech', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-llm-click-'))
  const ctx = createMockCtx(createMockServices({ llm: makeLlm('ok') }))
  const actionFile = path.join(dir, 'ui-action.json')
  try {
    mod.apply(ctx, baseConfig(dir))
    fs.writeFileSync(actionFile, JSON.stringify({ id: 'a1', name: 'interact-head' }), 'utf8')
    const clickOk = await waitFor(
      () => /llm line .*"kind":"interactHead"/.test(readLog(path.join(dir, 'bridge.log'))),
      3000
    )
    assert.ok(clickOk, 'expected llm line interactHead')
    fs.writeFileSync(actionFile, JSON.stringify({ id: 'a2', name: 'praise' }), 'utf8')
    const praiseOk = await waitFor(() => /llm line .*"kind":"praise"/.test(readLog(path.join(dir, 'bridge.log'))), 3000)
    assert.ok(praiseOk, 'expected llm line praise')
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('pet speech-request queue: click → llm reply (source:llm)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-speech-ok-'))
  const ctx = createMockCtx(createMockServices({ llm: makeLlm('ok') }))
  const queueFile = path.join(dir, 'speech-requests.json')
  try {
    mod.apply(ctx, baseConfig(dir))
    fs.writeFileSync(
      queueFile,
      JSON.stringify([{ id: 'q1', kind: 'click', context: { phase: 'click', mood: 2 } }]),
      'utf8'
    )
    const ok = await waitFor(() => {
      const st = readStats(dir)
      return !!(st && st.byKind && st.byKind.clickLine && st.byKind.clickLine.llm >= 1)
    }, 5000)
    const log = readLog(path.join(dir, 'bridge.log'))
    assert.ok(ok, 'expected clickLine llm; stats=' + JSON.stringify(readStats(dir)))
    assert.ok(log.includes('speech reply') && /"source":"llm"/.test(log))
    assert.equal(/speech request skipped/.test(log), false)
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await run('pet speech-request queue: llm failure → pool reply with fallbackReason', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-speech-fb-'))
  const ctx = createMockCtx(createMockServices({ llm: makeLlm('error') }))
  const queueFile = path.join(dir, 'speech-requests.json')
  try {
    mod.apply(ctx, baseConfig(dir, 'error'))
    fs.writeFileSync(queueFile, JSON.stringify([{ id: 'q2', kind: 'praise', context: {} }]), 'utf8')
    const ok = await waitFor(() => {
      const st = readStats(dir)
      return !!(st && st.byKind && st.byKind.praise && st.byKind.praise.pool >= 1)
    }, 5000)
    const log = readLog(path.join(dir, 'bridge.log'))
    assert.ok(ok, 'expected praise fallback; stats=' + JSON.stringify(readStats(dir)))
    assert.ok(/speech reply .*"source":"pool".*"fallbackReason":"(empty|llm-unavailable|timeout|invalid)"/.test(log))
    ctx._dispose()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

globalThis.setInterval = realSetInterval
console.log(`llm-lines mock tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
process.exit(0)
