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
  'idle',
  'walk',
  'eat',
  'steal',
  'sneak',
  'sleep',
  'wake',
  'wave',
  'dance',
  'jump',
  'land',
  'turn',
  'drag',
  'fall',
  'cry',
  'sit',
  'blink'
]
const fallbackComposites = [
  'eat_cry',
  'steal_caught',
  'sleep_wake',
  'wave_jump',
  'drag_fall',
  'land_bounce',
  'turn_look',
  'cry_comfort',
  'play_ball',
  'stretch_yawn',
  'sneak_peek'
]
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
const unknowns = []
const fx = new Set(FX_14)
let source = 'fallback(task-92 pending)'
try {
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const a = m.actions || m.clips || {}
    const c = m.composites || {}
    for (const k of Object.keys(a)) acts.add(k)
    for (const k of Object.keys(c)) acts.add(k)
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
const target = join(root, 'docs', 'generated', 'act-fx-whitelist.json')
mkdirSync(dirname(target), { recursive: true })
const check = process.argv.includes('--check')
if (check) {
  const cur = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null
  const same =
    cur && JSON.stringify(cur.acts) === JSON.stringify(out.acts) && JSON.stringify(cur.fx) === JSON.stringify(out.fx)
  if (!same) {
    console.error('WHITELIST DRIFT: run node scripts/gen-act-fx-whitelist.mjs')
    process.exit(1)
  }
  console.log('whitelist OK', out.acts.length, 'acts /', out.fx.length, 'fx')
  process.exit(0)
}
writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log('generated', target, 'acts=' + out.acts.length, 'fx=' + out.fx.length, 'source=' + source)
