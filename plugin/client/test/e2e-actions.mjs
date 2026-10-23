/**
 * dsh-pet-bridge-ui — task-36/40 快捷动作真实链路验证
 *
 * 直接调用 Host 半边 handler（与面板同一代码路径），经命名管道让真实桌宠执行：
 *   weather / music / summary / show / hide / snapInto / recover / quietStart / quietEnd / balance(待就绪)
 * 并记录桌宠回执（cmd:<name> / unknowncmd:<name> / <...>-fail）。
 *
 * 安全：都是桌宠原生菜单等价操作；hide 后立即 show 恢复；quiet 1 分钟后结束；
 * 不重启 host、不杀进程、不写 key。结果写 evidence/ui-actions-verify.json。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')
const PET_ROOT = process.env.PET_WORK || 'E:\\project\\AI提效\\tool\\pet-integration-src\\pet-work'
const outFile = path.join(PET_ROOT, 'evidence', 'ui-actions-verify.json')

const index = await import(pathToFileURL(path.join(libDir, 'index.js')).href)
const { buildHandler, DEFAULTS } = index.__test
const handler = buildHandler({ ...DEFAULTS }, { info() {}, warn() {} })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const result = { startedAt: new Date().toISOString(), actions: [] }
async function run(name, payload) {
  const r = await handler('pet.action', { name, ...(payload || {}) })
  const row = {
    name,
    ok: r.ok,
    reply: r.ok ? r.data.reply : null,
    error: r.ok ? null : r.error,
    at: new Date().toISOString(),
  }
  result.actions.push(row)
  console.log(name, '->', JSON.stringify(row))
  return row
}

try {
  const state = (await handler('state.get')).data
  result.before = {
    petOnline: state.pet.online,
    pipeOnline: state.pipe.online,
    actionsReady: state.capabilities.petActions,
    versions: state.versions,
  }
  if (!state.pipe.online) throw new Error('命名管道离线，跳过真实动作验证')

  await run('weather')
  await sleep(1200)
  await run('summary')
  await sleep(1200)
  await run('music')
  await sleep(800)
  await run('hide')
  await sleep(1200)
  await run('show')
  await sleep(600)
  await run('snapInto')
  await sleep(600)
  await run('recover')
  await sleep(600)
  await run('quietStart', { minutes: 1 })
  await sleep(800)
  await run('quietEnd')
  await sleep(600)
  await run('balance') // 预期 not-supported（v19 前）

  const after = (await handler('state.get')).data
  result.after = { petOnline: after.pet.online, pipeOnline: after.pipe.online }
  result.ok = result.actions.filter((a) => a.ok).length >= 7
} catch (error) {
  result.ok = false
  result.error = String(error && error.stack ? error.stack : error)
  console.error('actions verify failed:', error)
  try {
    // 兜底：确保桌宠不处于隐藏状态
    await handler('pet.action', { name: 'show' })
  } catch { /* ignore */ }
} finally {
  result.finishedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8')
  console.log('\nwritten:', outFile)
  console.log('ok:', result.ok)
  if (!result.ok) process.exitCode = 1
}
