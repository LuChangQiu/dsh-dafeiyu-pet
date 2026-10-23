/**
 * 生成 harness 数据 fixture：用真实 host 半边（只读）采集当前环境状态 + 日志。
 * 用法：node test/make-fixture.mjs <输出 fixture.js 路径>
 *
 * 说明：只调用 state.get / logs.get（只读：读日志、读 state.json、探管道、tasklist），
 * 不做任何写操作；输出内容不含 key / 用户对话原文（日志里只有桌宠台词与插件行为）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.join(here, '..', 'lib')
const outFile = process.argv[2] || path.join(here, 'harness', 'fixture.js')

const index = await import(pathToFileURL(path.join(libDir, 'index.js')).href)
const { buildHandler, DEFAULTS } = index.__test

const noop = { info() {}, warn() {} }
const handler = buildHandler({ ...DEFAULTS }, noop)

const state = await handler('state.get')
const logs = await handler('logs.get', { lines: 80 })

const payload = { state: state.data, logs: logs.data, generatedAt: new Date().toISOString() }
// 可选：注入合成 runtime 状态用于 harness 截图（真实环境 status 字段由联动插件 task-44 提供）
// 用法：node test/make-fixture.mjs <out> '{"state":"tool","tool":"pwsh","step":4,"turn":2,...}'
if (process.argv[3]) {
  const runtime = JSON.parse(process.argv[3])
  payload.state.runtime = runtime
  console.log('fixture runtime injected:', JSON.stringify(runtime))
}
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, 'window.__FIXTURE__ = ' + JSON.stringify(payload, null, 2) + ';\n', 'utf8')
console.log('fixture written:', outFile)
console.log('state keys:', Object.keys(payload.state).join(', '))
console.log('logs lines:', payload.logs.lines.length)
