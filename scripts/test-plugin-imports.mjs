/**
 * 静态检查：plugin/server/lib/index.js 里使用本地模块（./mode.js 等）导出的标识符时，
 * 必须已经在对应 import 里引入。防止出现 "xxx is not defined" 一类运行时致命错误
 * （v49 曾因 modeAllowsAct 未 import，在 long-task 计时器里崩溃整个 DSH host）。
 *
 * 用法：node scripts/test-plugin-imports.mjs
 * 退出码：0 通过；1 失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const target = path.join(repo, 'plugin', 'server', 'lib', 'index.js')

/** 本地模块 → 相对 index.js 的路径 */
const LOCAL_MODULES = {
  './mode.js': path.join(repo, 'plugin', 'server', 'lib', 'mode.js'),
  './pricing.js': path.join(repo, 'plugin', 'server', 'lib', 'pricing.js'),
  './privacy.js': path.join(repo, 'plugin', 'server', 'lib', 'privacy.js'),
  './tool-types.js': path.join(repo, 'plugin', 'server', 'lib', 'tool-types.js'),
  './team-view.js': path.join(repo, 'plugin', 'server', 'lib', 'team-view.js'),
  './text-fmt.js': path.join(repo, 'plugin', 'server', 'lib', 'text-fmt.js')
}

const source = fs.readFileSync(target, 'utf8')
let failed = 0

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const [spec, file] of Object.entries(LOCAL_MODULES)) {
  if (!fs.existsSync(file)) {
    console.error(`FAIL 缺少模块文件: ${spec}`)
    failed++
    continue
  }
  // 收集来自该模块的所有 import 名字（支持单行与多行；可有多条 import）
  const importRe = new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escapeRe(spec)}['"]`, 'gm')
  const imported = new Set()
  let body = source
  let m
  while ((m = importRe.exec(source)) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]
        .trim()
      if (name) imported.add(name)
    }
  }
  body = source.replace(importRe, '')

  // 模块实际导出
  const mod = await import('file:///' + file.replace(/\\/g, '/'))
  const exported = Object.keys(mod)
  for (const name of exported) {
    // 只关心被 index.js 引用到的导出名（取词边界匹配，已排除 import 语句本身）
    const useRe = new RegExp(`\\b${escapeRe(name)}\\b`)
    if (!useRe.test(body)) continue
    if (!imported.has(name)) {
      console.error(`FAIL ${spec}: 用到了 ${name} 但没有 import（运行时会 ReferenceError）`)
      failed++
    }
  }
}

if (failed) {
  console.error(`test-plugin-imports: ${failed} 个问题`)
  process.exit(1)
}
console.log('test-plugin-imports: OK（本地模块导出与 import 一致）')
