import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
const root = process.cwd()
// B-only：不再依赖已删除的 assets/whale-girl/manifest.json；使用内置 A-fallback act 名（与历史白名单一致）
const fallbackClips = [
  'caught',
  'cheer',
  'cry',
  'dance',
  'drag',
  'eat',
  'eatSatisfied',
  'errorSequence',
  'fall',
  'hum',
  'idleBase',
  'idleSettle',
  'idleShift',
  'idleStretch',
  'jump',
  'land',
  'lonelySit',
  'pat',
  'report',
  'sleep',
  'sneak',
  'think',
  'tsundere',
  'turnStop',
  'waitPeek',
  'wake',
  'walk',
  'wave'
]
const fallbackComposites = []
const FX_14 = [
  'blink',
  'love',
  'shy',
  'zzz',
  'sweat',
  'dizzy',
  'spin',
  'heart',
  'tear',
  'anger',
  'surprise',
  'sleepy',
  'happy',
  'sad'
]
const acts = new Set()
const fx = new Set(FX_14)
let source = 'fallback(task-92 pending)'
let unknowns = []
if (!acts.size) {
  for (const k of fallbackClips) acts.add(k)
  for (const k of fallbackComposites) acts.add(k)
}
const out = { version: 1, generatedFrom: source, unknowns, acts: [...acts].sort(), fx: [...fx].sort() }
const text = JSON.stringify(out, null, 2) + '\n'
// CF1 方案 A：真源 docs/generated + 随包副本 plugin/server/lib/generated（逐字节一致）
const targets = [
  join(root, 'docs', 'generated', 'act-fx-whitelist.json'),
  join(root, 'plugin', 'server', 'lib', 'generated', 'act-fx-whitelist.json')
]
for (const t of targets) mkdirSync(dirname(t), { recursive: true })
const check = process.argv.includes('--check')
if (check) {
  for (const t of targets) {
    const cur = existsSync(t) ? readFileSync(t, 'utf8') : ''
    if (cur !== text) {
      console.error('WHITELIST DRIFT: ' + t + ' — run node scripts/gen-act-fx-whitelist.mjs')
      process.exit(1)
    }
  }
  console.log('whitelist OK', out.acts.length, 'acts /', out.fx.length, 'fx / 2 files in sync')
  process.exit(0)
}
for (const t of targets) writeFileSync(t, text, 'utf8')
console.log('generated', targets.join(' + '), 'acts=' + out.acts.length, 'fx=' + out.fx.length, 'source=' + source)
