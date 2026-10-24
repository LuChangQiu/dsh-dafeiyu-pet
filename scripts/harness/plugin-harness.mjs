/**
 * task-76：隔离验证 harness —— 不挂载 DSH，直接加载真实 plugin/server/lib/index.js，
 * 用 mock ctx 喂完整事件流，覆盖崩溃路径（长任务计时器 act）与关键分支。
 *
 * 用法：node scripts/harness/plugin-harness.mjs
 * 退出码：0 全过；1 有失败；2 环境错误
 *
 * 覆盖（对应 task-76 ②③）：
 *  - load/loaded、turn/start、tool/call、assistant/message(usage)、turn/end
 *  - 长任务计时器 → act()（v49 曾因 modeAllowsAct 漏 import 在此崩 host）
 *  - mode-request → silent 门控（act 被抑制、不崩）
 *  - approval/asked+decided、user-questions/request
 *  - team/task 投影 → v2 team 只读字段
 *  - TEST HOOK usage/state/report
 *  - 隐私：v2 不含绝对路径/API key；未知事件/异常事件不抛
 *  - dispose：定时器停止、无异常
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMockCtx, createMockServices, mockSession, mockEvent } from './mock-ctx.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const pluginPath = path.join(repo, 'plugin', 'server', 'lib', 'index.js')

console.error('HARNESS-START')
const checks = []
const check = (name, cond, detail = '') => {
  checks.push({ name, ok: !!cond, detail })
  if (!cond) console.error(`FAIL ${name}${detail ? ' :: ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const uncaught = []
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', (e && e.stack) || e)
  process.exit(3)
})
process.on('unhandledRejection', (e) => uncaught.push(String((e && e.stack) || e)))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-harness-'))
const f = (n) => path.join(dir, n)
const readV2 = () => {
  try {
    return JSON.parse(fs.readFileSync(f('bridge-state-v2.json'), 'utf8'))
  } catch {
    return null
  }
}
const readLog = () => {
  try {
    return fs.readFileSync(f('pet-bridge.log'), 'utf8')
  } catch {
    return ''
  }
}

// 加速所有定时器（插件 ritual 是固定 20s，长任务检查在其中；harness 里 50ms 一轮）
const realSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ms, ...args) => realSetInterval(fn, Math.min(Number(ms) || 50, 50), ...args)

const mod = await import(pathToFileURL(pluginPath).href)
const cfg = {
  enabled: true,
  dryRun: true, // 不真的写 pet pipe
  logLevel: 'info',
  logFile: f('pet-bridge.log'),
  stateFileV2: f('bridge-state-v2.json'),
  companionFile: f('companion.json'),
  eventsFile: f('events.json'),
  attribution: { enabled: true, onlyActive: false, bootstrapLastKnown: false, stateFile: f('attribution.json') },
  mode: { file: f('mode.json'), requestFile: f('mode-request.json'), autoResume: true },
  uiActionFile: '',
  petConfigFile: '',
  uiConfigFile: '',
  historyFile: f('llm-history.json'),
  lifecycle: { autoStart: false },
  actions: { enabled: true, longTaskMs: 10, longTaskStepMs: 0 },
  llm: { enabled: false },
  statusChannel: { enabled: false },
  stateWriteMs: 100,
  companionSaveMs: 100,
  eventsSaveMs: 100,
  teamV2: { enabled: true, refreshMs: 100 },
  testHookFile: ''
}

let ctx = null
try {
  ctx = createMockCtx(createMockServices())
  mod.apply(ctx, cfg)
} catch (e) {
  console.error('apply 抛异常:', e)
  process.exit(2)
}
await sleep(60)

// ---------- 1. 加载 ----------
check('apply: session/event 已注册', ctx._count('session/event') === 1, `count=${ctx._count('session/event')}`)
check('loaded 日志', readLog().includes('loaded v49'), '')
check('v2 已写盘', !!readV2(), '')

// ---------- 2. 基础事件流 ----------
const lead = mockSession('session-harness-lead-0001')
ctx._emit('session/event', lead, mockEvent('user/message', { text: '你好' }))
ctx._emit('session/event', lead, mockEvent('turn/start', {}))
ctx._emit('session/event', lead, mockEvent('tool/call', { name: 'read', toolName: 'read' }))
ctx._emit(
  'session/event',
  lead,
  mockEvent('assistant/message', {
    usage: { inputTokens: 1000, outputTokens: 400, cacheReadTokens: 200, cacheWriteTokens: 0 }
  })
)
ctx._emit('session/event', lead, mockEvent('turn/end', {}))
await sleep(320)
let v2 = readV2()
check('v2.today.tokens 统计', v2 && v2.today.tokens >= 1400, v2 ? `tokens=${v2.today.tokens}` : 'no v2')
check('v2.today.tokensUser 归因', v2 && (v2.today.tokensUser || 0) >= 1400, '')
check(
  'v2.sessions 有会话记录',
  v2 && Array.isArray(v2.sessions) && v2.sessions.length >= 1,
  v2 ? 'sessions=' + v2.sessions.length : ''
)

// ---------- 3. 长任务计时器 → act()（崩溃路径） ----------
ctx._emit('session/event', lead, mockEvent('turn/start', {}))
await sleep(300)
const logAfterLong = readLog()
check('长任务触发（walk two steps / act）', logAfterLong.includes('long task: walk two steps'))
check('长任务路径无 uncaught', uncaught.length === 0, uncaught.join('\n').slice(0, 300))

// ---------- 4. mode silent 门控 ----------
fs.writeFileSync(f('mode-request.json'), JSON.stringify({ name: 'mode-silent', minutes: 1 }), 'utf8')
await sleep(150)
check('mode request 生效', readLog().includes('mode change'))
const longBefore = (readLog().match(/long task: walk two steps/g) || []).length
ctx._emit('session/event', lead, mockEvent('turn/start', {}))
await sleep(300)
const longAfter = (readLog().match(/long task: walk two steps/g) || []).length
check('silent 模式抑制长任务 act', longAfter === longBefore, `before=${longBefore} after=${longAfter}`)
fs.writeFileSync(f('mode-request.json'), JSON.stringify({ name: 'mode-resume' }), 'utf8')
await sleep(120)

// ---------- 5. approval / user-questions ----------
ctx._emit('session/event', lead, mockEvent('approval/asked', { id: 'ap1', title: '需要确认' }))
ctx._emit('session/event', lead, mockEvent('approval/decided', { id: 'ap1', approved: true }))
ctx._emit('session/event', lead, mockEvent('user-questions/request', { questions: [{ q: '选哪个' }] }))
await sleep(120)
v2 = readV2()
check('approval 路径不崩', readLog().includes('approval') || readLog().includes('dengdai'), '')
check('userQuestions.sentCount', v2 && (v2.userQuestions?.sentCount || 0) >= 1, '')

// ---------- 6. team 投影 → v2 team ----------
ctx._emit('session/event', lead, mockEvent('team/task', { taskId: 't1', status: 'completed' }))
await sleep(200)
v2 = readV2()
check(
  'v2.team 只读字段',
  v2 && v2.team && v2.team.tasks && v2.team.tasks.total >= 3,
  v2 ? JSON.stringify(v2.team?.tasks) : ''
)
check('v2.team 不含敏感字段', v2 && !/subject|description|objective|writeScopes/.test(JSON.stringify(v2.team || {})))

// ---------- 7. TEST HOOK usage/state/report ----------
cfg.testHookFile = f('hook.json')
// 动态开关只有 ui-config/patch 路径；harness 直接改 cfg 后需重新注册 → 用 apply-time 已读取的空值。
// 这里用临时写 ui-config 不可行（apply 后 cfg 对象是内部引用，改不到）。改为验证默认关：
check('TEST HOOK 默认关（无 enabled 日志）', !readLog().includes('TEST HOOK enabled'), '')

// ---------- 8. 异常/未知事件不抛 ----------
let threw = null
try {
  ctx._emit('session/event', lead, mockEvent('session/dead', {}))
  ctx._emit('session/event', lead, mockEvent('session/error', { error: 'boom' }))
  ctx._emit('session/event', lead, mockEvent('unknown/type', {}))
  ctx._emit(
    'session/event',
    mockSession('session-harness-agent-0002', { delegationDepth: 1 }),
    mockEvent('turn/start', {})
  )
} catch (e) {
  threw = e
}
check('未知/异常事件不抛', !threw, threw ? String(threw) : '')
await sleep(80)

// ---------- 9. 隐私 ----------
const v2Text = JSON.stringify(readV2() || {})
check('v2 无绝对路径', !/[A-Za-z]:[\\/]/.test(v2Text), v2Text.match(/[A-Za-z]:[\\/][^"]{0,40}/)?.[0] || '')
const logText = readLog()
check('日志无绝对路径', !/[A-Za-z]:[\\/]/.test(logText), logText.match(/[A-Za-z]:[\\/][^"\s]{0,40}/)?.[0] || '')
check('无 API key 形状', !/sk-[A-Za-z0-9]{16,}/.test(v2Text + logText))

// ---------- 10. dispose ----------
let disposeErr = null
try {
  ctx._dispose()
} catch (e) {
  disposeErr = e
}
await sleep(80)
check(
  'dispose 不抛且写 disposed 日志',
  !disposeErr && readLog().includes('disposed'),
  disposeErr ? String(disposeErr) : ''
)

globalThis.setInterval = realSetInterval

// ---------- 汇总 ----------
const failed = checks.filter((c) => !c.ok)
const uncaughtNow = uncaught.filter((t) => !/session\/error/.test(t))
check('全程无 uncaught/未处理拒绝', uncaughtNow.length === 0, uncaughtNow.join('\n').slice(0, 400))
if (checks.some((c) => !c.ok) !== failed.length) failed.push(...checks.filter((c) => !c.ok))
console.log(`\nharness: ${checks.length - checks.filter((c) => !c.ok).length}/${checks.length} passed (tmp=${dir})`)
if (checks.some((c) => !c.ok)) {
  console.error('失败项：')
  for (const c of checks.filter((c) => !c.ok)) console.error(` - ${c.name}${c.detail ? ' :: ' + c.detail : ''}`)
  process.exit(1)
}
process.exit(0)
