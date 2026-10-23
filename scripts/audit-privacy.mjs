/**
 * v47 隐私抽检脚本（task-68）：v2 / events / companion / attribution / mode / 日志
 * 扫「绝对路径、key、对话原文类字段」是否 0 命中。
 *
 * 用法：
 *   node scripts/audit-privacy.mjs --dir "E:\...\pet-work"           # 默认文本报告
 *   node scripts/audit-privacy.mjs --dir "<pet-work>" --json         # 机器可读（verifier/CI）
 *   node scripts/audit-privacy.mjs --dir "<pet-work>" --log-tail 500 # 只查日志尾部 N 行
 *
 * 退出码：0 = 全部干净；1 = 有命中（会打印每个文件的 pattern 计数，不打印命中原文）。
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const flag = (name) => args.includes('--' + name)

const dir = opt('dir', process.env.PET_WORK_DIR || '')
const jsonOut = flag('json')
const logTail = Number(opt('log-tail', 0)) || 0
if (!dir) {
  console.error('usage: node scripts/audit-privacy.mjs --dir <pet-work> [--json] [--log-tail N]')
  process.exit(2)
}

const JSON_FILES = [
  'bridge-state-v2.json',
  'events.json',
  'companion.json',
  'attribution.json',
  'mode.json',
  'state.json'
]

const PATTERNS = [
  { id: 'winAbsolutePath', re: /[A-Za-z]:[\\/]/ },
  { id: 'uncPath', re: /\\\\\\\\[A-Za-z0-9._$-]+[\\/]/ },
  {
    id: 'secretKey',
    re: /(sk-[A-Za-z0-9]{16,}|ctx7sk-[A-Za-z0-9-]{8,}|api[_-]?key\s*["']?\s*[:=]|authorization\s*[:=]\s*bearer)/i
  },
  { id: 'conversationField', re: /"(objective|description|prompt|question|reasoning|answers|content)"\s*:/i }
]

const count = (text, re) =>
  (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length

const report = { dir, files: {}, log: null, findings: 0 }

for (const name of JSON_FILES) {
  const file = path.join(dir, name)
  const entry = { exists: false, patterns: {} }
  try {
    const text = fs.readFileSync(file, 'utf8')
    entry.exists = true
    entry.bytes = text.length
    for (const p of PATTERNS) {
      const n = count(text, p.re)
      if (n) {
        entry.patterns[p.id] = n
        report.findings += n
      }
    }
  } catch {}
  report.files[name] = entry
}

// 日志：只查最近 N 行（默认整个文件；旧日志归档后新文件很小）
const logFile = path.join(dir, 'evidence', 'pet-bridge-main.log')
try {
  let text = fs.readFileSync(logFile, 'utf8')
  if (logTail > 0) text = text.split(/\r?\n/).slice(-logTail).join('\n')
  const entry = { exists: true, bytes: text.length, patterns: {} }
  for (const p of PATTERNS.filter((x) => x.id !== 'conversationField')) {
    const n = count(text, p.re)
    if (n) {
      entry.patterns[p.id] = n
      report.findings += n
    }
  }
  report.log = entry
} catch {
  report.log = { exists: false }
}

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`privacy audit @ ${dir}`)
  for (const [name, e] of Object.entries(report.files)) {
    if (!e.exists) {
      console.log(`  - ${name}: (absent)`)
      continue
    }
    const hits = Object.entries(e.patterns)
    console.log(`  - ${name}: ${hits.length ? 'FAIL ' + JSON.stringify(e.patterns) : 'clean'}`)
  }
  const l = report.log
  console.log(
    `  - log: ${l.exists ? (Object.keys(l.patterns).length ? 'FAIL ' + JSON.stringify(l.patterns) : 'clean') : '(absent)'}`
  )
  console.log(`findings: ${report.findings}`)
}
process.exit(report.findings ? 1 : 0)
