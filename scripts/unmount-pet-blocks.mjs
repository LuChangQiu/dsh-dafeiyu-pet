/**
 * 安全卸载：把 profile patch 里"大肥鱼插件"的两个 insert 块整体注释掉（DSH 不加载插件），
 * 保留文件其余内容；流程固定：备份 → 注释 → js-yaml 校验 → 确认无激活的 pet-bridge id → 原子写。
 * 用法：node unmount-pet-blocks.mjs <patch> [backupDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('C:/Users/xiqi/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml')

const patch = process.argv[2]
const backupDir = process.argv[3]
if (!patch) {
  console.error('usage: unmount-pet-blocks.mjs <patch> [backupDir]')
  process.exit(2)
}

const raw = fs.readFileSync(patch, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)

// 找到两个 insert 块的行号区间（1-based）：
// 1) 从 "- insert:" 且其后紧跟 "    - id: pet-bridge-" 开始
// 2) 到下一个顶层条目（"- id: " 行首）或 EOF 结束
const ranges = []
for (let i = 0; i < lines.length; i++) {
  if (/^-\s*insert:\s*$/.test(lines[i])) {
    // 向后找第一条 id 行，确认是 pet-bridge
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    const idLine = lines[j] || ''
    if (/^\s*-\s*id:\s*(pet-bridge-v\d+|pet-bridge-ui)\b/.test(idLine)) {
      // 向前吞掉紧邻的注释标题行（可选）
      let start = i
      while (start - 1 >= 0 && /^#/.test(lines[start - 1])) start--
      // 向后找下一个顶层条目
      let end = i + 1
      while (end < lines.length && !/^-\s*id:\s*/.test(lines[end])) end++
      ranges.push([start, end - 1]) // 0-based inclusive
      i = end - 1
    }
  }
}

if (!ranges.length) {
  console.log('没有找到可卸载的 pet-bridge insert 块（可能已卸载）')
  process.exit(0)
}

for (const [start, end] of ranges) {
  for (let i = start; i <= end; i++) {
    if (!lines[i].startsWith('#')) lines[i] = '# ' + lines[i]
  }
}

const nextText = lines.join(eol)
try {
  yaml.load(nextText)
} catch (e) {
  console.error('VALIDATE FAIL (yaml): ' + e.message)
  process.exit(1)
}
// 确认没有激活的 pet-bridge id（非注释行）
const active = nextText.split(/\r?\n/).filter((l) => /^\s*-\s*id:\s*(pet-bridge-v\d+|pet-bridge-ui)\b/.test(l))
if (active.length) {
  console.error('VALIDATE FAIL: 仍有激活的 pet-bridge id: ' + active.join(' | '))
  process.exit(1)
}

if (backupDir) {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const bak = path.join(backupDir, 'cordis.patch.yml.bak-' + stamp + '-before-unmount')
  fs.copyFileSync(patch, bak)
  console.log('backup=' + bak)
}
const tmp = patch + '.tmp-unmount'
fs.writeFileSync(tmp, nextText, 'utf8')
fs.renameSync(tmp, patch)
console.log('OK unmounted blocks=' + ranges.length)
