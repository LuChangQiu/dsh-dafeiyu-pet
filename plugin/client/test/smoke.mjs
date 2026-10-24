/**
 * dsh-pet-bridge-ui — Node 侧 smoke 测试（不启动 DSH、不连真实桌宠）
 *
 * 覆盖：
 *   1. 日志解析（say 行 / loaded 行 / 今日 calls+cost）
 *   2. 免打扰时段解析与判定
 *   3. wire 协议路由（mock webServer）：ping / state.get / config.set / 鉴权栅栏 / 非法信封
 *   4. ui-config.json 写入格式 + activity.txt 热切写入（临时目录）
 *   5. client.js 能被当作 bundle 解析（语法 + __ModuleLoader__ 契约）
 *
 * 运行：node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')

const index = await import(pathToFileURL(path.join(libDir, 'index.js')).href)
const {
  parseBridgeLog,
  parseQuietRanges,
  isInQuietHours,
  buildHandler,
  DEFAULTS,
  petSettingsToCmds,
  normalizePetSettings,
  buildBubbleConfig,
  PET_CONFIG_FIELDS
} = index.__test
const { mountWebRoute } = await import(pathToFileURL(path.join(libDir, 'web-route.js')).href)

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error?.stack ?? error}`)
    process.exitCode = 1
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error?.stack ?? error}`)
    process.exitCode = 1
  }
}

// ───────────────────────── 1. 日志解析 ─────────────────────────
console.log('\n[1] 日志解析')

const SAMPLE_LOG = [
  '[2026-10-23T05:45:03.230Z] [info] llm call {"kind":"turnStart","latencyMs":1013,"tokens":372,"callsToday":11,"costToday":0.0062}',
  '[2026-10-23T05:45:03.232Z] [info] say {"kind":"turnStart","style":"normal","source":"llm","line":"开工吧，我照旧蹲旁边——干饭帮不上，占位还行。","latencyMs":1013,"tokens":372,"callsToday":11,"costToday":0.0062}',
  '[2026-10-23T05:45:04.068Z] [info] inner {"kind":"turnStart","line":"（今天要顺顺利利的呀。）"}',
  '[2026-10-23T05:46:44.663Z] [info] long task: walk two steps {"session":"session-54d9","step":1}',
  '[2026-10-23T05:47:00.000Z] [info] loaded v7 {"dryRun":false,"llm":"deepseek-official/deepseek-flash","llmLimits":{"maxTokens":200,"timeoutMs":3000,"maxCallsPerDay":300,"budgetPerDayYuan":1},"quietHours":["23:30-08:00"],"activity":"normal"}',
  '[2026-10-23T06:00:00.000Z] [info] say {"kind":"turnEnd","source":"llm","line":"这轮收工，我尾巴都蹲僵了。","callsToday":12,"costToday":0.0068}'
].join('\n')

test('say 行解析出最近记录（旧→新）且只保留 limit 条', () => {
  const r = parseBridgeLog(SAMPLE_LOG, 10)
  assert.equal(r.recentSay.length, 2)
  assert.equal(r.recentSay[0].kind, 'turnStart')
  assert.equal(r.recentSay[1].kind, 'turnEnd')
  assert.match(r.recentSay[1].line, /收工/)
  assert.equal(r.lastSayAt, '2026-10-23T06:00:00.000Z')
})

test('loaded v7 行解析出生效配置', () => {
  const r = parseBridgeLog(SAMPLE_LOG, 10)
  assert.equal(r.loaded.llm, 'deepseek-official/deepseek-flash')
  assert.equal(r.loaded.llmLimits.budgetPerDayYuan, 1)
  assert.deepEqual(r.loaded.quietHours, ['23:30-08:00'])
})

test('空日志不抛错', () => {
  const r = parseBridgeLog('', 10)
  assert.deepEqual(r.recentSay, [])
  assert.equal(r.loaded, null)
})

// ───────────────────────── 2. 免打扰 ─────────────────────────
console.log('\n[2] 免打扰时段')

test('解析多段与跨午夜', () => {
  const ranges = parseQuietRanges(['23:30-08:00', '12:00-13:00', 'bad', '25:00-26:00'])
  assert.equal(ranges.length, 2)
  assert.equal(ranges[0].start, 23 * 60 + 30)
  assert.equal(ranges[0].end, 8 * 60)
})

test('跨午夜判定', () => {
  const ranges = parseQuietRanges(['23:30-08:00'])
  assert.equal(isInQuietHours(ranges, new Date(2026, 9, 23, 23, 45)), true)
  assert.equal(isInQuietHours(ranges, new Date(2026, 9, 23, 3, 0)), true)
  assert.equal(isInQuietHours(ranges, new Date(2026, 9, 23, 8, 0)), false)
  assert.equal(isInQuietHours(ranges, new Date(2026, 9, 23, 14, 0)), false)
})

// ───────────────────────── 3. wire 协议路由 ─────────────────────────
console.log('\n[3] wire 协议路由（mock webServer）')

function makeReq({ method = 'POST', url = '/pet-bridge-ui/ping', body, headers = {} } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from(payload ? [Buffer.from(payload)] : [])
  req.method = method
  req.url = url
  req.headers = Object.assign({ host: '127.0.0.1:3080', 'content-type': 'application/json' }, headers)
  return req
}

function makeRes() {
  const res = {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers
    },
    end(chunk) {
      res.body = chunk === undefined ? '' : String(chunk)
    }
  }
  return res
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbu-test-'))
const tmpCfg = {
  ...DEFAULTS,
  uiConfigFile: path.join(tmpDir, 'ui-config.json'),
  activityFile: path.join(tmpDir, 'activity.txt'),
  stateFile: path.join(tmpDir, 'state.json'),
  logFile: path.join(tmpDir, 'pet-bridge-main.log'),
  evidenceDir: tmpDir,
  // ⚠️ 隔离：actionFile / petConfigFile / heartbeatFile 必须指向临时目录，
  //    否则测试会写生产 sidecar（曾误触生产 ui-action 队列，勿再犯）。
  stateV2File: path.join(tmpDir, 'bridge-state-v2.json'),
  eventsFile: path.join(tmpDir, 'events.json'),
  companionFile: path.join(tmpDir, 'companion.json'),
  actionFile: path.join(tmpDir, 'ui-action.json'),
  petConfigFile: path.join(tmpDir, 'pet-config.json'),
  heartbeatFile: path.join(tmpDir, 'heartbeat.json'),
  pipe: '\\\\.\\pipe\\pbu-test-definitely-missing',
  pipeProbeTimeoutMs: 200,
  processProbeTtlMs: 60000
}
fs.writeFileSync(tmpCfg.logFile, SAMPLE_LOG, 'utf8')
fs.writeFileSync(tmpCfg.activityFile, 'normal', 'utf8')
fs.writeFileSync(
  tmpCfg.petConfigFile,
  JSON.stringify({
    mode: 'still',
    size: 0.54,
    opacity: 0.9,
    line_freq: '话多',
    layer: 'normal',
    bubble_style: 'dark',
    skin: '大肥鱼',
    volume: 0.5,
    quiet_minutes: 10,
    city: '唐山',
    music_link: false,
    sound_on: false,
    passthrough: true,
    locked: true,
    topmost: false,
    snap_on: false
  }),
  'utf8'
)

const noopLog = { info() {}, warn() {} }
const handler = buildHandler(tmpCfg, noopLog)

function mountWith(handlerImpl, routePath = '/pet-bridge-ui', connection) {
  const routes = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
    }
  }
  const dispose = mountWebRoute({ webServer, connection, channel: routePath, handler: handlerImpl, log: noopLog })
  return { routes, dispose }
}

function mount(routePath = '/pet-bridge-ui', connection) {
  const routes = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
    }
  }
  const dispose = mountWebRoute({
    webServer,
    connection,
    channel: routePath,
    handler,
    log: noopLog
  })
  return { routes, dispose }
}

async function invoke(routes, req, res) {
  const matched = routes.filter((r) => {
    const p = new URL(req.url, 'http://127.0.0.1').pathname
    return r.kind === 'prefix' ? p.startsWith(r.path) : p === r.path
  })
  assert.ok(matched.length > 0, 'route not registered')
  await matched[0].handler(req, res)
  return res
}

await testAsync('ping 返回 server-response 信封', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(routes, makeReq({ body: { rpcId: 'r1', method: 'ping' } }), makeRes())
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, 'r1')
  assert.equal(body.result.ok, true)
  assert.equal(body.result.data.pong, true)
  dispose()
})

await testAsync('state.get 返回聚合状态（日志回退路径）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/state.get',
      body: { rpcId: 'r2', method: 'state.get' }
    }),
    makeRes()
  )
  assert.equal(res.status, 200)
  const data = JSON.parse(res.body).result.data
  assert.equal(data.host.online, true)
  assert.equal(typeof data.host.pid, 'number')
  assert.equal(data.pipe.online, false)
  assert.equal(data.config.activity, 'normal')
  assert.equal(data.config.model, 'deepseek-flash')
  assert.equal(data.config.quietHours[0], '23:30-08:00')
  assert.equal(data.recentSay.length, 2)
  assert.equal(data.today.calls >= 0, true)
  assert.ok(data.files.logFile.endsWith('pet-bridge-main.log'))
  dispose()
})

await testAsync('config.set 写 ui-config.json + activity.txt（activity 即时生效）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/config.set',
      body: {
        rpcId: 'r3',
        method: 'config.set',
        payload: {
          activity: 'lively',
          enabled: true,
          quietHours: ['23:30-08:00', '12:00-13:00'],
          budgetPerDayYuan: 0.5
        }
      }
    }),
    makeRes()
  )
  assert.equal(res.status, 200)
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  assert.equal(result.data.applied.activity, 'immediate')
  const saved = JSON.parse(fs.readFileSync(tmpCfg.uiConfigFile, 'utf8'))
  assert.equal(saved.activity, 'lively')
  assert.equal(saved.llm.budgetPerDayYuan, 0.5)
  assert.deepEqual(saved.quietHours, ['23:30-08:00', '12:00-13:00'])
  assert.equal(fs.readFileSync(tmpCfg.activityFile, 'utf8'), 'lively')
  dispose()
})

await testAsync('config.set 拒绝非法时段 / 非法 activity', async () => {
  const { routes, dispose } = mount()
  for (const payload of [{ quietHours: ['25:99-26:00'] }, { activity: 'hyper' }, { enabled: 'yes' }]) {
    const res = await invoke(
      routes,
      makeReq({
        url: '/pet-bridge-ui/config.set',
        body: { rpcId: 'r4', method: 'config.set', payload }
      }),
      makeRes()
    )
    const result = JSON.parse(res.body).result
    assert.equal(result.ok, false, JSON.stringify(payload))
    assert.equal(result.error.code, 'invalid-argument')
  }
  dispose()
})

await testAsync('鉴权栅栏：requestRejection 返回 403 时拒绝', async () => {
  const { routes, dispose } = mount('/pet-bridge-ui', {
    requestRejection: () => 403
  })
  const res = await invoke(routes, makeReq({ body: { rpcId: 'r5', method: 'ping' } }), makeRes())
  assert.equal(res.status, 403)
  assert.equal(res.body, 'forbidden')
  dispose()
})

await testAsync('无 connection 时 loopback 同源放行、非 POST 405、非 JSON 415', async () => {
  const { routes, dispose } = mount()
  const ok = await invoke(routes, makeReq({ body: { rpcId: 'r6', method: 'ping' } }), makeRes())
  assert.equal(ok.status, 200)

  const notPost = await invoke(routes, makeReq({ method: 'GET', body: undefined }), makeRes())
  assert.equal(notPost.status, 405)

  const badType = await invoke(
    routes,
    makeReq({
      body: { rpcId: 'r7', method: 'ping' },
      headers: { 'content-type': 'text/plain' }
    }),
    makeRes()
  )
  assert.equal(badType.status, 415)
  dispose()
})

await testAsync('method 与 endpoint 不一致 → ok:false', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/state.get',
      body: { rpcId: 'r8', method: 'config.set' }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
  dispose()
})

await testAsync('测试动作用不存在管道 → pipe-unavailable（不抛异常）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/test.jump',
      body: { rpcId: 'r9', method: 'test.jump' }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'pipe-unavailable')
  dispose()
})

// ───────────────────────── 3.5 桌宠设置 / 应急 ─────────────────────────
console.log('\n[3.5] 桌宠设置与应急通道')

test('petSettingsToCmds 生成 cmd:config 批量行且只带白名单字段', () => {
  const cmds = petSettingsToCmds({
    size: 0.9,
    opacity: 0.8,
    mode: 'still',
    lineFreq: '话多',
    passthrough: true,
    locked: true,
    topmost: false,
    snap: true,
    layer: 'bottom',
    bubbleStyle: 'dark',
    skin: '大肥鱼',
    soundOn: false,
    volume: 0.5,
    musicLink: false,
    city: '汕头',
    quietMinutes: 15,
    bubbleMs: 7000,
    hacked: 'x',
    __proto__x: 1
  })
  assert.equal(cmds.length, 1)
  assert.ok(cmds[0].startsWith('cmd:config:'))
  const payload = JSON.parse(cmds[0].slice('cmd:config:'.length))
  assert.equal(payload.size, 0.9)
  assert.equal(payload.mode, 'still')
  assert.equal(payload.lineFreq, '话多')
  assert.equal(payload.city, '汕头')
  assert.equal(payload.quietMinutes, 15)
  assert.equal(payload.hacked, undefined)
  assert.deepEqual(Object.keys(payload).sort(), PET_CONFIG_FIELDS.filter((k) => payload[k] !== undefined).sort())
})

test('petSettingsToCmds 空对象返回空数组', () => {
  assert.deepEqual(petSettingsToCmds({}), [])
  assert.deepEqual(petSettingsToCmds(null), [])
})

test('normalizePetSettings 校验新字段并拒绝非法值', () => {
  const good = normalizePetSettings({
    size: 0.72,
    opacity: 1,
    volume: 0.9,
    mode: 'wander',
    lineFreq: '正常',
    layer: 'top',
    bubbleStyle: 'auto',
    skin: '大肥鱼',
    quietMinutes: 30,
    topmost: true,
    snap: true,
    passthrough: false,
    locked: false,
    city: '汕头'
  })
  assert.equal(good.error, undefined)
  assert.equal(good.value.size, 0.72)
  assert.equal(good.value.volume, 0.9)
  assert.equal(good.value.quietMinutes, 30)

  for (const bad of [
    { size: 0.1 },
    { opacity: 0.1 },
    { volume: 1.5 },
    { mode: 'run' },
    { lineFreq: '超多' },
    { layer: 'middle' },
    { bubbleStyle: 'rainbow' },
    { skin: '' },
    { quietMinutes: 999 },
    { topmost: 'yes' },
    { city: 'x'.repeat(21) }
  ]) {
    const r = normalizePetSettings(bad)
    assert.ok(r.error, '应拒绝 ' + JSON.stringify(bad))
  }
})

test('buildBubbleConfig 按 bubbleMs 派生各气泡节奏', () => {
  const b = buildBubbleConfig(5000)
  assert.equal(b.normalMs, 5000)
  assert.equal(b.innerMs, 3000)
  assert.equal(b.reportMs, 10000)
  assert.equal(b.approvalMs, 8000)
  assert.equal(b.nightMs, 6000)
  const b2 = buildBubbleConfig(8000)
  assert.equal(b2.innerMs, 4800)
})

await testAsync('config.set pet → 写 ui-config.pet + bubble（管道不可用时仍保存）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/config.set',
      body: {
        rpcId: 'r-pet',
        method: 'config.set',
        payload: {
          pet: {
            size: 0.9,
            opacity: 0.8,
            mode: 'still',
            lineFreq: '话多',
            passthrough: true,
            locked: true,
            topmost: true,
            snap: false,
            layer: 'bottom',
            bubbleStyle: 'dark',
            skin: '大肥鱼',
            volume: 0.5,
            musicLink: false,
            soundOn: false,
            city: '汕头',
            quietMinutes: 15,
            bubbleMs: 8000
          }
        }
      }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  const saved = JSON.parse(fs.readFileSync(tmpCfg.uiConfigFile, 'utf8'))
  assert.equal(saved.pet.size, 0.9)
  assert.equal(saved.pet.layer, 'bottom')
  assert.equal(saved.pet.bubbleMs, 8000)
  assert.equal(saved.bubble.normalMs, 8000)
  assert.equal(saved.bubble.innerMs, 4800)
  // 管道不存在：cmd 下发 ok:false 但配置照常保存
  assert.equal(Array.isArray(result.data.applied.pet), true)
  dispose()
})

await testAsync('logs.get 返回日志尾部行', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/logs.get',
      body: { rpcId: 'r-log', method: 'logs.get', payload: { lines: 3 } }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  assert.equal(result.data.lines.length, 3)
  assert.ok(result.data.lines.some((l) => l.includes('say')))
  dispose()
})

await testAsync('action.request 写 ui-action.json；未完成动作时 busy', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/action.request',
      body: {
        rpcId: 'r-act',
        method: 'action.request',
        payload: { name: 'restart-pet' }
      }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  assert.equal(result.data.queued, true)
  const queued = JSON.parse(fs.readFileSync(tmpCfg.actionFile, 'utf8'))
  assert.equal(queued.name, 'restart-pet')
  assert.ok(queued.id)
  assert.equal(queued.handledAt, undefined)

  // 未消费前再请求 → busy
  const res2 = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/action.request',
      body: {
        rpcId: 'r-act2',
        method: 'action.request',
        payload: { name: 'stop-pet' }
      }
    }),
    makeRes()
  )
  const result2 = JSON.parse(res2.body).result
  assert.equal(result2.ok, false)
  assert.equal(result2.error.code, 'busy')

  // 模拟消费后允许下一次
  queued.handledAt = new Date().toISOString()
  queued.status = 'done'
  fs.writeFileSync(tmpCfg.actionFile, JSON.stringify(queued), 'utf8')
  const res3 = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/action.request',
      body: {
        rpcId: 'r-act3',
        method: 'action.request',
        payload: { name: 'stop-pet' }
      }
    }),
    makeRes()
  )
  assert.equal(JSON.parse(res3.body).result.ok, true)

  // 非法动作名
  const res4 = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/action.request',
      body: {
        rpcId: 'r-act4',
        method: 'action.request',
        payload: { name: 'format-c' }
      }
    }),
    makeRes()
  )
  assert.equal(JSON.parse(res4.body).result.ok, false)
  dispose()
})

await testAsync('config.reset 恢复默认值（含完整 pet 默认表 + bubble）', async () => {
  const { routes, dispose } = mount()
  fs.writeFileSync(tmpCfg.uiConfigFile, JSON.stringify({ pet: { size: 0.2 }, activity: 'quiet' }), 'utf8')
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/config.reset',
      body: { rpcId: 'r-reset', method: 'config.reset' }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  const saved = JSON.parse(fs.readFileSync(tmpCfg.uiConfigFile, 'utf8'))
  assert.equal(saved.pet.size, 0.36)
  assert.equal(saved.pet.mode, 'wander')
  assert.equal(saved.pet.city, '汕头')
  assert.equal(saved.pet.bubbleMs, 5000)
  assert.equal(saved.bubble.normalMs, 5000)
  assert.equal(saved.activity, 'normal')
  assert.deepEqual(saved.quietHours, ['23:30-08:00'])
  assert.equal(fs.readFileSync(tmpCfg.activityFile, 'utf8'), 'normal')
  dispose()
})

await testAsync('pet.nativeui 管道不可用时报错（不抛）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/pet.nativeui',
      body: { rpcId: 'r-nui', method: 'pet.nativeui', payload: { on: true } }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'pipe-unavailable')
  dispose()
})

// ───────────────────────── 3.6 task-36/40：快捷查看 / 双击 / 自启 ─────────────────────────
console.log('\n[3.6] 快捷查看与双击/自启')

test('PET_ACTION_CMDS 覆盖旧菜单快捷项且 balance/quit 标注待服务端', () => {
  const cmds = index.__test.PET_ACTION_CMDS
  for (const k of [
    'balance',
    'weather',
    'music',
    'summary',
    'show',
    'hide',
    'snapInto',
    'recover',
    'quietStart',
    'quietEnd',
    'quit'
  ]) {
    assert.ok(cmds[k], '缺少动作 ' + k)
  }
  assert.equal(cmds.weather, 'cmd:weather')
  assert.equal(cmds.quietEnd, 'cmd:quiet:off')
  const readiness = index.__test.DEFAULT_PET_ACTION_READINESS
  assert.equal(readiness.balance, false)
  assert.equal(readiness.quit, false)
  assert.equal(readiness.weather, true)
  assert.equal(readiness.quietStart, true)
})

test('normalizePetSettings 支持 doubleClick / autoStart', () => {
  const good = normalizePetSettings({
    doubleClick: 'weather',
    autoStart: true
  })
  assert.equal(good.error, undefined)
  assert.equal(good.value.doubleClick, 'weather')
  assert.equal(good.value.autoStart, true)
  for (const bad of [{ doubleClick: 'dance' }, { autoStart: 'yes' }]) {
    assert.ok(normalizePetSettings(bad).error, '应拒绝 ' + JSON.stringify(bad))
  }
})

await testAsync('pet.action：未就绪动作返回 not-supported（balance）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/pet.action',
      body: {
        rpcId: 'r-pa1',
        method: 'pet.action',
        payload: { name: 'balance' }
      }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not-supported')
  dispose()
})

await testAsync('pet.action：已就绪动作在管道不可用时返回 pipe-unavailable', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/pet.action',
      body: {
        rpcId: 'r-pa2',
        method: 'pet.action',
        payload: { name: 'weather' }
      }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'pipe-unavailable')
  dispose()
})

await testAsync('pet.action：未知动作 invalid-argument', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/pet.action',
      body: {
        rpcId: 'r-pa3',
        method: 'pet.action',
        payload: { name: 'explode' }
      }
    }),
    makeRes()
  )
  assert.equal(JSON.parse(res.body).result.error.code, 'invalid-argument')
  dispose()
})

await testAsync('state.get 含 capabilities 与 petOptions（皮肤/双击/自启）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/state.get',
      body: { rpcId: 'r-caps', method: 'state.get' }
    }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  assert.ok(Array.isArray(data.capabilities.petActions))
  assert.equal(data.capabilities.petActionReadiness.weather, true)
  assert.equal(typeof data.capabilities.doubleClick, 'boolean')
  assert.ok(Array.isArray(data.petOptions.skins) && data.petOptions.skins.includes('大肥鱼'))
  assert.ok(Array.isArray(data.petOptions.doubleClickOptions))
  assert.equal(typeof data.petOptions.autoStart, 'boolean')
  dispose()
})

await testAsync('config.set pet.doubleClick/autoStart 写入 ui-config.pet（pending）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/config.set',
      body: {
        rpcId: 'r-dc',
        method: 'config.set',
        payload: { pet: { doubleClick: 'music', autoStart: true } }
      }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  const saved = JSON.parse(fs.readFileSync(tmpCfg.uiConfigFile, 'utf8'))
  assert.equal(saved.pet.doubleClick, 'music')
  assert.equal(saved.pet.autoStart, true)
  assert.ok(result.data.applied.petPendingFields.includes('doubleClick'))
  dispose()
})
// ───────────────────────── 3.7 task-44：状态通道归一 ─────────────────────────
console.log('\n[3.7] 状态通道（state:<json>）归一/失联')

const { normalizeRuntimeStatus } = index.__test
const NOW = Date.parse('2026-10-23T06:40:00.000Z')
const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString()

test('各状态枚举 → 中文标签/色调', () => {
  const cases = {
    idle: ['空闲', 'dim'],
    thinking: ['思考中', 'busy'],
    tool: ['调工具', 'busy'],
    waiting_approval: ['等确认', 'warn'],
    waiting_input: ['等输入', 'warn'],
    background: ['后台运行', 'dim'],
    error: ['出错', 'err'],
    done: ['完成', 'ok']
  }
  for (const [state, [label, tone]] of Object.entries(cases)) {
    const r = normalizeRuntimeStatus({ status: { state, heartbeatAt: iso(1000) } }, { now: NOW })
    assert.equal(r.state, state, state)
    assert.equal(r.label, label)
    assert.equal(r.tone, tone)
    assert.equal(r.disconnected, false)
  }
})

test('别名归一（approval/toolcall/running/offline…）', () => {
  const pairs = [
    ['approval', 'waiting_approval'],
    ['toolcall', 'tool'],
    ['running', 'background'],
    ['failed', 'error'],
    ['completed', 'done'],
    ['offline', 'disconnected']
  ]
  for (const [raw, want] of pairs) {
    const r = normalizeRuntimeStatus({ status: { state: raw, heartbeatAt: iso(500) } }, { now: NOW })
    assert.equal(r.state, want, raw)
  }
})

test('心跳超 30s → disconnected（失联）', () => {
  const fresh = normalizeRuntimeStatus({ status: { state: 'thinking', heartbeatAt: iso(29000) } }, { now: NOW })
  assert.equal(fresh.disconnected, false)
  assert.equal(fresh.state, 'thinking')
  const stale = normalizeRuntimeStatus({ status: { state: 'thinking', heartbeatAt: iso(31000) } }, { now: NOW })
  assert.equal(stale.disconnected, true)
  assert.equal(stale.state, 'disconnected')
  assert.equal(stale.label, '失联')
  assert.equal(stale.tone, 'err')
})

test('无 status 字段：supported=false 且按 state.json.updatedAt 兜底判活', () => {
  const fresh = normalizeRuntimeStatus({ updatedAt: iso(5000) }, { now: NOW })
  assert.equal(fresh.supported, false)
  assert.equal(fresh.disconnected, false)
  assert.equal(fresh.state, 'idle')
  const stale = normalizeRuntimeStatus({ updatedAt: iso(120000) }, { now: NOW })
  assert.equal(stale.disconnected, true)
  const empty = normalizeRuntimeStatus(null, { now: NOW })
  assert.equal(empty.supported, false)
  assert.equal(empty.disconnected, true)
})

test('容错：runtime.status / 顶层 runtime 两种形状都读；tool/step/turn/since 解析', () => {
  const a = normalizeRuntimeStatus(
    {
      runtime: {
        status: {
          state: 'tool',
          tool: 'bash',
          step: 3,
          turn: 2,
          since: iso(45000),
          heartbeatAt: iso(2000)
        }
      }
    },
    { now: NOW }
  )
  assert.equal(a.state, 'tool')
  assert.equal(a.tool, 'bash')
  assert.equal(a.step, 3)
  assert.equal(a.turn, 2)
  assert.equal(a.elapsedMs, 45000)
  const b = normalizeRuntimeStatus({ runtime: { state: 'thinking', heartbeatAt: iso(1000) } }, { now: NOW })
  assert.equal(b.state, 'thinking')
  assert.equal(b.supported, true)
})

await testAsync('state.get 返回 runtime 字段（当前环境无 status → 未就绪兜底）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/state.get',
      body: { rpcId: 'r-rt', method: 'state.get' }
    }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  assert.ok(data.runtime && typeof data.runtime === 'object')
  assert.equal(typeof data.runtime.state, 'string')
  assert.equal(typeof data.runtime.label, 'string')
  assert.equal(typeof data.runtime.disconnected, 'boolean')
  assert.equal(data.runtime.staleAfterMs, 30000)
  dispose()
})

// ───────────────────────── 3.8 task-46：多会话（工作区分组） ─────────────────────────
console.log('\n[3.8] 多会话视图（sessions[]）')

const { normalizeSessions } = index.__test
const SESS_NOW = Date.parse('2026-10-23T07:10:00.000Z')
const sessAgo = (ms) => new Date(SESS_NOW - ms).toISOString()

test('无 sessions 字段 → 单会话兼容模式', () => {
  const rt = {
    state: 'idle',
    label: '空闲',
    tone: 'dim',
    tool: null,
    heartbeatAt: sessAgo(2000),
    heartbeatAgeMs: 2000
  }
  const r = normalizeSessions({ currentSessionId: 's1', activeSessionCount: 1 }, rt, { now: SESS_NOW })
  assert.equal(r.supported, false)
  assert.equal(r.total, 1)
  assert.equal(r.othersCount, 0)
  assert.equal(r.groups.length, 1)
  assert.equal(r.groups[0].sessions[0].isCurrent, true)
  assert.equal(r.groups[0].sessions[0].label, '空闲')
})

test('计数：userActiveCount 只算真人、backgroundCount 单列（不含子代理）', () => {
  const r = normalizeSessions(
    {
      currentSessionId: 'u1',
      activeSessionCount: 4,
      userActiveCount: 2,
      backgroundCount: 2,
      sessions: [
        { sessionId: 'u1', workspace: 'w', title: 'im#u1', role: 'user', state: 'thinking', lastSeenAt: sessAgo(1000) },
        { sessionId: 'u2', workspace: 'w2', title: 'im#u2', role: 'user', state: 'tool', lastSeenAt: sessAgo(2000) },
        {
          sessionId: 't1',
          workspace: 'w',
          title: 'im#t1',
          role: 'subagent',
          state: 'background',
          lastSeenAt: sessAgo(3000)
        },
        {
          sessionId: 't2',
          workspace: 'w3',
          title: 'im#t2',
          role: 'teammate',
          state: 'background',
          lastSeenAt: sessAgo(4000)
        }
      ]
    },
    null,
    { now: SESS_NOW }
  )
  assert.equal(r.userActiveCount, 2)
  assert.equal(r.backgroundCount, 2)
  // 另有 1 个真人对话（u2），子代理不算「对话」
  assert.equal(r.othersCount, 1)
  assert.equal(r.total, 4)
  assert.equal(r.groups.length, 3)
})

test('分项计数缺省时从 sessions 推导；current 字段兼容', () => {
  const r = normalizeSessions(
    {
      sessions: [
        { sessionId: 'a', workspace: 'w', role: 'user', state: 'thinking', lastSeenAt: sessAgo(1000), current: true },
        { sessionId: 'b', workspace: 'w2', role: 'user', state: 'idle', lastSeenAt: sessAgo(2000) },
        { sessionId: 'c', workspace: 'w2', role: 'subagent', state: 'background', lastSeenAt: sessAgo(3000) }
      ]
    },
    null,
    { now: SESS_NOW }
  )
  assert.equal(r.supported, true)
  assert.equal(r.userActiveCount, 2)
  assert.equal(r.backgroundCount, 1)
  assert.equal(r.othersCount, 1)
  assert.equal(r.groups.length, 2)
  assert.equal(r.groups[0].sessions[0].sessionId, 'a')
})

test('lastUserMessageAt 解析为年龄；无值时 null（UI 显示 —）', () => {
  const r = normalizeSessions(
    {
      currentSessionId: 's1',
      sessions: [
        {
          sessionId: 's1',
          workspace: 'w',
          role: 'user',
          state: 'idle',
          lastUserMessageAt: sessAgo(120000),
          lastSeenAt: sessAgo(1000)
        },
        {
          sessionId: 's2',
          workspace: 'w2',
          role: 'user',
          state: 'idle',
          lastUserMessageAt: null,
          lastSeenAt: sessAgo(2000)
        }
      ]
    },
    null,
    { now: SESS_NOW }
  )
  const s1 = r.groups.flatMap((g) => g.sessions).find((s) => s.sessionId === 's1')
  const s2 = r.groups.flatMap((g) => g.sessions).find((s) => s.sessionId === 's2')
  assert.equal(s1.lastUserMessageAgeMs, 120000)
  assert.equal(s2.lastUserMessageAgeMs, null)
})

test('多工作区：当前会话所在组排最前，组内按最近活动排序', () => {
  const r = normalizeSessions(
    {
      currentSessionId: 's-cur',
      activeSessionCount: 3,
      sessions: [
        {
          sessionId: 's-a',
          workspace: 'proj-a',
          title: 'A 任务',
          state: 'thinking',
          lastSeenAt: sessAgo(3000)
        },
        {
          sessionId: 's-b',
          workspace: 'proj-b',
          title: 'B 任务',
          state: 'tool',
          tool: 'pwsh',
          lastSeenAt: sessAgo(1000)
        },
        {
          sessionId: 's-cur',
          workspace: 'proj-b',
          title: 'B 当前',
          state: 'thinking',
          lastSeenAt: sessAgo(8000)
        }
      ]
    },
    null,
    { now: SESS_NOW }
  )
  assert.equal(r.supported, true)
  assert.equal(r.total, 3)
  assert.equal(r.othersCount, 2)
  assert.equal(r.groups.length, 2)
  assert.equal(r.groups[0].workspace, 'proj-b')
  assert.equal(r.groups[0].isCurrentGroup, true)
  assert.equal(r.groups[0].sessions[0].sessionId, 's-cur')
  assert.equal(r.groups[0].sessions[0].isCurrent, true)
  assert.equal(r.groups[1].workspace, 'proj-a')
})

test('同一工作区多对话并列展示', () => {
  const r = normalizeSessions(
    {
      currentSessionId: 's1',
      activeSessionCount: 2,
      sessions: [
        {
          sessionId: 's1',
          workspace: 'w',
          title: '一',
          state: 'idle',
          lastSeenAt: sessAgo(5000)
        },
        {
          sessionId: 's2',
          workspace: 'w',
          title: '二',
          state: 'tool',
          tool: 'bash',
          lastSeenAt: sessAgo(1000)
        }
      ]
    },
    null,
    { now: SESS_NOW }
  )
  assert.equal(r.groups.length, 1)
  assert.equal(r.groups[0].sessions.length, 2)
  assert.equal(r.groups[0].sessions[0].sessionId, 's1')
  assert.equal(r.groups[0].sessions[0].isCurrent, true)
  assert.equal(r.groups[0].isCurrentGroup, true)
})

test('role/state 后台标记 + 别名归一', () => {
  const r = normalizeSessions(
    {
      currentSessionId: 'main',
      activeSessionCount: 3,
      sessions: [
        {
          sessionId: 'main',
          workspace: 'w',
          title: '主',
          state: 'thinking',
          role: 'main',
          lastSeenAt: sessAgo(1000)
        },
        {
          sessionId: 'sub',
          workspace: 'w',
          title: '子代理',
          state: 'running',
          role: 'subagent',
          lastSeenAt: sessAgo(2000)
        },
        {
          sessionId: 'tm',
          workspace: 'w',
          title: '队友',
          state: 'background',
          role: 'team',
          lastSeenAt: sessAgo(3000)
        }
      ]
    },
    null,
    { now: SESS_NOW }
  )
  const rows = r.groups[0].sessions
  assert.equal(rows[0].isCurrent, true)
  const sub = rows.find((s) => s.sessionId === 'sub')
  assert.equal(sub.isBackground, true)
  assert.equal(sub.state, 'background')
  const tm = rows.find((s) => s.sessionId === 'tm')
  assert.equal(tm.isBackground, true)
})

await testAsync('state.get 返回 sessionList（无 sessions → supported=false 单会话兜底）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/state.get',
      body: { rpcId: 'r-sess', method: 'state.get' }
    }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  assert.ok(data.sessionList && typeof data.sessionList === 'object')
  assert.equal(typeof data.sessionList.supported, 'boolean')
  assert.equal(typeof data.sessionList.othersCount, 'number')
  assert.ok(Array.isArray(data.sessionList.groups))
  dispose()
})

// ───────────────────────── 3.9 task-45(v33)：bridge-state-v2.json 优先级 ─────────────────────────
console.log('\n[3.9] bridge-state-v2 读取优先级')

await testAsync('v2 存在时优先读取（版本/status/sessions 均来自 v2），并标记 files.stateSource', async () => {
  const v2 = {
    updatedAt: new Date().toISOString(),
    version: '9.9.9',
    host: true,
    pet: true,
    pipe: true,
    enabled: true,
    activity: 'lively',
    quietHours: ['23:30-08:00'],
    todayCalls: 7,
    todayCost: 0.0042,
    budgetPerDayYuan: 2,
    currentSessionId: 'v2-cur',
    userActiveCount: 2,
    backgroundCount: 1,
    status: {
      state: 'thinking',
      tool: null,
      since: new Date(Date.now() - 3000).toISOString(),
      heartbeatAt: new Date().toISOString()
    },
    sessions: [
      {
        sessionId: 'v2-cur',
        workspace: 'w-a',
        title: 'im#v2',
        role: 'user',
        state: 'thinking',
        lastSeenAt: new Date().toISOString()
      },
      {
        sessionId: 'v2-b',
        workspace: 'w-b',
        title: 'im#b',
        role: 'user',
        state: 'tool',
        tool: 'pwsh',
        lastSeenAt: new Date().toISOString()
      },
      {
        sessionId: 'v2-sub',
        workspace: 'w-a',
        title: 'im#sub',
        role: 'subagent',
        state: 'background',
        lastSeenAt: new Date().toISOString()
      }
    ]
  }
  fs.writeFileSync(tmpCfg.stateV2File, JSON.stringify(v2), 'utf8')
  const v2Handler = buildHandler(tmpCfg, noopLog)
  const { routes, dispose } = mountWith(v2Handler)
  const res = await invoke(
    routes,
    makeReq({ url: '/pet-bridge-ui/state.get', body: { rpcId: 'r-v2', method: 'state.get' } }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  assert.equal(data.files.stateSource, 'v2')
  assert.equal(data.versions.bridgePlugin, '9.9.9')
  assert.equal(data.runtime.state, 'thinking')
  assert.equal(data.sessionList.supported, true)
  assert.equal(data.sessionList.userActiveCount, 2)
  assert.equal(data.sessionList.backgroundCount, 1)
  assert.equal(data.sessionList.othersCount, 1)
  assert.equal(data.sessionList.groups.length, 2)
  fs.unlinkSync(tmpCfg.stateV2File)
  dispose()
})

await testAsync('v2 缺失时回退 state.json（legacy）', async () => {
  fs.writeFileSync(
    tmpCfg.stateFile,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      version: '1.2.3',
      host: true,
      pet: true,
      pipe: true,
      status: { state: 'idle', heartbeatAt: new Date().toISOString() }
    }),
    'utf8'
  )
  const legacyHandler = buildHandler(tmpCfg, noopLog)
  const { routes, dispose } = mountWith(legacyHandler)
  const res = await invoke(
    routes,
    makeReq({ url: '/pet-bridge-ui/state.get', body: { rpcId: 'r-leg', method: 'state.get' } }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  assert.equal(data.files.stateSource, 'legacy')
  assert.equal(data.versions.bridgePlugin, '1.2.3')
  assert.equal(data.runtime.state, 'idle')
  assert.equal(data.sessionList.supported, false)
  dispose()
})

// ───────────────────────── 3.10 task-51：Phase-1 数据（today/events/companion/guards/互动） ─────────────────────────
console.log('\n[3.10] Phase-1 数据契约')

test('readEvents：最新在前、unread 统计、字段裁剪', async () => {
  const { readEvents } = index.__test
  const nowIso = new Date().toISOString()
  fs.writeFileSync(
    tmpCfg.eventsFile,
    JSON.stringify({
      events: [
        { at: nowIso, kind: 'turn', level: 'S3', payload: '完成一轮', said: true, unread: false },
        { at: nowIso, kind: 'approval', level: 'S0', payload: '等你确认', said: true, unread: true },
        { at: nowIso, kind: 'error', level: 'S1', payload: '出错重试', said: false, unread: true }
      ]
    }),
    'utf8'
  )
  const r = readEvents(tmpCfg.eventsFile, 50)
  assert.equal(r.supported, true)
  assert.equal(r.total, 3)
  assert.equal(r.unread, 2)
  assert.equal(r.items.length, 3)
  assert.equal(r.items[0].kind, 'error') // 最新在前
  assert.equal(r.items[0].level, 'S1')
})

test('readEvents：文件缺失 → 空态（supported=false）', () => {
  const { readEvents } = index.__test
  const r = readEvents(path.join(tmpDir, 'nope-events.json'))
  assert.equal(r.supported, false)
  assert.deepEqual(r.items, [])
})

test('readCompanion：v2.companion.words 优先，文件兜底无 words', () => {
  const { readCompanion } = index.__test
  fs.writeFileSync(tmpCfg.companionFile, JSON.stringify({ mood: 10, level: '熟悉', streakDays: 2 }), 'utf8')
  const fromFile = readCompanion(null, tmpCfg.companionFile)
  assert.equal(fromFile.supported, true)
  assert.equal(fromFile.words, null)
  assert.equal(fromFile.level, '熟悉')
  const fromV2 = readCompanion(
    {
      companion: { mood: 10, words: { mood: '平静', energy: '有精神', affinity: '亲近' }, level: '熟悉', streakDays: 3 }
    },
    tmpCfg.companionFile
  )
  assert.deepEqual(fromV2.words, { mood: '平静', energy: '有精神', affinity: '亲近' })
})

test('guards 校验（normalize 层）：非法值拒绝', async () => {
  const { routes, dispose } = mount()
  for (const bad of [
    { guards: { maxActionsPerHour: 0 } },
    { guards: { maxActionsPerHour: 999 } },
    { guards: { noActionOnSameState: 'yes' } }
  ]) {
    const res = await invoke(
      routes,
      makeReq({ url: '/pet-bridge-ui/config.set', body: { rpcId: 'r-g', method: 'config.set', payload: bad } }),
      makeRes()
    )
    assert.equal(JSON.parse(res.body).result.ok, false, JSON.stringify(bad))
  }
  dispose()
})

await testAsync('state.get 含 todayStats/events/companion/guards/capabilities.interactions', async () => {
  const v2 = {
    updatedAt: new Date().toISOString(),
    version: '9.9.9',
    status: { state: 'thinking', heartbeatAt: new Date().toISOString() },
    today: {
      date: '2026-10-23',
      turns: 4,
      toolCalls: 12,
      longestTurnMs: 65000,
      calls: 5,
      costYuan: 0.12,
      petLlmCostYuan: 0.03,
      budgetYuan: 1,
      tokens: 250000,
      riceBowls: 2.5,
      period: '高峰'
    },
    companion: { words: { mood: '不错', energy: '有精神', affinity: '亲近' }, level: '亲近', streakDays: 3 },
    capabilities: { interactions: { head: true, feed: true, come: true } }
  }
  fs.writeFileSync(tmpCfg.stateV2File, JSON.stringify(v2), 'utf8')
  const h = buildHandler(tmpCfg, noopLog)
  const { routes, dispose } = mountWith(h)
  const res = await invoke(
    routes,
    makeReq({ url: '/pet-bridge-ui/state.get', body: { rpcId: 'r-p1', method: 'state.get' } }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  fs.unlinkSync(tmpCfg.stateV2File)
  assert.equal(data.files.stateSource, 'v2')
  assert.equal(data.todayStats.riceBowls, 2.5)
  assert.equal(data.todayStats.period, '高峰')
  assert.equal(data.todayStats.petLlmCostYuan, 0.03)
  assert.equal(data.todayStats.estimateCostYuan, 0.12)
  assert.equal(data.todayStats.tokens, 250000)
  assert.deepEqual(data.companion.words, { mood: '不错', energy: '有精神', affinity: '亲近' })
  assert.equal(data.capabilities.interactions.head, true)
  assert.equal(data.guards.maxActionsPerHour, 60)
  dispose()
})

await testAsync('interaction：能力就绪时排队 ui-action（interact-head）；未就绪 not-supported', async () => {
  const { routes, dispose } = mount()
  // 当前 tmpCfg 无 v2 → interactions 未就绪
  const resBad = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/interaction',
      body: { rpcId: 'r-i0', method: 'interaction', payload: { name: 'head' } }
    }),
    makeRes()
  )
  assert.equal(JSON.parse(resBad.body).result.error.code, 'not-supported')
  dispose()

  fs.writeFileSync(
    tmpCfg.stateV2File,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      capabilities: { interactions: { head: true, feed: true, come: true } }
    }),
    'utf8'
  )
  fs.writeFileSync(tmpCfg.actionFile, JSON.stringify({ id: 'old', handledAt: 'x', status: 'done' }), 'utf8')
  const h = buildHandler(tmpCfg, noopLog)
  const m2 = mountWith(h)
  const res = await invoke(
    m2.routes,
    makeReq({
      url: '/pet-bridge-ui/interaction',
      body: { rpcId: 'r-i1', method: 'interaction', payload: { name: 'head' } }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  assert.equal(result.data.request.name, 'interact-head')
  m2.dispose()
  fs.unlinkSync(tmpCfg.stateV2File)
})

await testAsync('events.ack：排队 ui-action events-ack', async () => {
  fs.writeFileSync(tmpCfg.actionFile, JSON.stringify({ id: 'old', handledAt: 'x', status: 'done' }), 'utf8')
  const h = buildHandler(tmpCfg, noopLog)
  const { routes, dispose } = mountWith(h)
  const res = await invoke(
    routes,
    makeReq({ url: '/pet-bridge-ui/events.ack', body: { rpcId: 'r-ack', method: 'events.ack' } }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  assert.equal(result.data.request.name, 'events-ack')
  dispose()
})

test('renderHomeHtml：自包含（无外链 http(s)），含主页关键节点', async () => {
  const { renderHomeHtml } = await import(pathToFileURL(path.join(libDir, 'home.js')).href)
  const html = renderHomeHtml()
  assert.match(html, /大肥鱼主页|大肥鱼联动/)
  assert.match(html, /实时状态/)
  assert.match(html, /运行中的对话/)
  assert.match(html, /今日数据/)
  assert.match(html, /她今天怎么样/)
  // task-62/3D：主页预留 3D 形象状态占位（render.mode 未接入前显示关闭）
  assert.match(html, /3D 形象/)
  assert.doesNotMatch(html, /https?:\/\//)
})

// ───────────────────────── 3.14 task-91 B2：聊天页 RPC 接线（mock-first） ─────────────────────────
console.log('\n[3.14] 聊天页 B2：RPC 接线（mock-first）')

async function withChatMock(opts, fn) {
  const { createMockChatServer } = await import(pathToFileURL(path.join(here, 'serve-chat-harness.mjs')).href)
  const h = await createMockChatServer(opts)
  const { url } = await h.listen()
  try {
    await fn(h, url)
  } finally {
    await h.close()
  }
}

async function chatRpc(url, method, payload) {
  const res = await fetch(url + '/pet-bridge-ui/chat/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rpcId: 'test-' + method, method, payload: payload || {} })
  })
  return res.json()
}

await testAsync('renderChatHtml（B2）：同源 /chat/rpc、state/history/send/memory、textContent、无外链', async () => {
  const { renderChatHtml } = await import(pathToFileURL(path.join(libDir, 'chat-page.js')).href)
  const html = renderChatHtml()
  assert.match(html, /大肥鱼 · 聊天/)
  assert.match(html, /RPC_URL = "\/pet-bridge-ui\/chat\/rpc"/)
  assert.match(html, /fetch\(RPC_URL/)
  assert.match(html, /chat\.state\.get/)
  assert.match(html, /chat\.history\.get/)
  assert.match(html, /chat\.send/)
  assert.match(html, /memory\.list/)
  assert.match(html, /memory\.delete/)
  assert.match(html, /memory\.forget/)
  assert.match(html, /memory\.clear/)
  assert.match(html, /textContent/)
  assert.doesNotMatch(html, /innerHTML/)
  assert.doesNotMatch(html, /https?:\/\//)
  // 同意卡：勾选前按钮仍禁用；未勾选不会写 consent
  assert.match(html, /id="btnEnable"[^>]*disabled/)
  assert.doesNotMatch(html, /id="agree"[^>]*disabled/)
  // 隐私：页面源码不出现盘符绝对路径
  assert.doesNotMatch(html, /[A-Za-z]:\\\\/)
})

await testAsync('chat mock：默认关 → CHAT_DISABLED（不返回数据、不写盘）', async () => {
  await withChatMock({}, async (h, url) => {
    const r = await chatRpc(url, 'chat.state.get', {})
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'CHAT_DISABLED')
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock：enabled → state/history/send 正常', async () => {
  await withChatMock({ enabled: true }, async (h, url) => {
    const st = await chatRpc(url, 'chat.state.get', {})
    assert.equal(st.ok, true)
    assert.equal(st.result.enabled, true)
    assert.equal(st.result.stageLabel, '熟悉')
    const h0 = await chatRpc(url, 'chat.history.get', { limit: 100 })
    assert.equal(h0.ok, true)
    assert.equal(h0.result.items.length, 0)
    const sent = await chatRpc(url, 'chat.send', { text: '在吗', clientMsgId: 'c-1' })
    assert.equal(sent.ok, true)
    assert.ok(sent.result.reply.text.length > 0)
    const h1 = await chatRpc(url, 'chat.history.get', { limit: 100 })
    assert.equal(h1.result.items.length, 2)
    assert.equal(h1.result.items[0].role, 'user')
    assert.equal(h1.result.items[1].role, 'her')
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock：memory list/delete/forget/clear', async () => {
  const memories = [
    { id: 'm1', text: '喜欢喝乌龙茶', kind: 'preference', importance: 6, source: 'user_chat' },
    { id: 'm2', text: '周五要交周报', kind: 'plan', importance: 8, source: 'user_chat' },
    { id: 'm3', text: '爱吃白饭', kind: 'event', importance: 4, source: 'event' }
  ]
  await withChatMock({ enabled: true, memories }, async (h, url) => {
    const list = await chatRpc(url, 'memory.list', { limit: 50 })
    assert.equal(list.result.items.length, 3)
    const del = await chatRpc(url, 'memory.delete', { id: 'm1' })
    assert.equal(del.result.ok, true)
    const forget = await chatRpc(url, 'memory.forget', { query: '周报' })
    assert.equal(forget.result.deleted, 1)
    const list2 = await chatRpc(url, 'memory.list', { limit: 50 })
    assert.equal(list2.result.items.length, 1)
    const clear = await chatRpc(url, 'memory.clear', { confirm: true })
    assert.equal(clear.result.ok, true)
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock：consent 首次必填、形状 {version,at}（B3 契约）', async () => {
  await withChatMock({}, async (h, url) => {
    const bad = await chatRpc(url, 'chat.settings.set', { enabled: true })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'INVALID_INPUT')
    const ok = await chatRpc(url, 'chat.settings.set', {
      enabled: true,
      consent: { version: 'v1', at: '2026-01-02T00:00:00.000Z' }
    })
    assert.equal(ok.ok, true)
    const st = await chatRpc(url, 'chat.state.get', {})
    assert.equal(st.result.enabled, true)
    const settings = await chatRpc(url, 'chat.settings.get', {})
    assert.equal(settings.result.consent.version, 'v1')
    assert.equal(h.state.writes, 0)
  })
})

// ───────────────────────── 3.15 task-91 B3：同意/静音/记忆接线（mock 数据） ─────────────────────────
console.log('\n[3.15] 聊天页 B3：同意/设置/记忆接线（mock 数据）')

await testAsync(
  'renderChatHtml（B3）：consent {version,at}、settings.get|set、静音/频率/记忆开关、单 fetch、无外链',
  async () => {
    const { renderChatHtml } = await import(pathToFileURL(path.join(libDir, 'chat-page.js')).href)
    const html = renderChatHtml()
    // 同意卡：可勾选；勾选前 btnEnable 仍禁用；首次开启写入 consent {version,at}
    assert.match(html, /id="agree">/)
    assert.doesNotMatch(html, /id="agree"[^>]*disabled/)
    assert.match(html, /id="btnEnable"[^>]*disabled/)
    assert.match(html, /consent: \{ version: "v1", at: new Date\(\)\.toISOString\(\) \}/)
    // 设置卡：静音 / 每日频率 / 记忆开关 / 保存
    assert.match(html, /chat\.settings\.get/)
    assert.match(html, /chat\.settings\.set/)
    assert.match(html, /id="quietMode"/)
    assert.match(html, /id="freq"/)
    assert.doesNotMatch(html, /option value="8"/)
    assert.match(html, /id="memEnabled"/)
    assert.match(html, /id="btnSaveSettings"/)
    assert.match(html, /id="btnDisable"/)
    assert.match(html, /enabled: false/)
    assert.match(html, /id="quietState"/)
    // 隐私说明 / 清空确认
    assert.match(html, /高风险敏感信息/)
    assert.match(html, /不可恢复/)
    assert.match(html, /再点确认清空/)
    // 渲染安全：textContent、无 innerHTML/外链/盘符路径；fetch 只有一个（同源 RPC）
    assert.match(html, /textContent/)
    assert.doesNotMatch(html, /innerHTML|https?:\/\//)
    assert.doesNotMatch(html, /[A-Za-z]:\\\\/)
    assert.equal((html.match(/fetch\(/g) || []).length, 1)
    assert.match(html, /fetch\(RPC_URL/)
  }
)

await testAsync('chat mock B3：settings.get 默认值 + set 静音/频率/记忆开关往返（返回 settings）', async () => {
  await withChatMock({}, async (h, url) => {
    const s0 = await chatRpc(url, 'chat.settings.get', {})
    assert.equal(s0.ok, true)
    assert.equal(s0.result.enabled, false)
    assert.equal(s0.result.consent, null)
    assert.equal(s0.result.quietMode, false)
    assert.equal(s0.result.frequencyPerDay, 4)
    assert.equal(s0.result.memoryEnabled, true)
    const set = await chatRpc(url, 'chat.settings.set', {
      quietMode: true,
      frequencyPerDay: 2,
      memoryEnabled: false
    })
    assert.equal(set.ok, true)
    assert.equal(set.result.settings.quietMode, true)
    assert.equal(set.result.settings.frequencyPerDay, 2)
    assert.equal(set.result.settings.memoryEnabled, false)
    const s1 = await chatRpc(url, 'chat.settings.get', {})
    assert.equal(s1.result.quietMode, true)
    assert.equal(s1.result.frequencyPerDay, 2)
    assert.equal(s1.result.memoryEnabled, false)
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock B3：首次开启 consent 校验（缺省/版本/at 非法 → INVALID_INPUT；返回 consent）', async () => {
  await withChatMock({}, async (h, url) => {
    const at = '2026-01-02T00:00:00.000Z'
    const missing = await chatRpc(url, 'chat.settings.set', { enabled: true })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'INVALID_INPUT')
    const badVer = await chatRpc(url, 'chat.settings.set', { enabled: true, consent: { version: 'v2', at } })
    assert.equal(badVer.error.code, 'INVALID_INPUT')
    const badAt = await chatRpc(url, 'chat.settings.set', { enabled: true, consent: { version: 'v1', at: 'nope' } })
    assert.equal(badAt.error.code, 'INVALID_INPUT')
    const ok = await chatRpc(url, 'chat.settings.set', { enabled: true, consent: { version: 'v1', at } })
    assert.equal(ok.ok, true)
    assert.equal(ok.result.settings.enabled, true)
    assert.equal(ok.result.settings.consent.version, 'v1')
    assert.equal(ok.result.settings.consent.at, at)
    const st = await chatRpc(url, 'chat.state.get', {})
    assert.equal(st.result.enabled, true)
    assert.equal(st.result.quietMode, false)
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock B3：memory.list 过滤 sensitivity=high（不返回原文、计数不含）', async () => {
  const memories = [
    { id: 'm1', text: '喜欢喝乌龙茶', kind: 'preference', importance: 6 },
    { id: 'h1', text: 'key=sk-test-secret', kind: 'secret', importance: 10, sensitivity: 'high' }
  ]
  await withChatMock({ enabled: true, memories }, async (h, url) => {
    const list = await chatRpc(url, 'memory.list', { limit: 50 })
    assert.equal(list.ok, true)
    assert.equal(list.result.items.length, 1)
    assert.equal(list.result.items[0].id, 'm1')
    assert.doesNotMatch(JSON.stringify(list), /sk-test-secret/)
    const st = await chatRpc(url, 'chat.state.get', {})
    assert.equal(st.result.memoryCount, 1)
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock B3：settings 白名单/频率范围校验；关闭后其余方法 403、可再开启', async () => {
  await withChatMock({ enabled: true }, async (h, url) => {
    const unknown = await chatRpc(url, 'chat.settings.set', { foo: 1 })
    assert.equal(unknown.ok, false)
    assert.equal(unknown.error.code, 'INVALID_INPUT')
    const badFreq = await chatRpc(url, 'chat.settings.set', { frequencyPerDay: 0 })
    assert.equal(badFreq.error.code, 'INVALID_INPUT')
    // 30 §4.4 主动开口 ≤4 次/天：8 视为超限
    const badFreqHi = await chatRpc(url, 'chat.settings.set', { frequencyPerDay: 8 })
    assert.equal(badFreqHi.error.code, 'INVALID_INPUT')
    const freq = await chatRpc(url, 'chat.settings.set', { frequencyPerDay: 2 })
    assert.equal(freq.ok, true)
    assert.equal(freq.result.settings.frequencyPerDay, 2)
    // 关闭：settings 可读写，其余 403 CHAT_DISABLED；已同意过则再开启无需 consent
    const off = await chatRpc(url, 'chat.settings.set', { enabled: false })
    assert.equal(off.ok, true)
    assert.equal(off.result.settings.enabled, false)
    const blocked = await chatRpc(url, 'chat.state.get', {})
    assert.equal(blocked.error.code, 'CHAT_DISABLED')
    const sg = await chatRpc(url, 'chat.settings.get', {})
    assert.equal(sg.ok, true)
    assert.equal(sg.result.enabled, false)
    const on = await chatRpc(url, 'chat.settings.set', { enabled: true })
    assert.equal(on.ok, true)
    assert.equal(on.result.settings.enabled, true)
    assert.equal(h.state.writes, 0)
  })
})

await testAsync('chat mock B3.1：关闭聊天（enabled:false）→ 禁用态；同意记录保留、可再开启', async () => {
  await withChatMock({ enabled: true }, async (h, url) => {
    const off = await chatRpc(url, 'chat.settings.set', { enabled: false })
    assert.equal(off.ok, true)
    assert.equal(off.result.settings.enabled, false)
    assert.equal(off.result.settings.consent.version, 'v1')
    const st = await chatRpc(url, 'chat.state.get', {})
    assert.equal(st.ok, false)
    assert.equal(st.error.code, 'CHAT_DISABLED')
    const sg = await chatRpc(url, 'chat.settings.get', {})
    assert.equal(sg.ok, true)
    assert.equal(sg.result.enabled, false)
    assert.equal(sg.result.consent.version, 'v1')
    // UI 再开启始终显式带 consent {version,at}
    const on = await chatRpc(url, 'chat.settings.set', {
      enabled: true,
      consent: { version: 'v1', at: '2026-01-03T00:00:00.000Z' }
    })
    assert.equal(on.ok, true)
    assert.equal(on.result.settings.enabled, true)
    assert.equal(on.result.settings.consent.version, 'v1')
    assert.equal(h.state.writes, 0)
  })
})

// ───────────────────────── 3.16 task-107 B4：形象位（本地镜像头像 + 降级 + 署名 + 3D 占位禁用） ─────────────────────────
console.log('\n[3.16] 形象位 B4：头像本地镜像 + 色板降级 + 署名')

await testAsync('portrait：本地镜像 PNG 可用、与仓库 assets 同字节、署名五要素、无外链 scheme', async () => {
  const p = await import(pathToFileURL(path.join(libDir, 'portrait.js')).href)
  const buf = p.readPortrait()
  assert.ok(buf && buf.length > 10000, '本地镜像 portrait 应存在且 >10KB')
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic')
  assert.equal(p.PORTRAIT_SRC, '/pet-bridge-ui/asset/portrait.png')
  assert.match(p.PORTRAIT_ATTRIBUTION, /YunYueSama/)
  assert.match(p.PORTRAIT_ATTRIBUTION, /codex-deepseek-pet/)
  assert.match(p.PORTRAIT_ATTRIBUTION, /大肥鱼项目署名许可 1\.0/)
  assert.match(p.PORTRAIT_ATTRIBUTION, /未重绘|降采样/)
  assert.match(p.PORTRAIT_ATTRIBUTION, /非官方/)
  assert.doesNotMatch(p.PORTRAIT_ATTRIBUTION, /https?:\/\//, '署名不得带外链 scheme（自包含页面）')
  // 镜像与仓库资产一致（防止镜像漂移）
  const mirror = fs.readFileSync(path.join(libDir, 'assets', 'whale-girl', 'portrait.png'))
  const repoAsset = fs.readFileSync(path.join(here, '..', '..', '..', 'assets', 'whale-girl', 'portrait.png'))
  assert.ok(mirror.equals(repoAsset), 'lib/assets 镜像应与 assets/whale-girl/portrait.png 同字节')
  // 降级：读不到时返回 null（供页面 onerror/色板使用）
  assert.equal(typeof p.resetPortraitCache, 'function')
})

await testAsync('renderChatHtml（B4）：头像位本地镜像 + 29 色板降级 + 署名 footer、无外链', async () => {
  const { renderChatHtml } = await import(pathToFileURL(path.join(libDir, 'chat-page.js')).href)
  const html = renderChatHtml()
  assert.match(html, /id="avatarSlot"/)
  assert.match(html, /src="\/pet-bridge-ui\/asset\/portrait\.png"/)
  assert.match(html, /class="fb"[^>]*>29</)
  assert.match(html, /onerror="this\.remove\(\)"/)
  assert.match(html, /id="attribution"/)
  assert.match(html, /YunYueSama/)
  assert.match(html, /非官方/)
  assert.doesNotMatch(html, /https?:\/\//)
  assert.doesNotMatch(html, /innerHTML/)
})

await testAsync('renderHomeHtml（B4）：头部头像位 + 色板降级 + 署名 + 3D 占位仍禁用', async () => {
  const { renderHomeHtml } = await import(pathToFileURL(path.join(libDir, 'home.js')).href)
  const html = renderHomeHtml()
  assert.match(html, /id="avatarSlot"/)
  assert.match(html, /src="\/pet-bridge-ui\/asset\/portrait\.png"/)
  assert.match(html, /class="fb"[^>]*>29</)
  assert.match(html, /onerror="this\.remove\(\)"/)
  assert.match(html, /id="attribution"/)
  assert.match(html, /YunYueSama/)
  assert.match(html, /非官方/)
  // 34 号「3D 渲染模式」占位：仍为关闭/禁用，不因 B4 解锁
  assert.match(html, /3D 形象：关闭/)
  assert.match(html, /3D 渲染模式」占位禁用/)
  assert.match(html, /待 render\.mode/)
  assert.doesNotMatch(html, /https?:\/\//)
})

await testAsync('client.js（B4）：设置页形象位 + 署名；3D（实验）按钮仍 disabled', async () => {
  const src = fs.readFileSync(path.join(libDir, 'client.js'), 'utf8')
  assert.match(src, /CHANNEL \+ '\/asset\/portrait\.png'/)
  assert.match(src, /YunYueSama/)
  assert.match(src, /非官方/)
  assert.match(src, /'3D（实验）'/)
  assert.match(src, /disabled: true,\s*title: '待 render\.mode 字段/, '3D（实验）占位仍 disabled')
  assert.doesNotMatch(src, /https?:\/\/github\.com\/YunYueSama/, '设置页署名不带外链 scheme')
})

await testAsync('index.js（B4）：GET 头像路由挂在同 channel；缺失时 404 由页面降级', async () => {
  const src = fs.readFileSync(path.join(libDir, 'index.js'), 'utf8')
  assert.match(src, /import \{ PORTRAIT_ROUTE_SUFFIX, readPortrait \} from '\.\/portrait\.js'/)
  assert.match(src, /\[cfg\.channel \+ PORTRAIT_ROUTE_SUFFIX\]: servePortrait/)
  assert.match(src, /'content-type': 'image\/png'/)
  assert.match(src, /res\.writeHead\(404/)
})

await testAsync('chat mock（B4）：GET /asset/portrait.png → PNG；portrait:false → 404（降级路径）', async () => {
  await withChatMock({}, async (h, url) => {
    const res = await fetch(url + '/pet-bridge-ui/asset/portrait.png')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /image\/png/)
    const buf = Buffer.from(await res.arrayBuffer())
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
    assert.ok(buf.length > 10000)
  })
  await withChatMock({ portrait: false }, async (h, url) => {
    const res = await fetch(url + '/pet-bridge-ui/asset/portrait.png')
    assert.equal(res.status, 404, '未装资产模拟：404')
    const html = await (await fetch(url + '/pet-bridge-ui/chat')).text()
    assert.match(html, /id="avatarSlot"/, '页面仍自包含渲染（img onerror 降级）')
  })
})

await testAsync('主页「互动」卡含聊天入口（B1）', async () => {
  const { renderHomeHtml } = await import(pathToFileURL(path.join(libDir, 'home.js')).href)
  const html = renderHomeHtml()
  assert.match(html, /id="btnChat"/)
  assert.match(html, /聊天（预览）/)
})

// ───────────────────────── 3.11 task-58：团队/目标/计划（v2 优先 + host fallback + 降级） ─────────────────────────
console.log('\n[3.11] 团队/目标/计划数据')

const { normalizeTeamFeatures } = index.__test

test('v2 字段优先：team/goal/plan/userQuestions 原样归一', () => {
  const r = normalizeTeamFeatures(
    {
      team: {
        enabled: true,
        status: 'ok',
        members: { total: 3, active: 1, failed: 0 },
        tasks: { total: 5, pending: 2, in_progress: 1, completed: 2, blocked: 0, ready: 1, progress: 0.4 },
        updatedAt: '2026-10-23T07:00:00Z'
      },
      goal: { active: true, status: 'running', roundsStarted: 2 },
      plan: { active: true, pending: 3 },
      userQuestions: { active: 1, sentCount: 2 }
    },
    { status: 'unsupported', reason: 'host-should-be-ignored' }
  )
  assert.equal(r.source, 'v2')
  assert.equal(r.status, 'ok')
  assert.equal(r.team.members.total, 3)
  assert.equal(r.team.tasks.progress, 0.4)
  assert.equal(r.goal.status, 'running')
  assert.equal(r.plan.pending, 3)
  assert.equal(r.userQuestions.active, 1)
})

test('host fallback：ok/empty/degraded/unsupported 四级', () => {
  const ok = normalizeTeamFeatures(null, {
    status: 'ok',
    team: {
      status: 'ok',
      members: { total: 2, active: 1, failed: 0 },
      tasks: { total: 4, pending: 1, in_progress: 1, completed: 2, blocked: 0, ready: 1, progress: 0.5 }
    },
    goal: { active: false, status: null, roundsStarted: null },
    plan: { active: true, pending: 2 },
    userQuestions: { active: 1, sentCount: 0 }
  })
  assert.equal(ok.source, 'host')
  assert.equal(ok.team.tasks.completed, 2)
  assert.equal(ok.goal.active, false)
  assert.equal(ok.plan.pending, 2)
  const empty = normalizeTeamFeatures(null, {
    status: 'empty',
    team: { status: 'empty', members: { total: 1, active: 1, failed: 0 }, tasks: { total: 0, progress: null } }
  })
  assert.equal(empty.status, 'empty')
  assert.equal(empty.enabled, true)
  const degraded = normalizeTeamFeatures(null, { status: 'degraded', reason: 'snapshot-error' })
  assert.equal(degraded.status, 'degraded')
  assert.equal(degraded.enabled, false)
  const unsupported = normalizeTeamFeatures(null, { status: 'unsupported', reason: 'projection-service-missing' })
  assert.equal(unsupported.status, 'unsupported')
  assert.equal(unsupported.source, 'host')
})

test('无任何数据：unsupported + 空计数（不抛错）', () => {
  const r = normalizeTeamFeatures(null, null)
  assert.equal(r.source, null)
  assert.equal(r.status, 'unsupported')
  assert.equal(r.team.tasks.total, 0)
  assert.equal(r.team.tasks.progress, null)
  assert.equal(r.goal.active, false)
})

await testAsync('state.get 含 teamFeatures（无 host bridge 时为 unsupported）', async () => {
  const { routes, dispose } = mount()
  const res = await invoke(
    routes,
    makeReq({ url: '/pet-bridge-ui/state.get', body: { rpcId: 'r-team', method: 'state.get' } }),
    makeRes()
  )
  const data = JSON.parse(res.body).result.data
  assert.ok(data.teamFeatures && typeof data.teamFeatures === 'object')
  assert.equal(typeof data.teamFeatures.status, 'string')
  assert.ok(data.teamFeatures.team && data.teamFeatures.team.members && data.teamFeatures.team.tasks)
  dispose()
})

// ───────────────────────── 3.12 task-57 v47+：workspaceName/workspaceHash 隐私 ─────────────────────────
console.log('\n[3.12] 工作区隐私（workspaceName/hash）')

test('workspaceName+workspaceHash：同名不同工作区加 ·#hash 后缀，绝不泄漏绝对路径', () => {
  const { normalizeSessions } = index.__test
  const iso = (ms) => new Date(Date.now() - ms).toISOString()
  const r = normalizeSessions(
    {
      currentSessionId: 's1',
      userActiveCount: 3,
      sessions: [
        {
          sessionId: 's1',
          workspaceName: 'proj',
          workspaceHash: 'aaaa1111',
          title: 'im#1',
          state: 'thinking',
          lastSeenAt: iso(1000)
        },
        {
          sessionId: 's2',
          workspaceName: 'proj',
          workspaceHash: 'bbbb2222',
          title: 'im#2',
          state: 'idle',
          lastSeenAt: iso(2000)
        },
        {
          sessionId: 's3',
          workspaceName: 'im',
          workspaceHash: 'cccc3333',
          title: 'im#3',
          state: 'idle',
          lastSeenAt: iso(3000)
        }
      ]
    },
    null,
    { now: Date.now() }
  )
  assert.equal(r.groups.length, 3)
  const labels = r.groups.map((g) => g.workspace).sort()
  assert.ok(labels.includes('proj·#aaaa'), labels.join(','))
  assert.ok(labels.includes('proj·#bbbb'), labels.join(','))
  assert.ok(labels.includes('im'), labels.join(','))
  assert.ok(!JSON.stringify(r).includes('C:\\') && !JSON.stringify(r).includes('E:\\'))
})

test('旧 workspace 绝对路径兼容：只保留 basename 显示名', () => {
  const { normalizeSessions } = index.__test
  const iso = (ms) => new Date(Date.now() - ms).toISOString()
  const r = normalizeSessions(
    {
      currentSessionId: 'x',
      sessions: [
        {
          sessionId: 'x',
          workspace: 'E:\\project\\XQWL-000185-北京数智模型',
          title: 't',
          state: 'idle',
          lastSeenAt: iso(1000)
        }
      ]
    },
    null,
    { now: Date.now() }
  )
  assert.equal(r.groups[0].workspace, 'XQWL-000185-北京数智模型')
  assert.ok(!JSON.stringify(r).includes('E:\\project'))
})

// ───────────────────────── 3.13 task-67：控制模式（v47 mode 契约） ─────────────────────────
console.log('\n[3.13] 控制模式 mode')

const { normalizeModeView, MODE_DEFAULT_SETTINGS } = index.__test

test('normalizeModeView：缺失 → 未就绪；silent 剩余时间/能力正确', () => {
  const now = Date.parse('2026-10-23T09:00:00.000Z')
  const absent = normalizeModeView({}, now)
  assert.equal(absent.available, false)
  assert.equal(absent.active, false)
  assert.equal(absent.capabilities.silent, false)
  const silent = normalizeModeView(
    {
      mode: {
        active: true,
        kind: 'silent',
        resumeAt: new Date(now + 1800000).toISOString(),
        since: new Date(now - 60000).toISOString()
      },
      capabilities: { mode: { silent: true, focus: true, off: true, resume: true } }
    },
    now
  )
  assert.equal(silent.available, true)
  assert.equal(silent.active, true)
  assert.equal(silent.kind, 'silent')
  assert.equal(silent.label, '静一静')
  assert.equal(silent.remainMs, 1800000)
  assert.equal(silent.capabilities.resume, true)
})

test('ui-config.mode 默认值齐全，hotkey 格式校验（前端占位）', () => {
  assert.equal(MODE_DEFAULT_SETTINGS.silentMinutes, 30)
  assert.equal(MODE_DEFAULT_SETTINGS.focusMinutes, 50)
  assert.equal(MODE_DEFAULT_SETTINGS.autoResume, true)
  assert.equal(MODE_DEFAULT_SETTINGS.hotkey, '')
})

await testAsync('mode.request：能力缺失 → not-supported；v2 就绪 → 排队 mode-silent（含 minutes）', async () => {
  const { routes, dispose } = mount()
  const bad = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/mode.request',
      body: { rpcId: 'r-m0', method: 'mode.request', payload: { name: 'silent', minutes: 20 } }
    }),
    makeRes()
  )
  assert.equal(JSON.parse(bad.body).result.error.code, 'not-supported')
  dispose()

  fs.writeFileSync(
    tmpCfg.stateV2File,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      mode: { active: true, kind: 'silent', resumeAt: new Date(Date.now() + 600000).toISOString() },
      capabilities: { mode: { silent: true, focus: true, off: true, resume: true } }
    }),
    'utf8'
  )
  fs.writeFileSync(tmpCfg.actionFile, JSON.stringify({ id: 'old', handledAt: 'x', status: 'done' }), 'utf8')
  const h = buildHandler(tmpCfg, noopLog)
  const { routes: routes2, dispose: dispose2 } = mountWith(h)
  const res = await invoke(
    routes2,
    makeReq({
      url: '/pet-bridge-ui/mode.request',
      body: { rpcId: 'r-m1', method: 'mode.request', payload: { name: 'silent', minutes: 20 } }
    }),
    makeRes()
  )
  const result = JSON.parse(res.body).result
  assert.equal(result.ok, true)
  assert.equal(result.data.request.name, 'mode-silent')
  assert.equal(result.data.request.minutes, 20)
  dispose2()
  fs.unlinkSync(tmpCfg.stateV2File)
  fs.unlinkSync(tmpCfg.actionFile)
})

await testAsync('config.set mode：合法值写入/非法值拒绝', async () => {
  const { routes, dispose } = mount()
  const okRes = await invoke(
    routes,
    makeReq({
      url: '/pet-bridge-ui/config.set',
      body: {
        rpcId: 'r-m2',
        method: 'config.set',
        payload: { mode: { silentMinutes: 45, focusMinutes: 90, autoResume: false, hotkey: 'Ctrl+Alt+S' } }
      }
    }),
    makeRes()
  )
  assert.equal(JSON.parse(okRes.body).result.ok, true)
  dispose()
  const { routes: r2, dispose: d2 } = mount()
  for (const badMode of [
    { silentMinutes: 0 },
    { focusMinutes: 999 },
    { autoResume: 'yes' },
    { hotkey: 'x'.repeat(50) },
    { offUntil: 'not-a-date' }
  ]) {
    const res = await invoke(
      r2,
      makeReq({
        url: '/pet-bridge-ui/config.set',
        body: { rpcId: 'r-m3', method: 'config.set', payload: { mode: badMode } }
      }),
      makeRes()
    )
    assert.equal(JSON.parse(res.body).result.ok, false, JSON.stringify(badMode))
  }
  d2()
})

// ───────────────────────── 4. client bundle 契约 ─────────────────────────
console.log('\n[4] client bundle 契约')

test('client.js 语法合法且注册 __ModuleLoader__.load 工厂', () => {
  const src = fs.readFileSync(path.join(libDir, 'client.js'), 'utf8')
  assert.match(src, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(src, /id:\s*'dsh-pet-bridge-ui'/)
  assert.match(src, /factory\(require\)/)
  // 语法校验：作为脚本解析（不执行）
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  assert.doesNotThrow(() => new AsyncFunction(src))
  assert.doesNotThrow(() => new Function(src))
})

test('package.json 声明 dsh.client 且 exports["./client"] 存在', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(fs.existsSync(path.join(here, '..', pkg.exports['./client'])))
})

// ───────────────────────── 清理 ─────────────────────────
fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n结果：${passed} 通过${process.exitCode ? '（有失败）' : ''}`)
