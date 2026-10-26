// action-director 单元测试：导演 JSON 解析/白名单/边界/兜底/perf payload
import assert from 'node:assert/strict'
import {
  DIRECTOR_KINDS,
  DIRECTOR_LIMITS,
  CLIP_NAMES,
  OP_ACTION_HINTS,
  isDirectorKind,
  buildDirectorSuffix,
  parseDirectorPlan,
  fallbackPlan,
  perfPayload
} from '../lib/action-director.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ACTS = [
  'idleBase',
  'idleShift',
  'idleSettle',
  'walk',
  'jump',
  'think',
  'hum',
  'peek',
  'wave',
  'stretch',
  'pat',
  'eat',
  'sleep',
  'cry',
  'turnStop'
]
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

run('director kinds', () => {
  for (const k of ['clickLine', 'doubleClickLine', 'praise', 'interactHead', 'turnEnd', 'selfTalk'])
    assert.ok(isDirectorKind(k), k)
  assert.equal(isDirectorKind('report'), false)
  assert.ok(DIRECTOR_KINDS.has('clickLine'))
})

run('B 词表 50 段 clip + DSH 操作映射', () => {
  assert.equal(CLIP_NAMES.length, 50)
  assert.equal(new Set(CLIP_NAMES).size, 50)
  for (const n of ['开始工作', '工作结束', '工作被打扰', '被吓一跳（炸毛）', '看表叹气', '待机呼吸休闲'])
    assert.ok(CLIP_NAMES.includes(n), n)
  for (const k of ['turnStart', 'tool', 'approval', 'done', 'error', 'longTask', 'idle'])
    assert.ok(OP_ACTION_HINTS[k], k)
})

run('buildDirectorSuffix contains schema and whitelist', () => {
  const s = buildDirectorSuffix({ acts: ACTS })
  assert.match(s, /导演任务/)
  assert.match(s, /"beats"/)
  assert.match(s, /\[A 动作白名单\]/)
  assert.match(s, /\[B clip 白名单\]/)
  assert.match(s, /think/)
  assert.match(s, /开始工作/)
  assert.match(s, /2–4 拍/)
  assert.match(s, /turnStart=/)
})

run('parse valid plan', () => {
  const r = parseDirectorPlan(
    JSON.stringify({
      text: '湖面很安静',
      beats: [
        { act: 'think', ms: 800 },
        { act: 'hum', ms: 600 },
        { act: 'wave', ms: 400 }
      ],
      intensity: 1.2
    }),
    { acts: ACTS }
  )
  assert.equal(r.ok, true)
  assert.equal(r.plan.text, '湖面很安静')
  assert.equal(r.plan.beats.length, 3)
  assert.deepEqual(r.plan.beats[1], { act: 'hum', ms: 600 })
  assert.equal(r.plan.intensity, 1.2)
})

run('parse strips code fences / extra prose', () => {
  const raw = '好的：\n```json\n{"text":"尾巴轻轻摆","beats":[{"act":"wave","ms":500},{"act":"peek","ms":400}]}\n```'
  const r = parseDirectorPlan(raw, { acts: ACTS })
  assert.equal(r.ok, true)
  assert.equal(r.plan.text, '尾巴轻轻摆')
})

run('B clip beats + optional text/intensity/transitionMs/interrupt', () => {
  const r = parseDirectorPlan(
    JSON.stringify({
      beats: [
        { act: '点击回应 - 开心跃动', ms: 500, intensity: 1.2, transitionMs: 120 },
        { act: 'think', ms: 600 },
        { act: '工作结束', ms: 800 }
      ],
      interrupt: true
    }),
    { acts: ACTS }
  )
  assert.equal(r.ok, true)
  assert.equal(r.plan.text, '')
  assert.equal(r.plan.interrupt, true)
  assert.deepEqual(r.plan.beats[0], { act: '点击回应 - 开心跃动', ms: 500, intensity: 1.2, transitionMs: 120 })
  assert.equal(r.plan.beats[2].act, '工作结束')
})

run('invalid json → reason invalid-json', () => {
  for (const raw of ['', 'not json', '{"text": }', '[]']) {
    const r = parseDirectorPlan(raw, { acts: ACTS })
    assert.equal(r.ok, false, raw)
    assert.equal(r.reason, 'invalid-json')
  }
})

run('invalid text: digits/emoji/too-long/banned', () => {
  const base = {
    beats: [
      { act: 'think', ms: 500 },
      { act: 'hum', ms: 500 }
    ]
  }
  for (const text of ['白饭123粒', '好耶😀', 'x'.repeat(60), '作为AI我不能', '']) {
    const r = parseDirectorPlan(JSON.stringify({ text, ...base }), { acts: ACTS })
    assert.equal(r.ok, false, text)
    assert.equal(r.reason, 'invalid-text')
  }
})

run('beats below min / above max / unknown acts filtered', () => {
  const below = parseDirectorPlan(JSON.stringify({ text: '湖面很安静', beats: [{ act: 'think', ms: 500 }] }), {
    acts: ACTS
  })
  assert.equal(below.ok, false)
  assert.equal(below.reason, 'too-few-beats')
  const unknown = parseDirectorPlan(
    JSON.stringify({
      text: '湖面很安静',
      beats: [
        { act: 'fly', ms: 500 },
        { act: 'hack', ms: 500 }
      ]
    }),
    { acts: ACTS }
  )
  assert.equal(unknown.ok, false)
  const above = parseDirectorPlan(
    JSON.stringify({
      text: '湖面很安静',
      beats: ACTS.slice(0, 8).map((act) => ({ act, ms: 300 }))
    }),
    { acts: ACTS, maxBeats: 4 }
  )
  assert.equal(above.ok, true)
  assert.equal(above.plan.beats.length, 4)
})

run('ms/intensity clamp', () => {
  const r = parseDirectorPlan(
    JSON.stringify({
      text: '湖面很安静',
      beats: [
        { act: 'think', ms: 99 },
        { act: 'hum', ms: 99999 }
      ],
      intensity: 9
    }),
    { acts: ACTS }
  )
  assert.equal(r.ok, true)
  assert.equal(r.plan.beats[0].ms, DIRECTOR_LIMITS.beatMsMin)
  assert.equal(r.plan.beats[1].ms, DIRECTOR_LIMITS.beatMsMax)
  assert.equal(r.plan.intensity, DIRECTOR_LIMITS.intensityMax)
})

run('fallbackPlan single action', () => {
  const p = fallbackPlan('clickLine', 'invalid-json')
  assert.equal(p.fallback, true)
  assert.equal(p.beats.length, 1)
  assert.equal(p.beats[0].act, 'think')
  assert.equal(p.reason, 'invalid-json')
})

run('perfPayload schema', () => {
  const payload = JSON.parse(
    perfPayload(
      {
        intensity: 1.1,
        interrupt: true,
        text: '湖面很安静',
        beats: [
          { act: 'wave', ms: 500 },
          { act: '点击回应 - 害羞惊讶', ms: 400, transitionMs: 90 }
        ]
      },
      { kind: 'clickLine' }
    )
  )
  assert.equal(payload.v, 1)
  assert.equal(payload.kind, 'clickLine')
  assert.equal(payload.onEnd, 'idle')
  assert.equal(payload.priority, 'normal')
  assert.equal(payload.beats.length, 2)
  assert.equal(payload.beats[1].act, '点击回应 - 害羞惊讶')
  assert.equal(payload.beats[1].transitionMs, 90)
  assert.equal(payload.text, '湖面很安静')
  assert.equal(payload.interrupt, true)
  assert.match(payload.source, /action-director/)
})

run('index wiring static contract', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const src = fs.readFileSync(path.join(root, 'plugin', 'server', 'lib', 'index.js'), 'utf8')
  assert.match(src, /buildDirectorSuffix/)
  assert.match(src, /parseDirectorPlan/)
  assert.match(src, /runDirectorPlan/)
  assert.match(src, /perf plan/)
  assert.match(src, /channel === 'perf'/)
  assert.match(src, /'perf:' \+ perfPayload/)
  assert.match(src, /perf send/)
  assert.match(src, /channel: 'perf'/)
  assert.match(src, /send\('act:' \+ String\(beat\.act\)/)
})

console.log(`action-director tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
