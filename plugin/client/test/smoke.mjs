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
