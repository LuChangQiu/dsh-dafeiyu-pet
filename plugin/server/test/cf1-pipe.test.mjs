/**
 * CF1 mock pipe 集成测试（不启 DSH）：真实加载 plugin/server/lib/index.js，mock ctx 喂事件，
 * cfg.pipe 指向测试用命名管道服务端，抓 send() 实际写出的行，断言：
 *   - replaceClassicActs=true：首轮 report 真发 `act:report`（不被 same-state 吞），且不再发 classic `act:stretch`；
 *   - replaceClassicActs=false（降级=仅 classic）：只发 `act:stretch`，0 次 `act:report`；
 *   - kill switch：同上，仅 classic；
 *   - quiet：0 次 `act:report`；
 *   - reunion：真发 `act:wave`（replace=true 的 wave 正证据）。
 * cleanup 由调用方在断言后执行（不能用 finally 提前 dispose，否则 +600ms/+2.5s 的定时发送丢失）。
 * 运行：node --test plugin/server/test/cf1-pipe.test.mjs（约 12–15s）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const mod = await import(pathToFileURL(path.join(repo, 'plugin', 'server', 'lib', 'index.js')).href)
const { createMockCtx, createMockServices, mockSession, mockEvent } = await import(
  pathToFileURL(path.join(repo, 'scripts', 'harness', 'mock-ctx.mjs')).href
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 与 harness 一致：把插件 20s ritual/心跳 interval 加速到 50ms，让 refreshPetOnline 快速置 petOnline=true
// （插件只有 ritual 定时器里刷新 pipe 在线状态；不加速会一直 pet-offline，whale act 被决策层拒绝）
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ms, ...args) => realSetInterval(fn, Math.min(Number(ms) || 50, 50), ...args)

async function waitFor(fn, timeoutMs = 3000, stepMs = 50) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (fn()) return true
    await sleep(stepMs)
  }
  return fn()
}

const pipePath = (name) =>
  '\\\\.\\pipe\\cf1-test-' + name + '-' + process.pid + '-' + Math.random().toString(16).slice(2, 8)

async function runScenario({ name, whaleActs = {}, quietHours = ['23:30-08:00'], reunion = false, emit = true }) {
  const pipe = pipePath(name)
  const lines = []
  const sockets = new Set()
  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('data', (d) => {
      for (const line of d.toString('utf8').split('\n')) if (line.trim()) lines.push(line.trim())
    })
    sock.on('error', () => {})
    sock.on('close', () => sockets.delete(sock))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipe, resolve)
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf1-pipe-' + name + '-'))
  const f = (n) => path.join(dir, n)
  const cfg = {
    enabled: true,
    dryRun: false, // 真走 pipe
    pipe,
    pipeTimeoutMs: 500,
    logLevel: 'info',
    logFile: f('bridge.log'),
    stateFileV2: f('state-v2.json'),
    companionFile: f('companion.json'),
    eventsFile: f('events.json'),
    attribution: { enabled: true, onlyActive: false, bootstrapLastKnown: false, stateFile: f('attribution.json') },
    mode: { file: f('mode.json'), requestFile: f('mode-request.json'), autoResume: false },
    uiActionFile: '',
    petConfigFile: '',
    uiConfigFile: '',
    historyFile: f('history.json'),
    lifecycle: { autoStart: false },
    actions: { enabled: true, longTaskMs: 3600000, longTaskStepMs: 3600000 },
    llm: { enabled: false },
    statusChannel: { enabled: false },
    teamV2: { enabled: false },
    idleSkit: { enabled: false },
    morning: { enabled: false },
    sleep: { enabled: false },
    events: { turnStart: false, turnEnd: false, approval: false },
    report: { enabled: true, everyNTurns: 1, minIntervalMs: 0, minTools: 0, minDurationMs: 0 },
    balancePush: { enabled: false },
    stateWriteMs: 100,
    companionSaveMs: 100,
    eventsSaveMs: 100,
    testHookFile: '',
    quietHours,
    whaleActs: {
      enabled: true,
      replaceClassicActs: true,
      report: { enabled: true, chance: 1.0, cooldownMs: 0 },
      wave: { enabled: true, chance: 1.0, cooldownMs: 0 },
      sneak: { enabled: false, chance: 0 },
      ...whaleActs
    }
  }
  if (reunion) {
    const old = new Date(Date.now() - 3 * 3600000).toISOString()
    fs.writeFileSync(
      cfg.companionFile,
      JSON.stringify({ lastUserSeenAt: old, lastSeenAt: old, lastGreetDate: '', affinity: 10, mood: 50 })
    )
  }
  const ctx = createMockCtx(createMockServices())
  mod.apply(ctx, cfg)
  await sleep(150)
  if (emit) {
    const lead = mockSession('session-cf1-pipe-0001')
    ctx._emit('session/event', lead, mockEvent('user/message', { text: '开始' }))
    ctx._emit('session/event', lead, mockEvent('turn/start', {}))
    ctx._emit('session/event', lead, mockEvent('tool/call', { name: 'read', toolName: 'read' }))
    await sleep(120)
    ctx._emit('session/event', lead, mockEvent('assistant/message', { usage: { inputTokens: 1200, outputTokens: 500 } }))
    ctx._emit('session/event', lead, mockEvent('turn/end', { reason: { kind: 'completed' } }))
  }
  const cleanup = async () => {
    try {
      ctx._dispose()
    } catch {}
    for (const s of sockets) {
      try {
        s.destroy()
      } catch {}
    }
    await new Promise((resolve) => {
      try {
        server.close(() => resolve())
      } catch {
        resolve()
      }
    })
    await sleep(20)
  }
  return { lines, waitFor: (pred, ms) => waitFor(() => lines.some(pred), ms), cleanup }
}

/** 公共模式：断言后必定 cleanup。 */
async function withScenario(opts, fn) {
  const s = await runScenario(opts)
  try {
    await fn(s)
  } finally {
    await s.cleanup()
  }
}

test('pipe：replace=true 首轮 report 真发 act:report（不被 same-state 吞），且不双发 act:stretch', async () => {
  await withScenario({ name: 'report' }, async (s) => {
    const got = await s.waitFor((l) => l === 'act:report', 3000)
    assert.equal(got, true, 'pipe 中未出现 act:report；lines=' + JSON.stringify(s.lines.slice(0, 20)))
    assert.equal(s.lines.includes('act:stretch'), false, 'replace=true 不应再发 classic act:stretch')
  })
})

test('pipe：replace=false 降级=仅 classic（act:stretch，0 次 act:report）', async () => {
  await withScenario({ name: 'false', whaleActs: { replaceClassicActs: false } }, async (s) => {
    const got = await s.waitFor((l) => l === 'act:stretch', 3000)
    assert.equal(got, true, 'pipe 中未出现 classic act:stretch；lines=' + JSON.stringify(s.lines.slice(0, 20)))
    assert.equal(s.lines.includes('act:report'), false, 'replace=false 不应发 whale act:report')
  })
})

test('pipe：kill switch 仅 classic（act:stretch，0 次 act:report）', async () => {
  await withScenario({ name: 'kill', whaleActs: { enabled: false } }, async (s) => {
    const got = await s.waitFor((l) => l === 'act:stretch', 3000)
    assert.equal(got, true, 'pipe 中未出现 classic act:stretch；lines=' + JSON.stringify(s.lines.slice(0, 20)))
    assert.equal(s.lines.includes('act:report'), false, 'kill switch 不应发 whale act:report')
  })
})

test('pipe：quiet（免打扰/深夜）0 次 act:report', async () => {
  await withScenario({ name: 'quiet', quietHours: ['00:00-23:59'] }, async (s) => {
    await sleep(1200)
    assert.equal(
      s.lines.includes('act:report'),
      false,
      'quiet 不应发 whale act:report；lines=' + JSON.stringify(s.lines.slice(0, 20))
    )
  })
})

test('pipe：reunion 真发 act:wave（replace=true 的 wave 正证据；约 7s）', async () => {
  await withScenario({ name: 'wave', reunion: true, emit: false }, async (s) => {
    const got = await s.waitFor((l) => l === 'act:wave', 9000)
    assert.equal(got, true, 'pipe 中未出现 act:wave；lines=' + JSON.stringify(s.lines.slice(0, 20)))
  })
})
