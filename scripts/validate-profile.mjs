/**
 * profile patch 校验器（只读）：
 *   node scripts/validate-profile.mjs [--patch <cordis.patch.yml>] [--json]
 * 检查：YAML 可解析（重复 key 会失败）、顶层数组、id 不重复、
 *       pet-bridge-vNN 恰好 1 个、pet-bridge-ui 恰好 1 个、插件 name 与 id 匹配。
 * 退出码：0 通过；1 失败；2 参数/文件错误。
 */

import path from 'node:path'
import fs from 'node:fs'
import { validatePatchFile } from './lib/patch-check.mjs'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const jsonOut = args.includes('--json')

const defaultPatch = process.env.DSH_PROFILE_PATCH || 'C:/Users/xiqi/.dsh/profiles/web/cordis.patch.yml'
const file = path.resolve(opt('patch', defaultPatch))

if (!fs.existsSync(file)) {
  console.error(`validate-profile: patch 不存在: ${file}`)
  process.exit(2)
}

const result = await validatePatchFile(file)
const report = {
  patch: file,
  bytes: result.bytes,
  hasBom: result.hasBom,
  ok: result.ok,
  errors: result.errors,
  warnings: result.warnings || [],
  ids: result.ids || [],
  checkedAt: new Date().toISOString()
}
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`validate-profile: ${file}`)
  console.log(`  bytes=${report.bytes} bom=${report.hasBom} ids=${report.ids.length}`)
  for (const w of report.warnings) console.log(`  WARN ${w}`)
  for (const e of report.errors) console.log(`  FAIL ${e}`)
  console.log(report.ok ? '  YAML OK / 插件块命中 OK' : '  校验失败')
}
process.exit(report.ok ? 0 : 1)
