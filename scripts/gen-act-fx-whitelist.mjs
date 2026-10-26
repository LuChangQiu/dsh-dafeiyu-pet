import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
const root = process.cwd()
const candidates = [
  join(root, 'assets', 'whale-girl', 'manifest.json'),
  join(root, 'pet', 'assets', 'whale-girl', 'manifest.json'),
  join(root, '..', '..', 'pet-integration-src', 'pet-work', 'assets', 'whale-girl', 'manifest.json')
]
const manifestPath = candidates.find((p) => existsSync(p)) || candidates[candidates.length - 1]
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
try {
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const a = m.actions || m.clips || {}
    const c = m.composites || {}
    for (const k of Object.keys(a)) acts.add(k)
    const META = new Set(['note', 'notes', 'description', 'version', 'meta'])
    for (const k of Object.keys(c)) {
      if (META.has(k)) {
        unknowns.push('composites.' + k)
      } else acts.add(k)
    }
    if (acts.size) source = 'manifest'
  }
} catch (e) {
  console.error('manifest read failed:', e.message)
}
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
