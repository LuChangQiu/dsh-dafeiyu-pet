// perf-script 单元测试（普通脚本；node <file> 退出码=结果）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SCRIPT_VERSION,
  TRACKS,
  buildVocabulary,
  buildScript,
  buildBaselineScript,
  normalizeScript,
  normalizeScriptV1,
  validateScript,
  assembleScript,
  canEmit,
  markEmitted,
  INTENT_TEMPLATES,
  perfScriptVersions
} from '../lib/perf-script.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..', '..')
const stateMap = JSON.parse(readFileSync(join(root, 'config', 'state-map.json'), 'utf8'))
const vocab = buildVocabulary(stateMap)

let pass = 0
let fail = 0
const run = (name, fn) => {
  try {
    fn()
    pass++
  } catch (err) {
    fail++
    console.error(`FAIL ${name}: ${err.message}`)
  }
}

run('schema version/tracks/templates', () => {
  assert.equal(SCRIPT_VERSION, 2)
  assert.deepEqual([...TRACKS], ['base', 'action', 'expression', 'bubble', 'fx', 'gaze', 'move'])
  assert.equal(Object.keys(INTENT_TEMPLATES).length, 18)
  assert.equal(perfScriptVersions().templateCount, 18)
})

run('all 18 intent templates build + validate', () => {
  for (const intentId of Object.keys(INTENT_TEMPLATES)) {
    const script = buildScript({ intentId, mode: 'active' })
    const r = validateScript(script, vocab)
    assert.equal(r.ok, true, `${intentId}: ${JSON.stringify(r.errors)}`)
    assert.equal(script.scriptVersion, 2)
    assert.ok(script.layers.some((l) => l.track === 'base'))
  }
})

run('baseline script valid', () => {
  const base = buildBaselineScript()
  const r = validateScript(base, vocab)
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

run('invalid clip rejected (note not playable / unknown)', () => {
  const s = buildScript({ intentId: 'react_ack' })
  s.layers[1].clip = 'note'
  const r = validateScript(s, vocab)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.reason === 'unknown-clip'))
  s.layers[1].clip = 'nope'
  assert.equal(validateScript(s, vocab).ok, false)
})

run('invalid composite rejected (note)', () => {
  const s = buildScript({ intentId: 'celebrate_done' })
  s.layers[1].composite = 'note'
  const r = validateScript(s, vocab)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.reason === 'unknown-composite'))
})

run('clip + composite mutually exclusive', () => {
  const s = buildScript({ intentId: 'react_ack' })
  s.layers[1].composite = 'cheer'
  const r = validateScript(s, vocab)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.reason === 'clip-composite-exclusive'))
})

run('unknown expression / fx cross-field misuse rejected', () => {
  const s = buildScript({ intentId: 'celebrate_done' })
  const face = s.layers.find((l) => l.track === 'expression')
  face.expression = 'not-an-expression'
  assert.ok(validateScript(s, vocab).errors.some((e) => e.reason === 'unknown-expression'))
  const s2 = buildScript({ intentId: 'celebrate_done' })
  const fx = s2.layers.find((l) => l.track === 'fx')
  fx.name = 'happy' // expression id in fx field → 必须拒绝
  assert.ok(validateScript(s2, vocab).errors.some((e) => e.reason === 'unknown-fx'))
})

run('bubble validation: kind/level/maxChars/textKey', () => {
  const badKind = buildScript({ intentId: 'celebrate_done' })
  badKind.layers.find((l) => l.track === 'bubble').kind = 'shout'
  assert.ok(validateScript(badKind, vocab).errors.some((e) => e.reason === 'unknown-bubble-kind'))
  const badLevel = buildScript({ intentId: 'celebrate_done' })
  badLevel.layers.find((l) => l.track === 'bubble').level = 'S9'
  assert.ok(validateScript(badLevel, vocab).errors.some((e) => e.reason === 'unknown-bubble-level'))
  const tooLong = buildScript({ intentId: 'celebrate_done' })
  tooLong.layers.find((l) => l.track === 'bubble').maxChars = 41
  assert.ok(validateScript(tooLong, vocab).errors.some((e) => e.reason === 'bubble-maxChars'))
  const rawText = buildScript({ intentId: 'celebrate_done' })
  rawText.layers.find((l) => l.track === 'bubble').textKey = '恭喜你完成了任务'
  assert.ok(validateScript(rawText, vocab).errors.some((e) => e.reason === 'bubble-textKey-must-be-semantic'))
})

run('duplicate layer id / missing required fields rejected', () => {
  const dup = buildScript({ intentId: 'react_ack' })
  dup.layers[1].id = 'base'
  assert.ok(validateScript(dup, vocab).errors.some((e) => e.reason === 'duplicate-layer-id'))
  const missing = buildScript({ intentId: 'react_ack' })
  delete missing.layers[1].dwellMs
  assert.ok(validateScript(missing, vocab).errors.some((e) => e.reason === 'bad-layer-field'))
  const badTrack = buildScript({ intentId: 'react_ack' })
  badTrack.layers[1].track = 'dancefloor'
  assert.ok(validateScript(badTrack, vocab).errors.some((e) => e.reason === 'bad-track'))
})

run('too many primary actions / bad source / bad script version rejected', () => {
  const s = buildScript({ intentId: 'react_ack' })
  s.layers.push({ ...s.layers[1], id: 'act2' })
  assert.ok(validateScript(s, vocab).errors.some((e) => e.reason === 'too-many-primary-actions'))
  const badSource = buildScript({ intentId: 'react_ack' })
  badSource.source = 'free text source'
  assert.ok(validateScript(badSource, vocab).errors.some((e) => e.reason === 'bad-source'))
  const v1 = buildScript({ intentId: 'react_ack' })
  v1.scriptVersion = 1
  assert.ok(validateScript(v1, vocab).errors.some((e) => e.reason === 'v1-script-needs-normalize'))
})

run('assembler rejects whole script and falls back to valid baseline', () => {
  const res = assembleScript({
    stateMap,
    intentId: 'react_ack',
    extraLayers: [
      {
        id: 'bad',
        track: 'action',
        clip: 'nope',
        atMs: 0,
        dwellMs: 0,
        fadeMs: 0,
        priority: 50,
        allowDuring: ['active']
      }
    ]
  })
  assert.equal(res.rejected, true)
  assert.ok(res.errors.length > 0)
  const baseValid = validateScript(res.script, vocab)
  assert.equal(baseValid.ok, true)
})

run('assembler ok path returns valid script', () => {
  const res = assembleScript({ stateMap, intentId: 'celebrate_done', mode: 'active' })
  assert.equal(res.rejected, false)
  assert.equal(res.errors.length, 0)
  assert.equal(validateScript(res.script, vocab).ok, true)
})

run('v1 compatibility: defaults filled + unknown fields reported', () => {
  const v1 = {
    id: 'perf-old-1',
    scriptVersion: 1,
    source: 'intent:react_ack',
    layers: [{ id: 'base', track: 'base', clip: 'idleBase' }],
    legacyField: 'ignored'
  }
  const { script, ignored } = normalizeScriptV1(v1)
  assert.equal(script.scriptVersion, 2)
  assert.equal(script.layers[0].priority, 30)
  assert.equal(script.layers[0].dwellMs, 0)
  assert.deepEqual(script.layers[0].allowDuring, ['active'])
  assert.deepEqual(ignored, ['legacyField'])
  assert.equal(validateScript(script, vocab).ok, true)
})

run('idempotency: cooldown + one-shot', () => {
  const registry = new Map()
  const first = canEmit({ registry, source: 'intent:celebrate_done', nowMs: 1000, cooldownMs: 6000 })
  assert.equal(first.emit, true)
  markEmitted({ registry, source: 'intent:celebrate_done', nowMs: 1000 })
  const tooSoon = canEmit({ registry, source: 'intent:celebrate_done', nowMs: 3000, cooldownMs: 6000 })
  assert.equal(tooSoon.emit, false)
  assert.equal(tooSoon.reason, 'cooldown')
  const later = canEmit({ registry, source: 'intent:celebrate_done', nowMs: 8000, cooldownMs: 6000 })
  assert.equal(later.emit, true)
  const oneShotKey = 'goal:evt-1'
  assert.equal(
    canEmit({ registry, source: 'intent:celebrate_goal', nowMs: 9000, cooldownMs: 0, oneShotKey }).emit,
    true
  )
  markEmitted({ registry, source: 'intent:celebrate_goal', nowMs: 9000, oneShotKey })
  const again = canEmit({ registry, source: 'intent:celebrate_goal', nowMs: 10000, cooldownMs: 0, oneShotKey })
  assert.equal(again.emit, false)
  assert.equal(again.reason, 'one-shot-done')
})

run('stress: 18 templates + invalid mutations all reject (no silent partial)', () => {
  for (const intentId of Object.keys(INTENT_TEMPLATES)) {
    const good = buildScript({ intentId })
    assert.equal(validateScript(good, vocab).ok, true)
    const bad = JSON.parse(JSON.stringify(good))
    bad.layers[bad.layers.length - 1].track = 'unknown-track'
    const res = assembleScript({ stateMap, intentId, extraLayers: [bad.layers[bad.layers.length - 1]] })
    assert.equal(res.rejected, true, `${intentId} should reject invalid extra layer`)
    assert.equal(validateScript(res.script, vocab).ok, true)
  }
})

console.log(`perf-script tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
