/**
 * 安全的 profile patch 改写器（唯一允许修改 cordis.patch.yml 的入口）。
 *
 * 规则：按插件 id 定向编辑，**绝不手写整文件**；流程固定：
 *   1) 备份 <patch>.bak-<ts>
 *   2) 只在目标范围内做文本替换（替换次数可核对）
 *   3) 用 js-yaml 解析新内容（重复 key/缩进错误会失败）+ 插件块命中检查
 *   4) 校验失败 → 不保存，退出 1；校验通过 → 临时文件 + rename 原子写
 *   5) 写入抛错 → 用备份回滚
 *
 * 用法：
 *   node scripts/safe-patch.mjs --id pet-bridge-v49 --replace "<old>" "<new>" [--dry-run] [--json]
 *   node scripts/safe-patch.mjs --id pet-bridge-v49 --set-key testHookFile "''" [--dry-run]
 *   node scripts/safe-patch.mjs --activate --id pet-bridge-v491 [--name dsh-pet-bridge-v491] [--dry-run]
 *   node scripts/safe-patch.mjs --deactivate [--dry-run]
 *   --patch 指定 patch 路径（默认 profile web）
 *
 * 挂载窗口语义（MOUNT-PROTOCOL）：
 *   --activate   把 pet-bridge-vNN / pet-bridge-ui 两个注释块取消注释（mount），
 *                并把 bridge 的 id/name 切成目标版本（name 默认 dsh-<id>）。
 *   --deactivate 把两个插件块整体注释掉（默认未挂载状态）。
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
const doActivate = flag('activate')
const doDeactivate = flag('deactivate')

const defaultPatch = process.env.DSH_PROFILE_PATCH || 'C:/Users/xiqi/.dsh/profiles/web/cordis.patch.yml'
const patch = path.resolve(opt('patch', defaultPatch))
const id = String(opt('id', '')).trim()

if (!doActivate && !doDeactivate && !id) {
  console.error('usage: safe-patch --id <plugin-entry-id> (--replace <old> <new> | --set-key <key> <yamlValue>)')
  console.error('       safe-patch --activate --id <new-bridge-id> [--name <pkg-name>] | --deactivate')
  process.exit(2)
}
if (doActivate && !/^pet-bridge-v\d+$/.test(id)) {
  console.error('--activate 需要 --id pet-bridge-vNN')
  process.exit(2)
}
if (!fs.existsSync(patch)) {
  console.error('patch 不存在: ' + patch)
  process.exit(2)
}
const original = fs.readFileSync(patch, 'utf8')
const eol = original.includes('\r\n') ? '\r\n' : '\n'

const BRIDGE_ID_RE = /^pet-bridge-v\d+$/
const isPluginId = (v) => BRIDGE_ID_RE.test(v) || v === 'pet-bridge-ui'
const indentOf = (line) => (/^\s*/.exec(line) || [''])[0]

/** 找 insert 块：从 "- insert:" 行起，到下一个顶层 "- id:"/- "insert:"（或 EOF）为止；返回 0-based [start,end)。 */
function findPluginInsertBlocks(lines) {
  const blocks = []
  const insertRe = /^\s*-\s*insert:\s*$/
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const stripped = raw.replace(/^#\s?/, '').trimStart()
    if (!insertRe.test(stripped)) continue
    // 往后找第一条 id 行（允许中间有注释/空行）
    let j = i + 1
    while (j < lines.length) {
      const probe = lines[j].replace(/^#\s?/, '').trim()
      if (!probe) {
        j++
        continue
      }
      break
    }
    const idLine = (lines[j] || '').replace(/^#\s?/, '')
    const m = /^\s*-\s*id:\s*(\S+)\s*$/.exec(idLine)
    if (!m || !isPluginId(m[1])) continue
    // 找下一个顶层条目
    let end = i + 1
    while (end < lines.length) {
      const probe = lines[end].replace(/^#\s?/, '')
      if (/^\s*-\s*(id|insert):\s*/.test(probe) && indentOf(probe) === '') break
      end++
    }
    blocks.push({ start: i, end, id: m[1] })
    i = end - 1
  }
  return blocks
}

/** 将块内每行去掉一层注释（只处理 YAML 结构行，保留块内原有文档注释，如 '── 大肥鱼 × DSH …' 标题）。 */
function uncommentBlock(lines, block) {
  const YAML_LINE_RE = /^\s*(?:[-{}[\]'"]|[A-Za-z_$][\w.$-]*\s*:)/
  for (let i = block.start; i < block.end; i++) {
    if (!lines[i].startsWith('# ')) continue
    const body = lines[i].slice(2)
    if (YAML_LINE_RE.test(body)) lines[i] = body
  }
}

/** 将块内每行加一层注释（空行/已注释行保持）。 */
function commentBlock(lines, block) {
  for (let i = block.start; i < block.end; i++) {
    if (lines[i].trim() === '') continue
    if (!lines[i].startsWith('#')) lines[i] = '# ' + lines[i]
  }
}

/** 把已挂载的 bridge id/name 切成目标版本。返回 {changed, oldId}。 */
function retargetBridge(lines, newId, newName) {
  let oldId = ''
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*-\s*id:\s*)(\S+)\s*$/.exec(lines[i])
    if (!m || !BRIDGE_ID_RE.test(m[2])) continue
    oldId = m[2]
    if (oldId !== newId) lines[i] = m[1] + newId
    // 同条目的 name 行（在下一个顶层条目之前）
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s*(id|insert):\s*/.test(lines[j]) && indentOf(lines[j]) === '') break
      const nm = /^(\s*name:\s*)['"]dsh-[^'"]+['"]\s*$/.exec(lines[j])
      if (nm) {
        if (nm[1].length > indentOf(lines[i]).length) {
          lines[j] = nm[1] + `'${newName}'`
          break
        }
      }
    }
    break
  }
  return oldId
}

let next = original
let note = ''

if (doActivate) {
  const newName = String(opt('name', 'dsh-' + id)).trim()
  const lines = original.split(/\r?\n/)
  let blocks = findPluginInsertBlocks(lines)
  if (!blocks.length) {
    console.error('未找到 pet-bridge 插件 insert 块（无法挂载）')
    process.exit(1)
  }
  for (const b of blocks) uncommentBlock(lines, b)
  // 重新定位（取消注释后仍是同样的块位置）
  blocks = findPluginInsertBlocks(lines)
  const oldId = retargetBridge(lines, id, newName)
  next = lines.join(eol)
  note = `activate ${oldId || '?'} -> ${id} (pkg ${newName})`
} else if (doDeactivate) {
  const lines = original.split(/\r?\n/)
  const blocks = findPluginInsertBlocks(lines)
  if (!blocks.length) {
    console.log('已处于未挂载状态（没有可注释的插件块）')
    note = 'deactivate (noop)'
    next = original
  } else {
    for (const b of blocks) commentBlock(lines, b)
    next = lines.join(eol)
    note = `deactivate (${blocks.length} block(s))`
  }
} else {
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
}

const expect = doActivate ? 'mounted' : doDeactivate ? 'unmounted' : 'any'
const validation = await validatePatchText(next, { expect })
const summary = {
  patch,
  id,
  action: note,
  dryRun,
  expect,
  ok: validation.ok,
  errors: validation.errors,
  warnings: validation.warnings,
  mounted: validation.mounted,
  ids: validation.ids.length
}
if (jsonOut) console.log(JSON.stringify(summary, null, 2))
else {
  console.log(`safe-patch: ${note}`)
  for (const w of validation.warnings || []) console.log(`  WARN ${w}`)
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
if (next === original) {
  console.log('内容无变化，未写入')
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
