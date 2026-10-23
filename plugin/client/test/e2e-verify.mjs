/**
 * dsh-pet-bridge-ui — 真实链路端到端验证（e2e）
 *
 * 直接调用 Host 半边的 handler（与浏览器面板同一代码路径），验证它与
 * dsh-pet-bridge（server 插件 v15+）之间的真实 sidecar 契约：
 *   1. config.set { pet } → ui-config.json → 联动插件 20s 内 `ui-config applied` / `pet settings pushed`
 *   2. state.json 回显 petSettings / bubble / lastAction
 *   3. pet.nativeui on/off → 命名管道 cmd:nativeui:*（真实桌宠）
 *   4. action.request { start-pet } → ui-action.json → 联动插件消费 → state.json.lastAction
 *
 * 安全：只在 ui-config.json 上做一次微小改动（size 0.36↔0.37）并在结束时逐字节恢复原文件；
 * 不重启 host、不杀桌宠、不写 key；结果写入 evidence/ui-e2e-verify.json。
 *
 * 用法：node test/e2e-verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')
const PET_ROOT = process.env.PET_WORK || 'E:\\project\\AI提效\\tool\\pet-integration-src\\pet-work'
const uiFile = path.join(PET_ROOT, 'ui-config.json')
const logFile = path.join(PET_ROOT, 'evidence', 'pet-bridge-main.log')
const outFile = path.join(PET_ROOT, 'evidence', 'ui-e2e-verify.json')

const index = await import(pathToFileURL(path.join(libDir, 'index.js')).href)
const { buildHandler, DEFAULTS } = index.__test
const handler = buildHandler({ ...DEFAULTS }, { info() {}, warn() {} })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readLogTail(n = 80) {
  try {
    const st = fs.statSync(logFile)
    const size = Math.min(st.size, 262144)
    const fd = fs.openSync(logFile, 'r')
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, st.size - size)
    fs.closeSync(fd)
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-n)
  } catch {
    return []
  }
}
const grepLog = (needle) => readLogTail(200).filter((l) => l.includes(needle))

const originalUi = fs.existsSync(uiFile) ? fs.readFileSync(uiFile, 'utf8') : null
const result = { startedAt: new Date().toISOString(), steps: [] }

function step(name, data) {
  result.steps.push({ name, at: new Date().toISOString(), ...data })
  console.log(`\n[${name}]`, JSON.stringify(data).slice(0, 500))
}

try {
  // 0) 基线
  const before = (await handler('state.get')).data
  step('baseline', {
    version: before.versions,
    pipe: before.pipe.online,
    pet: before.pet.online,
    activity: before.config.activity,
    size: before.petSettings.size,
    bubble: before.bubble,
    lastAction: before.lastAction,
  })

  // 1) ui-config.pet 下发（size 0.37 + bubbleMs 5000）
  const baselineSize = Number(before.petSettings.size)
  const probeSize = Math.abs(baselineSize - 0.37) < 0.001 ? 0.36 : 0.37
  const set1 = await handler('config.set', { pet: { size: probeSize, bubbleMs: 5000 } })
  const saved1 = JSON.parse(fs.readFileSync(uiFile, 'utf8'))
  step('config.set pet', {
    ok: set1.ok,
    applied: set1.data?.applied,
    savedSize: saved1.pet && saved1.pet.size,
    savedBubble: saved1.bubble,
  })

  // 等待联动插件 20s 轮询应用
  await sleep(26000)
  const after1 = (await handler('state.get')).data
  const pushed = grepLog('pet settings pushed').slice(-3)
  const appliedLog = grepLog('ui-config applied').slice(-3)
  step('after 26s', {
    stateSize: after1.petSettingsApplied && after1.petSettingsApplied.size,
    stateBubble: after1.bubble,
    petSettingsSourceState: after1.petSettings.size,
    logPetSettingsPushed: pushed,
    logUiConfigApplied: appliedLog,
  })

  // 2) 应急：cmd:nativeui on/off（真实桌宠，1.2s 后恢复隐藏）
  const nuiOn = await handler('pet.nativeui', { on: true })
  await sleep(1200)
  const nuiOff = await handler('pet.nativeui', { on: false })
  step('nativeui on/off', { onOk: nuiOn.ok, offOk: nuiOff.ok, errors: [nuiOn.error, nuiOff.error].filter(Boolean) })

  // 3) 应急动作：start-pet（幂等；若桌宠已在跑应无副作用）
  const act = await handler('action.request', { name: 'start-pet' })
  step('action.request start-pet', { ok: act.ok, queued: act.data?.queued, request: act.data?.request })
  await sleep(26000)
  const afterAct = (await handler('state.get')).data
  step('after action 26s', {
    lastAction: afterAct.lastAction,
    logActions: grepLog('ui-action').slice(-4),
  })

  // 4) 恢复：逐字节写回原 ui-config + 等联动插件回读
  await handler('config.set', { pet: { size: baselineSize } })
  if (originalUi !== null) {
    await sleep(26500)
    fs.writeFileSync(uiFile, originalUi, 'utf8')
    await sleep(21000)
  }
  const restored = (await handler('state.get')).data
  step('restored', {
    uiConfigRestoredByteEqual: originalUi !== null
      ? fs.readFileSync(uiFile, 'utf8') === originalUi
      : null,
    size: restored.petSettings.size,
    bubble: restored.bubble,
  })

  result.ok = true
} catch (error) {
  result.ok = false
  result.error = String(error && error.stack ? error.stack : error)
  console.error('E2E failed:', error)
  // 兜底恢复
  try {
    if (originalUi !== null) fs.writeFileSync(uiFile, originalUi, 'utf8')
  } catch { /* ignore */ }
} finally {
  result.finishedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8')
  console.log('\nwritten:', outFile)
  console.log('ok:', result.ok)
  if (!result.ok) process.exitCode = 1
}
