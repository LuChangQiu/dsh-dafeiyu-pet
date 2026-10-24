/**
 * 安全的 profile patch 改写器（唯一允许修改 cordis.patch.yml 的入口）。
 *
 * 规则：按插件 id 定向编辑，**绝不手写整文件**；流程固定：
 *   1) 备份 <patch>.bak-<ts>
 *   2) 只在目标 id 所在的条目区间内做文本替换（替换次数可核对）
 *   3) 用 js-yaml 解析新内容（重复 key/缩进错误会失败）+ 插件块命中检查
 *   4) 校验失败 → 不保存，退出 1；校验通过 → 临时文件 + rename 原子写
 *   5) 写入抛错 → 用备份回滚
 *
 * 用法：
 *   node scripts/safe-patch.mjs --id pet-bridge-v49 --replace "<old>" "<new>" [--dry-run] [--json]
 *   node scripts/safe-patch.mjs --id pet-bridge-v49 --set-key testHookFile "''" [--dry-run]
 *   --patch 指定 patch 路径（默认 profile web）
 */

import fs from 'node:fs'
import path from 'node:path'
import { validatePatchText } from './lib/patch-check.mjs'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const flag = (name) => args.includes('--' + name)
const jsonOut = flag('json')
const dryRun = flag('dry-run')

const defaultPatch = process.env.DSH_PROFILE_PATCH || 'C:/Users/xiqi/.dsh/profiles/web/cordis.patch.yml'
const patch = path.resolve(opt('patch', defaultPatch))
const id = String(opt('id', '')).trim()
if (!id) {
  console.error('usage: safe-patch --id <plugin-entry-id> (--replace <old> <new> | --set-key <key> <yamlValue>)')
  process.exit(2)
}
if (!fs.existsSync(patch)) {
  console.error('patch 不存在: ' + patch)
  process.exit(2)
}
const original = fs.readFileSync(patch, 'utf8')
const eol = original.includes('\r\n') ? '\r\n' : '\n'

// ── 定位目标条目区间（id 行 → 下一个条目标记）
function sectionRange(text, entryId) {
  const re = new RegExp('(^|\\n)([ \\t]*- id:[ \\t]*' + entryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b)')
  const m = re.exec(text)
  if (!m) return null
  const start = m.index + (m[1] === '\n' ? 1 : 0)
  const after = start + m[2].length
  const boundary = /\n(?:- | {0,4}- id: | {2,4}- insert: )/g
  boundary.lastIndex = after
  const b = boundary.exec(text)
  const end = b ? b.index : text.length
  return { start, end }
}

const range = sectionRange(original, id)
if (!range) {
  console.error(`未找到 - id: ${id}（拒绝改整文件）`)
  process.exit(2)
}
let next = original
let note = ''

if (args.includes('--replace')) {
  const i = args.indexOf('--replace')
  const oldStr = args[i + 1]
  const newStr = args[i + 2]
  if (oldStr === undefined || newStr === undefined) {
    console.error('--replace 需要 <old> <new>')
    process.exit(2)
  }
  const section = original.slice(range.start, range.end)
  const count = section.split(oldStr).length - 1
  if (count !== 1) {
    console.error(`--replace 在 ${id} 区间内命中 ${count} 次（要求恰好 1 次）`)
    process.exit(1)
  }
  const newSection = section.replace(oldStr, newStr)
  next = original.slice(0, range.start) + newSection + original.slice(range.end)
  note = `replace (${count}x)`
} else if (args.includes('--set-key')) {
  const setI = args.indexOf('--set-key')
  const key = args[setI + 1]
  const val = args[setI + 2]
  if (!key || val === undefined) {
    console.error('--set-key 需要 <key> <yamlValue>')
    process.exit(2)
  }
  const section = original.slice(range.start, range.end)
  const lineRe = new RegExp('^(\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '):[^\\n]*$', 'm')
  if (!lineRe.test(section)) {
    console.error(`--set-key: ${id} 区间内未找到 key ${key}`)
    process.exit(1)
  }
  const newSection = section.replace(lineRe, `$1: ${val}`)
  next = original.slice(0, range.start) + newSection + original.slice(range.end)
  note = `set-key ${key}=${val}`
} else {
  console.error('需要 --replace 或 --set-key')
  process.exit(2)
}

const validation = await validatePatchText(next)
const summary = {
  patch,
  id,
  action: note,
  dryRun,
  ok: validation.ok,
  errors: validation.errors,
  ids: validation.ids.length
}
if (jsonOut) console.log(JSON.stringify(summary, null, 2))
else {
  console.log(`safe-patch: ${action(note)} on ${id}`)
  for (const e of validation.errors) console.log(`  FAIL ${e}`)
}

if (!validation.ok) {
  console.error('校验失败：未写入（原文件保持不变）')
  process.exit(1)
}
if (dryRun) {
  console.log('dry-run：校验通过，未写入')
  process.exit(0)
}

const ts = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${patch}.bak-${ts}`
fs.copyFileSync(patch, backup)
const tmp = `${patch}.tmp-${process.pid}`
try {
  fs.writeFileSync(tmp, next, 'utf8')
  fs.rmSync(patch, { force: true })
  fs.renameSync(tmp, patch)
  console.log(`已写入：${patch}`)
  console.log(`备份：${backup}`)
} catch (e) {
  try {
    fs.copyFileSync(backup, patch)
  } catch {}
  try {
    fs.rmSync(tmp, { force: true })
  } catch {}
  console.error('写入失败，已回滚：' + String((e && e.message) || e))
  process.exit(1)
}

function action(v) {
  return v
}
